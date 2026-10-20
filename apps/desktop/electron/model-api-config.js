import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateHarnessConfiguration} from './harness-configuration.js';

const providers = new Set(['pangu', 'openai-compatible']);
const efforts = ['none', 'low', 'medium', 'high'];
const fail = message => { throw Error(message); };
const text = (value, max) => typeof value === 'string' && value.trim().length > 0
  && value.trim().length <= max && !/[\u0000-\u001f\u007f]/u.test(value) ? value.trim() : fail('模型配置字段无效');
function endpoint(value) {
  let url;
  try { url = new URL(text(value, 2048)); } catch { fail('模型 Endpoint 无效'); }
  if (url.username || url.password || url.search || url.hash
    || !(url.protocol === 'https:' || (url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) fail('模型 Endpoint 必须使用 HTTPS，本机服务可使用 HTTP；不能包含凭据或查询参数');
  return url.href.replace(/\/+$/u, '');
}
function supportedEfforts(value = []) {
  if (!Array.isArray(value) || value.length > efforts.length || new Set(value).size !== value.length
    || value.some(item => !efforts.includes(item))) fail('原生推理支持列表无效');
  return efforts.filter(item => value.includes(item));
}
function nativeReasoning(value, provider) {
  if (value === undefined) return undefined;
  const levels = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  if (provider !== 'openai-compatible' || !value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['thinking','effort','supportedEfforts','outputTokenParameter'].includes(key))
    || !['enabled','disabled'].includes(value.thinking)
    || !['max_tokens','max_completion_tokens'].includes(value.outputTokenParameter)
    || !Array.isArray(value.supportedEfforts) || new Set(value.supportedEfforts).size !== value.supportedEfforts.length
    || value.supportedEfforts.some(item => !levels.includes(item))
    || (value.effort !== undefined && !value.supportedEfforts.includes(value.effort))
    || (value.thinking === 'disabled' && (value.effort !== undefined || value.supportedEfforts.length))) fail('原生思考配置无效');
  return {thinking: value.thinking, outputTokenParameter: value.outputTokenParameter,
    supportedEfforts: levels.filter(item => value.supportedEfforts.includes(item)),
    ...(value.effort === undefined ? {} : {effort: value.effort})};
}
function validateRecord(value) {
  if (!value || !providers.has(value.provider) || typeof value.enabled !== 'boolean') fail('模型配置无效');
  const native = nativeReasoning(value.nativeReasoning, value.provider);
  const reasoningEfforts = supportedEfforts(value.reasoningEfforts);
  if (native && reasoningEfforts.length) fail('原生思考与旧推理档位不能同时配置');
  return {id: text(value.id, 100), provider: value.provider, baseUrl: endpoint(value.baseUrl),
    model: text(value.model, 200), displayName: text(value.displayName, 200), apiKey: text(value.apiKey, 8192),
    bindingId: text(value.bindingId, 100), reasoningEfforts,
    ...(native === undefined ? {} : {nativeReasoning: native})};
}

function publicRequestBudget(value, binding, configurationRef) {
  const unknown = {state:'unmeasured',scope:'provider-body',hiddenContext:'unknown',configurationRef};
  if (value?.state !== 'measured' || value.scope !== 'provider-body' || value.hiddenContext !== 'unknown'
    || !binding || ['scope','model','tokenizerRef','configurationRef','contextTokens'].some(key=>value[key]!==binding[key])
    || ![value.inputTokens,value.contextTokens,value.reservedOutputTokens,binding.reservedOutputTokens].every(Number.isSafeInteger)
    || value.inputTokens < 0 || value.reservedOutputTokens < 1
    || value.reservedOutputTokens > binding.reservedOutputTokens
    || value.inputTokens > value.contextTokens-value.reservedOutputTokens) return unknown;
  return {state:'measured',scope:'provider-body',hiddenContext:'unknown',configurationRef,
    inputTokens:value.inputTokens,contextTokens:value.contextTokens,reservedOutputTokens:value.reservedOutputTokens};
}

/** Trusted main process only. Snapshot is safe for IPC; no endpoint is contacted while saving. */
export function createModelApiConfig({userData, safeStorage, createGateway, createGuardedGateway,
  fetchImpl=globalThis.fetch, isDefaultExecutionAvailable, profile = 'huawei_ict_agentarts'}) {
  const target = path.join(userData, 'model-api-config.json');
  let entries = new Map(), defaultId, restoreFailed = false, disposed = false;
  let harness={version:1,revision:'unconfigured',enabled:false,context:{enabled:false},events:{enabled:false,quiet:false}};
  const gateways = new Map();
  const controllers = new Map();
  const requestBudgets = new Map();
  if (existsSync(target)) {
    try {
      if (!safeStorage.isEncryptionAvailable()) throw Error();
      const envelope = JSON.parse(readFileSync(target, 'utf8'));
      if (envelope.version !== 1 || typeof envelope.encrypted !== 'string') throw Error();
      const data = JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encrypted, 'base64')));
      if (!Array.isArray(data.entries) || data.entries.length > 16) throw Error();
      const restored = new Map();
      for (const value of data.entries) {
        const clean = validateRecord(value);
        if (restored.has(clean.id)) throw Error();
        restored.set(clean.id, {...clean, enabled: value.enabled});
      }
      if (data.defaultId !== undefined && (!restored.has(data.defaultId) || !restored.get(data.defaultId).enabled)) throw Error();
      const restoredHarness=data.harness===undefined?harness:validateHarnessConfiguration(data.harness);
      entries = restored; defaultId = data.defaultId;harness=restoredHarness;
    } catch {restoreFailed = true;}
  }
  const active = () => {if (disposed) fail('模型配置宿主已释放');};
  const revoke = id => {
    for (const controller of controllers.get(id) ?? []) controller.abort('Model configuration revoked');
    controllers.delete(id); gateways.delete(id); requestBudgets.delete(id);
  };
  const persist = (next, selected, nextHarness=harness) => {
    if (!safeStorage.isEncryptionAvailable()) fail('本机安全存储不可用，未保存模型配置');
    try {
      const encrypted = safeStorage.encryptString(JSON.stringify({entries: [...next.values()], defaultId: selected,harness:nextHarness})).toString('base64');
      mkdirSync(userData, {recursive: true});
      const temporary = `${target}.tmp-${randomUUID()}`;
      writeFileSync(temporary, JSON.stringify({version: 1, encrypted}), {encoding: 'utf8', mode: 0o600});
      renameSync(temporary, target);
    } catch {fail('模型加密配置保存失败');}
  };
  const available = () => profile === 'huawei_ict_agentarts' && typeof createGateway === 'function';
  const selectedEntry = (modelName, expectedConfigurationRef) => {
    const id = modelName === undefined || modelName === '' ? defaultId : modelName;
    const entry = entries.get(id);
    return !disposed && entry?.enabled && available()
      && (expectedConfigurationRef === undefined || expectedConfigurationRef === entry.bindingId) ? entry : undefined;
  };
  const getModelReasoningEfforts = (modelName, expectedConfigurationRef) =>
    [...(selectedEntry(modelName, expectedConfigurationRef)?.nativeReasoning?.supportedEfforts
      ?? selectedEntry(modelName, expectedConfigurationRef)?.reasoningEfforts ?? [])];
  const getModelReasoningState = (modelName, expectedConfigurationRef) => {
    const entry = selectedEntry(modelName, expectedConfigurationRef);
    return {available: Boolean(entry), modelId: entry?.id ?? '', configurationRef: entry?.bindingId ?? '',
      reasoningEfforts: getModelReasoningEfforts(modelName, expectedConfigurationRef),
      ...(entry?.nativeReasoning === undefined ? {} : {nativeReasoning: structuredClone(entry.nativeReasoning)}),
      nativeReasoningConfigured: Boolean(entry?.nativeReasoning || entry?.reasoningEfforts.length), nativeReasoningVerified: false,
      parameter: entry?.nativeReasoning ? 'thinking/reasoning_effort' : 'reasoning_effort', verification: 'conditional', source: 'explicit-configuration',
      thinkingBudgetSupported: false,
      reason: !entry ? '模型、配置版本或当前 profile 不可用'
        : entry.nativeReasoning ? '原生思考配置独立于步骤预算；真实端点尚未验证'
          : entry.reasoningEfforts.length ? '已声明此配置支持的 reasoning_effort；真实端点尚未验证'
          : '未声明原生推理参数支持，仅可使用执行步骤预算'};
  };
  const defaultAvailable = () => {
    if (disposed || profile !== 'huawei_ict_agentarts' || typeof isDefaultExecutionAvailable !== 'function') return false;
    try {return isDefaultExecutionAvailable() === true;} catch {return false;}
  };
  const snapshot = () => {
    const defaultReady = defaultAvailable();
    return {
    configured: !disposed && [...entries.values()].some(entry => entry.enabled && available(entry)),
    defaultId: defaultId ?? '',
    harness:{...structuredClone(harness),contextModelAvailable:harness.context.enabled&&Boolean(selectedEntry(harness.context.modelId,harness.context.configurationRef)),
      verification:'not_run'},
    defaultModelAvailable: Boolean(selectedEntry(undefined)),
    defaultAvailable: defaultReady,
    defaultExecution: {strategy: 'competition', available: defaultReady, verification: 'conditional',
      reason: defaultReady ? '默认子任务复用主 AgentArts 协调配置；真实执行以任务读回为准'
        : '默认 AgentArts 子任务执行器不可用；启用独立模型配置不代表默认执行器已可用'},
    status: disposed || restoreFailed || !available() ? 'unavailable' : entries.size ? 'configured' : 'unconfigured',
    reason: disposed ? '模型配置宿主已释放' : restoreFailed ? '模型加密配置无法读取，请重新保存'
      : profile !== 'huawei_ict_agentarts' ? '当前模型配置只服务 AgentArts Competition Profile'
      : '用于 AgentArts 委派的辅助子任务；保存不代表真实连接已验证',
    models: [...entries.values()].map(({id, provider, baseUrl, model, displayName, enabled, bindingId, reasoningEfforts, nativeReasoning: native}) => ({
      id, provider, baseUrl, model, displayName, enabled, configurationRef: bindingId,
      available: !disposed && enabled && available(entries.get(id)),
      verification: 'conditional', keyConfigured: true,
      capabilities: {text: true, tools: 'structured-json', nativeToolCalling: false,
        nativeReasoning: Boolean(selectedEntry(id)?.nativeReasoning || selectedEntry(id)?.reasoningEfforts.length), thinkingBudget: false},
      reasoningEfforts: [...reasoningEfforts], nativeReasoningVerified: false,
      ...(native === undefined ? {} : {nativeReasoning: structuredClone(native)}),
      reasoningVerification: 'conditional', reasoningSource: 'explicit-configuration',
      requestBudget: structuredClone(requestBudgets.get(id) ?? {state:'unmeasured',scope:'provider-body',hiddenContext:'unknown',configurationRef:bindingId}),
    })),
    };
  };
  function buildGateway(entry,factory,beforeSend) {
    const id = entry.id;
    const assertCurrent = () => {
      if (disposed || entries.get(id) !== entry || !entry.enabled) fail('模型配置已撤销或更改');
    };
    const modelGateway = factory({profile, provider: entry.provider, baseUrl: entry.baseUrl,
      model: entry.model, deployment: `${entry.id}@${entry.bindingId}`,
      ...(entry.nativeReasoning === undefined ? {} : {nativeReasoning: structuredClone(entry.nativeReasoning)}),
      apiKey: () => {assertCurrent(); return entry.apiKey;},
      ...(beforeSend===undefined?{}:{fetch:(...args)=>{
        assertCurrent();
        const guarded=beforeSend();
        if(guarded!==undefined){void Promise.resolve(guarded).catch(()=>undefined);fail('模型发送门禁必须同步完成');}
        return fetchImpl(...args);
      }})});
    if (!modelGateway || typeof modelGateway.complete !== 'function') fail('受信模型网关不可用');
    let latestRequest = 0;
    const gateway = {deployment: modelGateway.deployment, async complete(request) {
      assertCurrent();
      if (request.reasoningEffort !== undefined && !(entry.nativeReasoning?.supportedEfforts ?? entry.reasoningEfforts).includes(request.reasoningEffort)) {
        fail('此模型配置未声明支持所请求的 reasoning_effort');
      }
      if (request.thinkingBudget !== undefined) fail('当前模型配置不支持 thinkingBudget 参数');
      const sequence = ++latestRequest;
      requestBudgets.delete(id);
      const controller = new AbortController();
      const abort = () => controller.abort(request.signal.reason);
      const pending = controllers.get(id) ?? new Set();
      controllers.set(id, pending); pending.add(controller);
      request.signal.addEventListener('abort', abort, {once: true});
      if (request.signal.aborted) abort();
      try {
        const result = await modelGateway.complete({...request, signal: controller.signal});
        assertCurrent();
        if (sequence === latestRequest && !controller.signal.aborted) requestBudgets.set(id,publicRequestBudget(result.requestBudget,
          modelGateway.deployment?.capabilities?.requestTokenBudget,entry.bindingId));
        return result;
      } finally {
        request.signal.removeEventListener('abort', abort); pending.delete(controller);
      }
    }};
    return gateway;
  }
  function getModelGateway(modelName, expectedConfigurationRef) {
    active();
    const entry=selectedEntry(modelName,expectedConfigurationRef);
    if(!entry)return undefined;
    if(!gateways.has(entry.id))gateways.set(entry.id,buildGateway(entry,createGateway));
    return gateways.get(entry.id);
  }
  function getGuardedModelGateway(modelName,expectedConfigurationRef,beforeSend) {
    active();
    // This path never selects an implicit default or shares a mutable send guard.
    if(typeof modelName!=='string'||!modelName||typeof expectedConfigurationRef!=='string'||!expectedConfigurationRef
      ||typeof beforeSend!=='function'||typeof createGuardedGateway!=='function'||typeof fetchImpl!=='function')return undefined;
    const entry=selectedEntry(modelName,expectedConfigurationRef);
    return entry?buildGateway(entry,createGuardedGateway,beforeSend):undefined;
  }
  return Object.freeze({
    snapshot, getModelGateway, getGuardedModelGateway, getModelReasoningEfforts, getModelReasoningState,
    readHarnessConfiguration(){active();return structuredClone(harness);},
    configureHarness(input){
      active();
      if(profile!=='huawei_ict_agentarts'||!input||typeof input!=='object'||Array.isArray(input)
        ||Object.keys(input).some(key=>!['expectedRevision','enabled','maxExecutorSteps','context','events'].includes(key))
        ||input.expectedRevision!==harness.revision||typeof input.enabled!=='boolean'||!input.context||typeof input.context!=='object'
        ||Array.isArray(input.context)||typeof input.context.enabled!=='boolean'
        ||Object.keys(input.context).some(key=>!['enabled','modelId','configurationRef','maxOutputTokens','policy'].includes(key)))
        fail('开发者 Harness 配置已变化，请刷新后保存');
      const revision=randomUUID();
      const context=input.context.enabled?{...input.context,policy:{...input.context.policy,version:'desktop-context:'+revision}}
        :{...harness.context,enabled:false};
      const next=validateHarnessConfiguration({version:1,revision,enabled:input.enabled,
        ...(input.maxExecutorSteps===undefined?(harness.maxExecutorSteps===undefined?{}:{maxExecutorSteps:harness.maxExecutorSteps})
          :{maxExecutorSteps:input.maxExecutorSteps}),context,events:input.events??harness.events});
      if(next.context.enabled&&!selectedEntry(next.context.modelId,next.context.configurationRef))fail('请选择当前可用的摘要模型版本');
      persist(entries,defaultId,next);harness=next;return snapshot();
    },
    configure(input) {
      active();
      if (profile !== 'huawei_ict_agentarts') fail('当前模型配置只服务 AgentArts Competition Profile');
      if (!input || Object.keys(input).some(key => !['id', 'provider', 'baseUrl', 'model', 'displayName', 'apiKey', 'enabled', 'makeDefault',
        'reasoningEfforts', 'reasoningSupportConfirmed', 'expectedConfigurationRef', 'nativeReasoning'].includes(key))
        || (input.makeDefault !== undefined && typeof input.makeDefault !== 'boolean')
        || (input.enabled !== undefined && typeof input.enabled !== 'boolean')
        || (input.apiKey !== undefined && typeof input.apiKey !== 'string')
        || (input.reasoningSupportConfirmed !== undefined && typeof input.reasoningSupportConfirmed !== 'boolean')
        || (input.expectedConfigurationRef !== undefined && typeof input.expectedConfigurationRef !== 'string')) fail('模型配置字段无效');
      const id = input.id === undefined || input.id === '' ? `model-${randomUUID()}` : text(input.id, 100);
      const previous = entries.get(id);
      if (input.expectedConfigurationRef !== undefined && previous?.bindingId !== input.expectedConfigurationRef) {
        fail('模型配置版本已变更，请刷新后重新保存');
      }
      const reasoningEfforts = supportedEfforts(input.reasoningEfforts);
      const native = nativeReasoning(input.nativeReasoning, input.provider);
      if ((reasoningEfforts.length || native !== undefined) && (input.reasoningSupportConfirmed !== true
        || (previous && input.expectedConfigurationRef !== previous.bindingId))) {
        fail('请明确确认当前供应商、Endpoint、模型与配置版本支持这些原生推理参数');
      }
      const baseUrl = endpoint(input.baseUrl);
      const sameDestination = previous?.provider === input.provider && previous?.baseUrl === baseUrl;
      const entry = {...validateRecord({...input, id, baseUrl, reasoningEfforts, bindingId: randomUUID(), enabled: input.enabled ?? previous?.enabled ?? true,
        apiKey: input.apiKey?.trim() || (sameDestination ? previous.apiKey : '')}),
        enabled: input.enabled ?? previous?.enabled ?? true};
      const next = new Map(entries); next.set(id, entry);
      if (next.size > 16) fail('最多保存 16 个辅助模型');
      let selected = input.makeDefault === true ? id
        : input.makeDefault === false && defaultId === id ? undefined
          : defaultId ?? (input.makeDefault !== false && entry.enabled ? id : undefined);
      if (selected && !next.get(selected)?.enabled) selected = undefined;
      persist(next, selected); revoke(id); entries = next; defaultId = selected; restoreFailed = false;
      return snapshot();
    },
    remove(input) {
      active();
      if (!input || Object.keys(input).some(key => key !== 'id')) fail('删除模型参数无效');
      const id = text(input.id, 100);
      const next = new Map(entries); next.delete(id);
      const selected = defaultId === id ? undefined : defaultId;
      persist(next, selected); revoke(id); entries = next; defaultId = selected;
      return snapshot();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const id of entries.keys()) revoke(id);
      entries.clear(); defaultId = undefined;
    },
  });
}
