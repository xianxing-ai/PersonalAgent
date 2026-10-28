import { Ajv } from 'ajv';
import schema from './schema.js';
import type { ProtocolContracts } from './generated.js';
export type { ProtocolContracts } from './generated.js';
export type { StoragePort, ToolContext, RegisteredTool, ToolHost, ConnectorPort } from './ports.js';
export type Request = ProtocolContracts['request'];
export type Response = ProtocolContracts['response'];
export type Event = ProtocolContracts['event'];
export type TaskSnapshot = ProtocolContracts['snapshot'];
export type ToolDescriptor = ProtocolContracts['tool'];
export type ConnectorManifest = ProtocolContracts['connector'];
export type Operation = Request['operation'];
export type Payload<K extends Operation> = Extract<Request, {operation: K}>['payload'];
export type Result<K extends Operation> = ProtocolContracts['results'][K];
export const PROTOCOL_VERSION = '1.0.0';
export const MAX_FRAME_BYTES = 1024 * 1024;
export const MAX_COORDINATION_GOAL_CHARACTERS = 128_000;
export const MAX_COORDINATION_INITIAL_QUERY_BYTES = 1_100_000;
const ajv = new Ajv({allErrors: true, strict: false});
ajv.addSchema(schema);
const referenceValidators = new Map<string, ReturnType<typeof ajv.compile>>();
const validator = (path: string) => {
  let valid = referenceValidators.get(path);
  if (!valid) { valid = ajv.compile({$ref: schema.$id + '#/properties/' + path}); referenceValidators.set(path, valid); }
  return valid;
};
const requestValidator = validator('request');
const responseValidator = validator('response');
const eventValidator = validator('event');
const resultValidators = new Map<string, ReturnType<typeof validator>>();
const protocolErrors = new WeakSet<object>();
export class ProtocolError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = false, public readonly retryAfterMs?: number) { super(message); protocolErrors.add(this); }
}
/** Trusted local error identity, including subclasses, without external prototype traversal. */
export function isProtocolError(error: unknown): error is ProtocolError {
  return typeof error === 'object' && error !== null && protocolErrors.has(error);
}
const toolNotStartedProofs = new WeakSet<object>();
/** Trusted executor proof: no mutation was dispatched. Never recreate from untrusted wire data. */
export class ToolNotStartedError extends ProtocolError {
  constructor(code: string, message: string) { super(code, message); this.name = 'ToolNotStartedError'; toolNotStartedProofs.add(this); }
}
/** Identity-only check; never runs untrusted prototype/getter traps or accepts a forged wire object. */
export function isToolNotStartedError(error: unknown): error is ToolNotStartedError {
  return typeof error === 'object' && error !== null && toolNotStartedProofs.has(error);
}
function check(valid: ReturnType<typeof validator>, value: unknown): void {
  if (!valid(value)) throw new ProtocolError('INVALID_ARGUMENT', 'Message does not match the public schema');
}
export function parseRequest(value: unknown): Request {
  check(requestValidator, value);
  const request = value as Request;
  if (request.protocolVersion.split('.')[0] !== '1') throw new ProtocolError('PROTOCOL_MISMATCH', 'Unsupported protocol major');
  if (!Number.isFinite(Date.parse(request.deadline))) throw new ProtocolError('INVALID_ARGUMENT', 'Invalid deadline');
  return request;
}
export function parseResponse(value: unknown, operation: Operation, requestId: string): Response {
  check(responseValidator, value);
  const response = value as Response;
  if (!/^1\.\d+\.\d+$/.test(response.protocolVersion)) throw new ProtocolError('PROTOCOL_MISMATCH', 'Unsupported response version');
  if (response.requestId !== requestId) throw new ProtocolError('INVALID_ARGUMENT', 'Response requestId mismatch');
  if (response.outcome === 'ok') {
    let valid = resultValidators.get(operation);
    if (!valid) { valid = validator('results/properties/' + operation); resultValidators.set(operation, valid); }
    check(valid, response.data);
  }
  return response;
}
export function parseEvent(value: unknown): Event {
  check(eventValidator, value);
  const event = value as Event;
  if (!/^1\.\d+\.\d+$/.test(event.protocolVersion)) throw new ProtocolError('PROTOCOL_MISMATCH', 'Unsupported event version');
  if (!Number.isFinite(Date.parse(event.occurredAt))) throw new ProtocolError('INVALID_ARGUMENT', 'Invalid event time');
  return event;
}
export function validateContract(name: 'snapshot' | 'tool' | 'connector' | 'evidence' | 'connectorItem' | 'connectorAction', value: unknown): void {
  check(validator(name), value);
}
export function validateToolValue(schema: object, value: unknown): void {
  const valid=ajv.compile(schema);
  if(valid(value))return;
  const issue=valid.errors?.[0];
  const allowedKeywords=new Set(['required','type','enum','const','minimum','maximum','minLength','maxLength','pattern','format','additionalProperties','minItems','maxItems','oneOf','anyOf']);
  const keyword=issue&&allowedKeywords.has(issue.keyword)?issue.keyword:'schema';
  const properties=(schema as {properties?:Record<string,unknown>}).properties;
  const candidate=issue?.keyword==='required'?issue.params.missingProperty:issue?.instancePath.split('/')[1];
  // Only a property declared by the registered schema may be named. Never copy
  // additionalProperties, values, paths, regex patterns or AJV's raw message.
  const field=typeof candidate==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(candidate)
    &&properties&&Object.hasOwn(properties,candidate)?candidate:undefined;
  throw new ProtocolError('INVALID_ARGUMENT',`Tool value violates schema [keyword=${keyword}${field?`; field=${field}`:''}]`);
}
export function encodeFrame(message: Request | Response | Event): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(message) + '\n');
  if (bytes.length > MAX_FRAME_BYTES) throw new ProtocolError('INVALID_ARGUMENT', 'Frame exceeds 1 MiB');
  return bytes;
}
export class FrameDecoder {
  private pending: Uint8Array = new Uint8Array(0);
  push(chunk: Uint8Array): unknown[] {
    const values: unknown[] = [];
    let start = 0;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] !== 10) continue;
      const part = chunk.subarray(start, i + 1);
      const frame = this.join(part);
      this.pending = new Uint8Array(0);
      values.push(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(frame)));
      start = i + 1;
    }
    this.pending = this.join(chunk.subarray(start));
    return values;
  }
  private join(part: Uint8Array): Uint8Array {
    if (this.pending.length + part.length > MAX_FRAME_BYTES) {
      this.pending = new Uint8Array(0);
      throw new ProtocolError('INVALID_ARGUMENT', 'Frame exceeds 1 MiB');
    }
    const result = new Uint8Array(this.pending.length + part.length);
    result.set(this.pending); result.set(part, this.pending.length); return result;
  }
  finish(): void {
    if (this.pending.length) throw new ProtocolError('INVALID_ARGUMENT', 'Truncated JSONL frame');
  }
}
