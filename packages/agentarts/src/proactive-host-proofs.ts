import {createHmac,timingSafeEqual} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {proactiveWorkflowDigest} from './proactive-workflows.js';

export interface ProactiveHostProofBinding {taskId:string;sessionId:string;controlRevision:number;taskDeadline:string}
export type ProactiveHostProofKind='event'|'responsibility'|'receipt'|'control'|'frame'|'advance_result';
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const invalid=():never=>{throw new ProtocolError('INVALID_ARGUMENT','Invalid proactive host protocol');};
const identity=(value:ProactiveHostProofBinding)=>{
  if(!value||typeof value.taskId!=='string'||!value.taskId||typeof value.sessionId!=='string'||!value.sessionId
    ||!Number.isSafeInteger(value.controlRevision)||value.controlRevision<0||!Number.isFinite(Date.parse(value.taskDeadline)))invalid();
  return {taskId:value.taskId,sessionId:value.sessionId,controlRevision:value.controlRevision,taskDeadline:value.taskDeadline};
};
/** Shared host/image provenance algorithm. This signs data, never Runtime/Policy permission. */
export function createProactiveHostProofs(secret:string) {
  if(typeof secret!=='string'||Buffer.byteLength(secret)<32)invalid();
  const digest=(kind:ProactiveHostProofKind,value:Record<string,unknown>,binding:ProactiveHostProofBinding)=>{
    const {proof:ignored,...body}=value;
    return createHmac('sha256',secret).update('proactive-host-v1:'+proactiveWorkflowDigest({kind,binding:identity(binding),value:body})).digest();
  };
  return {
    sign<T extends object>(kind:ProactiveHostProofKind,value:T,binding:ProactiveHostProofBinding):T&{proof:string} {
      if(!plain(value))invalid();
      return {...value,proof:digest(kind,value as Record<string,unknown>,binding).toString('base64url')};
    },
    verify(kind:ProactiveHostProofKind,value:unknown,binding:ProactiveHostProofBinding):boolean {
      if(!plain(value)||typeof value.proof!=='string')return false;
      try {const supplied=Buffer.from(value.proof,'base64url'),expected=digest(kind,value,binding);
        return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
      } catch {return false;}
    },
  };
}
