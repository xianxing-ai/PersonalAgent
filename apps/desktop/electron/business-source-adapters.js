import {ProtocolError} from '@personal-agent/contracts';
import {CalDavProvider, CalendarService} from '@personal-agent/calendar';
import {MailService, QQMailProvider, decodeMailCursor} from '@personal-agent/mail';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';

const DEFAULT_CALENDAR_DAYS = 7;
const DEFAULT_MAIL_LIMIT = 20;
const MAIL_ACCOUNT = 'desktop-qq-inbox';
const CALENDAR_ACCOUNT = 'desktop-calendar';

function fail(code, message) {
  throw new ProtocolError(code, message);
}

function assertScopeActive(context, requiredScope, now) {
  if (!context || typeof context !== 'object') fail('INVALID_ARGUMENT', '缺少任务执行上下文');
  if (context.signal?.aborted) fail('CANCELLED', '来源读取已取消');
  const deadlineMs = Date.parse(context.deadline);
  if (!Number.isFinite(deadlineMs) || deadlineMs <= now()) fail('TIMEOUT', '来源读取期限已到');
  if (typeof context.taskId !== 'string' || !context.taskId.trim()
    || typeof context.runId !== 'string' || !context.runId.trim()
    || typeof context.authorizationRef !== 'string' || !context.authorizationRef.trim()) {
    fail('UNAUTHORIZED', '主动来源读取缺少正式任务或授权绑定');
  }
  if (context.conversationId && [context.taskId, context.runId, context.authorizationRef].includes(context.conversationId)) {
    fail('UNAUTHORIZED', '主动来源读取禁止将对话标识复用为任务或授权标识');
  }
  if (!Array.isArray(context.scopes) || !context.scopes.includes(requiredScope)) {
    fail('SCOPE_DENIED', `主动来源读取缺少所需权限范围：${requiredScope}`);
  }
}

function assertPolicyGranted(getApplication, toolName, requiredScopes, input, context, now) {
  const runtime = getApplication()?.runtime;
  if (!runtime?.policy?.authorize) return;
  if (typeof runtime.getTask === 'function') {
    const task = runtime.getTask(context.taskId);
    if (!task || task.cancelRequested || task.state !== 'running') {
      fail('REVISION_CONFLICT', '主动来源任务状态未处于执行中');
    }
  }
  runtime.policy.authorize({
    authorizationRef: context.authorizationRef,
    taskId: context.taskId,
    toolName,
    requiredScopes,
    now: now(),
    argumentsDigest: toolArgumentsDigest(input ?? {}),
  });
}

function defaultCalendarWindow(nowMs) {
  return {
    fromUtc: new Date(nowMs).toISOString(),
    toUtc: new Date(nowMs + DEFAULT_CALENDAR_DAYS * 86_400_000).toISOString(),
  };
}

/**
 * Production business source adapters for CW-05 (`proactiveWorkflowApplication`) and
 * CW-03 (`proactiveSourceHost`). Never constructs credentials from tool input or bypasses
 * TaskRuntime/Policy/connector session authorization.
 */
export function createDesktopBusinessSourceAdapters({
  getApplication = () => undefined,
  getCalendarConfig = () => undefined,
  getMailConfig = () => undefined,
  getFeedsHost = () => undefined,
  createCalendarProvider = options => new CalDavProvider(options),
  createMailProvider = options => new QQMailProvider(options),
  now = Date.now,
} = {}) {
  const calendarDescriptor = {
    name: 'calendar.events',
    version: '0.1.0-alpha.1',
    sideEffect: 'read',
    requiredScopes: ['calendar:read'],
    requiresPresence: false,
  };
  const mailDescriptor = {
    name: 'mail.inbox',
    version: '0.1.0-alpha.1',
    sideEffect: 'read',
    requiredScopes: ['mail:read'],
    requiresPresence: false,
  };
  const feedsDescriptor = {
    name: 'feeds.collect',
    version: '0.1.0-alpha.1',
    sideEffect: 'read',
    requiredScopes: ['feeds:read'],
    requiresPresence: false,
  };

  async function readCalendarEvents(input = {}, context) {
    assertScopeActive(context, 'calendar:read', now);
    assertPolicyGranted(getApplication, 'calendar.events', ['calendar:read'], input, context, now);
    const calendarConfig = getCalendarConfig?.();
    const binding = calendarConfig?.binding?.();
    if (!binding || binding.providerKind !== 'caldav') {
      fail('UNSUPPORTED_CAPABILITY', '日历配置未绑定或已撤销');
    }
    const calendarScope = {...context, kind: 'calendar', toolName: 'calendar.events', requirementId: 'calendar-local-read'};
    if (!calendarConfig.isSessionAllowed?.(binding.revision, calendarScope)) {
      fail('UNAUTHORIZED', '日历本会话读取许可未授予或已撤销');
    }
    const authorization = await calendarConfig.readAuthorization(binding);
    const provider = createCalendarProvider({
      calendarUrl: binding.calendarUrl,
      calendarName: binding.calendarName,
      authorization,
      allowLoopbackHttp: true,
      now,
    });
    const service = new CalendarService(provider, {now});
    const defaults = defaultCalendarWindow(now());
    const window = {
      fromUtc: typeof input?.fromUtc === 'string' ? input.fromUtc : defaults.fromUtc,
      toUtc: typeof input?.toUtc === 'string' ? input.toUtc : defaults.toUtc,
    };
    const page = await service.listEvents(CALENDAR_ACCOUNT, window, {
      limit: Number.isInteger(input?.limit) ? input.limit : 20,
      ...(typeof input?.cursor === 'string' && input.cursor ? {cursor: input.cursor} : {}),
      signal: context.signal,
      deadline: context.deadline,
    });
    return {
      items: page.items,
      window: page.window,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor ?? '',
    };
  }

  async function readMailInbox(input = {}, context) {
    assertScopeActive(context, 'mail:read', now);
    assertPolicyGranted(getApplication, 'mail.inbox', ['mail:read'], input, context, now);
    const mailConfig = getMailConfig?.();
    const saved = mailConfig?.current?.();
    if (!saved) {
      fail('UNSUPPORTED_CAPABILITY', '邮箱配置未绑定或已撤销');
    }
    const mailScope = {
      ...context,
      kind: 'mail',
      toolName: 'mail.inbox',
      scope: context.scope ?? 'proactive-source',
      requirementId: context.requirementId ?? 'mail-local-batch',
    };
    if (!mailConfig.isSessionAllowed?.(saved.revision, mailScope)) {
      fail('UNAUTHORIZED', '邮箱本会话读取许可未授予或已撤销');
    }
    const provider = createMailProvider({user: saved.user, authCode: saved.authCode});
    try {
      const service = new MailService(provider, {now});
      const limit = Number.isInteger(input?.limit) && input.limit >= 1 && input.limit <= 100
        ? input.limit
        : DEFAULT_MAIL_LIMIT;
      const folder = typeof input?.folder === 'string' && input.folder.trim() ? input.folder : 'INBOX';
      const cursor = typeof input?.cursor === 'string' && input.cursor ? decodeMailCursor(input.cursor) : undefined;
      const page = await service.fetchInbox(MAIL_ACCOUNT, {
        folder,
        limit,
        ...(cursor ? {cursor} : {}),
        signal: context.signal,
      });
      return {
        items: page.items,
        hasMore: page.hasMore,
        ...(page.nextCursor ? {nextCursor: page.nextCursor} : {}),
      };
    } finally {
      try { await provider?.dispose?.(); } catch { /* noop */ }
    }
  }

  async function readPublicFeed(input = {}, context) {
    assertScopeActive(context, 'feeds:read', now);
    assertPolicyGranted(getApplication, 'feeds.collect', ['feeds:read'], input, context, now);
    const feedsHost = getFeedsHost?.();
    const collectTool = feedsHost?.tools?.find?.(tool => tool.descriptor?.name === 'feeds.collect');
    const sourceBinding = typeof input?.subscriptionId === 'string' ? feedsHost?.readSourceBinding?.(input.subscriptionId) : undefined;
    if (!collectTool || !sourceBinding || sourceBinding.available !== true
      || sourceBinding.sensitivity !== 'public' || sourceBinding.containsCredentials !== false) {
      fail('UNSUPPORTED_CAPABILITY', '公开订阅来源不可用或含私有凭据');
    }
    return collectTool.execute(input, context);
  }

  function list() {
    const calendarConfig = getCalendarConfig?.();
    const calendarBinding = calendarConfig?.binding?.();
    const calendarSessionAllowed = Boolean(calendarBinding && calendarConfig?.isSessionAllowed?.(calendarBinding.revision));

    const mailConfig = getMailConfig?.();
    const mailSaved = mailConfig?.current?.();
    const mailSessionAllowed = Boolean(mailSaved && (
      mailConfig?.isSessionAllowed?.(mailSaved.revision, {scope: 'proactive-source'})
      || mailConfig?.isSessionAllowed?.(mailSaved.revision, {scope: 'personal-dashboard'})
    ));

    const feedsHost = getFeedsHost?.();
    const feedsConfigured = Boolean(feedsHost?.snapshot?.().configured || feedsHost?.tools?.length);

    return [
      {
        kind: 'calendar',
        toolName: calendarDescriptor.name,
        configured: Boolean(calendarBinding),
        sessionAllowed: calendarSessionAllowed,
        available: Boolean(calendarBinding && calendarSessionAllowed),
      },
      {
        kind: 'mail',
        toolName: mailDescriptor.name,
        configured: Boolean(mailSaved),
        sessionAllowed: mailSessionAllowed,
        available: Boolean(mailSaved && mailSessionAllowed),
      },
      {
        kind: 'feeds',
        toolName: feedsDescriptor.name,
        configured: feedsConfigured,
        sessionAllowed: feedsConfigured,
        available: feedsConfigured,
      },
    ];
  }

  const proactiveTools = Object.freeze([
    {descriptor: calendarDescriptor, execute: readCalendarEvents},
    {descriptor: mailDescriptor, execute: readMailInbox},
    {descriptor: feedsDescriptor, execute: readPublicFeed},
  ]);

  return Object.freeze({
    list,
    proactiveTools,
    readCalendarEvents,
    readMailInbox,
    readPublicFeed,
  });
}
