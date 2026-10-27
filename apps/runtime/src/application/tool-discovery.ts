import {ProtocolError, validateToolValue} from '@personal-agent/contracts';
import type {RegisteredTool, ToolDescriptor} from '@personal-agent/contracts';
import type {RuntimeCompetitionToolCatalog} from './tool-catalog.js';

export const TOOL_DISCOVERY_NAME = 'capability.search';
export const TOOL_DISCOVERY_VERSION = '1.0.0';
export const TOOL_DISCOVERY_DESCRIPTION = 'Search the original task tool directory by a name, namespace or keyword. Use query "" for groups, or "workspace", "browser", "computer" for actions. Returned selected tools become available on the next turn; use cursor for more. Discovery never grants execution permission.';

const identity = {type:'object',properties:{name:{type:'string',maxLength:128},version:{type:'string',maxLength:64}},
  required:['name','version'],additionalProperties:false};

export const TOOL_DISCOVERY_DESCRIPTOR:ToolDescriptor = {
  name:TOOL_DISCOVERY_NAME,version:TOOL_DISCOVERY_VERSION,
  inputSchema:{type:'object',properties:{
    query:{type:'string',maxLength:256,description:'Tool name, namespace or keywords; empty returns an overview and a bounded first page.'},
    cursor:{type:'string',minLength:1,maxLength:1024,description:'Exact nextCursor returned for the same original task and query.'},
  },required:['query'],additionalProperties:false},
  outputSchema:{type:'object',properties:{
    catalogRef:{type:'string',minLength:64,maxLength:64},query:{type:'string',maxLength:256},
    totalMatches:{type:'integer',minimum:0},offset:{type:'integer',minimum:0},hasMore:{type:'boolean'},
    nextCursor:{type:'string',maxLength:1024},
    groups:{type:'array',maxItems:64,items:{type:'object',properties:{namespace:{type:'string',maxLength:128},count:{type:'integer',minimum:1}},
      required:['namespace','count'],additionalProperties:false}},groupsTruncated:{type:'boolean'},
    matches:{type:'array',maxItems:63,items:{type:'object',properties:{...identity.properties,
      state:{type:'string',enum:['selected','unavailable','schema_too_large']}},required:['name','version','state'],additionalProperties:false}},
    selectedTools:{type:'array',maxItems:63,items:identity},
    authorization:{type:'string',enum:['checked_on_invocation']},
  },required:['catalogRef','query','totalMatches','offset','hasMore','groups','groupsTruncated','matches','selectedTools','authorization'],additionalProperties:false},
  sideEffect:'read',requiredScopes:['capability:read'],idempotencySupport:true,recoverySupport:false,requiresPresence:false,
};

export function createRuntimeToolDiscoveryTool(getCatalog:(taskId:string)=>RuntimeCompetitionToolCatalog|undefined):RegisteredTool {
  const descriptor=structuredClone(TOOL_DISCOVERY_DESCRIPTOR);
  return {descriptor,execute:async (raw,context)=>{
    validateToolValue(descriptor.inputSchema,raw);
    const catalog=getCatalog(context.taskId);
    if(!catalog)throw new ProtocolError('UNSUPPORTED_CAPABILITY','Original task tool discovery is unavailable');
    return catalog.search({...context,arguments:raw as {query:string;cursor?:string}});
  }};
}
