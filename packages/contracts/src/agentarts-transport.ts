import {Ajv2020} from 'ajv/dist/2020.js';
import {createHash} from 'node:crypto';
import schema from '../schema/agentarts-transport.json' with {type: 'json'};
import {ProtocolError} from './index.js';
import type {AgentArtsTransportFrame} from './agentarts-transport.generated.js';

export type {AgentArtsTransportFrame} from './agentarts-transport.generated.js';
export type AgentArtsTransportInvoke = Extract<AgentArtsTransportFrame, {type:'invoke'}>;
export type AgentArtsTransportPayload = AgentArtsTransportInvoke['payload'];
export const AGENTARTS_TRANSPORT_VERSION = '0.1.0';
export const MAX_AGENTARTS_TRANSPORT_BYTES = 1_200_000;
export const MAX_AGENTARTS_RESULT_BYTES = 64_000;
const validate = new Ajv2020({strict:false,allErrors:true}).compile(schema);
function invalid(): never { throw new ProtocolError('INVALID_ARGUMENT','Invalid AgentArts transport frame'); }
/** Canonical single-key payload, independent of input object property order. */
export function digestAgentArtsPayload(payload:AgentArtsTransportPayload):string {
  const canonical = 'query' in payload ? {query:payload.query}
    : {inputs:Object.fromEntries(Object.entries(payload.inputs).sort(([a],[b])=>a.localeCompare(b)))};
  return createHash('sha256').update(JSON.stringify(canonical),'utf8').digest('hex');
}
export function parseAgentArtsTransportFrame(value:unknown):AgentArtsTransportFrame {
  if(!validate(value)) invalid();
  const frame=value as AgentArtsTransportFrame;
  if('deadline' in frame && (!Number.isFinite(Date.parse(frame.deadline))
    || new Date(frame.deadline).toISOString().replace('.000Z','Z')!==frame.deadline.replace('.000Z','Z'))) invalid();
  if(frame.type==='invoke') {
    const query='query' in frame.payload ? frame.payload.query : Object.values(frame.payload.inputs)[0];
    if(!query?.trim() || digestAgentArtsPayload(frame.payload)!==frame.payloadDigest) invalid();
  }
  const text=JSON.stringify(frame);
  if(Buffer.byteLength(text)>MAX_AGENTARTS_TRANSPORT_BYTES) invalid();
  if('events' in frame && (Buffer.byteLength(JSON.stringify(frame.events))>MAX_AGENTARTS_RESULT_BYTES
    || frame.events.map(event=>event.event).join(',')!=='message,task_end,end')) invalid();
  return frame;
}
export function encodeAgentArtsTransportFrame(value:AgentArtsTransportFrame):string {
  parseAgentArtsTransportFrame(value);
  return JSON.stringify(value);
}
