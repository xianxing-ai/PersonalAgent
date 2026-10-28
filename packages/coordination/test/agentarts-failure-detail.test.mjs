import assert from 'node:assert/strict';
import test from 'node:test';
import {AgentArtsBeforeInvokeError, AgentArtsResultUnknownError, AgentArtsTerminalError,
  formatAgentArtsFailureDetail} from '../dist/index.js';

const receipt = {sessionId: 'synthetic', requestId: 'synthetic', idempotencyKey: 'synthetic',
  payloadDigest: '0'.repeat(64), accepted: true};
const fail = () => { throw Error('SYNTHETIC_PRIVATE_ACCESSOR'); };

test('optional cloud details fail closed for primitives, getters and Proxy traps', () => {
  const diagnostic = {transportPhase: 'wss_invoke', closeCode: 1011, closeReason: 'server_error'};
  const getter = Object.defineProperty(new AgentArtsResultUnknownError(receipt), 'connectionDiagnostic', {get: fail});
  const nested = new AgentArtsResultUnknownError(receipt, Object.defineProperty({...diagnostic}, 'closeCode', {get: fail}));
  const terminal = Object.defineProperty(new AgentArtsTerminalError(receipt), 'remoteCode', {get: fail});
  const values = [undefined, null, true, 1, 1n, Symbol('synthetic'), 'SYNTHETIC_PRIVATE_TEXT', {}, getter, nested, terminal,
    new Proxy({}, {getPrototypeOf: fail}),
    new Proxy(new AgentArtsResultUnknownError(receipt, diagnostic), {get: fail})];
  for (const value of values) assert.equal(formatAgentArtsFailureDetail(value), undefined);
  const {proxy, revoke} = Proxy.revocable({}, {}); revoke();
  assert.equal(formatAgentArtsFailureDetail(proxy), undefined);
});

test('fail-closed projection preserves the supported precise typed cloud facts', () => {
  assert.equal(formatAgentArtsFailureDetail(new AgentArtsResultUnknownError(receipt,
    {transportPhase: 'wss_invoke', closeCode: 1011, closeReason: 'server_error'})),
  'cloud: transport=wss phase=wss_invoke close=1011 reason=server_error');
  assert.equal(formatAgentArtsFailureDetail(new AgentArtsBeforeInvokeError('connection',
    {transportPhase: 'wss_connect', socketErrorCode: 'ECONNREFUSED'})),
  'cloud: transport=wss phase=wss_connect socket=ECONNREFUSED');
  assert.equal(formatAgentArtsFailureDetail(new AgentArtsTerminalError(receipt, 'RATE_LIMITED')),
    'cloud: transport=wss code=RATE_LIMITED');
});
