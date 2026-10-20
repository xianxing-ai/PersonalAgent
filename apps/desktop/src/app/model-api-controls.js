import {mountHarnessControls} from './harness-controls.js';
import {mountDeveloperControls} from '../features/admin/developer-controls.js';
import {mountHarnessExperienceControls} from '../features/admin/harness-experience-controls.js';

/** Safe presentation only; the trusted host independently enforces the declaration. */
export function describeModelThinking(entry, depth) {
  if (depth !== undefined && (!Number.isInteger(depth) || depth < 0 || depth > 5)) throw Error('思考深度无效');
  const requestedEffort = depth === undefined ? null : ['none', 'low', 'low', 'medium', 'high', 'high'][depth];
  if (entry?.available && entry.nativeReasoning) {
    return {configurationRef: entry.configurationRef ?? '', depth: depth ?? null,
      stepBudget: {maxSteps: depth === undefined ? 6 : Math.max(2, (depth + 1) * 2)},
      modelReasoning: {requestedEffort: entry.nativeReasoning.effort ?? null, effort: entry.nativeReasoning.effort ?? null, supported: true,
        thinking: entry.nativeReasoning.thinking, outputTokenParameter: entry.nativeReasoning.outputTokenParameter,
        verification: 'conditional', thinkingBudgetSupported: false,
        reason: '按版本绑定的原生思考配置发送；步骤档位不覆盖它，真实端点尚未验证'}};
  }
  const supported = Boolean(entry?.available && requestedEffort !== null && entry.reasoningEfforts?.includes(requestedEffort));
  return {configurationRef: entry?.configurationRef ?? '', depth: depth ?? null,
    stepBudget: {maxSteps: depth === undefined ? 6 : Math.max(2, (depth + 1) * 2)},
    modelReasoning: {requestedEffort, effort: supported ? requestedEffort : null, supported,
      verification: 'conditional', thinkingBudgetSupported: false,
      reason: supported ? '按此配置声明发送 reasoning_effort，真实端点尚未验证'
        : '此档位未声明原生推理支持，仅调整执行步骤预算'}};
}

/** Renderer-only controls. Invoke must be a restricted trusted-host IPC bridge. */
export function describeModelRequestBudget(entry) {
  const value = entry?.requestBudget;
  if (value?.state !== 'measured' || value.scope !== 'provider-body' || value.hiddenContext !== 'unknown'
    || value.configurationRef !== entry.configurationRef
    || ![value.inputTokens,value.contextTokens,value.reservedOutputTokens].every(Number.isSafeInteger)
    || value.inputTokens < 0 || value.reservedOutputTokens < 1
    || value.inputTokens > value.contextTokens-value.reservedOutputTokens) {
    return '可见模型输入尚未计量；平台额外上下文未知，暂不能确认剩余容量。';
  }
  return `最近一次可见输入 ${value.inputTokens} Token；窗口 ${value.contextTokens} Token；输出预留 ${value.reservedOutputTokens} Token。仅覆盖此辅助模型的可见输入，平台额外上下文未知。`;
}

export function mountModelApiControls(root, invoke) {
  const settings = document.createElement('details');
  settings.className = 'sis-settings';
  settings.innerHTML = `<summary>独立 API 设置</summary><div class="sis-fields">
    <p class="notice">保留独立 API 凭据与原生参数设置；比赛任务的主模型与子模型由 AgentArts 目录选择。保存配置不会发起模型调用。</p>
    <p data-model-api="defaultExecution" class="notice"></p>
    <label>已保存模型<select data-model-api="saved"><option value="">添加模型</option></select></label>
    <label>供应商<select data-model-api="provider"><option value="pangu">盘古</option><option value="openai-compatible">OpenAI 兼容</option></select></label>
    <label>显示名称<input data-model-api="displayName" maxlength="200" autocomplete="off"></label>
    <label>Endpoint<input data-model-api="baseUrl" type="url" maxlength="2048" autocomplete="off" placeholder="https://.../v1"></label>
    <label>模型 ID<input data-model-api="model" maxlength="200" autocomplete="off"></label>
    <label>API Key<input data-model-api="key" type="password" maxlength="8192" autocomplete="new-password" placeholder="同一目的地留空保留，修改目的地需重新填写"></label>
    <label><input data-model-api="enabled" type="checkbox" checked>启用</label>
    <label><input data-model-api="default" type="checkbox">设为独立 API 默认选项</label>
    <fieldset><legend>当前模型支持的 reasoning_effort</legend>
      <p class="notice">请根据供应商文档或已有验证声明；未知模型保持不选。更改供应商、Endpoint 或模型后需重新确认。</p>
      ${['none', 'low', 'medium', 'high'].map(effort => `<label><input data-model-effort="${effort}" type="checkbox">${effort}</label>`).join('')}
      ${['minimal', 'xhigh', 'max'].map(effort => `<label><input data-model-effort="${effort}" type="checkbox">${effort}（需下方原生配置）</label>`).join('')}
      <label>原生思考开关<select data-model-api="nativeThinking"><option value="">未配置，保留旧档位行为</option><option value="enabled">开启</option><option value="disabled">关闭</option></select></label>
      <label>固定原生强度<select data-model-api="nativeEffort"><option value="">由供应商默认</option>${['none','minimal','low','medium','high','xhigh','max'].map(effort => `<option value="${effort}">${effort}</option>`).join('')}</select></label>
      <label>输出预算参数<select data-model-api="outputTokenParameter"><option value="max_tokens">max_tokens</option><option value="max_completion_tokens">max_completion_tokens（含思考）</option></select></label>
      <p class="notice">原生配置仅适用于 OpenAI 兼容辅助模型。启用后，任务思考深度只调整步骤预算；关闭思考时不选任何强度。</p>
      <label><input data-model-api="reasoningConfirmed" type="checkbox">确认此目的地与模型支持所选参数</label>
    </fieldset>
    <p data-model-api="capabilities" class="notice"></p>
    <p data-model-api="requestBudget" class="notice" role="status"></p>
    <button data-model-api="save" type="button">保存加密配置</button>
    <button data-model-api="remove" type="button">删除并撤销</button>
    <p data-model-api="status" class="notice" role="status"></p></div>`;
  root.append(settings);
  const harness=mountHarnessControls(root,invoke);
  const developer=mountDeveloperControls(root,invoke);
  const experienceRoot=document.createElement('div');root.append(experienceRoot);
  let experience=mountHarnessExperienceControls(experienceRoot,{invoke});
  const field = name => settings.querySelector(`[data-model-api="${name}"]`);
  let state = {}, busy = false, closed = false, destinationChanged = false;
  const effortInputs = [...settings.querySelectorAll('[data-model-effort]')];
  const buttons = () => {
    settings.setAttribute('aria-busy', String(busy));
    settings.querySelectorAll('input,select,button').forEach(control => {control.disabled = busy;});
    field('remove').disabled = busy || !field('saved').value;
  };
  function select() {
    destinationChanged = false;
    const entry = state.models?.find(item => item.id === field('saved').value);
    for (const name of ['displayName', 'baseUrl', 'model']) field(name).value = entry?.[name] ?? '';
    field('provider').value = entry?.provider ?? 'pangu';
    field('enabled').checked = entry?.enabled ?? true;
    field('default').checked = Boolean(entry && entry.id === state.defaultId);
    field('key').value = '';
    for (const input of effortInputs) input.checked = Boolean((entry?.nativeReasoning?.supportedEfforts ?? entry?.reasoningEfforts)?.includes(input.dataset.modelEffort));
    field('nativeThinking').value = entry?.nativeReasoning?.thinking ?? '';
    field('nativeEffort').value = entry?.nativeReasoning?.effort ?? '';
    field('outputTokenParameter').value = entry?.nativeReasoning?.outputTokenParameter ?? 'max_tokens';
    field('reasoningConfirmed').checked = Boolean(entry?.nativeReasoning || entry?.reasoningEfforts?.length);
    field('capabilities').textContent = entry
      ? `${entry.available ? '已配置，真实连接尚未验证' : '当前不可用或已停用'} · 文本与 JSON 工具提案；原生推理${entry.nativeReasoning ? `已配置 ${entry.nativeReasoning.thinking} / ${entry.nativeReasoning.effort ?? '供应商默认'}` : entry.reasoningEfforts?.length ? `已声明 ${entry.reasoningEfforts.join(' / ')}` : '未声明'}；thinkingBudget 不支持`
      : '执行步骤预算由任务控制；原生推理默认不发送，thinkingBudget 不支持';
    field('requestBudget').textContent = describeModelRequestBudget(entry);
    buttons();
  }
  function render(value = {}, selectedId = field('saved').value) {
    if (closed) return;
    state = value;
    harness.render(value);
    developer.render(value.developerSettings);
    experience?.update(value.harnessExperience??{available:false,entries:[],reason:'开发经验尚未接通'});
    field('defaultExecution').textContent = value.defaultExecution?.reason
      ?? '默认 AgentArts 子任务执行器尚未公布；独立 API 按子对话明确选型使用';
    field('saved').replaceChildren();
    for (const entry of [{id: '', displayName: '添加模型'}, ...(value.models ?? [])]) {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.displayName;
      field('saved').append(option);
    }
    field('saved').value = value.models?.some(entry => entry.id === selectedId) ? selectedId : '';
    field('status').textContent = value.reason ?? '辅助模型未配置';
    select();
  }
  async function run(operation, payload) {
    if (busy || closed) return;
    busy = true; buttons();
    try {
      const value = await invoke(operation, payload);
      if (value) render(value, payload?.id || value.models?.at(-1)?.id);
    } catch {
      if (!closed) field('status').textContent = '模型配置操作未完成，请检查字段与安全存储';
    } finally {busy = false; if (!closed) buttons();}
  }
  field('saved').onchange = select;
  for (const name of ['provider', 'baseUrl', 'model']) field(name).addEventListener('input', () => {
    destinationChanged = true;
    field('requestBudget').textContent = '目的地或模型已更改，需要重新取得预算计量结果。';
    for (const input of effortInputs) input.checked = false;
    field('nativeThinking').value = '';
    field('nativeEffort').value = '';
    field('outputTokenParameter').value = 'max_tokens';
    field('reasoningConfirmed').checked = false;
    field('capabilities').textContent = '目的地或模型已更改，请重新声明支持列表；真实端点尚未验证';
  });
  for (const control of [...effortInputs, ...['nativeThinking','nativeEffort','outputTokenParameter'].map(field)]) {
    control.addEventListener('input', () => {field('reasoningConfirmed').checked = false;});
  }
  field('save').onclick = async () => {
    if (busy || closed) return;
    const selected = state.models?.find(entry => entry.id === field('saved').value);
    const supportedEfforts = effortInputs.filter(input => input.checked).map(input => input.dataset.modelEffort);
    const nativeThinking = field('nativeThinking').value;
    const payload = {provider: field('provider').value, displayName: field('displayName').value,
      baseUrl: field('baseUrl').value, model: field('model').value, apiKey: field('key').value,
      enabled: field('enabled').checked, makeDefault: field('default').checked,
      reasoningEfforts: nativeThinking ? [] : supportedEfforts,
      ...(nativeThinking ? {nativeReasoning: {thinking: nativeThinking, supportedEfforts,
        outputTokenParameter: field('outputTokenParameter').value,
        ...(field('nativeEffort').value ? {effort: field('nativeEffort').value} : {})}} : {}),
      reasoningSupportConfirmed: field('reasoningConfirmed').checked,
      ...(selected?.configurationRef ? {expectedConfigurationRef: selected.configurationRef} : {}),
      ...(field('saved').value ? {id: field('saved').value} : {})};
    field('key').value = '';
    try {await run('modelApi.configure', payload);} finally {payload.apiKey = '';}
  };
  field('remove').onclick = () => run('modelApi.remove', {id: field('saved').value});
  select();
  return {render, updateBudget(value) {
    if (closed) return;
    state = value;
    if (!destinationChanged) field('requestBudget').textContent = describeModelRequestBudget(state.models?.find(entry=>entry.id===field('saved').value));
  }, showSettings(show) {
    settings.hidden = !show;harness.showSettings(show);developer.showSettings(show);experienceRoot.hidden=!show;
    if(show&&!experience)experience=mountHarnessExperienceControls(experienceRoot,{invoke,status:state.harnessExperience});
    else if(!show&&experience){experience.dispose();experience=undefined;experienceRoot.replaceChildren();}
  }, close() {
    closed = true; field('key').value = ''; settings.remove();harness.close();developer.close();experience?.dispose();experienceRoot.remove();
  }};
}
