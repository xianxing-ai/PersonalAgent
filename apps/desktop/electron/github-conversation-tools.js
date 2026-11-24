import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import * as githubModule from '@personal-agent/github';
import {attachExactExports} from './developer-deployment-config.js';
import {connectorResultProjectionSchema} from './connector-result-projection.js';

const USER_FACING_GITHUB_OPS = githubModule.githubAllOperations.filter(
  op => op !== 'actions.repair.link' && op !== 'actions.repair.get',
);
const GITHUB_TOOL_NAMES = new Set(USER_FACING_GITHUB_OPS.map(op => `github.${op}`));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const denied = () => { throw new ProtocolError('UNAUTHORIZED', 'GitHub 连接器配置或本次任务许可已失效'); };
const GITHUB_SECRET_PATTERN = /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9_.-]{16,})/u;

export function createGitHubConversationTools({
  github,
  getApplication,
  resolveConversation,
  confirmExport,
  question,
  createGitHubProvider = options => new githubModule.GitHubRestProvider(options),
  now = Date.now,
} = {}) {
  const bindings = new Map();
  const prepared = new Map();
  const providers = new Map();
  const controllers = new Set();
  const secrets = new Set();
  const tools = [];
  let closed = false;

  const currentBinding = () => github?.binding?.();
  const currentIdentity = () => {
    const binding = currentBinding();
    return binding ? digest(binding) : undefined;
  };
  const resource = () => digest({kind: 'github', configuration: currentIdentity()});
  const preparationKey = scope => JSON.stringify([scope.taskId, scope.proposalId ?? scope.proposal?.proposalId]);
  const questionReady = () => ['prepare', 'prepareExport', 'currentRequirement', 'authorizeExport', 'readResourceGeneration', 'rotateResourceGeneration']
    .every(name => typeof question?.[name] === 'function');

  const taskScope = scope => {
    if (closed || scope.signal?.aborted || !(Date.parse(scope.deadline) > now())) return false;
    try {
      const task = getApplication().runtime.getTask(scope.taskId);
      return !task.cancelRequested && Boolean(resolveConversation(scope.taskId));
    } catch {
      return false;
    }
  };

  const current = scope => {
    const binding = bindings.get(scope.taskId);
    return taskScope(scope) && binding && binding.identity === currentIdentity()
      && binding.conversationId === resolveConversation(scope.taskId)
      && (!question || binding.resourceGeneration === question.readResourceGeneration(binding.resource));
  };

  const assertCurrent = scope => {
    if (!current(scope)) denied();
    if (question && scope.questionExecution === true) question.currentRequirement(scope, 'github-session');
  };

  const available = (name, scope) => GITHUB_TOOL_NAMES.has(name) && taskScope(scope) && Boolean(currentIdentity())
    && getApplication().runtime.getTask(scope.taskId).state === 'running'
    && (question ? questionReady() : typeof confirmExport === 'function');

  const pendingHostQuestion = scope => {
    if (!question || !questionReady() || !taskScope(scope) || scope.runId !== `host-tool-${scope.taskId}`) return false;
    const application = getApplication();
    const pending = application.readPendingToolInvocation(scope.taskId, scope.runId);
    const host = application.readHostToolTask(scope.taskId);
    const proposal = scope.proposal;
    return host.task.state === 'waiting_approval' && host.commandId === proposal.proposalId
      && pending?.toolName === proposal.toolName && pending.toolVersion === proposal.toolVersion
      && pending.deadline === scope.deadline && isDeepStrictEqual(pending.arguments, proposal.arguments);
  };

  const containsCredential = value => (
    typeof value === 'string' && ([...secrets].some(secret => secret && value.includes(secret)) || GITHUB_SECRET_PATTERN.test(value))
  );

  const execution = new AsyncLocalStorage();
  const proxyProvider = {
    verification: 'conditional',
    async execute(op, input, context) {
      const active = execution.getStore();
      if (!active?.provider) throw new ProtocolError('UNSUPPORTED_CAPABILITY', '当前 GitHub 工具执行上下文不可用');
      assertCurrent({...active, signal: context.signal ?? active.signal});
      return active.provider.execute(op, input, context);
    },
  };

  const host = {
    register(tool) {
      if (!GITHUB_TOOL_NAMES.has(tool.descriptor.name)) return () => {};
      tools.push({
        ...tool,
        execute: async (input, context) => {
          if (question) {
            const entry = [...prepared.values()].find(
              value => value.scope.taskId === context.taskId && value.scope.runId === context.runId,
            );
            if (!entry || entry.scope.toolName !== tool.descriptor.name || entry.argumentsDigest !== digest(input)) denied();
            context = {...entry.scope, ...context};
          }
          context = {...context, kind: 'github', ...(question ? {questionExecution: true} : {})};
          assertCurrent(context);
          if (!context.authorizationRef || !tool.descriptor.requiredScopes.every(scope => context.scopes?.includes(scope))) denied();

          const controller = new AbortController();
          const signal = AbortSignal.any([context.signal, controller.signal]);
          controllers.add(controller);
          let provider, timer, onAbort, disposal, timedOut = false;
          const dispose = () => disposal ??= Promise.resolve().then(() => {
            provider?.dispose?.();
          }).catch(() => {});
          const activeContext = {...context, signal};

          try {
            const interrupted = new Promise((_, reject) => {
              onAbort = () => {
                void dispose();
                reject(new ProtocolError(context.signal.aborted ? 'CANCELLED' : 'TIMEOUT', 'GitHub 连接器操作已停止，写入结果须在原任务核实'));
              };
              signal.addEventListener('abort', onAbort, {once: true});
              timer = setTimeout(() => {
                timedOut = true;
                controller.abort();
              }, Math.max(1, Math.min(2_147_483_647, Date.parse(context.deadline) - now())));
              if (signal.aborted) onAbort();
            });

            const operation = (async () => {
              const binding = currentBinding();
              assertCurrent(activeContext);
              if (!binding) denied();
              provider = createGitHubProvider({
                repositories: binding.repositories,
                readToken: async bounded => {
                  assertCurrent({...activeContext, signal: bounded?.signal ?? signal});
                  const token = github.readToken(binding);
                  secrets.add(token);
                  return token;
                },
              });
              providers.set(controller, {provider, dispose});
              assertCurrent(activeContext);
              return await execution.run({...activeContext, provider}, () => tool.execute(input, activeContext));
            })();

            const result = await Promise.race([operation, interrupted]);
            assertCurrent(activeContext);
            return result;
          } catch (error) {
            if (signal.aborted) {
              throw new ProtocolError(
                !context.signal.aborted && (timedOut || now() >= Date.parse(context.deadline)) ? 'TIMEOUT' : 'CANCELLED',
                'GitHub 操作已停止，已发生的写入须在原任务核实',
              );
            }
            if (error instanceof ProtocolError) throw new ProtocolError(error.code, 'GitHub 操作未完成；请按错误码核实原任务');
            throw new ProtocolError('EXTERNAL_FAILURE', 'GitHub 操作未完成；请核实原任务，勿重复未知写入');
          } finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
            controllers.delete(controller);
            providers.delete(controller);
            void dispose();
          }
        },
      });
      return () => {};
    },
  };

  const disposeModule = githubModule.register(host, {
    provider: proxyProvider,
    operations: USER_FACING_GITHUB_OPS,
  });

  const original = {
    tools,
    competitionToolAvailability: tools.map(tool => ({
      toolName: tool.descriptor.name,
      toolVersion: tool.descriptor.version,
      available: scope => available(tool.descriptor.name, scope),
    })),
  };

  const exports = attachExactExports(original, {
    current,
    ready: available,
    assertCurrent,
    confirmExport,
    now,
    kindPrefix: 'github',
    policyBinding: 'configured-github-v1',
    containsCredential,
  });

  const originalPreparation = scope => {
    const entry = prepared.get(preparationKey(scope));
    if (!entry || !current({...entry.scope, signal: scope.signal ?? entry.scope.signal})) denied();
    return entry;
  };

  const confirmedHostResult = (entry, result) => {
    const application = getApplication();
    const scope = entry.scope;
    if (application.runtime.getTask(scope.taskId).state === 'running') return false;
    const hostTask = application.readHostToolTask(scope.taskId);
    const intent = application.runtime.loadCheckpoint(scope.taskId, 'host-tool-intent');
    if (scope.runId !== `host-tool-${scope.taskId}` || hostTask.task.state !== 'succeeded'
      || hostTask.commandId !== scope.proposalId || hostTask.toolName !== scope.toolName
      || hostTask.toolVersion !== scope.toolVersion || hostTask.confirmed?.runId !== scope.runId
      || !hostTask.confirmed.evidenceRefs.includes(scope.runId) || !isDeepStrictEqual(hostTask.confirmed.result, result)
      || intent?.commandId !== scope.proposalId || intent.toolName !== scope.toolName
      || intent.toolVersion !== scope.toolVersion || intent.deadline !== scope.deadline
      || digest(intent.arguments) !== entry.argumentsDigest) denied();
    return true;
  };

  const questionExports = tools.map(tool => ({
    toolName: tool.descriptor.name,
    toolVersion: tool.descriptor.version,
    exportPolicyVersion: 'connector-question-bounded-v2',
    accepts: scope => {
      try {
        const entry = originalPreparation(scope);
        if (entry.scope.toolName !== tool.descriptor.name || entry.argumentsDigest !== digest(scope.arguments)) return false;
        if (scope.phase === 'final') {
          if (!entry.resultDigest || entry.resultDigest !== digest(scope.projection)) return false;
          const exact = {...entry.scope, signal: scope.signal ?? entry.scope.signal};
          if (confirmedHostResult(entry, scope.projection)) question.assertConsumedResult(exact, 'github-export');
          else question.currentRequirement(exact, 'github-export');
        }
        return true;
      } catch {
        return false;
      }
    },
    project: scope => {
      const entry = originalPreparation(scope);
      const text = JSON.stringify(scope.result);
      if (entry.scope.toolName !== tool.descriptor.name) denied();
      if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 512 * 1024 || containsCredential(text)) denied();
      const exact = {...entry.scope, signal: scope.signal ?? entry.scope.signal};
      if (confirmedHostResult(entry, scope.result)) {
        question.assertConsumedResult(exact, 'github-session');
        question.authorizeConsumedExport(exact, scope.result, 'github-export');
      } else {
        question.currentRequirement(exact, 'github-session');
        question.authorizeExport(exact, scope.result, 'github-export');
      }
      entry.resultDigest = digest(scope.result);
      return structuredClone(scope.result);
    },
  }));

  return {
    ...exports.host,
    ...(question ? {competitionToolExports: questionExports} : {}),
    async prepareExport(scope) {
      if (!tools.some(tool => tool.descriptor.name === scope.proposal?.toolName)) return;
      if (scope.phase === 'preflight') {
        const bindingDigest = currentIdentity();
        const conversationId = resolveConversation(scope.taskId);
        if (!bindingDigest || !conversationId || (!available(scope.proposal.toolName, scope) && !pendingHostQuestion(scope))) denied();
        for (const [key, value] of bindings) if (Date.parse(value.deadline) <= now()) bindings.delete(key);
        if (bindings.size >= 512 && !bindings.has(scope.taskId)) denied();
        const previous = bindings.get(scope.taskId);
        if (previous && (previous.identity !== bindingDigest || previous.conversationId !== conversationId)) denied();
        const source = resource();
        const resourceGeneration = question ? question.readResourceGeneration(source) : undefined;
        bindings.set(scope.taskId, {
          identity: bindingDigest,
          conversationId,
          deadline: scope.deadline,
          ...(question ? {resource: source, resourceGeneration} : {}),
        });
        if (question) {
          if (!scope.runId) denied();
          for (const [id, entry] of prepared) if (Date.parse(entry.scope.deadline) <= now()) prepared.delete(id);
          const tool = tools.find(item => item.descriptor.name === scope.proposal.toolName && item.descriptor.version === scope.proposal.toolVersion);
          if (!tool) denied();
          const exact = {
            taskId: scope.taskId,
            proposalId: scope.proposal.proposalId,
            runId: scope.runId,
            toolName: tool.descriptor.name,
            toolVersion: tool.descriptor.version,
            deadline: scope.deadline,
            signal: scope.signal,
          };
          const entry = {scope: exact, argumentsDigest: digest(scope.proposal.arguments)};
          const id = preparationKey(scope);
          const prior = prepared.get(id);
          if (prior && (prior.scope.runId !== exact.runId || prior.argumentsDigest !== entry.argumentsDigest)) denied();
          prepared.set(id, entry);
          const isWrite = tool.descriptor.sideEffect === 'external_write';
          const repoHint = typeof scope.proposal.arguments?.repo === 'string' ? `（仓库 ${scope.proposal.arguments.repo}）` : '';
          const ruleBindingDigest = digest({
            resource: source,
            resourceGeneration,
            toolName: tool.descriptor.name,
            toolVersion: tool.descriptor.version,
            projection: tool.descriptor.outputSchema,
          });
          question.prepare(exact, {
            requirements: [{
              requirementId: 'github-session',
              kind: 'connector_session',
              scopes: tool.descriptor.requiredScopes,
              bindingDigest: digest({
                resource: source,
                resourceGeneration,
                taskId: scope.taskId,
                runId: scope.runId,
                argumentsDigest: entry.argumentsDigest,
                deadline: scope.deadline,
              }),
              ruleBindingDigest,
              summary: isWrite
                ? `向 GitHub 发起外部写入 ${tool.descriptor.name}${repoHint}（将产生远端变更）；卡片不能替代账号配置`
                : `读取已配置 GitHub 账号/仓库范围 ${tool.descriptor.name}${repoHint}；仅限本次任务`,
            }],
            assertCurrent: () => { try { return current(exact); } catch { return false; } },
          });
          question.prepareExport(exact, {
            requirementId: 'github-export',
            projectionSchema: connectorResultProjectionSchema(tool.descriptor.outputSchema),
            summary: `将本次 ${tool.descriptor.name} 已声明字段的结果发送到本任务选定 AgentArts 模型；排除凭据与额外字段（最多 512 KiB）`,
            bindingDigest: digest({ruleBindingDigest, taskId: scope.taskId, runId: scope.runId, argumentsDigest: entry.argumentsDigest}),
            ruleBindingDigest: digest({ruleBindingDigest, kind: 'export'}),
          });
        }
      }
      if (!question) await exports.prepareExport(scope);
      else originalPreparation(scope);
    },
    async invalidate({rotate = true} = {}) {
      const resources = new Set([...bindings.values()].map(binding => binding.resource).filter(Boolean));
      if (question && currentIdentity()) resources.add(resource());
      bindings.clear();
      prepared.clear();
      exports.clear(GITHUB_TOOL_NAMES);
      for (const controller of controllers) controller.abort();
      const pending = [];
      for (const [controller, value] of providers) {
        providers.delete(controller);
        pending.push(value.dispose());
      }
      await Promise.all(pending);
      secrets.clear();
      if (question && rotate) {
        for (const id of resources) {
          const previous = question.readResourceGeneration(id);
          question.rotateResourceGeneration(id, previous);
        }
      }
    },
    async close() {
      closed = true;
      await this.invalidate({rotate: false});
      disposeModule();
    },
  };
}
