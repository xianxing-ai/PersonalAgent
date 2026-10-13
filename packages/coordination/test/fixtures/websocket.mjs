import {EventEmitter} from 'node:events';
import {AGENTARTS_TRANSPORT_VERSION} from '@personal-agent/contracts/agentarts-transport';

export const version = AGENTARTS_TRANSPORT_VERSION;
export const identity = frame => ({protocolVersion: version, sessionId: frame.sessionId,
  requestId: frame.requestId, idempotencyKey: frame.idempotencyKey, payloadDigest: frame.payloadDigest,
  serverInstanceId: 'synthetic-instance'});
export const events = text => [{event: 'message', data: {text}}, {event: 'task_end'}, {event: 'end'}];

export class SyntheticWebSocket extends EventEmitter {
  readyState = 0;
  sent = [];
  terminations = 0;
  constructor(respond, {autoReady = true} = {}) {
    super();
    this.respond = respond;
    if (autoReady) queueMicrotask(() => this.ready());
  }
  ready(overrides = {}) {
    this.readyState = 1;
    this.emit('open');
    this.receive({protocolVersion: version, type: 'ready', serverInstanceId: 'synthetic-instance',
      capabilities: ['invoke', 'status', 'cancel', 'ephemeral-replay'], restartRecovery: false,
      heartbeatMs: 30_000, ...overrides});
  }
  receive(frame) { this.emit('message', Buffer.from(JSON.stringify(frame)), false); }
  send(raw, callback) {
    const frame = JSON.parse(raw);
    this.sent.push(frame);
    callback?.();
    this.respond?.(frame, this);
  }
  accepted(frame) { this.receive({...identity(frame), type: 'accepted', deadline: frame.deadline}); }
  result(frame, text = 'Synthetic answer') { this.receive({...identity(frame), type: 'result', events: events(text)}); }
  disconnect() { this.readyState = 3; this.emit('close'); }
  close() { this.disconnect(); }
  terminate() { this.terminations++; this.readyState = 3; this.emit('close'); }
}
