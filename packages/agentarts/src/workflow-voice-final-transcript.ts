import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from './workflow-adapters.js';

/** Trusted Desktop final-only receipt. Partial, echo, silence and stale audio never qualify. */
export interface VoiceFinalTranscriptReceipt {
  readonly source:'live_input_audio';
  readonly phase:'final';
  readonly origin:'user';
  readonly echo:false;
  readonly sessionId:string;
  readonly utteranceId:string;
  readonly text:string;
  readonly transcriptDigest:string;
  readonly questionId:string;
  readonly questionRevision:number;
  readonly startedAt:string;
  readonly completedAt:string;
  readonly expiresAt:string;
}

export interface VoiceFinalTranscriptReadRequest {
  readonly workflowId:string;
  readonly nodeId:string;
  readonly taskId?:string;
  readonly questionId?:string;
  readonly questionRevision?:number;
  readonly sessionId?:string;
  readonly deadline:string;
  readonly signal:AbortSignal;
}

export type VoiceFinalTranscriptObservation =
  | {readonly state:'completed';readonly receipt:VoiceFinalTranscriptReceipt}
  | {readonly state:'unavailable';readonly reason:string}
  | {readonly state:'unknown';readonly reason:string}
  | {readonly state:'failed';readonly reason:string};

/**
 * Desktop / host injection port. Composition must supply a real final-receipt reader;
 * this module never invents ASR text or treats Fake success as production wiring.
 */
export interface VoiceFinalTranscriptPort {
  readFinal(request:VoiceFinalTranscriptReadRequest):Promise<VoiceFinalTranscriptObservation>;
}

export const VOICE_FINAL_TRANSCRIPT_SCOPE='voice.final_transcript' as const;
export const VOICE_FINAL_TRANSCRIPT_UNAVAILABLE_REASON=
  'Desktop voice final receipt port unavailable; F02_N03 stays unavailable until a trusted final-only reader is injected' as const;

/** Matches Desktop `notificationDigest(text)` so Live final receipts validate without a second digest scheme. */
export function voiceFinalTranscriptDigest(text:string):string {
  return createHash('sha256').update(JSON.stringify(text)).digest('hex');
}

function active(context:ToolContext):void {
  if(context.signal.aborted)throw new ProtocolError('CANCELLED','Voice final transcript adapter cancelled');
  if(!Number.isFinite(Date.parse(context.deadline))||Date.parse(context.deadline)<=Date.now())
    throw new ProtocolError('TIMEOUT','Voice final transcript adapter expired');
}

function trustedReceipt(value:unknown):value is VoiceFinalTranscriptReceipt {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const receipt=value as Record<string,unknown>;
  return receipt.source==='live_input_audio'&&receipt.phase==='final'&&receipt.origin==='user'
    &&receipt.echo===false&&typeof receipt.sessionId==='string'&&receipt.sessionId.length>0
    &&typeof receipt.utteranceId==='string'&&receipt.utteranceId.length>0
    &&typeof receipt.text==='string'&&receipt.text.trim().length>0
    &&receipt.transcriptDigest===voiceFinalTranscriptDigest(receipt.text)
    &&typeof receipt.questionId==='string'&&receipt.questionId.length>0
    &&Number.isSafeInteger(receipt.questionRevision)
    &&Number.isFinite(Date.parse(String(receipt.startedAt)))
    &&Number.isFinite(Date.parse(String(receipt.completedAt)))
    &&Number.isFinite(Date.parse(String(receipt.expiresAt)))
    &&Date.parse(String(receipt.completedAt))>=Date.parse(String(receipt.startedAt));
}

export function createVoiceFinalTranscriptService(options:{
  port?:VoiceFinalTranscriptPort;
  requiredScopes?:readonly string[];
  now?:()=>number;
}) {
  const scopes=options.requiredScopes?.length?[...options.requiredScopes]:[VOICE_FINAL_TRANSCRIPT_SCOPE];
  const now=options.now??Date.now;
  const port=options.port&&typeof options.port.readFinal==='function'?options.port:undefined;
  return {
    requiredScopes:scopes as readonly string[],
    status():{state:'ready'|'unavailable';reason?:string} {
      return port?{state:'ready'}:{state:'unavailable',reason:VOICE_FINAL_TRANSCRIPT_UNAVAILABLE_REASON};
    },
    async read(input:Record<string,unknown>,context:ToolContext):Promise<Record<string,unknown>> {
      active(context);
      if(!port) {
        return {state:'unavailable',reason:VOICE_FINAL_TRANSCRIPT_UNAVAILABLE_REASON,
          capability:'voice.final_transcript',nodeId:'F02_N03'};
      }
      const questionId=typeof input.questionId==='string'?input.questionId:undefined;
      const questionRevision=Number.isSafeInteger(input.questionRevision)?Number(input.questionRevision):undefined;
      const sessionId=typeof input.sessionId==='string'?input.sessionId:undefined;
      const observation=await port.readFinal({
        workflowId:'F02',nodeId:'F02_N03',
        ...(typeof input.taskId==='string'?{taskId:input.taskId}:{}),
        ...(questionId?{questionId}:{}),
        ...(questionRevision!==undefined?{questionRevision}:{}),
        ...(sessionId?{sessionId}:{}),
        deadline:context.deadline,signal:context.signal,
      });
      active(context);
      if(observation.state!=='completed') {
        return {state:observation.state,reason:observation.reason,capability:'voice.final_transcript',nodeId:'F02_N03'};
      }
      const receipt=observation.receipt;
      if(!trustedReceipt(receipt)) {
        return {state:'unavailable',reason:'untrusted_or_partial_voice_receipt_rejected',
          capability:'voice.final_transcript',nodeId:'F02_N03'};
      }
      if(questionId&&receipt.questionId!==questionId) {
        return {state:'unavailable',reason:'final_receipt_question_mismatch',capability:'voice.final_transcript',nodeId:'F02_N03'};
      }
      if(questionRevision!==undefined&&receipt.questionRevision!==questionRevision) {
        return {state:'unavailable',reason:'final_receipt_revision_mismatch',capability:'voice.final_transcript',nodeId:'F02_N03'};
      }
      if(!(Date.parse(receipt.expiresAt)>now())) {
        return {state:'unavailable',reason:'final_receipt_expired',capability:'voice.final_transcript',nodeId:'F02_N03'};
      }
      return {
        state:'completed',
        capability:'voice.final_transcript',
        nodeId:'F02_N03',
        sessionId:receipt.sessionId,
        utteranceId:receipt.utteranceId,
        questionId:receipt.questionId,
        questionRevision:receipt.questionRevision,
        transcriptDigest:receipt.transcriptDigest,
        text:receipt.text,
        startedAt:receipt.startedAt,
        completedAt:receipt.completedAt,
        expiresAt:receipt.expiresAt,
        phase:'final',
        echo:false,
        origin:'user',
        source:'live_input_audio',
      };
    },
  };
}

export type VoiceFinalTranscriptService=ReturnType<typeof createVoiceFinalTranscriptService>;

/** F02_N03 production adapter. Missing Desktop port stays explicit unavailable — never Fake ASR success. */
export function createVoiceFinalTranscriptAdapter(service:VoiceFinalTranscriptService):RegisteredTool {
  return createOwnedWorkflowAdapter({
    nodeId:'F02_N03',kind:'host',sideEffect:'read',requiredScopes:[...service.requiredScopes],
    inputSchema:{type:'object',additionalProperties:false,properties:{
      taskId:{type:'string',minLength:1},
      questionId:{type:'string',minLength:1},
      questionRevision:{type:'integer',minimum:0},
      sessionId:{type:'string',minLength:1},
    }},
    outputSchema:{type:'object',additionalProperties:false,required:['state','capability','nodeId'],properties:{
      state:{type:'string',enum:['completed','unavailable','unknown','failed']},
      reason:{type:'string',minLength:1},
      capability:{type:'string',enum:['voice.final_transcript']},
      nodeId:{type:'string',enum:['F02_N03']},
      sessionId:{type:'string',minLength:1},
      utteranceId:{type:'string',minLength:1},
      questionId:{type:'string',minLength:1},
      questionRevision:{type:'integer',minimum:0},
      transcriptDigest:{type:'string',pattern:'^[a-f0-9]{64}$'},
      text:{type:'string',minLength:1},
      startedAt:{type:'string',minLength:1},
      completedAt:{type:'string',minLength:1},
      expiresAt:{type:'string',minLength:1},
      phase:{type:'string',enum:['final']},
      echo:{type:'boolean'},
      origin:{type:'string',enum:['user']},
      source:{type:'string',enum:['live_input_audio']},
    }},
    execute:(input,context)=>service.read((input&&typeof input==='object'&&!Array.isArray(input)
      ?input:{}) as Record<string,unknown>,context),
  });
}
