import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../src/app/renderer.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('renderer.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let handler;
const feedbackDependencies = new Map();
function visit(node) {
  if (ts.isBinaryExpression(node) && node.left.getText(ast) === 'talkButton.onclick') handler = node.right.getText(ast);
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
    && ['errorFeedbackRevision', 'setFeedback'].includes(node.name.text)) {
    feedbackDependencies.set(node.name.text, node.getText(ast));
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(handler, 'original manual dictation handler');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}

function fixture() {
  const error = {textContent: ''}, button = {disabled: false}, calls = [];
  const context = vm.createContext({talkButton: button,
    root: {querySelector(selector) {assert.equal(selector, '#error'); return error;}},
    current: {voice: {experimental: true, status: 'unavailable'}, live: {active: false}},
    updateVersion: 0, talkFeedbackRevision: 0, wakeClosed: false,
    wakeBlocksCapture: () => false, report: value => {error.textContent = value.message;},
    invoke(name) {const pending = deferred(); calls.push({name, ...pending}); return pending.promise;}});
  for (const declaration of feedbackDependencies.values()) vm.runInContext(`let ${declaration};`, context);
  const click = vm.runInContext(`(${handler})`, context);
  return {context, error, button, calls, click, snapshot(status, message = '') {
    context.updateVersion++;
    context.current = {voice: {experimental: true, status}, live: {active: false}};
    error.textContent = message;
    button.disabled = !['unavailable', 'error', 'listening', 'awaiting_speech'].includes(status);
  }};
}

test('a held successful start permits timely finish and cannot erase the newer ASR failure', async () => {
  const f = fixture(), start = f.click();
  f.snapshot('listening');
  assert.equal(f.button.disabled, false);
  const finish = f.click();
  assert.deepEqual(f.calls.map(call => call.name), ['voice.record.start', 'voice.record.finish']);
  f.snapshot('recognizing');
  f.snapshot('error', '语音识别失败：当前错误');
  f.calls[1].reject(Error('当前结束录音失败'));
  await finish;
  assert.equal(f.error.textContent, '当前结束录音失败', 'current failure is accepted despite its processing/error snapshots');
  f.calls[0].resolve(); await start;
  assert.equal(f.error.textContent, '当前结束录音失败');
  assert.equal(f.button.disabled, false);
});

test('an older failed start cannot replace feedback or unlock a newer explicit retry', async () => {
  const f = fixture(), earlier = f.click();
  f.snapshot('error', '当前设备错误');
  const retry = f.click();
  assert.equal(f.button.disabled, true);
  f.calls[0].reject(Error('旧启动错误')); await earlier;
  assert.equal(f.error.textContent, '当前设备错误');
  assert.equal(f.button.disabled, true, 'late finally must preserve the newer pending action');
  f.snapshot('listening'); f.calls[1].resolve(); await retry;
  assert.equal(f.error.textContent, '');
  assert.equal(f.button.disabled, false);
});

test('the current successful action still clears previous local feedback and restores availability', async () => {
  const f = fixture(); f.error.textContent = '已处理的旧错误';
  const run = f.click(); assert.equal(f.button.disabled, true);
  f.calls[0].resolve(); await run;
  assert.equal(f.error.textContent, ''); assert.equal(f.button.disabled, false);
});

test('the current failed action still reports its error after ordinary newer snapshots', async () => {
  const f = fixture(), run = f.click();
  f.snapshot('acquiring'); f.snapshot('error', 'Host 当前采集失败');
  f.calls[0].reject(Error('当前采集失败')); await run;
  assert.equal(f.error.textContent, '当前采集失败'); assert.equal(f.button.disabled, false);
});

test('a successful receipt cannot erase a later Host error even without a second user action', async () => {
  const f = fixture(), run = f.click();
  f.snapshot('listening'); f.snapshot('error', 'Host 后续设备失败');
  f.calls[0].resolve(); await run;
  assert.equal(f.error.textContent, 'Host 后续设备失败'); assert.equal(f.button.disabled, false);
});

test('closing suppresses late success or failure, keeps controls disabled and rejects new interaction', async () => {
  for (const fail of [false, true]) {
    const f = fixture(), run = f.click();
    f.context.wakeClosed = true; f.error.textContent = '关闭后的当前消息';
    if (fail) f.calls[0].reject(Error('关闭后旧错误')); else f.calls[0].resolve();
    await run;
    assert.equal(f.error.textContent, '关闭后的当前消息'); assert.equal(f.button.disabled, true);
    await f.click(); assert.equal(f.calls.length, 1);
  }
});
