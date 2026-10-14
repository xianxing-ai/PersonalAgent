import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';
import {parseCoordinationAvailableTools} from '@personal-agent/coordination';
import type {CoordinationAvailableTool} from '@personal-agent/coordination';
import {getOwnedWorkflowTemplate,OWNED_WORKFLOW_VERSION} from './owned-workflow-templates.js';
import type {OwnedWorkflowNode,OwnedWorkflowTemplate} from './owned-workflow-templates.js';

export type OwnedWorkflowMode = 'main' | 'decision_shadow' | 'trace_replay' | 'isolated';
export interface WorkflowSelector {
  select(request: {context:string; candidates:readonly {id:string;description:string}[];
    deadline:string;signal:AbortSignal;requestId:string}):Promise<string>;
}
export interface WorkflowCandidate {
  id:string;description:string;value:unknown;
  abstain?:true;
  /** Conditional nodes are activated explicitly; missing condition evidence remains unresolved. */
  branches?:readonly {nodeId:string;state:'selected'|'skipped'}[];
}
export interface WorkflowNodeContext {
  template:OwnedWorkflowTemplate;node:OwnedWorkflowNode;input:unknown;
  predecessorOutputs:Readonly<Record<string,unknown>>;availableTools:readonly CoordinationAvailableTool[];
  predecessorStates:Readonly<Record<string,string>>;
  deadline:string;signal:AbortSignal;requestId:string;mode:OwnedWorkflowMode;namespace:string;
}
export interface WorkflowHostPort {
  /** Discovery is trusted startup composition, never supplied in query by an end user. */
  capabilities:readonly string[];
  /** This port only reads/checks. Write nodes return a bound request to local Runtime. */
  read(context:WorkflowNodeContext):Promise<{state:'completed'|'unavailable'|'failed'|'unknown';value?:unknown}>;
  condition?(context:WorkflowNodeContext):Promise<'selected'|'skipped'|'unknown'>;
}
export type WorkflowProposal =
  | {kind:'tool_proposal';nodeId:string;proposalId:string;operationId:string;inputDigest:string;
      originControlRevision:number;toolSchemaDigest:string;
      toolName:string;toolVersion:string;arguments:Record<string,unknown>;resourceKeys:readonly string[];effect:'read'|'write'}
  | {kind:'host_requirement';nodeId:string;proposalId:string;operationId:string;inputDigest:string;
      originControlRevision:number;
      capabilities:readonly string[];arguments:Record<string,unknown>;resourceKeys:readonly string[];effect:'read'|'write'};
export interface WorkflowReceipt {
  nodeId:string;proposalId:string;operationId:string;inputDigest:string;
  state:'confirmed'|'failed'|'unknown'|'not_started'|'stopping';result:unknown;evidenceRefs:readonly string[];
  /** Opaque host readback/signature, not a model or client's trust label. */
  proof:unknown;
}
export interface WorkflowReceiptVerifier {
  verify(receipt:WorkflowReceipt,expected:WorkflowProposal,request:OwnedWorkflowAdvanceRequest):Promise<boolean>;
  verifyMigration?(migration:WorkflowRevisionMigration,previous:WorkflowRevisionIdentity,next:WorkflowRevisionIdentity):Promise<boolean>;
}
export interface WorkflowRevisionIdentity {taskId:string;sessionId:string;workflowId:string;templateDigest:string;
  controlRevision:number;inputDigest:string;catalogDigest:string}
export interface WorkflowRevisionMigration {invalidatedNodeIds:readonly string[];proof:unknown}
export interface OwnedWorkflowAdvanceRequest {
  workflowId:string;input:unknown;taskId:string;controlRevision:number;sessionId:string;requestId:string;
  deadline:string;signal:AbortSignal;availableTools:readonly CoordinationAvailableTool[];
  checkpoint?:string;receipts?:readonly WorkflowReceipt[];mode?:OwnedWorkflowMode;
  migration?:WorkflowRevisionMigration;
  /** Original full tool results are retained by TaskRuntime; restoration must match the sealed digest. */
  resolvedValues?:Readonly<Record<string,unknown>>;
  snapshot?:{namespace:string;asOf:string;sourceVersions:Readonly<Record<string,string>>};
}
type NodeState = 'pending'|'completed'|'skipped'|'waiting_receipt'|'unavailable'|'failed'|'unknown'|'cancelled'|'stopping';
interface StepState {state:NodeState;value?:unknown;proposal?:WorkflowProposal;evidenceRefs?:readonly string[];reason?:string}
interface CheckpointState {
  workflowVersion:typeof OWNED_WORKFLOW_VERSION;workflowId:string;templateVersion:string;templateDigest:string;
  taskId:string;sessionId:string;controlRevision:number;inputDigest:string;catalogDigest:string;mode:OwnedWorkflowMode;
  snapshotDigest:string;namespace:string;nodes:Record<string,StepState>;selections:Record<string,'selected'|'skipped'>;
}
export interface OwnedWorkflowAdvanceResult {
  workflowVersion:typeof OWNED_WORKFLOW_VERSION;workflowId:string;templateVersion:string;templateDigest:string;
  /** Application graph state only. Local TaskRuntime owns wire task terminal states. */
  state:'progress'|'awaiting_host'|'unavailable'|'failed'|'unknown'|'cancelled'|'settled';
  verification:'unverified';checkpoint:string;nodes:Record<string,StepState>;proposals:WorkflowProposal[];
  unavailable:{nodeId:string;capabilities:string[];reason:string}[];
  feedback:{source:string;target:string;state:'requires_host_revision'}[];
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
const NODE_OUTPUT_BYTES=(template:OwnedWorkflowTemplate):number=>Math.floor((1_100_000-65_536)/(4*template.nodes.length));

/** Stateless cloud planning frontier. No DB, credentials, authorization issuer or real tool executor. */
export class OwnedWorkflowEngine {
  private readonly secret:Buffer;
  constructor(private readonly options:{selector:WorkflowSelector;prepareCandidates:(context:WorkflowNodeContext)=>Promise<readonly WorkflowCandidate[]>;
    checkpointSecret:string;host?:WorkflowHostPort;receiptVerifier?:WorkflowReceiptVerifier}) {
    if(typeof options.checkpointSecret!=='string'||Buffer.byteLength(options.checkpointSecret)<32
      ||typeof options.selector?.select!=='function'||typeof options.prepareCandidates!=='function') invalid('Invalid workflow startup configuration');
    this.secret=Buffer.from(options.checkpointSecret,'utf8');
  }
  private seal(state:CheckpointState):string {
    const encoded=Buffer.from(JSON.stringify(state)).toString('base64url');
    return encoded+'.'+createHmac('sha256',this.secret).update(encoded).digest('base64url');
  }
  private open(value:string):CheckpointState {
    if(typeof value!=='string'||Buffer.byteLength(value)>1_100_000) invalid('Invalid workflow checkpoint');
    const parts=value.split('.');if(parts.length!==2) invalid('Invalid workflow checkpoint');
    const [encoded,signature]=parts as [string,string];
    const expected=createHmac('sha256',this.secret).update(encoded).digest();
    const actual=Buffer.from(signature,'base64url');
    if(expected.length!==actual.length||!timingSafeEqual(expected,actual)) invalid('Workflow checkpoint integrity failed');
    try {return JSON.parse(Buffer.from(encoded,'base64url').toString('utf8')) as CheckpointState;}
    catch {return invalid('Invalid workflow checkpoint');}
  }
  private async initialize(request:OwnedWorkflowAdvanceRequest,template:OwnedWorkflowTemplate,tools:readonly CoordinationAvailableTool[]):Promise<CheckpointState> {
    if(!safeId(request.taskId)||!safeId(request.sessionId)||!safeId(request.requestId)
      ||!Number.isSafeInteger(request.controlRevision)||request.controlRevision<0) invalid();
    const mode=request.mode??'main';
    if(!['main','decision_shadow','trace_replay','isolated'].includes(mode)) invalid();
    const snapshot=request.snapshot;
    if(mode!=='main'&&(!snapshot||!safeId(snapshot.namespace)||snapshot.namespace==='main'
      ||!Number.isFinite(Date.parse(snapshot.asOf))||!plain(snapshot.sourceVersions))) invalid('Shadow snapshot and separate namespace required');
    if(snapshot&&Object.values(snapshot.sourceVersions).some(value=>typeof value!=='string'||!value)) invalid();
    const identity={workflowVersion:OWNED_WORKFLOW_VERSION,workflowId:template.workflowId,templateVersion:template.version,
      templateDigest:template.templateDigest,taskId:request.taskId,sessionId:request.sessionId,controlRevision:request.controlRevision,
      inputDigest:digest(request.input),catalogDigest:digest(tools),mode,snapshotDigest:digest(snapshot??null),namespace:snapshot?.namespace??'main'};
    if(request.checkpoint!==undefined) {
      const state=this.open(request.checkpoint);
      if(!plain(state.nodes)||!plain(state.selections)
        ||Object.keys(state.nodes).length!==template.nodes.length
        ||template.nodes.some(node=>!Object.hasOwn(state.nodes,node.id))) invalid('Workflow checkpoint input, catalog or revision is stale');
      const immutable=['workflowVersion','workflowId','templateVersion','templateDigest','taskId','sessionId','mode','snapshotDigest','namespace'] as const;
      if(immutable.some(key=>state[key]!==identity[key])) invalid('Workflow checkpoint identity is stale');
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
          // A cloud proposal does not prove local submission. After revision change it is readback-only,
          // including an unrelated branch: do not re-emit stale parameters as a new executable request.
          if(step.proposal&&step.state==='waiting_receipt') {
            step.state='unknown';step.reason='Original revision changed; host must reconcile whether the original operation was submitted';
          }
          // Pure calculations and read-only host observations must see the new input/source version.
          // Original actual/proposed operations, including unknown and failed effects, stay bound to their original IDs.
          if(affected.has(node.id)&&!step.proposal&&(['input','assemble','decision','executor'].includes(node.kind)
            ||node.kind==='host'&&node.effect!=='write')) {
            state.nodes[node.id]={state:'pending'};
          }
        }
        for(const id of Object.keys(state.selections)) if(affected.has(id)&&state.nodes[id]!.state==='pending') delete state.selections[id];
        state.controlRevision=identity.controlRevision;state.inputDigest=identity.inputDigest;state.catalogDigest=identity.catalogDigest;
      } else if(request.migration) invalid('Migration does not change the original revision');
      return state;
    }
    if(request.receipts?.length) invalid('A receipt requires its original checkpoint');
    return {...identity,nodes:Object.fromEntries(template.nodes.map(node=>[node.id,{state:'pending' as const}])),selections:{}};
  }
  private context(request:OwnedWorkflowAdvanceRequest,template:OwnedWorkflowTemplate,node:OwnedWorkflowNode,
    state:CheckpointState,tools:readonly CoordinationAvailableTool[]):WorkflowNodeContext {
    return {template:copy(template),node:copy(node),input:copy(request.input),
      predecessorOutputs:copy(Object.fromEntries(node.dependencies.map(dep=>{
        const value=state.nodes[dep.nodeId]?.value;
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
      step.state=receipt.state==='confirmed'?'completed':receipt.state==='not_started'?'cancelled':receipt.state;
      const bytes=Buffer.byteLength(JSON.stringify(receipt.result));
      step.value=receipt.state==='confirmed'&&bytes>NODE_OUTPUT_BYTES(template)
        ? {kind:'trusted_tool_result_reference',valueDigest:digest(receipt.result),bytes,
            evidenceRefs:[...receipt.evidenceRefs],operationId:expected.operationId,inputDigest:expected.inputDigest}
        :copy(receipt.result);
      step.evidenceRefs=[...receipt.evidenceRefs];delete step.reason;
    }
  }
  private async candidates(context:WorkflowNodeContext,state:CheckpointState):Promise<WorkflowCandidate> {
    const candidates=copy(await this.options.prepareCandidates(context));
    control(context);
    if(!Array.isArray(candidates)||candidates.length<2||candidates.length>16||new Set(candidates.map(item=>item.id)).size!==candidates.length
      ||candidates.some(item=>!safeId(item.id)||typeof item.description!=='string'||!item.description.trim()
        ||!Object.hasOwn(item,'value'))) throw new ProtocolError('EXTERNAL_FAILURE','Invalid executor candidates');
    const selected=await this.options.selector.select({context:JSON.stringify({workflowId:context.template.workflowId,
      nodeId:context.node.id,label:context.node.label,input:context.input,predecessors:context.predecessorOutputs,
      candidateValues:candidates.map(({id,value})=>({id,value})),mode:context.mode}),
      candidates:candidates.map(({id,description})=>({id,description})),deadline:context.deadline,
      signal:context.signal,requestId:context.requestId});
    control(context);
    const candidate=candidates.find(item=>item.id===selected);
    if(!candidate) throw new ProtocolError('EXTERNAL_FAILURE','Selector returned an unknown candidate');
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
    const operationId='wf-'+digest([state.taskId,state.controlRevision,state.workflowId,context.node.id,state.inputDigest]).slice(0,48);
    const inputDigest=digest(value),base={nodeId:context.node.id,proposalId:operationId,operationId,inputDigest,
      originControlRevision:state.controlRevision,
      resourceKeys:[...context.node.resourceKeys],effect:context.node.effect==='write'?'write' as const:'read' as const};
    if(context.node.kind==='tool') {
      const descriptor=context.availableTools.find(tool=>tool.name===value.toolName&&tool.version===value.toolVersion);
      if(!descriptor||!context.node.capabilities.some(cap=>cap.kind==='tool'&&cap.name===descriptor.name)
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
    if(context.mode!=='main'&&(node.effect==='write'||node.designKind==='checkpoint'||node.designKind==='wait_user')) {
      return {state:'unavailable',reason:'Shadow does not consume main authorization, mutate main state or emit real effects'};
    }
    if(node.kind==='input') return {state:'completed',value:copy(context.input)};
    if(node.kind==='assemble') return {state:'completed',value:copy({states:context.predecessorStates,outputs:context.predecessorOutputs})};
    if(node.kind==='decision'||node.kind==='executor') {
      const chosen=await this.candidates(context,state);
      return chosen.abstain?{state:'unknown',reason:'Unique selector requested recheck; no execution or branch activation'}
        :{state:'completed',value:chosen.value};
    }
    const missing=node.capabilities.filter(cap=>cap.kind==='tool'
      ? !context.availableTools.some(tool=>tool.name===cap.name)
      : !this.options.host?.capabilities.includes(cap.name));
    if(missing.length) return {state:'unavailable',reason:'Required published tool or injected host capability unavailable',
      value:{missing:missing.map(cap=>`${cap.kind}:${cap.name}`)}};
    if(node.kind==='host'&&node.effect!=='write') {
      if(!this.options.host) return {state:'unavailable',reason:'Host provider unavailable'};
      const result=await this.options.host.read(context);control(context);
      if(!['completed','unavailable','failed','unknown'].includes(result.state)) throw new ProtocolError('EXTERNAL_FAILURE','Invalid host observation');
      return {state:result.state,...(result.value===undefined?{}:{value:copy(result.value)})};
    }
    if(context.mode==='decision_shadow') return {state:'unavailable',reason:'Decision shadow only compares decisions over its frozen input'};
    if(context.mode==='isolated') return {state:'unavailable',reason:'Isolated tool execution needs a separately verified sandbox host; no main proposal emitted'};
    const selected=await this.candidates(context,state);
    if(selected.abstain) return {state:'unknown',reason:'Unique selector requested recheck; no operation proposal emitted'};
    return {state:'waiting_receipt',proposal:this.proposal(context,state,selected)};
  }
  async advance(request:OwnedWorkflowAdvanceRequest):Promise<OwnedWorkflowAdvanceResult> {
    const template=getOwnedWorkflowTemplate(request.workflowId);
    if(!template) throw new ProtocolError('UNSUPPORTED_CAPABILITY','Unknown owned workflow');
    const tools=parseCoordinationAvailableTools(request.availableTools);
    const state=await this.initialize(request,template,tools);
    const abort=():void=>{for(const step of Object.values(state.nodes)) {
      if(step.state==='pending') step.state='cancelled';
      else if(step.state==='waiting_receipt') {step.state='unknown';step.reason='Cancellation has no host stop/readback receipt';}
    }};
    if(request.signal.aborted) {abort();return this.result(template,state,true);}
    control(request);await this.admitReceipts(request,state,template);
    const ready:OwnedWorkflowNode[]=[];
    for(const node of template.nodes) {
      const step=state.nodes[node.id]!;if(step.state!=='pending') continue;
      const dependencyStates=node.dependencies.map(dep=>({dep,step:state.nodes[dep.nodeId]!}));
      const settledStates=['completed','skipped','cancelled','failed','unavailable',
        ...(node.designKind==='join'?['unknown']:[])];
      if(dependencyStates.some(({step})=>!settledStates.includes(step.state))) continue;
      if(dependencyStates.some(({dep,step})=>dep.required&&!['completed','skipped'].includes(step.state))) continue;
      if(node.dependencies.some(dep=>referenced(state.nodes[dep.nodeId]?.value)&&!Object.hasOwn(request.resolvedValues??{},dep.nodeId))) {
        step.reason='Original full ToolGateway result must be restored from its existing trusted host reference';continue;
      }
      if(dependencyStates.length&&dependencyStates.every(({step})=>step.state==='skipped')) {step.state='skipped';continue;}
      if(node.condition&&node.designKind!=='join') {
        let selected=node.hostGuard?undefined:state.selections[node.id];
        if(!selected&&this.options.host?.condition) {
          const evaluated=await this.options.host.condition(this.context(request,template,node,state,tools));control(request);
          if(evaluated!=='unknown') {selected=evaluated;state.selections[node.id]=evaluated;}
        }
        if(selected==='skipped') {step.state='skipped';continue;}
        if(selected!=='selected') {step.reason='Condition has no verified observation or selected semantic candidate';continue;}
      }
      ready.push(node);
    }
    // Freeze the ready frontier before executing anything. Independent nodes are genuinely concurrent.
    const completed=await Promise.all(ready.map(async node=>{
      const context=this.context(request,template,node,state,tools);
      try {
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
    }));
    for(const {id,result} of completed) state.nodes[id]=result;
    if(request.signal.aborted) abort();
    return this.result(template,state,request.signal.aborted);
  }
  private result(template:OwnedWorkflowTemplate,state:CheckpointState,cancelled=false):OwnedWorkflowAdvanceResult {
    const steps=Object.values(state.nodes),proposals=steps.flatMap(step=>step.state==='waiting_receipt'&&step.proposal?[copy(step.proposal)]:[]);
    const required=template.nodes.filter(node=>node.required||state.selections[node.id]==='selected').map(node=>state.nodes[node.id]!);
    const verifierMissing=steps.some(step=>step.reason==='Host receipt verifier unavailable; original operation is retained');
    const graphState:OwnedWorkflowAdvanceResult['state']=cancelled?'cancelled':required.some(step=>step.state==='unknown')?'unknown'
      :required.some(step=>step.state==='failed')?'failed':required.some(step=>step.state==='unavailable')?'unavailable'
      :verifierMissing?'unavailable'
      :proposals.length||steps.some(step=>step.state==='stopping')?'awaiting_host'
      :required.every(step=>['completed','skipped'].includes(step.state))?'settled':'progress';
    const result:OwnedWorkflowAdvanceResult={workflowVersion:OWNED_WORKFLOW_VERSION,workflowId:template.workflowId,templateVersion:template.version,
      templateDigest:template.templateDigest,state:graphState,verification:'unverified',checkpoint:this.seal(state),nodes:copy(state.nodes),proposals,
      unavailable:template.nodes.filter(node=>state.nodes[node.id]!.state==='unavailable'
        ||state.nodes[node.id]!.reason==='Host receipt verifier unavailable; original operation is retained').map(node=>({nodeId:node.id,
        capabilities:node.capabilities.map(cap=>`${cap.kind}:${cap.name}`),reason:state.nodes[node.id]!.reason??'Provider unavailable'})),
      feedback:template.transitions.filter(edge=>edge.feedback&&state.nodes[edge.source]?.state==='completed')
        .map(({source,target})=>({source,target,state:'requires_host_revision' as const}))};
    if(Buffer.byteLength(JSON.stringify(result))>1_100_000) throw new ProtocolError('EXTERNAL_FAILURE','Workflow result exceeds the versioned graph transport budget');
    return result;
  }
}
