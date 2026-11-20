import {ProtocolError} from '@personal-agent/contracts';
import {createRuntimeAtomicStatePort} from '@personal-agent/runtime';
import {CalDavProvider, register as registerCalendar} from '@personal-agent/calendar';
import {createTodoRegisteredWriteHostPort,
  createReminderClockRevisionHostPort,
  createCalendarFreshnessCheckHostPort,
  createCalendarRegisteredWriteHostPort,
  createCalendarUpdateAndInvalidateReminderHostPort,
  createPolicyQuietHoursHostPort,
  createNotificationDeliverHostPort,
  createNotificationDeliverWhenDueHostPort,
  createGithubBoundCiFailureHostPort,
  createWorkspaceTestIntentCheckHostPort,
  createGithubBoundPrDiffHostPort,
  createGithubMergeGateHostPort,
  createGithubIssueSnapshotHostPort,
  createGithubMergedRepairReadbackHostPort,
  createRuntimeEnqueueIssueRepairHostPort,
  createGithubRegisteredCloseIssueHostPort,
  createOwnedWorkflowAdapter,
} from '@personal-agent/agentarts';

const CALENDAR_ACCOUNT = 'desktop-calendar';
const isPlain = value => !!value && typeof value === 'object' && !Array.isArray(value);

/** Creates a SQLite-backed atomic CAS TodoIdempotencyStore via RuntimeAtomicStatePort. */
export function createRuntimeTodoIdempotencyStore(getRuntime) {
  const port = () => {
    const runtime = getRuntime?.();
    if (!runtime?.loadCheckpoint || !runtime?.saveCheckpoint) return undefined;
    return createRuntimeAtomicStatePort(runtime, 'desktop-todo-idempotency');
  };
  return {
    get(key) {
      return port()?.read(key)?.value;
    },
    set(key, entry) {
      const store = port();
      if (!store) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Todo idempotency store unavailable');
      const current = store.read(key);
      const committed = store.compareAndSet(key, current?.revision, structuredClone(entry));
      if (!committed) {
        throw new ProtocolError('REVISION_CONFLICT', 'Todo idempotency store concurrent overwrite');
      }
    },
    reserve(key, entry) {
      const store = port();
      if (!store) throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Todo idempotency store unavailable');
      const committed = store.compareAndSet(key, undefined, structuredClone(entry));
      if (committed) return {reserved: true};
      const existing = store.read(key)?.value;
      return existing !== undefined ? {reserved: false, existing} : {reserved: false};
    },
  };
}

function adapterToolFromHostPort({nodeId, hostPort, sideEffect, requiredScopes, inputSchema, outputSchema, resolveInput}) {
  return createOwnedWorkflowAdapter({
    nodeId,
    kind: 'host',
    sideEffect,
    requiredScopes,
    inputSchema,
    outputSchema: outputSchema ?? {type: 'object', additionalProperties: true},
    execute: async (input, context) => {
      const nodeContext = {
        input: resolveInput ? resolveInput(input, context) : input,
        taskId: context.taskId,
        signal: context.signal,
        deadline: context.deadline,
        requestId: context.runId ?? context.taskId,
        mode: 'main',
        predecessorStates: {},
        predecessorOutputs: {},
      };
      const observation = await hostPort.read(nodeContext);
      if (observation.state === 'completed') return observation.value;
      const reason = isPlain(observation.value) && typeof observation.value.reason === 'string'
        ? observation.value.reason
        : `${nodeId}_failed`;
      if (observation.state === 'unknown') {
        const err = new ProtocolError('RESULT_UNKNOWN', reason, false);
        err.receipt = observation.value;
        throw err;
      }
      if (observation.state === 'unavailable') {
        const code = /unauthorized|auth|consent|grant/i.test(reason) ? 'UNAUTHORIZED' : 'UNSUPPORTED_CAPABILITY';
        throw new ProtocolError(code, reason, false);
      }
      const code = /mismatch|conflict/i.test(reason) ? 'REVISION_CONFLICT' : 'EXTERNAL_FAILURE';
      throw new ProtocolError(code, reason, false);
    },
  });
}

/**
 * Desktop production ports for Todo, CalDAV, notifications and developer workflows.
 */
export function createDesktopBusinessWorkflowHosts({
  getApplication = () => undefined,
  getTodoHost = () => undefined,
  getCalendarConfig = () => undefined,
  getNotificationHost = () => undefined,
  getDeveloperDeployment = () => undefined,
  getGithubPort = () => undefined,
  createCalendarProvider = options => new CalDavProvider(options),
  now = Date.now,
} = {}) {
  const todoIdempotencyStore = createRuntimeTodoIdempotencyStore(() => getApplication()?.runtime);

  function invokeTodoTool(operation, input, context) {
    const todoHost = getTodoHost?.();
    const tool = todoHost?.tools?.find?.(entry => entry.descriptor?.name === operation);
    if (!todoHost || !tool) {
      throw new ProtocolError('UNSUPPORTED_CAPABILITY', `待办工具 ${operation} 不可用`);
    }
    return tool.execute(input, {
      taskId: context?.taskId ?? context?.requestId ?? 'todo-workflow-task',
      runId: context?.runId ?? context?.requestId ?? 'todo-workflow-run',
      signal: context.signal,
      deadline: context.deadline,
      scopes: ['todo:write'],
      authorizationRef: context?.authorizationRef ?? 'todo-registered-write',
    });
  }

  async function invokeCalendarOperation(operation, input, context, scopeKind = 'read') {
    const calendarConfig = getCalendarConfig?.();
    const binding = calendarConfig?.binding?.();
    if (!binding || binding.providerKind !== 'caldav') {
      throw new ProtocolError('UNSUPPORTED_CAPABILITY', '日历配置未绑定');
    }
    const calendarScope = {
      taskId: context?.taskId ?? context?.requestId,
      kind: 'calendar',
      toolName: operation,
      requirementId: scopeKind === 'write' ? 'calendar-local-write' : 'calendar-local-read',
    };
    if (!calendarConfig.isSessionAllowed?.(binding.revision, calendarScope)) {
      throw new ProtocolError('UNAUTHORIZED', '日历本会话许可未授予或已撤销');
    }
    const authorization = await calendarConfig.readAuthorization(binding);
    const provider = createCalendarProvider({
      calendarUrl: binding.calendarUrl,
      calendarName: binding.calendarName,
      authorization,
      allowLoopbackHttp: true,
      now,
    });
    const tools = new Map();
    const unregister = registerCalendar(
      {register(tool) { tools.set(tool.descriptor.name, tool); return () => {}; }},
      {provider, accountRef: CALENDAR_ACCOUNT, now},
    );
    try {
      const tool = tools.get(operation);
      if (!tool) throw new ProtocolError('UNSUPPORTED_CAPABILITY', `日历操作 ${operation} 不可用`);
      return await tool.execute(input, {
        taskId: context?.taskId ?? context?.requestId ?? 'calendar-workflow-task',
        runId: context?.runId ?? context?.requestId ?? 'calendar-workflow-run',
        signal: context.signal,
        deadline: context.deadline,
        scopes: [scopeKind === 'write' ? 'calendar:write' : 'calendar:read'],
        authorizationRef: context?.authorizationRef ?? 'calendar-registered-host',
      });
    } finally {
      unregister();
    }
  }

  function currentCalendarAccountRef() {
    const calendarConfig = getCalendarConfig?.();
    const binding = calendarConfig?.binding?.();
    if (!binding || binding.providerKind !== 'caldav') return undefined;
    if (!calendarConfig.isSessionAllowed?.(binding.revision, {kind: 'calendar', requirementId: 'calendar-local-read'})) {
      return undefined;
    }
    return CALENDAR_ACCOUNT;
  }

  const calendarReadPort = {
    get accountRef() { return currentCalendarAccountRef(); },
    execute: (op, input, context) => invokeCalendarOperation(op, input, context, 'read'),
  };
  const calendarWritePort = {
    get accountRef() { return currentCalendarAccountRef(); },
    execute: (op, input, context) => invokeCalendarOperation(op, input, context, 'write'),
  };

  // 1. F06_N03: todo.registered_write
  const todoRegisteredWritePort = createTodoRegisteredWriteHostPort({
    idempotencyStore: todoIdempotencyStore,
    write: {
      execute: (op, input, context) => invokeTodoTool(op, input, context),
    },
    resolveWrite: context => isPlain(context.input) ? context.input : undefined,
  });

  // 2. F06_N04: reminder.current_clock_and_revision
  const reminderClockRevisionPort = createReminderClockRevisionHostPort({
    reminderPort: {
      nowUtc: () => new Date(now()).toISOString(),
      getReminder: async reminderId => getTodoHost?.()?.readReminderState?.(reminderId),
    },
    resolveTarget: context => isPlain(context.input) ? context.input : undefined,
  });

  // 3. F07_N04: calendar.freshness_check
  const calendarFreshnessPort = createCalendarFreshnessCheckHostPort({
    calendarPort: calendarReadPort,
    resolveTarget: context => {
      if (!isPlain(context.input)) return undefined;
      return {
        ...context.input,
        accountRef: context.input.accountRef ?? currentCalendarAccountRef(),
      };
    },
  });

  // 4. F07_N05: calendar.registered_write
  const calendarRegisteredWritePort = createCalendarRegisteredWriteHostPort({
    calendarPort: calendarWritePort,
    resolveWrite: context => {
      if (!isPlain(context.input)) return undefined;
      return {
        ...context.input,
        accountRef: context.input.accountRef ?? currentCalendarAccountRef(),
      };
    },
  });

  // 5. F11_N05: calendar.update_and_invalidate_reminder
  const calendarUpdateAndInvalidatePort = createCalendarUpdateAndInvalidateReminderHostPort({
    calendarPort: calendarWritePort,
    calendarReadPort,
    invalidationPort: {
      invalidateReminder: async (reminderId, reason) => {
        const todoHost = getTodoHost?.();
        if (!todoHost?.invalidateReminder) {
          throw new ProtocolError('UNSUPPORTED_CAPABILITY', '提醒作废接口不可用');
        }
        return todoHost.invalidateReminder(reminderId, reason);
      },
    },
    resolveInput: context => {
      if (!isPlain(context.input)) return undefined;
      return {
        ...context.input,
        accountRef: context.input.accountRef ?? currentCalendarAccountRef(),
      };
    },
  });

  // 8. F12_N02 / F06_N05 / F12_N04 / F12_N05: 通知策略、渠道投递与点击/撤回账本
  const policyQuietHoursPort = createPolicyQuietHoursHostPort({
    now,
    policyPort: {
      readPolicy: scope => getNotificationHost?.()?.getInterruptionPolicy?.(scope),
    },
  });

  const notificationDeliverPort = createNotificationDeliverHostPort({
    now,
    deliveryPort: {
      deliver: async request => {
        const host = getNotificationHost?.();
        if (!host?.deliverBatch) return {state: 'unavailable', reason: 'notification_host_unavailable'};
        return host.deliverBatch({
          batchId: request.batchId,
          scope: request.scope ?? {kind: 'global'},
          expiresAt: request.expiresAt,
          title: request.title,
          body: request.body,
          source: request.source ?? 'desktop',
          ...(isPlain(request.navigation) ? {navigation: request.navigation} : {}),
        });
      },
    },
  });

  const notificationDeliverWhenDuePort = createNotificationDeliverWhenDueHostPort({
    now,
    ledgerPort: {
      getDigest: query => {
        const host = getNotificationHost?.();
        if (!host?.getDigest) throw new ProtocolError('UNSUPPORTED_CAPABILITY', '通知账本不可用');
        return host.getDigest(query);
      },
      acknowledgeRead: input => {
        const host = getNotificationHost?.();
        if (!host?.acknowledgeRead) throw new ProtocolError('UNSUPPORTED_CAPABILITY', '通知已读确认不可用');
        return host.acknowledgeRead(input);
      },
      withdraw: input => {
        const host = getNotificationHost?.();
        if (!host?.withdrawDelivery) throw new ProtocolError('UNSUPPORTED_CAPABILITY', '通知撤回不可用');
        return host.withdrawDelivery(input);
      },
    },
  });

  // 9. F16 / F18 / F19: GitHub & 工作区开发工作流宿主端口
  const githubPort = {
    execute(operation, input, context) {
      const explicit = getGithubPort?.();
      const raw = isPlain(input) ? input : {};
      const slug = typeof raw.owner === 'string' && typeof raw.repo === 'string' && !raw.repo.includes('/')
        ? `${raw.owner}/${raw.repo}`
        : raw.repo;
      const {owner: _omitOwner, ...rest} = raw;
      const normalized = {...rest, ...(slug ? {repo: slug} : {})};
      if (explicit?.execute) {
        return explicit.execute(operation, normalized, {
          signal: context.signal,
          deadline: context.deadline,
        });
      }
      const deployment = getDeveloperDeployment?.();
      const tool = deployment?.host?.tools?.find?.(entry => entry.descriptor?.name === `github.${operation}`);
      if (!tool) {
        throw new ProtocolError('UNSUPPORTED_CAPABILITY', `GitHub 工具 github.${operation} 尚未装配`);
      }
      const scopes = tool.descriptor?.requiredScopes ?? ['github:read'];
      return tool.execute(normalized, {
        taskId: context?.taskId ?? context?.requestId ?? 'github-workflow-task',
        runId: context?.runId ?? context?.requestId ?? 'github-workflow-run',
        signal: context.signal,
        deadline: context.deadline,
        scopes,
        authorizationRef: context?.authorizationRef ?? 'github-workflow-host',
      });
    },
  };

  const resolveIssueOrPrBinding = context => {
    if (!isPlain(context.input)) return undefined;
    if (isPlain(context.input.issue)) return context.input.issue;
    if (typeof context.input.owner === 'string' && typeof context.input.repo === 'string'
      && Number.isSafeInteger(context.input.number)) {
      return {owner: context.input.owner, repo: context.input.repo, number: context.input.number};
    }
    return undefined;
  };

  const githubBoundCiFailurePort = createGithubBoundCiFailureHostPort({
    read: githubPort,
    resolveBinding: context => {
      if (!isPlain(context.input)) return undefined;
      const {owner, repo, commitSha, runId} = context.input;
      if (typeof owner !== 'string' || typeof repo !== 'string' || typeof commitSha !== 'string') return undefined;
      return {owner, repo, commitSha, ...(Number.isSafeInteger(runId) ? {runId} : {})};
    },
  });

  const workspaceTestIntentCheckPort = createWorkspaceTestIntentCheckHostPort();

  const githubBoundPrDiffPort = createGithubBoundPrDiffHostPort({
    read: githubPort,
    resolveBinding: resolveIssueOrPrBinding,
  });

  const githubMergeGatePort = createGithubMergeGateHostPort({
    read: githubPort,
    resolveBinding: resolveIssueOrPrBinding,
  });

  const githubIssueSnapshotPort = createGithubIssueSnapshotHostPort({
    read: githubPort,
    resolveBinding: resolveIssueOrPrBinding,
  });

  const runtimeEnqueueIssueRepairPort = createRuntimeEnqueueIssueRepairHostPort({
    runtime: {
      submitRepairTask(request) {
        const runtime = getApplication?.()?.runtime;
        if (!runtime?.submitTask) {
          throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'TaskRuntime 尚未就绪');
        }
        const task = runtime.submitTask({
          goal: `修复 Issue ${request.owner}/${request.repo}#${request.issueNumber}`,
          conversationId: `developer-issue-repair:${request.owner}/${request.repo}`,
          idempotencyKey: request.idempotencyKey,
        });
        return {taskId: task.taskId, state: task.state, idempotencyKey: request.idempotencyKey};
      },
    },
    resolveBinding: context => {
      if (!isPlain(context.input)) return undefined;
      const issue = resolveIssueOrPrBinding(context);
      if (!issue) return undefined;
      const linkedPrNumber = Number.isSafeInteger(context.input.linkedPrNumber) ? context.input.linkedPrNumber : undefined;
      return {issue, ...(linkedPrNumber !== undefined ? {linkedPrNumber} : {})};
    },
  });

  const githubMergedRepairReadbackPort = createGithubMergedRepairReadbackHostPort({
    read: githubPort,
    resolveBinding: context => {
      if (!isPlain(context.input)) return undefined;
      const issue = resolveIssueOrPrBinding(context);
      const repairPr = context.input.repairPr;
      if (!issue || !Number.isSafeInteger(repairPr)) return undefined;
      return {issue, repairPr};
    },
  });

  const githubRegisteredCloseIssuePort = createGithubRegisteredCloseIssueHostPort({
    github: githubPort,
    resolveBinding: context => {
      if (!isPlain(context.input)) return undefined;
      const issue = resolveIssueOrPrBinding(context);
      const {repairPr, expectedUpdatedAt, comment, verifiedPassed} = context.input;
      if (!issue || !Number.isSafeInteger(repairPr)) return undefined;
      return {
        issue,
        repairPr,
        verifiedPassed: verifiedPassed === true,
        ...(typeof expectedUpdatedAt === 'string' ? {expectedUpdatedAt} : {}),
        ...(typeof comment === 'string' ? {comment} : {}),
      };
    },
  });

  const ports = Object.freeze([
    todoRegisteredWritePort,
    reminderClockRevisionPort,
    calendarFreshnessPort,
    calendarRegisteredWritePort,
    calendarUpdateAndInvalidatePort,
    policyQuietHoursPort,
    notificationDeliverPort,
    notificationDeliverWhenDuePort,
    githubBoundCiFailurePort,
    workspaceTestIntentCheckPort,
    githubBoundPrDiffPort,
    githubMergeGatePort,
    githubIssueSnapshotPort,
    runtimeEnqueueIssueRepairPort,
    githubMergedRepairReadbackPort,
    githubRegisteredCloseIssuePort,
  ]);

  const byCapability = new Map(ports.flatMap(port => port.capabilities.map(cap => [cap, port])));

  const workflowHostTools = Object.freeze([
    adapterToolFromHostPort({
      nodeId: 'F06_N03',
      hostPort: todoRegisteredWritePort,
      sideEffect: 'local_write',
      requiredScopes: ['todo:write'],
      inputSchema: {type: 'object', additionalProperties: true, required: ['title', 'idempotencyKey']},
    }),
    adapterToolFromHostPort({
      nodeId: 'F06_N04',
      hostPort: reminderClockRevisionPort,
      sideEffect: 'read',
      requiredScopes: ['todo:read'],
      inputSchema: {type: 'object', additionalProperties: true, required: ['reminderId']},
    }),
    adapterToolFromHostPort({
      nodeId: 'F06_N05',
      hostPort: notificationDeliverPort,
      sideEffect: 'local_write',
      requiredScopes: ['notifications:deliver'],
      inputSchema: {type: 'object', additionalProperties: true, required: ['batchId', 'title', 'body', 'expiresAt']},
    }),
    adapterToolFromHostPort({
      nodeId: 'F07_N04',
      hostPort: calendarFreshnessPort,
      sideEffect: 'read',
      requiredScopes: ['calendar:read'],
      inputSchema: {type: 'object', additionalProperties: true},
    }),
    adapterToolFromHostPort({
      nodeId: 'F07_N05',
      hostPort: calendarRegisteredWritePort,
      sideEffect: 'external_write',
      requiredScopes: ['calendar:write'],
      inputSchema: {type: 'object', additionalProperties: true, required: ['summary', 'startUtc', 'endUtc']},
    }),
    adapterToolFromHostPort({
      nodeId: 'F11_N05',
      hostPort: calendarUpdateAndInvalidatePort,
      sideEffect: 'external_write',
      requiredScopes: ['calendar:write', 'todo:write'],
      inputSchema: {type: 'object', additionalProperties: true, required: ['externalId', 'reminderId']},
    }),
    adapterToolFromHostPort({
      nodeId: 'F12_N02',
      hostPort: policyQuietHoursPort,
      sideEffect: 'read',
      requiredScopes: ['notifications:read'],
      inputSchema: {type: 'object', additionalProperties: true},
    }),
    adapterToolFromHostPort({
      nodeId: 'F12_N04',
      hostPort: notificationDeliverPort,
      sideEffect: 'local_write',
      requiredScopes: ['notifications:deliver'],
      inputSchema: {type: 'object', additionalProperties: true, required: ['batchId', 'title', 'body', 'expiresAt']},
    }),
    adapterToolFromHostPort({
      nodeId: 'F12_N05',
      hostPort: notificationDeliverWhenDuePort,
      sideEffect: 'local_write',
      requiredScopes: ['notifications:deliver'],
      inputSchema: {type: 'object', additionalProperties: true},
    }),
    adapterToolFromHostPort({
      nodeId: 'F16_N01',
      hostPort: githubBoundCiFailurePort,
      sideEffect: 'read',
      requiredScopes: ['github:read'],
      inputSchema: {type: 'object', additionalProperties: true, required: ['owner', 'repo', 'commitSha']},
    }),
    adapterToolFromHostPort({
      nodeId: 'F16_N04',
      hostPort: workspaceTestIntentCheckPort,
      sideEffect: 'read',
      requiredScopes: ['workspace:read'],
      inputSchema: {type: 'object', additionalProperties: true},
    }),
    adapterToolFromHostPort({
      nodeId: 'F18_N01',
      hostPort: githubBoundPrDiffPort,
      sideEffect: 'read',
      requiredScopes: ['github:read'],
      inputSchema: {type: 'object', additionalProperties: true, required: ['owner', 'repo', 'number']},
    }),
    adapterToolFromHostPort({
      nodeId: 'F18_N04',
      hostPort: githubMergeGatePort,
      sideEffect: 'read',
      requiredScopes: ['github:read'],
      inputSchema: {type: 'object', additionalProperties: true, required: ['owner', 'repo', 'number']},
    }),
    adapterToolFromHostPort({
      nodeId: 'F19_N01',
      hostPort: githubIssueSnapshotPort,
      sideEffect: 'read',
      requiredScopes: ['github:read'],
      inputSchema: {type: 'object', additionalProperties: true, required: ['owner', 'repo', 'number']},
    }),
    adapterToolFromHostPort({
      nodeId: 'F19_N03',
      hostPort: runtimeEnqueueIssueRepairPort,
      sideEffect: 'local_write',
      requiredScopes: ['developer:write'],
      inputSchema: {type: 'object', additionalProperties: true},
    }),
    adapterToolFromHostPort({
      nodeId: 'F19_N04',
      hostPort: githubMergedRepairReadbackPort,
      sideEffect: 'read',
      requiredScopes: ['github:read'],
      inputSchema: {type: 'object', additionalProperties: true, required: ['repairPr']},
    }),
    adapterToolFromHostPort({
      nodeId: 'F19_N05',
      hostPort: githubRegisteredCloseIssuePort,
      sideEffect: 'external_write',
      requiredScopes: ['github:write'],
      inputSchema: {type: 'object', additionalProperties: true, required: ['repairPr', 'verifiedPassed']},
    }),
  ]);

  return Object.freeze({
    ports,
    workflowHostTools,
    findPort: capability => byCapability.get(capability),
    asCompositeHostPort: () => ({
      capabilities: [...byCapability.keys()],
      async read(context) {
        const cap = context.node?.capabilities?.find(c => byCapability.has(c.name))?.name;
        if (!cap) return {state: 'unavailable', value: {reason: 'capability_not_bound'}};
        return byCapability.get(cap).read(context);
      },
    }),
  });
}
