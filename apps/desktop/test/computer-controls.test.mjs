import test from 'node:test';
import assert from 'node:assert/strict';
import {mountComputerControls} from '../src/app/computer-controls.js';
import {authorizationDom} from '../test-support/authorization-dom.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
};
const status = extra => ({state:'ready', enabled:true, available:true, providerAvailable:true,
  reason:'电脑操作已准备好', waitingConfirmation:false, observationExportAllowed:true,
  provider:{source:'windows-native', targetIdentity:'host_guard'}, input:{state:'idle', busy:false, writeBlocked:false},
  browser:{state:'ready', available:true}, ...extra});

function harness(t, handler) {
  const {document, root} = authorizationDom();
  const calls = [];
  let current = status(), readback = () => ({computerControl:current});
  const controls = mountComputerControls(root, async (name, payload) => {
    calls.push({name, payload});
    if (name === 'snapshot') return readback();
    if (handler) return handler(name, payload, ui);
    if (name === 'computer.control.configure') current = {...current, enabled:payload.enabled,
      observationExportAllowed:payload.allowObservationExport};
    if (name === 'computer.control.stop') current = status({state:'stopped', available:false, providerAvailable:false});
    if (name === 'computer.control.launch') return {taskId:'original-computer-task'};
    return {computerControl:current};
  });
  const section = root.querySelector('.computer-controls');
  const field = name => section.querySelector(`[data-computer="${name}"]`);
  const button = name => section.querySelector(`[data-computer-action="${name}"]`);
  const form = section.querySelector('form');
  const ui = {document, root, section, controls, calls, field, button,
    render(value = current) {current = value; controls.render(value);},
    setCurrent(value) {current = value;}, readback(value) {readback = value;},
    click(name) {return section.fire('click', button(name));},
    change(name, checked) {field(name).checked = checked; return section.fire('change', field(name));},
    input(text) {field('text').value = text; return form.fire('input', field('text'));},
    submit() {return form.fire('submit', form);}};
  t.after(() => controls.dispose());
  return ui;
}

test('a reopened computer page navigates the original persisted unknown without labelling it active', async t => {
  const ui=harness(t);
  ui.render(status({state:'blocked',available:false,providerAvailable:false,recoveryTaskId:'original-non-form-task'}));
  assert.equal(ui.button('open').disabled,false);
  assert.equal(ui.button('confirm').hidden,true);
  await ui.click('open');
  assert.deepEqual(ui.calls.at(-1),{name:'task.openConversation',payload:{taskId:'original-non-form-task'}});
  assert.equal(ui.calls.some(call=>call.name==='computer.control.launch'),false);
});

test('computer settings wait for trusted state and render component/browser facts without initiating work', t => {
  const ui = harness(t);
  assert.equal(ui.field('enabled').checked, true, 'default enabled is a preference, not a readiness claim');
  assert.equal(ui.field('enabled').disabled, true);
  assert.equal(ui.button('prepare').disabled, true);
  assert.equal(ui.button('confirm').hidden, true);
  assert.equal(ui.calls.length, 0);
  ui.render(status({state:'unavailable', available:false, providerAvailable:false,
    reason:'本机执行组件缺失，请准备组件', browser:{state:'unavailable', available:false, reason:'浏览器组件未准备'}}));
  assert.match(ui.field('status').textContent, /缺失/);
  assert.match(ui.field('provider').textContent, /未就绪/);
  assert.match(ui.field('browser').textContent, /未准备/);
  assert.equal(ui.button('prepare').disabled, false);
  assert.equal(ui.field('launch').disabled, true);
  assert.match(ui.section.html, /完全访问模式会自动同意应用授权/);
  assert.match(ui.section.html, /在场确认只继续原任务/);
  assert.equal(ui.section.attributes.get('aria-label'), '通用电脑操作');
});

test('both preferences use the exact configure action and await host readback', async t => {
  const ui = harness(t); ui.render();
  await ui.change('export', false);
  assert.deepEqual(ui.calls.slice(0, 2), [
    {name:'computer.control.configure', payload:{enabled:true, allowObservationExport:false}},
    {name:'snapshot', payload:undefined},
  ]);
  assert.equal(ui.field('export').checked, false);
  await ui.change('enabled', false);
  assert.deepEqual(ui.calls[2], {name:'computer.control.configure', payload:{enabled:false, allowObservationExport:false}});
  assert.match(ui.field('status').textContent, /已关闭/);
  assert.equal(ui.button('prepare').disabled, true);
});

test('prepare is not execution and a stop supersedes its late reply without unlocking another operation', async t => {
  const preparing = deferred(), stopping = deferred();
  const ui = harness(t, name => name === 'computer.control.prepare' ? preparing.promise : stopping.promise);
  ui.render(status({state:'unavailable', available:false, providerAvailable:false}));
  const first = ui.click('prepare');
  assert.equal(ui.button('stop').disabled, false);
  assert.equal(ui.field('enabled').disabled, true);
  await ui.click('prepare');
  assert.equal(ui.calls.filter(item => item.name === 'computer.control.prepare').length, 1);
  const stop = ui.click('stop');
  preparing.resolve({computerControl:status()}); await first;
  assert.equal(ui.button('stop').disabled, true);
  assert.equal(ui.button('prepare').disabled, true);
  ui.setCurrent(status({state:'stopped', available:false, providerAvailable:false}));
  stopping.resolve({computerControl:status({state:'stopped', available:false, providerAvailable:false})}); await stop;
  assert.equal(ui.field('launch').disabled, true);
  assert.ok(ui.calls.every(item => item.name !== 'computer.control.launch'));
});

test('a newer host publication wins over a stale configure response and stale snapshot', async t => {
  const reply = deferred(), readback = deferred();
  const ui = harness(t, () => reply.promise); ui.render();
  ui.readback(() => readback.promise);
  const configuring = ui.change('export', false);
  reply.resolve({computerControl:status()});
  await new Promise(resolve => setImmediate(resolve));
  ui.render(status({state:'disabled', enabled:false, available:false, observationExportAllowed:false}));
  readback.resolve({computerControl:status()}); await configuring;
  assert.equal(ui.field('enabled').checked, false);
  assert.equal(ui.field('export').checked, false);
  assert.match(ui.field('status').textContent, /已关闭/);
});

test('in-place pending updates preserve drafts, form identity and a user edit made during submission', async t => {
  const receipt = deferred();
  const ui = harness(t, () => receipt.promise); ui.render();
  ui.input('在当前窗口输入内容');
  const original = ui.field('text'); original.focus();
  const submitting = ui.submit();
  ui.input('用户在等待期间修改的新内容');
  ui.render(status({input:{state:'active', busy:true, writeBlocked:true}, activeTaskId:'accepted-original'}));
  assert.equal(ui.field('text'), original);
  assert.equal(ui.document.activeElement, original);
  receipt.resolve({taskId:'accepted-original'}); await submitting;
  assert.equal(ui.field('text').value, '用户在等待期间修改的新内容');
  assert.match(ui.field('feedback').textContent, /已受理/);
  assert.doesNotMatch(ui.field('feedback').textContent, /已完成|执行成功/);
  assert.deepEqual(ui.calls[0], {name:'computer.control.launch', payload:{text:'在当前窗口输入内容'}});
});

test('failed launch keeps text, redacts sensitive fragments and blocks a duplicate until explicit verified stop', async t => {
  const ui = harness(t, (name, _payload, host) => {
    if (name === 'computer.control.launch') throw Error('Bearer private-secret C:\\Users\\private\\content');
    host.setCurrent(status({state:'stopped', available:false, providerAvailable:false}));
    return {computerControl:status({state:'stopped', available:false, providerAvailable:false})};
  });
  ui.render(); ui.input('保留这段用户输入'); await ui.submit();
  assert.equal(ui.field('text').value, '保留这段用户输入');
  assert.match(ui.field('feedback').textContent, /受理结果未获确认/);
  assert.match(ui.field('feedback').textContent, /EXTERNAL_FAILURE|阶段：launch/);
  assert.match(ui.field('feedback').textContent, /凭据已遮蔽/);
  assert.doesNotMatch(ui.field('feedback').textContent, /private-secret|Users|content|C:/);
  assert.equal(ui.field('launch').disabled, true);
  await ui.submit();
  assert.equal(ui.calls.filter(item => item.name === 'computer.control.launch').length, 1);
  await ui.click('stop');
  ui.render(status());
  assert.equal(ui.field('launch').disabled, false);
});

test('unknown results cannot be cleared by prepare or invalid snapshots', async t => {
  const ui = harness(t); ui.render(status({state:'blocked', reason:'原结果未知', activeTaskId:'original-unknown',
    input:{state:'blocked', busy:false, writeBlocked:true}}));
  ui.input('不要重发原操作');
  assert.match(ui.field('status').textContent, /待核实/);
  assert.equal(ui.button('prepare').disabled, true);
  assert.equal(ui.field('launch').disabled, true);
  assert.equal(ui.button('open').disabled, false);
  ui.controls.render({state:'ready', available:true});
  assert.match(ui.field('status').textContent, /待核实/);
  await ui.click('prepare'); await ui.submit();
  assert.equal(ui.calls.length, 0);
});

test('confirm targets only the waiting original task and navigation reuses its existing conversation', async t => {
  const ui = harness(t); ui.render(status({state:'waiting_confirmation', waitingConfirmation:true, activeTaskId:'original-bound-task'}));
  assert.equal(ui.button('confirm').hidden, false);
  assert.equal(ui.field('launch').disabled, true);
  await ui.click('confirm');
  assert.deepEqual(ui.calls[0], {name:'computer.control.confirm', payload:{taskId:'original-bound-task'}});
  await ui.click('open');
  assert.deepEqual(ui.calls.at(-1), {name:'task.openConversation', payload:{taskId:'original-bound-task'}});
  assert.ok(ui.calls.every(item => !/authorization|grant|allow/.test(item.name)));
  ui.render(status({waitingConfirmation:true, activeTaskId:undefined}));
  assert.equal(ui.button('confirm').disabled, true);
});

test('full access ready state has no extra confirmation button and demo only fills the draft', async t => {
  const ui = harness(t); ui.render();
  assert.equal(ui.button('confirm').hidden, true);
  await ui.click('demo');
  assert.match(ui.field('text').value, /先不要发送或提交/);
  assert.equal(ui.field('launch').disabled, false);
  assert.equal(ui.calls.length, 0);
});

test('host input blocking independently pauses submission without hiding recovery or the original conversation', async t => {
  const ui = harness(t); ui.render(status({activeTaskId:'blocked-original', input:{state:'idle', busy:false, writeBlocked:true}}));
  ui.input('等待宿主解除暂停');
  assert.match(ui.field('status').textContent, /输入已暂停/);
  assert.equal(ui.field('launch').disabled, true);
  assert.equal(ui.button('prepare').disabled, false);
  assert.equal(ui.button('stop').disabled, false);
  assert.equal(ui.button('open').disabled, false);
  await ui.submit();
  assert.equal(ui.calls.length, 0);
  ui.render(status());
  assert.equal(ui.field('launch').disabled, false);
});

test('failed status readback remains unconfirmed while allowing explicit stop and retaining text', async t => {
  const ui = harness(t); ui.render(); ui.input('保留原输入');
  ui.readback(() => {throw Error('private snapshot failure');});
  await ui.click('prepare');
  assert.match(ui.field('feedback').textContent, /状态未获确认/);
  assert.equal(ui.field('feedback').attributes.get('role'), 'alert');
  assert.equal(ui.field('launch').disabled, true);
  assert.equal(ui.button('prepare').disabled, true);
  assert.equal(ui.button('stop').disabled, false);
  assert.equal(ui.field('text').value, '保留原输入');
  ui.render(status());
  assert.equal(ui.field('launch').disabled, false);
});

test('private paths and arbitrary provider identity do not appear in displayed status', t => {
  const ui = harness(t); ui.render(status({reason:'失败于 C:\\Users\\private\\file.txt',
    provider:{source:'C:\\Users\\private\\python.exe'}, browser:{available:false, reason:'/home/private/profile failed'}}));
  const shown = ['status', 'provider', 'browser', 'feedback'].map(name => ui.field(name).textContent).join(' ');
  assert.doesNotMatch(shown, /private|python.exe|file.txt|\/home/);
});

test('disposing prevents late operation replies from changing UI or reading more state', async t => {
  const late = deferred();
  const ui = harness(t, () => late.promise); ui.render();
  const preparing = ui.click('prepare'); ui.controls.show(false); ui.controls.dispose();
  const text = ui.field('status').textContent;
  late.resolve({computerControl:status()}); await preparing;
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.field('status').textContent, text);
  assert.equal(ui.section.parentElement, undefined);
});

test('operation failures retain their precise safe reason, phase and distinct code instead of becoming consent failures', async t => {
  for (const [code, message] of [['TIMEOUT','组件握手等待超过期限，请重试连接'],
    ['UNSUPPORTED_CAPABILITY','未找到 Windows 原生执行组件'], ['RESULT_UNKNOWN','最后一步可能已执行，需要核实'],
    ['UNAUTHORIZED','原任务的目标窗口许可已经失效']]) {
    const ui = harness(t, () => {throw Object.assign(Error(message), {code});}); ui.render();
    await ui.click('prepare');
    const shown = ui.field('feedback').textContent;
    assert.ok(shown.includes(message)); assert.ok(shown.includes(`[${code}]`));
    assert.match(shown, /阶段：prepare/);
    assert.equal(ui.field('feedback').attributes.get('role'), 'alert');
    if (code !== 'UNAUTHORIZED') assert.doesNotMatch(shown, /未获授权|未获有效许可/);
  }
});

test('error redaction removes only secrets and private paths while retaining diagnostic context and code', async t => {
  const message = 'SDK 握手失败：读取 "C:\\Users\\private name\\component.dll" 被拒绝；Bearer secret-token；api_key="secret key"；/home/private/profile；请检查组件版本。';
  const ui = harness(t, () => {throw Object.assign(Error(message), {code:'EACCES'});}); ui.render();
  await ui.click('prepare');
  const shown = ui.field('feedback').textContent;
  assert.match(shown, /SDK 握手失败/); assert.match(shown, /读取/); assert.match(shown, /被拒绝/);
  assert.match(shown, /请检查组件版本/); assert.match(shown, /\[EACCES\]/); assert.match(shown, /阶段：prepare/);
  assert.match(shown, /路径已遮蔽/); assert.match(shown, /凭据已遮蔽/);
  assert.doesNotMatch(shown, /private|component\.dll|secret-token|secret key|\/home|C:\\/);
  assert.match(ui.section.html, /尊重你明确关闭目标窗口观察导出的选择/);
});

test('a late operation failure remains diagnostic and cannot overwrite a newer host failure or blocked state', async t => {
  const reply = deferred();
  const ui = harness(t, () => reply.promise); ui.render();
  const preparing = ui.click('prepare');
  ui.render(status({state:'blocked', available:false, reason:'最新停止结果未知',
    failure:{code:'RESULT_UNKNOWN',stage:'input_stop',message:'最新宿主停止回执丢失'},
    input:{state:'blocked',busy:false,writeBlocked:true}}));
  reply.reject(Object.assign(Error('较早准备请求已超时'), {code:'TIMEOUT'})); await preparing;
  assert.match(ui.field('status').textContent, /待核实/);
  assert.match(ui.field('failure').textContent, /RESULT_UNKNOWN.*input_stop/);
  assert.match(ui.field('failure').textContent, /最新宿主停止回执丢失/);
  assert.match(ui.field('feedback').textContent, /TIMEOUT.*prepare/);
  assert.equal(ui.button('prepare').disabled, true);
  assert.equal(ui.field('launch').disabled, true);
});
