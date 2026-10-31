import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import {createOwnedWorkflowAdapter} from '@personal-agent/agentarts';
import type {RuntimeApplication} from './runtime-application.js';
import {assertOwnedWorkflowHostScope,failOwnedHost,type OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

type Scope=OwnedWorkflowHostScope;
export interface F10BoundFinding {claimId:string;claim:string;sourceRef:string;revision:string;quote:string}
export interface F10ClaimReview {claimId:string;state:'supported'|'contradicted'|'unknown';sourceRef:string;revision:string;findingDigest:string}
export interface F10SupportedClaimsOptions {
  application:Pick<RuntimeApplication,'runtime'|'readHostToolTask'>;
  requiredScopes:readonly string[];
  now:()=>Date;
  /** Validate actual current frontier and grant; never infer authority from the proposal. */
  assertCurrent:(scope:Scope,context:ToolContext)=>void;
  /** Resolve findings exclusively from confirmed N02/N03/N04 predecessor receipts. */
  resolveBoundFindings:(scope:Scope)=>Promise<readonly F10BoundFinding[]>;
  /** Read through the authorized, revision-aware source port, not model-provided text. */
  readCitation:(scope:Scope,sourceRef:string,revision:string)=>Promise<{revision:string;text:string}>;
  /** Authorize this exact finding and source text for the selected model destination. */
  authorizeReview:(scope:Scope,finding:F10BoundFinding,sourceText:string)=>Promise<boolean>;
  /** Independent review through the configured ModelGateway; unknown on insufficient support. */
  reviewClaim:(scope:Scope,finding:F10BoundFinding,sourceText:string)=>Promise<'supported'|'contradicted'|'unknown'>;
  authorizeExport:(scope:Scope,result:{correctionsApplied:F10ClaimReview[]})=>Promise<boolean>;
}
const text=(value:unknown,max=2048):value is string=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

/** Optional F10 check; no registration without original receipts, source readback,
 * independent reviewer, current frontier and exact export permission. */
export function createRuntimeF10SupportedClaimsHost(options?:F10SupportedClaimsOptions):{tools:RegisteredTool[];
  authorizeReceipt?:(input:{context:ToolContext;result:unknown})=>Promise<void>;unavailable:string|null} {
  if(!options?.application?.runtime||typeof options.application.readHostToolTask!=='function'||!Array.isArray(options.requiredScopes)||!options.requiredScopes.length
    ||!options.requiredScopes.every(value=>text(value,256))||typeof options.now!=='function'
    ||typeof options.assertCurrent!=='function'||typeof options.resolveBoundFindings!=='function'
    ||typeof options.readCitation!=='function'||typeof options.authorizeReview!=='function'
    ||typeof options.reviewClaim!=='function'||typeof options.authorizeExport!=='function')
    return {tools:[],unavailable:'f10_supported_claims_trusted_ports_unavailable'};
  const requiredScopes=[...options.requiredScopes],runtime=options.application.runtime;
  const active=(context:ToolContext)=>{
    if(!requiredScopes.every(scope=>context.scopes.includes(scope)))failOwnedHost('SCOPE_DENIED','F10 review scope required');
    return assertOwnedWorkflowHostScope({runtime,context,workflowId:'F10',nodeId:'F10_N05',
      hostToolName:'workflow.host.f10_n05',assertCurrent:options.assertCurrent,now:options.now});
  };
  const read=async(context:ToolContext,prior?:F10ClaimReview[])=>{
    const scope=active(context);
    let findings:readonly F10BoundFinding[];
    try {findings=await options.resolveBoundFindings(scope);}catch {return failOwnedHost('UNSUPPORTED_CAPABILITY','F10 predecessor evidence unavailable');}
    active(context);
    if(!Array.isArray(findings)||!findings.length||findings.length>100)
      failOwnedHost('UNSUPPORTED_CAPABILITY','F10 predecessor evidence unavailable');
    const ids=new Set<string>(),reviews:F10ClaimReview[]=[];
    for(const finding of findings){
      if(!object(finding)||!text(finding.claimId,256)||ids.has(finding.claimId)||!text(finding.claim,4000)
        ||!text(finding.sourceRef)||!text(finding.revision,256)||!text(finding.quote,4000))
        failOwnedHost('UNSUPPORTED_CAPABILITY','F10 finding provenance unavailable');
      const bound:F10BoundFinding={claimId:finding.claimId,claim:finding.claim,sourceRef:finding.sourceRef,
        revision:finding.revision,quote:finding.quote};
      const findingDigest=createHash('sha256').update(JSON.stringify(bound)).digest('hex');
      ids.add(finding.claimId);
      let source:{revision:string;text:string};
      try {source=await options.readCitation(scope,finding.sourceRef,finding.revision);}catch {return failOwnedHost('UNSUPPORTED_CAPABILITY','F10 source readback unavailable');}
      active(context);
      if(!object(source)||source.revision!==finding.revision||typeof source.text!=='string'||source.text.length>100000
        ||!source.text.includes(finding.quote))failOwnedHost('REVISION_CONFLICT','F10 source or quotation changed');
      let verdict:'supported'|'contradicted'|'unknown';
      if(prior){
        const saved=prior[reviews.length];
        if(!saved||saved.claimId!==finding.claimId||saved.sourceRef!==finding.sourceRef||saved.revision!==finding.revision||saved.findingDigest!==findingDigest)
          failOwnedHost('REVISION_CONFLICT','F10 bound findings changed');
        verdict=saved.state;
      }else{
        let allowed:boolean;
        try {allowed=await options.authorizeReview(scope,structuredClone(bound),source.text);}catch {return failOwnedHost('UNAUTHORIZED','F10 model review export denied');}
        if(allowed!==true)failOwnedHost('UNAUTHORIZED','F10 model review export denied');
        active(context);
        try {verdict=await options.reviewClaim(scope,bound,source.text);}catch {return failOwnedHost('UNSUPPORTED_CAPABILITY','F10 independent review unavailable');}
      }
      active(context);
      if(!['supported','contradicted','unknown'].includes(verdict))failOwnedHost('UNSUPPORTED_CAPABILITY','F10 independent review unavailable');
      let current:{revision:string;text:string};
      try {current=await options.readCitation(scope,finding.sourceRef,finding.revision);}catch {return failOwnedHost('UNSUPPORTED_CAPABILITY','F10 source readback unavailable');}
      active(context);
      if(!isDeepStrictEqual(source,current))failOwnedHost('REVISION_CONFLICT','F10 source changed during review');
      reviews.push({claimId:finding.claimId,state:verdict,sourceRef:finding.sourceRef,revision:finding.revision,findingDigest});
    }
    return {correctionsApplied:reviews};
  };
  const tool=createOwnedWorkflowAdapter({nodeId:'F10_N05',kind:'host',sideEffect:'read',requiredScopes,
    inputSchema:{type:'object',additionalProperties:false,properties:{}},
    outputSchema:{type:'object',additionalProperties:false,required:['correctionsApplied'],properties:{correctionsApplied:{type:'array',items:{
      type:'object',additionalProperties:false,required:['claimId','state','sourceRef','revision','findingDigest'],properties:{
        claimId:{type:'string'},state:{type:'string',enum:['supported','contradicted','unknown']},sourceRef:{type:'string'},revision:{type:'string'},findingDigest:{type:'string'}}}}}},
    async execute(_input,context){return read(context);}});
  return {tools:[tool],unavailable:null,authorizeReceipt:async({context,result})=>{
    const scope=active(context);
    const saved=options.application.readHostToolTask(context.taskId);
    if(saved.commandId!==scope.operationId||saved.toolName!=='workflow.host.f10_n05'||saved.task.state!=='succeeded'
      ||saved.confirmed?.runId!==context.runId||!saved.confirmed.evidenceRefs.includes(context.runId)
      ||!isDeepStrictEqual(saved.confirmed.result,result)||!object(result)||!Array.isArray(result.correctionsApplied))
      failOwnedHost('UNAUTHORIZED','F10 original review receipt unavailable');
    const reviews=result.correctionsApplied as F10ClaimReview[];
    if(!isDeepStrictEqual(result,await read(context,reviews)))failOwnedHost('REVISION_CONFLICT','F10 review changed before export');
    if(await options.authorizeExport(scope,structuredClone(result) as {correctionsApplied:F10ClaimReview[]})!==true)
      failOwnedHost('UNAUTHORIZED','F10 review export denied');
    if(!isDeepStrictEqual(result,await read(context,reviews)))failOwnedHost('REVISION_CONFLICT','F10 review changed during export');
  }};
}
