import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import {parseCoordinationAvailableTools} from '@personal-agent/coordination';
import type {CoordinationAvailableTool} from '@personal-agent/coordination';
import {getOwnedWorkflowTemplate,OWNED_WORKFLOW_VERSION} from './owned-workflow-templates.js';
import type {OwnedWorkflowNode,OwnedWorkflowTemplate} from './owned-workflow-templates.js';
import {parseWorkflowSelectionResult,workflowShadowSelectedPlan,workflowShadowSelectionDigest} from './workflow-shadow-policy.js';
import type {WorkflowSelectionResult,WorkflowShadowSelectedPlan,WorkflowShadowEvaluationReceipt} from './workflow-shadow-policy.js';
import {parseCodingRepairSnapshot,parseCodingRepairPublishReadback} from '@personal-agent/contracts/coding-repair';
import {codingRepairConfiguration,createCodingRepairFrontier,compactCodingSnapshot,acceptCodingChecks,parseCodingPatchCandidate,
  analyzeCodingPatches,codingPatchCost,codingPatchRepeated,codingSnapshotFingerprint,codingFailureFingerprint,codingPatchFingerprint,requiredCodingVerification,codingRepairDigestText} from './coding-repair.js';
import type {CodingRepairFrontier} from './coding-repair.js';

export type OwnedWorkflowMode = 'main' | 'decision_shadow' | 'trace_replay' | 'isolated';
export interface WorkflowSelector {
  select(request: {context:string; candidates:readonly {id:string;description:string;metadata?:WorkflowSelectionResult['metadata']}[];
    deadline:string;signal:AbortSignal;requestId:string}):Promise<string|WorkflowSelectionResult>;
}
export interface WorkflowCandidate {
  id:string;description:string;value:unknown;
  metadata?:WorkflowSelectionResult['metadata'];
  abstain?:true;
  /** Conditional nodes are activated explicitly; missing condition evidence remains unresolved. */
  branches?:readonly {nodeId:string;state:'selected'|'skipped'}[];
}
export interface WorkflowNodeContext {
  template:OwnedWorkflowTemplate;node:OwnedWorkflowNode;input:unknown;
  predecessorOutputs:Readonly<Record<string,unknown>>;availableTools:readonly CoordinationAvailableTool[];
  predecessorStates:Readonly<Record<string,string>>;
  deadline:string;signal:AbortSignal;requestId:string;mode:OwnedWorkflowMode;namespace:string;
  /** Sealed F15 round plus SHA-bound current sources, never a tool grant. */
  codingRepair?:CodingRepairFrontier;
}
export interface WorkflowHostPort {
  /** Discovery is trusted startup composition, never supplied in query by an end user. */
  capabilities:readonly string[];
  /** This port only reads/checks. Write nodes return a bound request to local Runtime. */
  read(context:WorkflowNodeContext):Promise<{state:'completed'|'unavailable'|'failed'|'unknown';value?:unknown}>;
  condition?(context:WorkflowNodeContext):Promise<'selected'|'skipped'|'unknown'>;
}
export type WorkflowProposal =
  | {kind:'tool_proposal';nodeId:string;proposalId:string;operationId:string;inputDigest:string;isolation?:{namespace:string;snapshotDigest:string};
      originControlRevision:number;toolSchemaDigest:string;
      toolName:string;toolVersion:string;arguments:Record<string,unknown>;resourceKeys:readonly string[];effect:'read'|'write'}
  | {kind:'host_requirement';nodeId:string;proposalId:string;operationId:string;inputDigest:string;isolation?:{namespace:string;snapshotDigest:string};
      originControlRevision:number;
      capabilities:readonly string[];arguments:Record<string,unknown>;resourceKeys:readonly string[];effect:'read'|'write'};
export interface WorkflowReceipt {
  nodeId:string;proposalId:string;operationId:string;inputDigest:string;
  state:'confirmed'|'failed'|'unknown'|'not_started'|'stopping';result:unknown;evidenceRefs:readonly string[];
  /** Opaque host readback/signature, not a model or client's trust label. */
  proof:unknown;
  /** Separate host policy readback; the raw ToolGateway result is retained unchanged. */
  shadowEvaluation?:WorkflowShadowEvaluationReceipt;
}
export interface WorkflowReceiptVerifier {
  verify(receipt:WorkflowReceipt,expected:WorkflowProposal,request:OwnedWorkflowAdvanceRequest):Promise<boolean>;
  verifyMigration?(migration:WorkflowRevisionMigration,previous:WorkflowRevisionIdentity,next:WorkflowRevisionIdentity):Promise<boolean>;
  verifyControl?(command:WorkflowControlCommand,request:OwnedWorkflowAdvanceRequest):Promise<boolean>;
  verifyShadowEvaluation?(evaluation:WorkflowShadowEvaluationReceipt,request:OwnedWorkflowAdvanceRequest):Promise<boolean>;
}
export type WorkflowControlAction='pause'|'resume'|'continue'|'notify_controller'|'request_controller'|'request_user';
export interface WorkflowControlCommand {commandId:string;action:WorkflowControlAction;reason?:string;proof:unknown}
export interface WorkflowRevisionIdentity {taskId:string;sessionId:string;workflowId:string;templateDigest:string;
  controlRevision:number;inputDigest:string;catalogDigest:string}
export interface WorkflowRevisionMigration {invalidatedNodeIds:readonly string[];proof:unknown}
export interface OwnedWorkflowAdvanceRequest {
  workflowId:string;input:unknown;taskId:string;controlRevision:number;sessionId:string;requestId:string;
  deadline:string;signal:AbortSignal;availableTools:readonly CoordinationAvailableTool[];
  /** Trusted TaskRuntime original deadline; distinct from each transport invocation deadline. */
  taskDeadline?:string;
  checkpoint?:string;receipts?:readonly WorkflowReceipt[];mode?:OwnedWorkflowMode;
  migration?:WorkflowRevisionMigration;
  hostControl?:WorkflowControlCommand;
  /** Original full tool results are retained by TaskRuntime; restoration must match the sealed digest. */
  resolvedValues?:Readonly<Record<string,unknown>>;
  /** Trusted transport composition only; never accepted from the workflow JSON envelope. */
  resultFits?:(result:OwnedWorkflowAdvanceResult)=>boolean;
  snapshot?:{namespace:string;asOf:string;sourceVersions:Readonly<Record<string,string>>};
}
type NodeState = 'pending'|'completed'|'skipped'|'waiting_receipt'|'unavailable'|'failed'|'unknown'|'cancelled'|'stopping';
interface StepState {state:NodeState;value?:unknown;proposal?:WorkflowProposal;evidenceRefs?:readonly string[];reason?:string;
  /** Engine-owned marker: a user value which resembles a reference remains ordinary input data. */
  inputReference?:true;
  retrySafe?:true;previousAttempts?:readonly {proposal:WorkflowProposal;state:NodeState;value?:unknown;evidenceRefs:readonly string[]}[];
  shadow?:{plan:WorkflowShadowSelectedPlan;selectionDigest:string;evaluation?:WorkflowShadowEvaluationReceipt};
  /** Sealed original alternatives; a decision receipt is not a business-tool receipt. */
  pendingSelection?:readonly WorkflowCandidate[];selectedCandidate?:WorkflowCandidate;pendingGuard?:true}
interface CheckpointState {
  workflowVersion:typeof OWNED_WORKFLOW_VERSION;workflowId:string;templateVersion:string;templateDigest:string;
  taskId:string;sessionId:string;controlRevision:number;inputDigest:string;catalogDigest:string;mode:OwnedWorkflowMode;
  snapshotDigest:string;namespace:string;nodes:Record<string,StepState>;selections:Record<string,'selected'|'skipped'>;
  executionProfile:string;
  originalDeadline:string;
  codingRepair?:CodingRepairFrontier;
  hostControl?:{status:'running'|'paused'|'awaiting_controller'|'awaiting_user';commands:Record<string,string>;
    events:{commandId:string;action:WorkflowControlAction;reason?:string}[]};
}
export interface OwnedWorkflowAdvanceResult {
  workflowVersion:typeof OWNED_WORKFLOW_VERSION;workflowId:string;templateVersion:string;templateDigest:string;
  /** Application graph state only. Local TaskRuntime owns wire task terminal states. */
  state:'progress'|'awaiting_host'|'unavailable'|'failed'|'unknown'|'cancelled'|'settled'|'paused'|'awaiting_controller'|'awaiting_user';
  verification:'unverified';checkpoint:string;nodes:Record<string,StepState>;proposals:WorkflowProposal[];
  unavailable:{nodeId:string;capabilities:string[];reason:string}[];
  feedback:{source:string;target:string;state:'requires_host_revision'}[];
  codingRepair?:{version:1;round:number;snapshotId:string;history:CodingRepairFrontier['history'];verification:CodingRepairFrontier['verification'];stoppedReason?:CodingRepairFrontier['stoppedReason']};
  hostControl?:CheckpointState['hostControl'];
  /** Data for the existing host; never a new tool grant or proof an isolated branch ran. */
  shadows?:{nodeId:string;plan:WorkflowShadowSelectedPlan;evaluation?:WorkflowShadowEvaluationReceipt}[];
  delivery?:{waitingForShadow:boolean;mayDeliverMain:boolean;reason:string};
}
const plain = (value:unknown):value is Record<string,unknown> => !!value&&typeof value==='object'&&!Array.isArray(value);
const digest = (value:unknown):string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid = (message='Invalid owned workflow request'):never => {throw new ProtocolError('INVALID_ARGUMENT',message);};
const safeId = (value:unknown):value is string => typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const control = (request:Pick<OwnedWorkflowAdvanceRequest,'signal'|'deadline'>):void => {
  if(!(request.signal instanceof AbortSignal)||!Number.isFinite(Date.parse(request.deadline))) invalid();
  if(request.signal.aborted) throw new ProtocolError('CANCELLED','Workflow invocation cancelled');
  if(Date.parse(request.deadline)<=Date.now()) throw new ProtocolError('TIMEOUT','Workflow deadline expired');
};
const copy = <T>(value:T):T => {
  try {const encoded=JSON.stringify(value);if(!encoded||Buffer.byteLength(encoded)>1_100_000) invalid();return JSON.parse(encoded) as T;}
  catch(error) {if(error instanceof ProtocolError) throw error;return invalid();}
};
const referenced=(value:unknown):value is {kind:'trusted_tool_result_reference';valueDigest:string;bytes:number;evidenceRefs:readonly string[]} =>
  plain(value)&&value.kind==='trusted_tool_result_reference'&&typeof value.valueDigest==='string';
const inputReferenced=(value:unknown):value is {kind:'workflow_input_reference';valueDigest:string} =>
  plain(value)&&value.kind==='workflow_input_reference'&&typeof value.valueDigest==='string';
const NODE_OUTPUT_BYTES=(template:OwnedWorkflowTemplate):number=>Math.floor((1_100_000-65_536)/(4*template.nodes.length));
function decisionInput(context:WorkflowNodeContext):Record<string,unknown> {
  if(!['F15_N01','F20_N01'].includes(context.node.id)||!plain(context.input)) return {input:context.input};
  // The current question is whether to request a file read, not whether a future patch is correct.
  // Preserve the complete source in the original input/checkpoint binding; expose explicit source references here.
  const input=copy(context.input),references:Record<string,string>={};
  for(const field of ['sourceSnapshot','patchSchema','initialFailure']) if(Object.hasOwn(input,field)) {
    references[field]=digest(input[field]);delete input[field];
  }
  return {input,...(Object.keys(references).length?{decisionInputProjection:{stage:'source_read_request',
    fullInputDigest:digest(context.input),deferredSourceFields:references,
    meaning:'Referenced original data retained for downstream patch generation/checks; not needed to propose this source read'}}:{})};
}

/** One current-node boundary shared by candidate preparation and typed selection. */
export function workflowCandidateMetadata(node:OwnedWorkflowNode,tools:readonly CoordinationAvailableTool[]) {
  const proposed=node.kind==='tool'||node.kind==='host';
  return {currentCandidateBoundary:{kind:node.kind==='tool'?'unexecuted_tool_request'
      :node.kind==='host'?'unexecuted_host_arguments':'node_output_data',
    nodeOutputStage:proposed?'after_actual_host_receipt':'candidate_data',
    selectionBasis:node.kind==='tool'?'published_schema_and_task_arguments'
      :node.kind==='host'?'bound_host_arguments_and_task_scope':'actual_sources_and_current_output_requirements',
    resultEvidenceStage:proposed?'after_actual_execution':'required_for_generated_claims'},
    publishedTools:tools.filter(tool=>node.capabilities.some(cap=>cap.kind==='tool'&&cap.name===tool.name)
      ||node.kind==='host'&&tool.name===workflowHostToolName(node.id)).map(tool=>copy(tool))};
}
export const workflowHostToolName=(nodeId:string):string=>'workflow.host.'+nodeId.toLowerCase();
export const workflowGuardToolName=(nodeId:string):string=>'workflow.guard.'+nodeId.toLowerCase();

/** Shared executable join rule. Unknown/failed evidence never counts as a completed selected branch. */
export function workflowJoinReady(node:Pick<OwnedWorkflowNode,'joinMode'|'dependencies'>,states:Readonly<Record<string,string>>):boolean {
  const dependencies=node.dependencies.map(dep=>states[dep.nodeId]);
  return node.joinMode==='any'?dependencies.some(state=>state==='completed')
    :dependencies.every(state=>state==='completed'||state==='skipped');
}

/** Stateless cloud planning frontier. No DB, credentials, authorization issuer or real tool executor. */
export class OwnedWorkflowEngine {
  private readonly secret:Buffer;
  constructor(private readonly options:{selector?:WorkflowSelector;decisionTool?:{name:string;version:string};externalHost?:boolean;
    allowIsolatedProposals?:boolean;prepareCandidates:(context:WorkflowNodeContext)=>Promise<readonly WorkflowCandidate[]>;
    checkpointSecret:string;host?:WorkflowHostPort;receiptVerifier?:WorkflowReceiptVerifier}) {
    if(typeof options.checkpointSecret!=='string'||Buffer.byteLength(options.checkpointSecret)<32
      ||(Boolean(options.selector)===Boolean(options.decisionTool))
      ||(options.selector!==undefined&&typeof options.selector.select!=='function')
      ||(options.decisionTool!==undefined&&(!options.decisionTool.name||!options.decisionTool.version))
      ||typeof options.prepareCandidates!=='function') invalid('Invalid workflow startup configuration');
    this.secret=Buffer.from(options.checkpointSecret,'utf8');
  }
  private seal(state:CheckpointState,compressed=false):string {
    const json=Buffer.from(JSON.stringify(state));
    // Preserve the decoded capacity of the existing 1,100,000-byte plain envelope.
    if(compressed&&json.length>Math.floor((1_100_000-44)*3/4))throw new ProtocolError('EXTERNAL_FAILURE','Workflow checkpoint exceeds the existing decoded capacity');
    const encoded=compressed?'deflate:'+deflateRawSync(json).toString('base64url'):json.toString('base64url');
    return encoded+'.'+createHmac('sha256',this.secret).update(encoded).digest('base64url');
  }
  private open(value:string):CheckpointState {
    if(typeof value!=='string'||Buffer.byteLength(value)>1_100_000) invalid('Invalid workflow checkpoint');
    const parts=value.split('.');if(parts.length!==2) invalid('Invalid workflow checkpoint');
    const [encoded,signature]=parts as [string,string];
    const expected=createHmac('sha256',this.secret).update(encoded).digest();
    const actual=Buffer.from(signature,'base64url');
    if(expected.length!==actual.length||!timingSafeEqual(expected,actual)) invalid('Workflow checkpoint integrity failed');
    try {
      const bytes=encoded.startsWith('deflate:')
        ?inflateRawSync(Buffer.from(encoded.slice('deflate:'.length),'base64url'),{maxOutputLength:Math.floor((1_100_000-44)*3/4)})
        :Buffer.from(encoded,'base64url');
      return JSON.parse(bytes.toString('utf8')) as CheckpointState;
    }
    catch {return invalid('Invalid workflow checkpoint');}
  }
  private async initialize(request:OwnedWorkflowAdvanceRequest,template:OwnedWorkflowTemplate,tools:readonly CoordinationAvailableTool[]):Promise<CheckpointState> {
    if(!safeId(request.taskId)||!safeId(request.sessionId)||!safeId(request.requestId)
      ||!Number.isSafeInteger(request.controlRevision)||request.controlRevision<0) invalid();
    const mode=request.mode??'main';
    if(!['main','decision_shadow','trace_replay','isolated'].includes(mode)) invalid();
    const coding=codingRepairConfiguration(request.input);
    if(coding&&(template.workflowId!=='F15'||coding.session.taskId!==request.taskId||coding.session.sessionId!==request.sessionId
      ||(mode==='isolated')!==(coding.session.mode==='isolated')))invalid('Coding repair must bind its original F15 task/session/isolation');
    const snapshot=request.snapshot;
    if(mode!=='main'&&(!snapshot||!safeId(snapshot.namespace)||snapshot.namespace==='main'
      ||!Number.isFinite(Date.parse(snapshot.asOf))||!plain(snapshot.sourceVersions))) invalid('Shadow snapshot and separate namespace required');
    if(snapshot&&Object.values(snapshot.sourceVersions).some(value=>typeof value!=='string'||!value)) invalid();
    const identity={workflowVersion:OWNED_WORKFLOW_VERSION,workflowId:template.workflowId,templateVersion:template.version,
      templateDigest:template.templateDigest,taskId:request.taskId,sessionId:request.sessionId,controlRevision:request.controlRevision,
      inputDigest:digest(request.input),catalogDigest:digest(tools),mode,snapshotDigest:digest(snapshot??null),namespace:snapshot?.namespace??'main',
      originalDeadline:request.taskDeadline??request.deadline,
      executionProfile:digest({version:'local-decision-serial-host-control-v2',selection:this.options.decisionTool??'in-process-selector',externalHost:this.options.externalHost??false,
        allowIsolatedProposals:this.options.allowIsolatedProposals??false})};
    if(request.checkpoint!==undefined) {
      const state=this.open(request.checkpoint);
      if(!Number.isFinite(Date.parse(state.originalDeadline))||request.taskDeadline!==undefined
        &&Date.parse(request.taskDeadline)!==Date.parse(state.originalDeadline)) invalid('Workflow cannot change its original task deadline');
      if(!plain(state.nodes)||!plain(state.selections)
        ||Object.keys(state.nodes).length!==template.nodes.length
        ||template.nodes.some(node=>!Object.hasOwn(state.nodes,node.id))) invalid('Workflow checkpoint input, catalog or revision is stale');
      const immutable=['workflowVersion','workflowId','templateVersion','templateDigest','taskId','sessionId','mode','snapshotDigest','namespace','executionProfile'] as const;
      if(immutable.some(key=>state[key]!==identity[key])) invalid('Workflow checkpoint identity is stale');
      if(Boolean(coding)!==Boolean(state.codingRepair)||coding&&digest(state.codingRepair!.configuration)!==digest({...coding,initialSnapshot:compactCodingSnapshot(coding.initialSnapshot)}))
        invalid('Coding repair configuration changed');
      if(state.controlRevision!==identity.controlRevision||state.inputDigest!==identity.inputDigest||state.catalogDigest!==identity.catalogDigest) {
        const migration=request.migration;
        if(!migration||request.controlRevision<=state.controlRevision||!this.options.receiptVerifier?.verifyMigration
          ||!Array.isArray(migration.invalidatedNodeIds)||new Set(migration.invalidatedNodeIds).size!==migration.invalidatedNodeIds.length
          ||migration.invalidatedNodeIds.some(id=>!template.nodes.some(node=>node.id===id))) invalid('A changed revision requires a trusted host migration');
        for(const step of Object.values(state.nodes)) {
          const proposal=step.proposal;
          if(proposal?.kind==='tool_proposal'&&!tools.some(tool=>tool.name===proposal.toolName&&tool.version===proposal.toolVersion
            &&digest(tool.inputSchema)===proposal.toolSchemaDigest)) {
            invalid('New catalog cannot remove an original pending or confirmed operation');
          }
        }
        const revisionIdentity=(value:WorkflowRevisionIdentity):WorkflowRevisionIdentity=>({taskId:value.taskId,sessionId:value.sessionId,
          workflowId:value.workflowId,templateDigest:value.templateDigest,controlRevision:value.controlRevision,
          inputDigest:value.inputDigest,catalogDigest:value.catalogDigest});
        if(!await this.options.receiptVerifier!.verifyMigration!(copy(migration!),revisionIdentity(state),revisionIdentity(identity))) invalid('Revision migration proof is not verified');
        control(request);
        const affected=new Set(migration!.invalidatedNodeIds);
        if(state.inputDigest!==identity.inputDigest) template.nodes.filter(node=>node.kind==='input').forEach(node=>affected.add(node.id));
        for(let changed=true;changed;) {
          changed=false;
          for(const node of template.nodes) if(!affected.has(node.id)&&node.dependencies.some(dep=>affected.has(dep.nodeId))) {
            affected.add(node.id);changed=true;
          }
        }
        for(const node of template.nodes) {
          const step=state.nodes[node.id]!;
          if(affected.has(node.id)&&step.state==='failed'&&step.retrySafe&&step.proposal?.effect==='read') {
            // Repair/retry policy is awaiting the user's algorithm. An attestation alone is not a retry decision.
            step.reason='Repair algorithm unavailable; original failed operation and evidence retained';
            continue;
          }
          // A cloud proposal does not prove local submission. After revision change it is readback-only,
          // including an unrelated branch: do not re-emit stale parameters as a new executable request.
          if(step.proposal&&step.state==='waiting_receipt') {
            step.state='unknown';step.reason='Original revision changed; host must reconcile whether the original operation was submitted';
          }
          // Pure calculations and read-only host observations must see the new input/source version.
          // A tool's semantic review before any proposal can be reconsidered only by this trusted affected migration.
          // Original actual/proposed operations, including unknown and failed effects, stay bound to their original IDs.
          if(affected.has(node.id)&&!step.proposal&&(['input','assemble','decision','executor'].includes(node.kind)
            ||node.kind==='host'&&node.effect!=='write'
            ||node.kind==='tool'&&step.state==='unknown'&&step.reason==='Unique selector requested recheck; no operation proposal emitted')) {
            state.nodes[node.id]={state:'pending'};
          }
        }
        for(const id of Object.keys(state.selections)) if(affected.has(id)&&state.nodes[id]!.state==='pending') delete state.selections[id];
        state.controlRevision=identity.controlRevision;state.inputDigest=identity.inputDigest;state.catalogDigest=identity.catalogDigest;
      } else if(request.migration) invalid('Migration does not change the original revision');
      return state;
    }
    if(request.receipts?.length) invalid('A receipt requires its original checkpoint');
    return {...identity,nodes:Object.fromEntries(template.nodes.map(node=>[node.id,{state:'pending' as const}])),selections:{},
      ...(coding?{codingRepair:createCodingRepairFrontier(coding)}:{})};
  }
  private context(request:OwnedWorkflowAdvanceRequest,template:OwnedWorkflowTemplate,node:OwnedWorkflowNode,
    state:CheckpointState,tools:readonly CoordinationAvailableTool[]):WorkflowNodeContext {
    let coding=state.codingRepair?copy(state.codingRepair):undefined;
    if(coding){
      // Delivery consumes the post-check snapshot. N01 intentionally describes pre-patch sources.
      const original=node.id==='F15_N06'?undefined:state.nodes.F15_N01?.value;
      let current=original;
      if(referenced(original)){
        current=request.resolvedValues?.F15_N01;
        if(current!==undefined&&digest(current)!==original.valueDigest)invalid('Current coding source reference changed');
      }
      if(current!==undefined){const snapshot=parseCodingRepairSnapshot(current);
        if(codingSnapshotFingerprint(snapshot)!==codingSnapshotFingerprint(coding.snapshot))invalid('Coding source snapshot changed');coding.snapshot=snapshot;}
      for(const [path,reference] of Object.entries(coding.sourceReferences)){
        const restored=request.resolvedValues?.['coding-source:'+path]??request.receipts?.find(receipt=>receipt.nodeId==='F15_N03'
          &&plain(receipt.result)&&receipt.result.path===path)?.result;
        if(!plain(restored)||digest(restored)!==reference.valueDigest||restored.sha256!==reference.sha256||typeof restored.content!=='string'
          ||codingRepairDigestText(restored.content)!==reference.sha256)throw new ProtocolError('INVALID_ARGUMENT','Original coding source result must be restored with its exact digest');
        const file=coding.snapshot.files.find(f=>f.path===path);
        if(!file||file.sha256!==reference.sha256)throw new ProtocolError('INVALID_ARGUMENT','Coding source revision changed');
        file.content=restored.content;
      }
      const unread=coding.scopePaths.find(path=>coding.snapshot.files.some(f=>f.path===path&&f.sha256!==null)&&!coding!.sourceReferences[path]);
      if(unread)coding.readPath=unread;else delete coding.readPath;
    }
    const sourceTool=coding&&node.id==='F15_N01'?'workspace.coding_snapshot':coding&&node.id==='F15_N03'&&coding.readPath?'coding.repair.read':undefined;
    const effectiveNode=sourceTool?{...node,kind:'tool' as const,effect:'read' as const,capabilities:[{kind:'tool' as const,name:sourceTool,boundary:'local' as const}]}:node;
    return {template:copy(template),node:copy(effectiveNode),input:copy(request.input),...(coding?{codingRepair:coding}:{}),
      predecessorOutputs:copy(Object.fromEntries(node.dependencies.map(dep=>{
        const value=state.nodes[dep.nodeId]?.value;
        if(state.nodes[dep.nodeId]?.inputReference) {
          if(!inputReferenced(value)||template.nodes.find(item=>item.id===dep.nodeId)?.kind!=='input'||value.valueDigest!==state.inputDigest
            ||digest(request.input)!==value.valueDigest) invalid('Workflow input reference does not match its sealed original input');
          return [dep.nodeId,request.input];
        }
        if(referenced(value)&&Object.hasOwn(request.resolvedValues??{},dep.nodeId)) {
          const restored=request.resolvedValues![dep.nodeId];
          if(digest(restored)!==value.valueDigest) invalid('Restored result does not match the original signed checkpoint');
          return [dep.nodeId,restored];
        }
        return [dep.nodeId,value??null];
      }))),
      predecessorStates:Object.fromEntries(node.dependencies.map(dep=>[dep.nodeId,state.nodes[dep.nodeId]!.state])),
      availableTools:copy(tools),deadline:request.deadline,signal:request.signal,requestId:request.requestId,
      mode:state.mode,namespace:state.namespace};
  }
  private async admitReceipts(request:OwnedWorkflowAdvanceRequest,state:CheckpointState,template:OwnedWorkflowTemplate):Promise<void> {
    const seen=new Set<string>();
    for(const value of request.receipts??[]) {
      control(request);
      const receipt=copy(value),step=state.nodes[receipt.nodeId];
      if(step?.shadow&&receipt.shadowEvaluation&&receipt.operationId===step.shadow.plan.decision.decisionRef
        &&(!step.pendingSelection||step.proposal?.operationId!==receipt.operationId)) {
        const key='shadow:'+receipt.operationId;
        if(seen.has(key)||receipt.state!=='confirmed'||workflowShadowSelectionDigest(parseWorkflowSelectionResult(receipt.result))!==step.shadow.selectionDigest
          ||!this.options.receiptVerifier?.verifyShadowEvaluation
          ||!await this.options.receiptVerifier.verifyShadowEvaluation(receipt.shadowEvaluation,{...request,taskDeadline:state.originalDeadline}))
          invalid('Shadow refresh lacks the original signed selection and current policy readback');
        seen.add(key);control(request);
        this.validateShadowEvaluation(receipt.shadowEvaluation,step.shadow.plan,step.shadow.selectionDigest,receipt.nodeId,state);
        step.shadow.plan=copy(receipt.shadowEvaluation.plan);step.shadow.evaluation=copy(receipt.shadowEvaluation);continue;
      }
      if(!step||!step.proposal) throw new ProtocolError('INVALID_ARGUMENT','Receipt has no original workflow operation');
      const expected=step.proposal;
      if(seen.has(receipt.nodeId)||!['waiting_receipt','unknown','stopping'].includes(step.state)
        ||receipt.proposalId!==expected.proposalId||receipt.operationId!==expected.operationId
        ||receipt.inputDigest!==expected.inputDigest||!Array.isArray(receipt.evidenceRefs)
        ||receipt.evidenceRefs.some(ref=>!safeId(ref))||!['confirmed','failed','unknown','not_started','stopping'].includes(receipt.state)) invalid('Receipt does not bind original workflow operation');
      seen.add(receipt.nodeId);
      if(!this.options.receiptVerifier) {step.reason='Host receipt verifier unavailable; original operation is retained';continue;}
      if(!await this.options.receiptVerifier.verify(receipt,copy(expected),request)) invalid('Host operation receipt is not verified');
      control(request);
      if(receipt.state==='confirmed'&&!receipt.evidenceRefs.length) invalid('Confirmed operation requires trusted execution evidence');
      if(step.pendingGuard&&receipt.state==='confirmed') {
        const result=receipt.result;
        if(!plain(result)||!['selected','skipped','unknown'].includes(String(result.state))
          ||Object.keys(result).some(key=>key!=='state')) return invalid('Invalid trusted condition result');
        if(expected.originControlRevision!==state.controlRevision) {
          step.state='unknown';step.reason='Original guard revision changed; stale condition cannot advance execution';continue;
        }
        delete step.pendingGuard;delete step.proposal;
        step.evidenceRefs=[...(step.evidenceRefs??[]),...receipt.evidenceRefs];
        if(result.state==='unknown') {step.state='unknown';step.reason='Condition adapter has no verified observation';}
        else {state.selections[receipt.nodeId]=result.state as 'selected'|'skipped';step.state='pending';delete step.reason;}
        continue;
      }
      if(step.pendingSelection&&receipt.state==='confirmed') {
        // The signer proves what the local tool returned, not that arbitrary candidate IDs are valid.
        const result=parseWorkflowSelectionResult(receipt.result,step.pendingSelection.map(candidate=>candidate.id));
        const selectedId=result.selectedId;
        const selected=step.pendingSelection.find(candidate=>candidate.id===selectedId);
        if(!selected) invalid('Local decision does not match the sealed original candidates');
        if(expected.originControlRevision!==state.controlRevision) {
          step.state='unknown';step.reason='Original decision revision changed; stale selection cannot advance business execution';continue;
        }
        const plan=workflowShadowSelectedPlan(state.taskId,expected.operationId,result),evaluation=receipt.shadowEvaluation;
        if(evaluation) {
          if(!plan)invalid('Shadow evaluation has no original selected plan');
          this.validateShadowEvaluation(evaluation,plan!,workflowShadowSelectionDigest(result),receipt.nodeId,state);
        }
        if(plan)step.shadow={plan:evaluation?copy(evaluation.plan):{...plan,mode:'ordinary'},selectionDigest:workflowShadowSelectionDigest(result),...(evaluation?{evaluation:copy(evaluation)}:{})};
        step.state='pending';step.selectedCandidate=copy(selected!);
        step.evidenceRefs=[...(step.evidenceRefs??[]),...receipt.evidenceRefs];
        delete step.proposal;delete step.pendingSelection;delete step.reason;
        continue;
      }
      step.state=receipt.state==='confirmed'?'completed':receipt.state==='not_started'?'cancelled':receipt.state;
      const bytes=Buffer.byteLength(JSON.stringify(receipt.result));
      step.value=receipt.state==='confirmed'&&bytes>NODE_OUTPUT_BYTES(template)
        ? {kind:'trusted_tool_result_reference',valueDigest:digest(receipt.result),bytes,
            evidenceRefs:[...receipt.evidenceRefs],operationId:expected.operationId,inputDigest:expected.inputDigest}
        :copy(receipt.result);
      step.evidenceRefs=[...new Set([...(step.evidenceRefs??[]),...receipt.evidenceRefs])];delete step.reason;
      if(receipt.state==='failed'&&expected.effect==='read'&&plain(receipt.result)&&plain(receipt.result.failure)
        &&receipt.result.failure.retrySafe===true) step.retrySafe=true;
      if(state.codingRepair&&receipt.state==='confirmed')this.admitCodingReceipt(state,receipt);
    }
  }
  private admitCodingReceipt(state:CheckpointState,receipt:WorkflowReceipt):void {
    const coding=state.codingRepair!,step=state.nodes[receipt.nodeId]!;
    try {
      if(receipt.nodeId==='F15_N01'){
        coding.snapshot=compactCodingSnapshot(parseCodingRepairSnapshot(receipt.result));return;
      }
      if(receipt.nodeId==='F15_N03'&&step.proposal?.kind==='tool_proposal'&&step.proposal.toolName==='coding.repair.read'){
        const result=receipt.result,path=step.proposal.arguments.path;
        if(typeof path!=='string'||!coding.scopePaths.includes(path)||!plain(result)||result.path!==path||typeof result.content!=='string'
          ||typeof result.sha256!=='string'||codingRepairDigestText(result.content)!==result.sha256
          ||coding.snapshot.files.find(file=>file.path===path)?.sha256!==result.sha256)throw new ProtocolError('REVISION_CONFLICT','Coding source read does not match its current sealed scope');
        coding.sourceReferences[path]={sha256:result.sha256,valueDigest:digest(result),operationId:receipt.operationId};
        step.state='pending';delete step.proposal;delete step.value;delete step.selectedCandidate;return;
      }
      if(receipt.nodeId==='F15_N04'){
        if(!plain(receipt.result)||receipt.result.sessionId!==coding.configuration.session.sessionId||receipt.result.approved!==true)
          throw new ProtocolError('REVISION_CONFLICT','Coding preview did not approve this original session');return;
      }
      if(receipt.nodeId==='F15_N05'){
        const sourceFingerprint=codingSnapshotFingerprint(coding.snapshot),patchDigest=codingPatchFingerprint(coding.pendingPatch?.patches??[]);
        const disposition=acceptCodingChecks(coding,receipt.result,receipt.evidenceRefs);
        if(disposition==='passed'){coding.sourceReferences={};coding.scopePaths=[];return;}
        if(disposition==='unknown'){step.state='unknown';step.reason='Required verification has no current confirmed result';coding.stoppedReason='verification_unknown';return;}
        const record={round:coding.round,sourceFingerprint,failureFingerprint:codingFailureFingerprint(coding),patchDigest,
          snapshotId:coding.snapshot.snapshotId,operationIds:[...Object.values(coding.sourceReferences).map(source=>source.operationId),...Object.values(state.nodes).flatMap(n=>n.proposal?[n.proposal.operationId]:[])],
          evidenceRefs:[...new Set(Object.values(state.nodes).flatMap(n=>n.evidenceRefs??[]))]};
        if(coding.history.some(prior=>prior.sourceFingerprint===record.sourceFingerprint&&prior.failureFingerprint===record.failureFingerprint&&prior.patchDigest===record.patchDigest)){
          step.state='failed';step.reason='NO_PROGRESS: identical source, failure and patch already verified';coding.stoppedReason='no_progress';return;
        }
        coding.history.push(record);coding.round++;delete coding.pendingPatch;coding.scopePaths=[];coding.sourceReferences={};
        // Known verification failure creates a new round, never a retry of an unknown effect.
        // Full original operations/results remain in the trusted TaskRuntime and old signed checkpoint.
        for(const id of Object.keys(state.nodes))state.nodes[id]={state:'pending'};
        state.selections={};return;
      }
      if(receipt.nodeId==='F15_N06'){
        const result=parseCodingRepairPublishReadback(receipt.result);
        if(result.sessionId!==coding.configuration.session.sessionId||!requiredCodingVerification(coding))throw new ProtocolError('REVISION_CONFLICT','Coding publish lost its current verification');
        if(result.state!=='published'){step.state=result.state==='unknown'?'unknown':result.state==='not_started'?'cancelled':'failed';step.reason='Original coding publish requires CAS readback: '+result.state;return;}
        const initial=new Map(coding.configuration.initialSnapshot.files.map(f=>[f.path,f.sha256]));
        const changed=coding.snapshot.files.filter(f=>f.sha256!==(initial.get(f.path)??null));
        if(result.files.length!==changed.length||result.files.some(f=>!changed.some(current=>current.path===f.path&&current.sha256===f.afterSha256
          &&(initial.get(f.path)??null)===f.beforeSha256)))throw new ProtocolError('REVISION_CONFLICT','Coding publish readback does not match verified exact files');
      }
    }catch{step.state='unknown';step.reason='Confirmed host effect retained; coding receipt needs original reconciliation';coding.stoppedReason='verification_unknown';}
  }
  private validateShadowEvaluation(evaluation:WorkflowShadowEvaluationReceipt,plan:WorkflowShadowSelectedPlan,
    selectionDigest:string,nodeId:string,state:CheckpointState):void {
    if(evaluation.version!==1||evaluation.authority!=='advisory_no_tool_grant'||evaluation.actualExecutionVerified!==false
      ||evaluation.nodeId!==nodeId||evaluation.decisionRef!==plan.decision.decisionRef||evaluation.selectionDigest!==selectionDigest
      ||typeof evaluation.comparisonRequested!=='boolean'
      ||workflowShadowSelectionDigest(evaluation.plan)!==workflowShadowSelectionDigest({...plan,mode:evaluation.comparisonRequested?'compare':'ordinary'})
      ||evaluation.context?.taskId!==state.taskId||evaluation.context.sessionId!==state.sessionId
      ||evaluation.context.controlRevision!==state.controlRevision||evaluation.context.taskDeadline!==state.originalDeadline
      ||!evaluation.policy||!['run','defer','skip','need_teacher'].includes(evaluation.policy.action)
      ||typeof evaluation.policy.mayDeliverMain!=='boolean'||typeof evaluation.policy.reason!=='string'
      ||!evaluation.policy.comparison||!['unknown','comparable'].includes(evaluation.policy.comparison.status))
      invalid('Shadow policy readback changed the original selected plan or task context');
  }
  private async candidates(context:WorkflowNodeContext,state:CheckpointState):Promise<WorkflowCandidate|StepState> {
    const saved=state.nodes[context.node.id]!.selectedCandidate;
    if(saved) return this.selectCandidate(context,state,saved);
    if(this.options.decisionTool&&!context.availableTools.some(tool=>tool.name===this.options.decisionTool!.name&&tool.version===this.options.decisionTool!.version)) {
      return {state:'unavailable',reason:'Local decision tool is not published by the trusted Runtime'};
    }
    const candidates=copy(await this.options.prepareCandidates(context));
    control(context);
    if(!Array.isArray(candidates)||candidates.length<2||candidates.length>16||new Set(candidates.map(item=>item.id)).size!==candidates.length
      ||candidates.some(item=>!safeId(item.id)||typeof item.description!=='string'||!item.description.trim()
        ||!Object.hasOwn(item,'value'))) throw new ProtocolError('EXTERNAL_FAILURE','Invalid executor candidates');
    for(const candidate of candidates)if(candidate.metadata)parseWorkflowSelectionResult({selectedId:candidate.id,metadata:candidate.metadata},candidates.map(item=>item.id));
    const selectionRequest={context:JSON.stringify({workflowId:context.template.workflowId,
      nodeId:context.node.id,label:context.node.label,
      nodeContract:{kind:context.node.kind,designKind:context.node.designKind,inputFields:context.node.inputFields,
        outputFields:context.node.outputFields,effect:context.node.effect,capabilities:context.node.capabilities,
        ...(context.node.evidenceRequirement?{evidenceRequirement:context.node.evidenceRequirement}:{})},
      ...workflowCandidateMetadata(context.node,context.availableTools),
      ...decisionInput(context),predecessorStates:context.predecessorStates,predecessors:context.predecessorOutputs,
      ...(context.codingRepair?{codingRepair:{round:context.codingRepair.round,scopePaths:context.codingRepair.scopePaths,
        currentSnapshot:context.codingRepair.snapshot,diagnostics:context.codingRepair.diagnostics,
        objective:'Prefer the smallest supported file/line repair among feasible candidates; size is not correctness. Actual current verification is mandatory.',
        history:context.codingRepair.history}}:{}),
      candidateValues:candidates.map(({id,value,branches,abstain,metadata})=>({id,value,...(metadata?{metadata}:{}),...(branches?{branches}:{}),...(abstain?{abstain}:{} )})),mode:context.mode}),
      candidates:candidates.map(({id,description,metadata})=>({id,description,...(metadata?{metadata}:{})})),deadline:context.deadline,
      signal:context.signal,requestId:context.requestId};
    if(this.options.decisionTool) {
      const descriptor=context.availableTools.find(tool=>tool.name===this.options.decisionTool!.name&&tool.version===this.options.decisionTool!.version);
      if(!descriptor) return {state:'unavailable',reason:'Local decision tool is not published by the trusted Runtime'};
      const argumentsValue={context:selectionRequest.context,candidates:selectionRequest.candidates,requestId:context.requestId};
      validateToolValue(descriptor.inputSchema,argumentsValue);
      const operationId='wf-decision-'+digest([state.taskId,state.controlRevision,state.workflowId,context.node.id,state.inputDigest,state.mode,state.namespace,candidates,
        ...(state.codingRepair?[state.codingRepair.round,codingSnapshotFingerprint(state.codingRepair.snapshot)]:[])]).slice(0,48);
      return {state:'waiting_receipt',pendingSelection:candidates,proposal:{kind:'tool_proposal',nodeId:context.node.id,
        operationId,proposalId:operationId,inputDigest:digest(argumentsValue),originControlRevision:state.controlRevision,
        toolName:descriptor.name,toolVersion:descriptor.version,toolSchemaDigest:digest(descriptor.inputSchema),
        arguments:argumentsValue,resourceKeys:['local_laya_cpu'],effect:'read',...this.isolation(state)}};
    }
    const result=parseWorkflowSelectionResult(await this.options.selector!.select(selectionRequest),candidates.map(candidate=>candidate.id));
    control(context);
    const candidate=candidates.find(item=>item.id===result.selectedId);
    if(!candidate) throw new ProtocolError('EXTERNAL_FAILURE','Selector returned an unknown candidate');
    const decisionRef='wf-decision-'+digest([state.taskId,state.controlRevision,state.workflowId,context.node.id,state.inputDigest,state.mode,state.namespace,candidates,
      ...(state.codingRepair?[state.codingRepair.round,codingSnapshotFingerprint(state.codingRepair.snapshot)]:[])]).slice(0,48);
    const plan=workflowShadowSelectedPlan(state.taskId,decisionRef,result);
    if(plan)state.nodes[context.node.id]!.shadow={plan:{...plan,mode:'ordinary'},selectionDigest:workflowShadowSelectionDigest(result)};
    return this.selectCandidate(context,state,candidate);
  }
  private selectCandidate(context:WorkflowNodeContext,state:CheckpointState,candidate:WorkflowCandidate):WorkflowCandidate {
    if(candidate.abstain) return candidate;
    for(const branch of candidate.branches??[]) {
      const node=context.template.nodes.find(item=>item.id===branch.nodeId);
      if(!node?.condition||node.hostGuard||!['selected','skipped'].includes(branch.state)
        ||state.nodes[node.id]?.state!=='pending') throw new ProtocolError('EXTERNAL_FAILURE','Candidate changes an invalid or already started branch');
      if(state.selections[node.id]!==undefined&&state.selections[node.id]!==branch.state) {
        throw new ProtocolError('EXTERNAL_FAILURE','Concurrent candidates disagree about branch selection');
      }
      state.selections[node.id]=branch.state;
    }
    return candidate;
  }
  private proposal(context:WorkflowNodeContext,state:CheckpointState,candidate:WorkflowCandidate):WorkflowProposal {
    if(!plain(candidate.value)) throw new ProtocolError('EXTERNAL_FAILURE','Invalid workflow operation candidate');
    const value=candidate.value;
    const operationId='wf-'+digest([state.taskId,state.controlRevision,state.workflowId,context.node.id,state.inputDigest,state.mode,state.namespace,
      ...(state.codingRepair?[state.codingRepair.round,codingSnapshotFingerprint(state.codingRepair.snapshot),digest(value)]:[])]).slice(0,48);
    const inputDigest=digest(value),base={nodeId:context.node.id,proposalId:operationId,operationId,inputDigest,
      originControlRevision:state.controlRevision,...this.isolation(state),
      resourceKeys:[...context.node.resourceKeys],effect:context.node.effect==='write'?'write' as const:'read' as const};
    if(context.node.kind==='tool'||this.options.externalHost&&context.node.kind==='host') {
      const descriptor=context.availableTools.find(tool=>context.node.kind==='host'
        ?tool.name===workflowHostToolName(context.node.id)&&tool.version==='1.0.0'
        :tool.name===value.toolName&&tool.version===value.toolVersion);
      if(!descriptor||(context.node.kind==='tool'&&!context.node.capabilities.some(cap=>cap.kind==='tool'&&cap.name===descriptor.name))
        ||!plain(value.arguments)) throw new ProtocolError('UNSUPPORTED_CAPABILITY','Tool candidate is absent from the precise node catalog');
      validateToolValue(descriptor.inputSchema,value.arguments);
      return {...base,kind:'tool_proposal',toolSchemaDigest:digest(descriptor.inputSchema),toolName:descriptor.name,toolVersion:descriptor.version,arguments:copy(value.arguments)};
    }
    if(!plain(value.arguments)) throw new ProtocolError('EXTERNAL_FAILURE','Invalid bound host arguments');
    return {...base,kind:'host_requirement',capabilities:context.node.capabilities.map(cap=>cap.name),arguments:copy(value.arguments)};
  }
  private async runNode(context:WorkflowNodeContext,state:CheckpointState):Promise<StepState> {
    const {node}=context;
    if(context.mode==='trace_replay') return {state:'unknown',reason:'Replay has no trusted counterfactual observation for this node'};
    if(state.codingRepair&&node.id==='F15_N06'&&context.mode==='isolated'){
      const coding=state.codingRepair;
      if(!requiredCodingVerification(coding))return {state:'unknown',reason:'Isolated artifact has no current mandatory verification'};
      const evidenceRefs=[...new Set(coding.verification.filter(receipt=>receipt.status==='VALID').flatMap(receipt=>receipt.evidenceRefs))];
      return {state:'completed',evidenceRefs,value:{version:1,sessionId:coding.configuration.session.sessionId,
        state:'shadow_artifact_verified',snapshotId:coding.snapshot.snapshotId,published:false,
        files:coding.snapshot.files.map(({content:_content,...file})=>file),
        verificationRunIds:coding.configuration.recipes.filter(r=>r.required).map(recipe=>[...coding.verification].reverse().find(r=>r.recipeId===recipe.recipeId)!.runId),evidenceRefs}};
    }
    const isolated=this.options.externalHost&&this.options.allowIsolatedProposals&&context.mode==='isolated';
    if(context.mode!=='main'&&!isolated&&(node.effect==='write'||node.designKind==='checkpoint'||node.designKind==='wait_user')) {
      return {state:'unavailable',reason:'Shadow does not consume main authorization, mutate main state or emit real effects'};
    }
    if(this.options.externalHost&&node.condition&&!state.selections[node.id]) {
      if(context.mode!=='main'&&!isolated) return {state:'unavailable',reason:'Shadow condition requires an isolated host observation'};
      const descriptor=context.availableTools.find(tool=>tool.name===workflowGuardToolName(node.id)&&tool.version==='1.0.0');
      if(!descriptor) return {state:'unavailable',reason:'Required local condition adapter is not published'};
      const argumentsValue={workflowId:context.template.workflowId,nodeId:node.id,input:context.input,
        predecessorOutputs:context.predecessorOutputs,predecessorStates:context.predecessorStates};
      validateToolValue(descriptor.inputSchema,argumentsValue);
      const operationId='wf-guard-'+digest([state.taskId,state.controlRevision,state.workflowId,node.id,state.inputDigest,state.mode,state.namespace,
        ...(state.codingRepair?[state.codingRepair.round,codingSnapshotFingerprint(state.codingRepair.snapshot)]:[])]).slice(0,48);
      return {state:'waiting_receipt',pendingGuard:true,proposal:{kind:'tool_proposal',nodeId:node.id,
        operationId,proposalId:operationId,inputDigest:digest(argumentsValue),originControlRevision:state.controlRevision,
        toolName:descriptor.name,toolVersion:descriptor.version,toolSchemaDigest:digest(descriptor.inputSchema),
        arguments:argumentsValue,resourceKeys:[],effect:'read',...this.isolation(state)}};
    }
    if(node.kind==='input') return {state:'completed',value:copy(context.input)};
    if(node.kind==='assemble') return {state:'completed',value:copy({states:context.predecessorStates,outputs:context.predecessorOutputs})};
    if(node.kind==='decision'||node.kind==='executor') {
      const chosen=await this.candidates(context,state);
      if('state' in chosen) return chosen;
      if(state.codingRepair&&node.id==='F15_N02'&&!chosen.abstain){
        if(!plain(chosen.value)||!Array.isArray(chosen.value.scope)||chosen.value.scope.length===0
          ||chosen.value.scope.some(path=>typeof path!=='string'||!path||path.includes('\\')||path.startsWith('/')||/^[A-Za-z]:/.test(path)
            ||path.split('/').some(part=>part==='..'||part===''||part==='.')||path.includes('\0')))
          throw new ProtocolError('INVALID_ARGUMENT','Coding scope must name explicit relative source paths');
        state.codingRepair.scopePaths=[...new Set(chosen.value.scope as string[])];
      }
      if(state.codingRepair&&node.id==='F15_N03'&&!chosen.abstain){
        const candidate=parseCodingPatchCandidate(chosen.value);
        if(candidate.patches.some(patch=>!state.codingRepair!.scopePaths.includes(patch.path)))throw new ProtocolError('INVALID_ARGUMENT','Coding patch exceeds its selected source scope');
        if(codingPatchRepeated(state.codingRepair,candidate.patches)){state.codingRepair.stoppedReason='no_progress';return {state:'failed',reason:'NO_PROGRESS: identical source, failure and patch'};}
        const analysis=codingPatchCost(state.codingRepair,candidate,context.codingRepair!.snapshot).analysis;
        state.codingRepair.pendingPatch=copy(candidate);
        return {state:'completed',value:{...candidate,analysis}};
      }
      return chosen.abstain?{state:'unknown',reason:'Unique selector requested recheck; no execution or branch activation'}
        :{state:'completed',value:chosen.value};
    }
    const missing=node.capabilities.filter(cap=>cap.kind==='tool'
      ? !context.availableTools.some(tool=>tool.name===cap.name)
      : this.options.externalHost
        ?!context.availableTools.some(tool=>tool.name===workflowHostToolName(node.id)&&tool.version==='1.0.0')
        :!this.options.host?.capabilities.includes(cap.name));
    if(missing.length) return {state:'unavailable',reason:'Required published tool or injected host capability unavailable',
      value:{missing:missing.map(cap=>`${cap.kind}:${cap.name}`)}};
    if(node.kind==='host'&&node.effect!=='write'&&!this.options.externalHost) {
      if(!this.options.host) return {state:'unavailable',reason:'Host provider unavailable'};
      const result=await this.options.host.read(context);control(context);
      if(!['completed','unavailable','failed','unknown'].includes(result.state)) throw new ProtocolError('EXTERNAL_FAILURE','Invalid host observation');
      return {state:result.state,...(result.value===undefined?{}:{value:copy(result.value)})};
    }
    if(context.mode==='decision_shadow') return {state:'unavailable',reason:'Decision shadow only compares decisions over its frozen input'};
    if(context.mode==='isolated'&&!isolated) return {state:'unavailable',reason:'Isolated tool execution needs a separately verified sandbox host; no main proposal emitted'};
    const selected=await this.candidates(context,state);
    if('state' in selected) return selected;
    if(selected.abstain) return {state:'unknown',reason:'Unique selector requested recheck; no operation proposal emitted'};
    return {state:'waiting_receipt',proposal:this.proposal(context,state,selected)};
  }
  private isolation(state:CheckpointState):{isolation?:{namespace:string;snapshotDigest:string}} {
    return state.mode==='isolated'?{isolation:{namespace:state.namespace,snapshotDigest:state.snapshotDigest}}:{};
  }
  async advance(request:OwnedWorkflowAdvanceRequest):Promise<OwnedWorkflowAdvanceResult> {
    if(request.resultFits!==undefined&&typeof request.resultFits!=='function')invalid('Invalid trusted workflow result bound');
    if(!Number.isFinite(Date.parse(request.deadline)))invalid('Invalid invocation deadline');
    if(request.taskDeadline!==undefined&&!Number.isFinite(Date.parse(request.taskDeadline)))invalid('Invalid original task deadline');
    const template=getOwnedWorkflowTemplate(request.workflowId);
    if(!template) throw new ProtocolError('UNSUPPORTED_CAPABILITY','Unknown owned workflow');
    const tools=parseCoordinationAvailableTools(request.availableTools);
    const state=await this.initialize(request,template,tools);
    // Reject an incompatible existing checkpoint before consuming receipts or preparing any new node.
    // The caller retains the original checkpoint and trusted host receipts for a larger transport.
    if(!this.deliverable(template,state,request)) invalid('Existing workflow checkpoint requires a larger result transport');
    // A new HTTP invocation window may move forward, but never renews the sealed task lifetime.
    request={...request,deadline:new Date(Math.min(Date.parse(request.deadline),Date.parse(state.originalDeadline))).toISOString()};
    const abort=():void=>{for(const step of Object.values(state.nodes)) {
      if(step.state==='pending') step.state='cancelled';
      else if(step.state==='waiting_receipt') {step.state='unknown';step.reason='Cancellation has no host stop/readback receipt';}
    }};
    if(request.signal.aborted) {abort();return this.delivery(template,state,request,true);}
    control(request);await this.admitReceipts(request,state,template);
    // Original tool executions remain in the host. Large confirmed values are represented by
    // their existing trusted host reference, never replaced with a new execution or an empty result.
    if(!this.deliverable(template,state,request)) invalid('Workflow receipts require a larger result transport; original host receipts remain authoritative');
    const command=request.hostControl;
    if(command) {
      if(!request.checkpoint||!safeId(command.commandId)||!['pause','resume','continue','notify_controller','request_controller','request_user'].includes(command.action)
        ||command.reason!==undefined&&(typeof command.reason!=='string'||!command.reason.trim())) invalid('Invalid trusted workflow control');
      const hostControl=state.hostControl??={status:'running',commands:{},events:[]};
      const commandDigest=digest(command),prior=hostControl.commands[command.commandId];
      if(prior!==undefined) {
        if(prior!==commandDigest) invalid('Workflow control command identity changed');
        return this.delivery(template,state,request);
      }
      if(!this.options.receiptVerifier?.verifyControl||!await this.options.receiptVerifier.verifyControl(copy(command),request)) invalid('Workflow control proof is not verified');
      control(request);
      hostControl.commands[command.commandId]=commandDigest;
      hostControl.events.push({commandId:command.commandId,action:command.action,...(command.reason===undefined?{}:{reason:command.reason})});
      if(command.action==='pause')hostControl.status='paused';
      else if(command.action==='request_controller')hostControl.status='awaiting_controller';
      else if(command.action==='request_user')hostControl.status='awaiting_user';
      else if(command.action==='resume'||command.action==='continue')hostControl.status='running';
      // Notify is an observable host request, not proof that a controller received it.
      return this.delivery(template,state,request);
    }
    if(state.hostControl&&state.hostControl.status!=='running')return this.delivery(template,state,request);
    if(Object.values(state.nodes).some(step=>step.state==='waiting_receipt'||step.state==='stopping')) return this.delivery(template,state,request);
    const ready:OwnedWorkflowNode[]=[];
    for(const node of template.nodes) {
      const step=state.nodes[node.id]!;if(step.state!=='pending') continue;
      const dependencyStates=node.dependencies.map(dep=>({dep,step:state.nodes[dep.nodeId]!}));
      const settledStates=['completed','skipped','cancelled','failed','unavailable',
        ...(node.designKind==='join'?['unknown']:[])];
      if(node.designKind==='join') {
        if(!workflowJoinReady(node,Object.fromEntries(dependencyStates.map(({dep,step})=>[dep.nodeId,step.state]))))continue;
      } else if(dependencyStates.some(({step})=>!settledStates.includes(step.state))) continue;
      if(node.joinMode!=='any'&&dependencyStates.some(({dep,step})=>dep.required&&!['completed','skipped'].includes(step.state))) continue;
      if(node.dependencies.some(dep=>referenced(state.nodes[dep.nodeId]?.value)&&!Object.hasOwn(request.resolvedValues??{},dep.nodeId))) {
        step.reason='Original full ToolGateway result must be restored from its existing trusted host reference';continue;
      }
      if(dependencyStates.length&&dependencyStates.every(({step})=>step.state==='skipped')) {step.state='skipped';continue;}
      if(node.condition&&node.designKind!=='join') {
        let selected=node.hostGuard&&!this.options.externalHost?undefined:state.selections[node.id];
        if(!selected&&this.options.host?.condition) {
          const evaluated=await this.options.host.condition(this.context(request,template,node,state,tools));control(request);
          if(evaluated!=='unknown') {selected=evaluated;state.selections[node.id]=evaluated;}
        }
        if(selected==='skipped') {step.state='skipped';continue;}
        if(selected!=='selected'&&!this.options.externalHost) {step.reason='Condition has no verified observation or selected semantic candidate';continue;}
      }
      ready.push(node);
    }
    // Serial frontier execution: no competing model preparation or local CPU requests.
    for(const node of ready) {
      const before=copy(state),unavailable={state:'unavailable' as const,
        reason:'Node output requires the existing host Artifact/reference adapter before transport'};
      const rejected=copy(before);rejected.nodes[node.id]={...before.nodes[node.id],...unavailable};
      // Reserve the actual sealed failure continuation, not a guessed per-node byte quota.
      // No model preparation or host read starts if even this continuation cannot be delivered.
      if(!this.deliverable(template,rejected,request)) invalid('Workflow continuation requires a larger result transport');
      const context=this.context(request,template,node,state,tools);
      const run=async()=>{try {
        control(request);const result=await this.runNode(context,state);control(request);
        // Preflight before emitting a proposal or seal. This is the existing transport byte budget, not a task/token budget.
        if(Buffer.byteLength(JSON.stringify(result))>NODE_OUTPUT_BYTES(template)) {
          return {id:node.id,result:{state:'unavailable' as const,reason:'Node output requires the existing host Artifact/reference adapter before transport'}};
        }
        return {id:node.id,result};
      }
      catch(error) {
        if(error instanceof ProtocolError&&error.code==='TIMEOUT') throw error;
        if(error instanceof ProtocolError&&error.code==='CANCELLED') return {id:node.id,result:{state:'cancelled' as const}};
        if(error instanceof ProtocolError&&error.code==='RATE_LIMITED'&&['decision','executor'].includes(node.kind)) {
          return {id:node.id,result:{state:'pending' as const,reason:'DECISION_BUSY: no operation submitted; may resume with the same checkpoint'}};
        }
        return {id:node.id,result:{state:error instanceof ProtocolError&&error.code==='UNSUPPORTED_CAPABILITY'?'unavailable' as const:'failed' as const,
          reason:error instanceof ProtocolError?error.code:'EXECUTOR_FAILURE'}};
      }
      };
      const {id,result}=await run();
      state.nodes[id]={...result,...(state.nodes[id]!.evidenceRefs?{evidenceRefs:state.nodes[id]!.evidenceRefs}:{}),
        ...(state.nodes[id]!.shadow?{shadow:state.nodes[id]!.shadow}:{}),
        ...(state.nodes[id]!.previousAttempts?{previousAttempts:state.nodes[id]!.previousAttempts}:{})};
      if(!this.deliverable(template,state,request)) {
        // The cloud has not executed a business operation. Do not expose an undeliverable
        // proposal or retain branch choices selected by a candidate which was never emitted.
        state.nodes=rejected.nodes;state.selections=rejected.selections;
        if(before.codingRepair)state.codingRepair=before.codingRepair;else delete state.codingRepair;
        return this.delivery(template,state,request);
      }
      // A sequential workflow never starts a second branch while a host effect/decision is unresolved.
      if(result.state==='waiting_receipt'||result.state==='unknown'||result.state==='failed'||result.state==='unavailable') break;
    }
    if(request.signal.aborted) abort();
    return this.delivery(template,state,request,request.signal.aborted);
  }
  private deliverable(template:OwnedWorkflowTemplate,state:CheckpointState,request:OwnedWorkflowAdvanceRequest,cancelled=false):OwnedWorkflowAdvanceResult|undefined {
    const fits=():OwnedWorkflowAdvanceResult|undefined=>{
      // F15 explicitly enables compressed coding checkpoints; other graphs retain their reference/capacity contract.
      for(const compressed of request.resultFits&&state.codingRepair?[false,true]:[false]) {
        let result:OwnedWorkflowAdvanceResult;
        try {result=this.result(template,state,cancelled,compressed);}
        catch(error) {if(error instanceof ProtocolError&&error.code==='EXTERNAL_FAILURE')continue;throw error;}
        if(!request.resultFits||request.resultFits(result))return result;
      }
      return undefined;
    };
    const original=fits();if(original||!request.resultFits)return original;
    // The original input is already resent and digest-bound on every advance. Avoid storing
    // a second full copy in nodes and a third base64 copy in the checkpoint on narrow transports.
    for(const node of template.nodes) {
      const step=state.nodes[node.id]!;
      if(node.kind==='input'&&step.state==='completed'&&Object.hasOwn(step,'value')&&!step.inputReference) {
        if(digest(step.value)!==state.inputDigest)invalid('Workflow input value changed before transport');
        step.value={kind:'workflow_input_reference',valueDigest:state.inputDigest};
        step.inputReference=true;
      } else if(step.proposal
        &&Object.hasOwn(step,'value')&&!referenced(step.value)) {
        const value=step.value;
        step.value={kind:'trusted_tool_result_reference',valueDigest:digest(value),bytes:Buffer.byteLength(JSON.stringify(value)),
          evidenceRefs:[...(step.evidenceRefs??[])],operationId:step.proposal.operationId,inputDigest:step.proposal.inputDigest};
      } else continue;
      const result=fits();if(result)return result;
    }
    return undefined;
  }
  private delivery(template:OwnedWorkflowTemplate,state:CheckpointState,request:OwnedWorkflowAdvanceRequest,cancelled=false):OwnedWorkflowAdvanceResult {
    const result=this.deliverable(template,state,request,cancelled);
    if(!result)invalid('Workflow continuation requires a larger result transport');
    return result!;
  }
  private result(template:OwnedWorkflowTemplate,state:CheckpointState,cancelled=false,compressed=false):OwnedWorkflowAdvanceResult {
    const steps=Object.values(state.nodes),proposals=state.hostControl&&state.hostControl.status!=='running'?[]
      :steps.flatMap(step=>step.state==='waiting_receipt'&&step.proposal?[copy(step.proposal)]:[]);
    const required=template.nodes.filter(node=>node.required||state.selections[node.id]==='selected').map(node=>state.nodes[node.id]!);
    const verifierMissing=steps.some(step=>step.reason==='Host receipt verifier unavailable; original operation is retained');
    // Optional guards still need an observation. No delivery/summary branch may disappear merely
    // because the fixed required prefix has completed; the existing frontier must settle it first.
    const openFrontier=steps.some(step=>['pending','waiting_receipt','unknown','stopping'].includes(step.state));
    const graphState:OwnedWorkflowAdvanceResult['state']=cancelled?'cancelled':state.hostControl&&state.hostControl.status!=='running'?state.hostControl.status:required.some(step=>step.state==='unknown')?'unknown'
      :required.some(step=>step.state==='failed')?'failed':required.some(step=>step.state==='unavailable')?'unavailable'
      :verifierMissing?'unavailable'
      :proposals.length||steps.some(step=>step.state==='stopping')?'awaiting_host'
      :!openFrontier&&required.every(step=>['completed','skipped'].includes(step.state))?'settled':'progress';
    const shadows=Object.entries(state.nodes).flatMap(([nodeId,step])=>step.shadow?[{nodeId,...copy(step.shadow)}]:[]);
    const comparisons=shadows.filter(shadow=>shadow.plan.mode==='compare');
    const waitingForShadow=comparisons.some(shadow=>shadow.evaluation?.context.controlRevision!==state.controlRevision
      ||shadow.evaluation.policy.mayDeliverMain!==true||shadow.evaluation.policy.comparison.status!=='comparable');
    const result:OwnedWorkflowAdvanceResult={workflowVersion:OWNED_WORKFLOW_VERSION,workflowId:template.workflowId,templateVersion:template.version,
      templateDigest:template.templateDigest,state:graphState,verification:'unverified',checkpoint:this.seal(state,compressed),nodes:copy(state.nodes),proposals,
      ...(state.hostControl?{hostControl:copy(state.hostControl)}:{}),
      ...(shadows.length?{shadows,delivery:{waitingForShadow,mayDeliverMain:graphState==='settled'&&!waitingForShadow,
        reason:waitingForShadow?'explicit_comparison_requires_verified_comparable_results':graphState!=='settled'?'main_graph_not_settled':'main_graph_settled_without_shadow_wait'}}:{}),
      unavailable:template.nodes.filter(node=>state.nodes[node.id]!.state==='unavailable'
        ||state.nodes[node.id]!.reason==='Host receipt verifier unavailable; original operation is retained').map(node=>({nodeId:node.id,
        capabilities:node.capabilities.map(cap=>`${cap.kind}:${cap.name}`),reason:state.nodes[node.id]!.reason??'Provider unavailable'})),
      feedback:template.transitions.filter(edge=>edge.feedback&&state.nodes[edge.source]?.state==='completed')
        .map(({source,target})=>({source,target,state:'requires_host_revision' as const})),
      ...(state.codingRepair?{codingRepair:{version:1 as const,round:state.codingRepair.round,snapshotId:state.codingRepair.snapshot.snapshotId,
        history:copy(state.codingRepair.history),verification:copy(state.codingRepair.verification),
        ...(state.codingRepair.stoppedReason?{stoppedReason:state.codingRepair.stoppedReason}:{})}}:{})};
    if(Buffer.byteLength(JSON.stringify(result))>1_100_000) throw new ProtocolError('EXTERNAL_FAILURE','Workflow result exceeds the versioned graph transport budget');
    return result;
  }
}
