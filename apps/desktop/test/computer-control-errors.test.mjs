import test from 'node:test';
import assert from 'node:assert/strict';
import {computerControlFailure} from '../electron/computer-control-errors.js';
import {readComputerControlDiagnostic} from '../src/app/computer-controls.js';

test('Main computer IPC preserves safe detail only for the exact action and re-redacts it',()=>{
  const stage='computer.control.configure',message='EISDIR: illegal operation on a directory, open C:/private/computer-control.json.next';
  const diagnostic={kind:'computer-control',...computerControlFailure(Object.assign(Error(message),{code:'EISDIR'}),stage)};
  const value=readComputerControlDiagnostic(diagnostic,stage);
  assert.equal(value.code,'EISDIR');assert.equal(value.stage,stage);
  assert.match(value.message,/illegal operation on a directory/);assert.doesNotMatch(value.message,/C:\/private/);
  for(const bad of [{...diagnostic,stage:'computer.control.stop'},{...diagnostic,kind:'other'},
    {...diagnostic,code:'bad code'},{...diagnostic,message:'x'.repeat(8193)}])
    assert.equal(readComputerControlDiagnostic(bad,stage),undefined);
  assert.equal(readComputerControlDiagnostic(diagnostic,'task.submit'),undefined);
});
import {mountComputerControls} from '../src/app/computer-controls.js';
import {authorizationDom} from '../test-support/authorization-dom.mjs';

test('computer failures retain original safe diagnostics, exact code and actual stage without consent reclassification', () => {
  for (const [code, message] of [
    ['ENOENT','Broker executable missing after successful extraction'],
    ['PROTOCOL_MISMATCH','Broker replied protocol=desktop/2; expected desktop/1'],
    ['TIMEOUT','initialize handshake exceeded its 5000ms deadline'],
    ['RESULT_UNKNOWN','stop acknowledgement did not arrive after device dispatch'],
    ['EPIPE','Native broker stdin closed during initialize'],
  ]) {
    const result = computerControlFailure(Object.assign(Error(message), {code}), 'component_start');
    assert.deepEqual(result, {code, stage:'component_start', message, retryable:false});
    assert.doesNotMatch(result.message, /未获授权|未获有效许可/);
  }
  const inherited = Object.create({code:'UNAUTHORIZED', message:'not an own diagnostic'});
  assert.equal(computerControlFailure(inherited, 'prepare').code, 'EXTERNAL_FAILURE');
});

const privateCases = [
  ['Bearer synthetic-token', 'synthetic-token'],
  ['Authorization: Basic c3ludGhldGljOnNlY3JldA==', 'c3ludGhldGljOnNlY3JldA=='],
  ['api_key="synthetic api key"', 'synthetic api key'],
  ['{"password":"synthetic password"}', 'synthetic password'],
  ['client_secret=synthetic-secret', 'synthetic-secret'],
  ['token=synthetic-token&status=502', 'synthetic-token'],
  ['密码：synthetic-password', 'synthetic-password'],
  ['Cookie: synthetic-session=private-cookie', 'private-cookie'],
  ['sk-syntheticprivatekey12345', 'sk-syntheticprivatekey12345'],
  ['-----BEGIN PRIVATE KEY-----\nsynthetic private key\n-----END PRIVATE KEY-----', 'synthetic private key'],
  ['https://synthetic-user:synthetic-password@localhost:4444', 'synthetic-password'],
  ['"C:\\Users\\synthetic user\\private.txt"', 'synthetic user'],
  ['C:\\Users\\synthetic\\private.txt', 'private.txt'],
  ['\\\\synthetic-server\\private-share\\private.txt', 'private-share'],
  ['/home/synthetic/private.txt', 'private.txt'],
  ['file:///home/synthetic/private.txt', 'private.txt'],
  ['body="synthetic mail body"', 'synthetic mail body'],
  ['{"content":"synthetic document body"}', 'synthetic document body'],
  ['response body: synthetic response body', 'synthetic response body'],
  ['正文："合成私人正文内容"', '合成私人正文内容'],
  ['stdout="synthetic private device text"', 'synthetic private device text'],
];

test('redaction replaces each private fragment while keeping surrounding technical diagnostics and identity', () => {
  for (const [fragment, secret] of privateCases) {
    const message = `Broker handshake failed; ${fragment}; received protocol 2 instead of 1; retry is disabled`;
    const result = computerControlFailure({code:'PROTOCOL_MISMATCH', message}, 'component_start');
    assert.equal(result.code, 'PROTOCOL_MISMATCH'); assert.equal(result.stage, 'component_start');
    assert.match(result.message, /Broker handshake failed/); assert.match(result.message, /received protocol 2 instead of 1/);
    assert.match(result.message, /retry is disabled/); assert.equal(result.message.includes(secret), false, fragment);
    assert.match(result.message, /已遮蔽/);
    if (fragment.startsWith('token=')) assert.match(result.message, /status=502/);
  }
});

test('labelled escaped body strings remain private without swallowing later diagnostics', () => {
  const message = 'UIA read failed; body="synthetic \\"quoted\\" body"; status=500; action=set_value';
  const result = computerControlFailure({code:'EXTERNAL_FAILURE', message}, 'observation');
  assert.doesNotMatch(result.message, /synthetic|quoted/);
  assert.match(result.message, /status=500; action=set_value/);
});

test('missing detail uses PR511 code fallback while safe strings and supplied stages remain visible', () => {
  assert.match(computerControlFailure({code:'ECONNREFUSED'}, 'browser_start').message, /服务拒绝连接/);
  assert.equal(computerControlFailure({code:'ENOENT'}, 'component_start').message, '电脑组件文件不存在');
  assert.equal(computerControlFailure('Unexpected protocol frame after initialize', 'transport').message, 'Unexpected protocol frame after initialize');
  assert.equal(computerControlFailure({code:'TIMEOUT', stage:'upstream_wait', message:'Broker timed out'}).stage, 'upstream_wait');
  const malformed = computerControlFailure({code:'Bearer secret-code', message:'Specific handshake failure'}, 'C:\\private\\stage');
  assert.equal(malformed.code, 'EXTERNAL_FAILURE'); assert.equal(malformed.stage, 'unknown');
  assert.equal(malformed.message, 'Specific handshake failure');
});

test('hostile diagnostic accessors and coercion are never invoked and cannot replace the original failure', () => {
  for (const key of ['code','message','stage']) {
    let touches = 0;
    const hostile = Object.defineProperty({}, key, {get() {touches++; throw Error('synthetic private getter');}});
    const result = computerControlFailure(hostile, 'prepare');
    assert.equal(touches, 0); assert.equal(result.code, 'EXTERNAL_FAILURE');
    assert.doesNotMatch(JSON.stringify(result), /private getter/);
  }
  const {proxy, revoke} = Proxy.revocable({}, {}); revoke();
  assert.doesNotThrow(() => computerControlFailure(proxy, 'prepare'));
  const hostile = {toString() {throw Error('must not coerce');}, code:'TIMEOUT', message:{toString() {throw Error('must not coerce message');}}};
  assert.doesNotThrow(() => computerControlFailure(hostile, 'prepare'));
  assert.equal(computerControlFailure(hostile, 'prepare').code, 'TIMEOUT');
});

test('host and UI redact the same fragments and already redacted failures keep their exact diagnostic context', t => {
  const {root} = authorizationDom();
  const controls = mountComputerControls(root, async () => {}); t.after(() => controls.dispose());
  for (const [fragment, secret] of privateCases) {
    const failure = {code:'EXTERNAL_FAILURE', stage:'component_start', message:`Native read failed; ${fragment}; retry disabled`};
    const projected = computerControlFailure(failure, failure.stage);
    const snapshot = {state:'unavailable', enabled:true, available:false, providerAvailable:false,
      reason:'Read failed', waitingConfirmation:false, observationExportAllowed:false, failure};
    controls.render(snapshot);
    const field = root.querySelector('[data-computer="failure"]');
    assert.equal(field.textContent.includes(secret), false, fragment);
    assert.ok(field.textContent.endsWith(projected.message), fragment);
    controls.render({...snapshot, failure:projected});
    assert.ok(field.textContent.endsWith(projected.message), `redaction is idempotent: ${fragment}\n${projected.message}\n${field.textContent}`);
    assert.match(field.textContent, /EXTERNAL_FAILURE.*component_start/);
  }
});
