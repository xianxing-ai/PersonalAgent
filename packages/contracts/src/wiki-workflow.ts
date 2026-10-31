import {ProtocolError, validateToolValue} from './index.js';

/** Provisional host-only service over the existing authenticated AgentArts invocation. */
export const WIKI_WORKFLOW_VERSION = 1;
export const WIKI_WORKFLOW_MAX_INPUT = 128_000;
export const WIKI_WORKFLOW_MAX_OUTPUT = 64_000;
const sha = {type:'string',pattern:'^[a-f0-9]{64}$'};
export const wikiWorkflowRequestSchema = {
  type:'object',additionalProperties:false,
  required:['wikiVersion','operation','requestId','inputDigest','stage','system','input','maxOutputCharacters','maxOutputTokens'],
  properties:{wikiVersion:{const:1},operation:{const:'compile'},requestId:sha,inputDigest:sha,
    stage:{enum:['extract','organize','answer']},system:{type:'string',minLength:1,maxLength:16_000},
    input:{type:'string',minLength:1,maxLength:WIKI_WORKFLOW_MAX_INPUT},
    maxOutputCharacters:{type:'integer',minimum:1,maximum:WIKI_WORKFLOW_MAX_OUTPUT},
    maxOutputTokens:{type:'integer',minimum:1,maximum:16_384}}
} as const;
export interface WikiWorkflowRequest {
  wikiVersion:1;operation:'compile';requestId:string;inputDigest:string;stage:'extract'|'organize'|'answer';
  system:string;input:string;maxOutputCharacters:number;maxOutputTokens:number;
}
export interface WikiWorkflowResult {
  wikiVersion:1;requestId:string;inputDigest:string;stage:'extract'|'organize'|'answer';verification:'unverified';
  output:unknown;deployment:{provider:string;deployment:string;model:string};
  usage?:{inputTokens?:number;outputTokens?:number};
}
export function parseWikiWorkflowRequest(value:unknown):WikiWorkflowRequest {
  validateToolValue(wikiWorkflowRequestSchema,value);
  return value as WikiWorkflowRequest;
}
export function parseWikiWorkflowResult(value:unknown,request:WikiWorkflowRequest):WikiWorkflowResult {
  validateToolValue({type:'object',additionalProperties:false,
    required:['wikiVersion','requestId','inputDigest','stage','verification','output','deployment'],
    properties:{wikiVersion:{const:1},requestId:{const:request.requestId},inputDigest:{const:request.inputDigest},
      stage:{const:request.stage},verification:{const:'unverified'},output:{type:'object'},
      deployment:{type:'object',additionalProperties:false,required:['provider','deployment','model'],properties:
        Object.fromEntries(['provider','deployment','model'].map(key=>[key,{type:'string',minLength:1,maxLength:256}]))},
      usage:{type:'object',additionalProperties:false,properties:{inputTokens:{type:'integer',minimum:0,maximum:1_000_000},
        outputTokens:{type:'integer',minimum:0,maximum:1_000_000}}}}},value);
  if(JSON.stringify((value as WikiWorkflowResult).output).length>request.maxOutputCharacters)
    throw new ProtocolError('INVALID_ARGUMENT','Wiki model output exceeds the authorized bound');
  return value as WikiWorkflowResult;
}
