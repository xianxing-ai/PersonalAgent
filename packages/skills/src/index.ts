import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ProtocolError, validateToolValue} from '@personal-agent/contracts';
import type {AgentToolInvocation, AgentToolPort, AgentWorkerContext, ToolInvocationResult} from '@personal-agent/agents';
import {referenceSummary} from './reference-summary.js';
export {readLocalSkillDirectory,openLocalSkillStore,localSkillInstructions} from './local-installation.js';
export type {LocalSkillBundle,LocalSkillFile,InstalledSkill} from './local-installation.js';
export {createCloudSkillSelectionPort, CLOUD_SKILL_CHOICE_SCHEMA, CLOUD_SKILL_TOOL_NAME, CLOUD_SKILL_TOOL_VERSION, CLOUD_SKILL_PUBLIC_ENUM_PATHS} from './cloud-selection.js';
export type {VersionedSkillWorkerPort, PublicSkillSource, CloudSkillChoice, CloudSkillContext, CloudSkillSelection, CloudSkillReceipt, CloudSkillSelectionOptions} from './cloud-selection.js';

export const REFERENCE_SUMMARY_SKILL_ID='workspace-reference-summary';
export const REFERENCE_SUMMARY_SKILL_VERSION='1.0.0';
export const REFERENCE_SUMMARY_BODY_SHA256='652c3a39baceac9d4508d9aef2b034e98f579c59bfc5589d382cdd11d51969e5';
const TOOL_NAME='mcp.workspace.read_text';
const TOOL_VERSION='1.0.0';
const CHECKPOINT='skill:workspace-reference-summary:v1';
function fail(code:string,message:string):never {throw new ProtocolError(code,message);}
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const parameters={type:'object',properties:{skillId:{const:REFERENCE_SUMMARY_SKILL_ID},version:{const:REFERENCE_SUMMARY_SKILL_VERSION},digest:{type:'string',pattern:'^[a-f0-9]{64}$'},path:{type:'string',minLength:1,maxLength:1024}},required:['skillId','version','digest','path'],additionalProperties:false};
const readResultSchema={type:'object',properties:{path:{type:'string'},text:{type:'string',maxLength:262144},contentDigest:{type:'string',pattern:'^[a-f0-9]{64}$'},source:{const:'mcp'},serverVersion:{type:'string'}},required:['path','text','contentDigest','source','serverVersion'],additionalProperties:false};

export interface SkillManifest {
  id:typeof REFERENCE_SUMMARY_SKILL_ID;
  version:typeof REFERENCE_SUMMARY_SKILL_VERSION;
  digest:string;
  name:string;
  description:string;
  capabilities:readonly {toolName:string;toolVersion:string;sideEffect:'read'}[];
  inputSchema:typeof parameters;
  steps:readonly ['read-reference','summarize-reference'];
}
export interface ReferenceSummaryInput {skillId:string;version:string;digest:string;path:string}
export interface SkillOutcome {
  state:'confirmed'|'pending'|'unknown';
  evidenceRefs:readonly string[];
  resultSummary?:string;
  sources?:readonly {path:string;contentDigest:string}[];
}
export interface SkillReadReconciliationQuery extends AgentToolInvocation {
  toolName:typeof TOOL_NAME;
  toolVersion:typeof TOOL_VERSION;
  arguments:{path:string};
  skillId:typeof REFERENCE_SUMMARY_SKILL_ID;
  skillVersion:typeof REFERENCE_SUMMARY_SKILL_VERSION;
  skillDigest:string;
  argumentsDigest:string;
  configurationRef:string;
}
export interface SkillReadReconciliationPort {
  /** Opaque trusted configuration identity, never a root path or credential. */
  currentConfigurationRef():string|undefined;
  /** Read only the exact Runtime execution, tool-result checkpoint and Evidence.
   * Must verify original task/run/tool/version/arguments/scopeRef and configuration.
   * Never invoke, grant, fabricate a receipt or reconcile from Renderer input. */
  readConfirmed(query:SkillReadReconciliationQuery):Promise<ToolInvocationResult|undefined>;
}
export interface ReferenceSummaryOptions {
  /** Existing Runtime tool port; never RegisteredTool.execute or self-issued grants. */
  tools:AgentToolPort;
  enabled?:boolean;
  /** Fresh trusted MCP health check, not an external tool annotation. */
  isToolAvailable:()=>boolean;
  reconciliation?:SkillReadReconciliationPort;
}
interface Checkpoint {
  binding:string;
  phase:'started'|'pending'|'unknown'|'read-confirmed'|'complete';
  read?:{path:string;text:string;contentDigest:string};
  evidenceRefs:string[];
  outcome?:SkillOutcome;
  configurationRef?:string;
}

/** Fixed two-step skill runner, called at the worker layer outside tool locks. */
export function createReferenceSummarySkill(options?:ReferenceSummaryOptions) {
  options=options ? {...options} : undefined;
  const reconciliation=options?.reconciliation ? {
    currentConfigurationRef:options.reconciliation.currentConfigurationRef.bind(options.reconciliation),
    readConfirmed:options.reconciliation.readConfirmed.bind(options.reconciliation),
  } : undefined;
  let enabled=options?.enabled ?? false;
  let disposed=false;
  let epoch=0;
  let controller=new AbortController();
  const activeTasks=new Set<string>();
  function manifest():SkillManifest {
    let body:string;
    try {body=readFileSync(new URL('../workspace-reference-summary/SKILL.md',import.meta.url),'utf8').replace(/\r\n/g,'\n');}
    catch {return fail('UNSUPPORTED_CAPABILITY','Skill bundle could not be loaded');}
    // This is an owned fixed Agent Skills bundle, not a general YAML/script loader.
    if(!body.startsWith('---\nname: workspace-reference-summary\ndescription: ') || body.length>16384
      || hash(body)!==REFERENCE_SUMMARY_BODY_SHA256) fail('PROTOCOL_MISMATCH','Skill bundle metadata or body digest is incompatible');
    const base={id:REFERENCE_SUMMARY_SKILL_ID,version:REFERENCE_SUMMARY_SKILL_VERSION,
      name:'Workspace reference summary',description:'Read approved text and return two source lines with provenance.',
      capabilities:[{toolName:TOOL_NAME,toolVersion:TOOL_VERSION,sideEffect:'read' as const}],inputSchema:parameters,
      steps:['read-reference','summarize-reference'] as const} satisfies Omit<SkillManifest,'digest'>;
    return {...structuredClone(base),digest:hash(JSON.stringify(base)+'\n'+body)};
  }
  function available() {
    if(!options || disposed || !enabled || !options.isToolAvailable()) return false;
    return options.tools.list().some(tool=>tool.name===TOOL_NAME && tool.version===TOOL_VERSION && tool.sideEffect==='read');
  }
  const health=()=>({configured:!!options,enabled,connected:available(),state:disposed?'disposed':!options?'unavailable':!enabled?'disabled':available()?'ready':'unavailable',id:REFERENCE_SUMMARY_SKILL_ID,version:REFERENCE_SUMMARY_SKILL_VERSION,digest:manifest().digest});
  function check(context:AgentWorkerContext, generation:number, bindingDigest:string) {
    if(context.signal.aborted || controller.signal.aborted || generation!==epoch) fail('CANCELLED','Skill invocation was cancelled or disabled');
    if(!Number.isFinite(Date.parse(context.deadline)) || Date.parse(context.deadline)<=Date.now()) fail('TIMEOUT','Skill deadline expired');
    if(manifest().digest!==bindingDigest) fail('PROTOCOL_MISMATCH','Skill content changed during invocation');
    if(!available()) fail('UNSUPPORTED_CAPABILITY','Skill tool dependency is unavailable');
  }
  function configurationRef():string|undefined {
    if(!reconciliation) return undefined;
    let value:string|undefined;
    try {value=reconciliation.currentConfigurationRef();}
    catch {return fail('UNSUPPORTED_CAPABILITY','Skill reconciliation configuration is unavailable');}
    if(value===undefined) fail('UNSUPPORTED_CAPABILITY','Skill reconciliation configuration is unavailable');
    if(typeof value!=='string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) fail('INVALID_ARGUMENT','Skill configuration reference must be an opaque identifier');
    return value;
  }
  function confirmedRead(result:unknown,path:string) {
    validateToolValue(readResultSchema,result);
    const read=result as {path:string;text:string;contentDigest:string};
    if(read.path!==path || hash(read.text)!==read.contentDigest || Buffer.byteLength(read.text)>262144) fail('EXTERNAL_FAILURE','Skill source result is inconsistent');
    return {path:read.path,text:read.text,contentDigest:read.contentDigest};
  }
  async function run(input:ReferenceSummaryInput,context:AgentWorkerContext):Promise<SkillOutcome> {
    validateToolValue(parameters,input);
    const current=manifest();
    if(input.digest!==current.digest) fail('PROTOCOL_MISMATCH','Skill version or digest is not current');
    const generation=epoch; check(context,generation,input.digest);
    const binding=JSON.stringify({taskId:context.taskId,skillId:input.skillId,version:input.version,digest:input.digest,path:input.path});
    let saved=context.loadCheckpoint(CHECKPOINT) as Checkpoint|undefined;
    if(saved && (typeof saved!=='object' || saved.binding!==binding)) fail('REVISION_CONFLICT','Skill task is bound to different input or version');
    if(saved?.configurationRef && configurationRef()!==saved.configurationRef) fail('REVISION_CONFLICT','Skill configuration changed');
    if(saved?.read) {
      if(saved.read.path!==input.path || typeof saved.read.text!=='string' || Buffer.byteLength(saved.read.text)>262144
        || hash(saved.read.text)!==saved.read.contentDigest) fail('RESULT_UNKNOWN','Saved Skill body does not match its digest');
    }
    if(saved?.phase==='complete') {
      if(!saved.read || saved.outcome?.state!=='confirmed' || saved.outcome.sources?.length!==1
        || saved.outcome.sources[0]?.path!==input.path || saved.outcome.sources[0]?.contentDigest!==saved.read.contentDigest
        || JSON.stringify(saved.outcome.evidenceRefs)!==JSON.stringify(saved.evidenceRefs)) fail('RESULT_UNKNOWN','Saved Skill receipt is inconsistent');
      return structuredClone(saved.outcome);
    }
    const runId=`skill-read-${context.taskId}-${input.digest.slice(0,16)}`;
    if(saved?.phase==='started' || saved?.phase==='unknown') {
      const unknown=():SkillOutcome=>({state:'unknown',evidenceRefs:[...saved!.evidenceRefs]});
      // Old checkpoints without an original configuration binding cannot be promoted.
      if(!reconciliation || !saved.configurationRef) return unknown();
      if(configurationRef()!==saved.configurationRef) fail('REVISION_CONFLICT','Skill reconciliation configuration changed');
      const receipt=await reconciliation.readConfirmed({taskId:context.taskId,runId,toolName:TOOL_NAME,toolVersion:TOOL_VERSION,
        arguments:{path:input.path},argumentsDigest:hash(JSON.stringify({path:input.path})),authorizationRef:runId,
        deadline:context.deadline,signal:AbortSignal.any([context.signal,controller.signal]),
        skillId:REFERENCE_SUMMARY_SKILL_ID,skillVersion:REFERENCE_SUMMARY_SKILL_VERSION,skillDigest:input.digest,configurationRef:saved.configurationRef});
      check(context,generation,input.digest);
      if(configurationRef()!==saved.configurationRef) fail('REVISION_CONFLICT','Skill reconciliation configuration changed');
      if(receipt?.state!=='confirmed' || !Array.isArray(receipt.evidenceRefs) || !receipt.evidenceRefs.includes(runId)
        || receipt.evidenceRefs.some(ref=>typeof ref!=='string' || !ref)) return unknown();
      try {saved.read=confirmedRead(receipt.result,input.path);}
      catch {return unknown();}
      saved.phase='read-confirmed';saved.evidenceRefs=[...receipt.evidenceRefs];context.saveCheckpoint(CHECKPOINT,saved);
    }
    if(!saved?.read) {
      context.reportProgress({stepId:'skill-read-reference',label:'Read approved reference',completedUnits:0,totalUnits:2});
      const originalConfiguration=saved?.configurationRef ?? configurationRef();
      if(saved?.configurationRef && configurationRef()!==saved.configurationRef) fail('REVISION_CONFLICT','Skill configuration changed');
      saved={binding,phase:'started',evidenceRefs:saved?.evidenceRefs ?? [],...(originalConfiguration?{configurationRef:originalConfiguration}:{})};
      context.saveCheckpoint(CHECKPOINT,saved);
      let result:ToolInvocationResult;
      try {
        result=await options!.tools.invoke({toolName:TOOL_NAME,toolVersion:TOOL_VERSION,arguments:{path:input.path},
          taskId:context.taskId,runId,authorizationRef:runId,deadline:context.deadline,
          signal:AbortSignal.any([context.signal,controller.signal])});
      } catch(error) {
        saved.phase='unknown';context.saveCheckpoint(CHECKPOINT,saved);
        throw error instanceof ProtocolError ? error : new ProtocolError('EXTERNAL_FAILURE','Skill read did not return a confirmed result');
      }
      saved.evidenceRefs=[...result.evidenceRefs];
      if(result.state!=='confirmed') {
        saved.phase=result.state;context.saveCheckpoint(CHECKPOINT,saved);
        return {state:result.state,evidenceRefs:[...result.evidenceRefs]};
      }
      try {
        saved.read=confirmedRead(result.result,input.path);saved.phase='read-confirmed';
      } catch {
        saved.phase='unknown';context.saveCheckpoint(CHECKPOINT,saved);
        fail('RESULT_UNKNOWN','Skill read returned an invalid result; reconcile before retrying');
      }
      // Preserve a confirmed execution even if stop/cancel happened while awaiting it.
      context.saveCheckpoint(CHECKPOINT,saved);
    }
    check(context,generation,input.digest);
    if(saved.configurationRef && configurationRef()!==saved.configurationRef) fail('REVISION_CONFLICT','Skill configuration changed');
    context.reportProgress({stepId:'skill-summarize-reference',label:'Summarize confirmed reference',completedUnits:1,totalUnits:2});
    const read=saved.read!;
    const excerpt=referenceSummary(read.text).content;
    const outcome:SkillOutcome={state:'confirmed',resultSummary:`${excerpt || '(empty reference)'} [source=${read.path}; sha256=${read.contentDigest}]`,sources:[{path:read.path,contentDigest:read.contentDigest}],evidenceRefs:[...saved.evidenceRefs]};
    check(context,generation,input.digest);
    saved.phase='complete';saved.outcome=outcome;context.saveCheckpoint(CHECKPOINT,saved);
    context.reportProgress({stepId:'skill-summarize-reference',label:'Reference summary ready',completedUnits:2,totalUnits:2});
    return structuredClone(outcome);
  }
  return {
    manifest,health,
    async invoke(input:ReferenceSummaryInput,context:AgentWorkerContext) {
      if(activeTasks.has(context.taskId)) fail('REVISION_CONFLICT','Skill task is already active');
      activeTasks.add(context.taskId);
      try {return await run(input,context);} finally {activeTasks.delete(context.taskId);}
    },
    setEnabled(value:boolean){if(disposed)fail('UNSUPPORTED_CAPABILITY','Skill is disposed');if(enabled!==value){epoch++;controller.abort();controller=new AbortController();enabled=value;}return health();},
    dispose(){if(disposed)return;disposed=true;enabled=false;epoch++;controller.abort();},
  };
}
