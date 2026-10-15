import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';

export type ProactiveEntry='connector'|'user_instruction'|'subtask_feedback'|'wake';
export type ProactiveAction='continue'|'research'|'delegate'|'local_plan'|'shadow'|'notify'|'request_user'|'defer'|'ignore';
export interface ProactiveSourceQuote {conversationId:string;messageId:string;quoteRef:string;sha256:string}
export interface ProactiveResponsibility {
  id:string;revision:number;conversationId:string;sourceQuotes:readonly ProactiveSourceQuote[];goalRefs:readonly string[];
  authority:'explicit_instruction'|'inferred_interest';scopeRefs:readonly string[];proof:unknown;
}
export interface ProactiveInputEvent {
  eventId:string;entry:ProactiveEntry;conversationId:string;sourceId:string;entityRef:string;sourceVersion:string;
  previousVersion?:string;observedAt:string;expiresAt?:string;change:'upsert'|'delete'|'retract'|'correction';
  payloadRef:string;payloadDigest:string;anchorRefs:readonly string[];responsibilityRefs:readonly string[];goalRefs:readonly string[];
  contractRef:string;priority:'important'|'normal'|'unknown';evidenceRefs:readonly string[];proof:unknown;
}
export interface ProactiveDecisionContract {
  id:string;version:string;criteria:string;qualifiedForMain:boolean;batchIndependent:boolean;
  candidates:readonly {id:string;description:string;action:ProactiveAction}[];
}
export type ProactiveCapabilityKind='retrieve_context'|'local_decision_batch'|'teacher_decision'|ProactiveAction|'update_item'|'schedule_wake';
export interface ProactiveHostCapability {kind:ProactiveCapabilityKind;ref:string;location:'local_device'|'cloud_persistent';effect:'read'|'write'}
export interface ProactiveContextReadback {
  contextRef:string;sourceVersions:Record<string,string>;sourceQuotes:readonly ProactiveSourceQuote[];
  goalRefs:readonly string[];memoryRefs:readonly string[];experienceRefs:readonly string[];scopeRefs:readonly string[];dependsOnItemIds?:readonly string[];
  itemReadbacks?:readonly {itemId:string;status:ProactiveActionReadback['status'];resultRef:string}[];
}
export interface ProactiveSelection {
  itemId:string;candidateId:string;decisionRef:string;decidedBy:'laya'|'deepseek'|'verified_experience';
  uncertain:boolean;complex:boolean;importance:'important'|'normal'|'irrelevant';authorityRequired:boolean;
}
export interface ProactiveWakeRequest {runAt:string;reason:string;timeZone:string;missedRunPolicy:'run_once'|'skip'}
export interface ProactiveActionReadback {
  status:'completed'|'changed'|'pending'|'blocked'|'waiting_user';resultRef:string;nextWake?:ProactiveWakeRequest;
}
export interface ProactiveHostProposal {
  proposalId:string;operationId:string;itemIds:readonly string[];stage:'retrieve'|'laya'|'teacher'|'action'|'update'|'wake';
  capabilityRef:string;capabilityKind:ProactiveCapabilityKind;effect:'read'|'write';location:'local_device'|'cloud_persistent';
  arguments:Record<string,unknown>;argumentsDigest:string;originControlRevision:number;taskDeadline:string;createdAt:string;
}
export interface ProactiveHostReceipt {
  proposalId:string;operationId:string;argumentsDigest:string;state:'confirmed'|'failed'|'unknown';
  result:unknown;observedAt:string;evidenceRefs:readonly string[];proof:unknown;
}
export interface ProactiveControl {
  commandId:string;action:'pause'|'resume'|'cancel'|'enter_unattended'|'return';evidenceRefs:readonly string[];proof:unknown;
}
export interface ProactiveStageTiming {
  stage:string;requestId:string;itemIds:readonly string[];startedAtUtc:string;finishedAtUtc:string;wallMs:number;
}
export interface ProactiveAdvanceRequest {
  taskId:string;sessionId:string;controlRevision:number;taskDeadline:string;deadline:string;requestId:string;signal:AbortSignal;
  checkpoint?:string;events?:readonly ProactiveInputEvent[];responsibilities?:readonly ProactiveResponsibility[];
  receipts?:readonly ProactiveHostReceipt[];control?:ProactiveControl;
  hostAvailability:{localDevice:boolean;cloudPersistentHost:boolean};availableCapabilities:readonly ProactiveHostCapability[];
}
type Stage='retrieve'|'laya'|'teacher'|'action'|'update'|'wake'|'done';
export interface ProactiveWorkItem {
  itemId:string;eventRefs:string[];sourceId:string;entityRef:string;sourceVersion:string;payloadDigest:string;contractRef:string;
  responsibilityRefs:string[];goalRefs:string[];priority:'important'|'normal'|'unknown';sourceConflict:boolean;needsRefresh:boolean;
  stage:Stage;state:'ready'|'waiting_host'|'waiting_device'|'waiting_reconciliation'|'waiting_user'|'blocked'|'done'|'cancelled';
  reason?:string;context?:ProactiveContextReadback;selection?:ProactiveSelection;candidateSelection?:ProactiveSelection;
  actionResult?:ProactiveActionReadback;outcome?:'completed'|'changed'|'pending'|'blocked'|'waiting_user';
  action?:ProactiveAction;
  pendingProposalId?:string;evidenceRefs:string[];attempt:number;
}
interface ProactiveCheckpoint {
  version:1;taskId:string;sessionId:string;controlRevision:number;taskDeadline:string;advanceRevision:number;
  mode:'attended'|'unattended'|'paused'|'cancel_requested'|'cancelled';
  events:Record<string,ProactiveInputEvent>;eventDigests:Record<string,string>;responsibilities:Record<string,ProactiveResponsibility>;
  items:Record<string,ProactiveWorkItem>;proposals:Record<string,ProactiveHostProposal>;receiptDigests:Record<string,string>;
  controlDigests:Record<string,string>;timeline:ProactiveStageTiming[];lastReturnReceiptIds:string[];
  receiptStates:Record<string,ProactiveHostReceipt['state']>;receiptHistory:{operationId:string;state:ProactiveHostReceipt['state'];digest:string;evidenceRefs:readonly string[];observedAt:string}[];
}
export interface ProactiveWorkflowResult {
  profileAddon:'proactive.responsibility.v1';verification:'unverified';checkpoint:string;advanceRevision:number;taskDeadline:string;
  mode:ProactiveCheckpoint['mode'];items:Readonly<Record<string,ProactiveWorkItem>>;proposals:readonly ProactiveHostProposal[];
  timeline:readonly ProactiveStageTiming[];
  returnSummary?:{done:readonly string[];changed:readonly string[];pending:readonly string[];blocked:readonly string[];newEvidenceOperationIds:readonly string[];replayedNotifications:0};
  cancellationRequirements:readonly {operationId:string;effect:'read'|'write';reason:string}[];
}
export interface ProactiveWorkflowOptions {
  checkpointSecret:string;decisionContracts:readonly ProactiveDecisionContract[];
  verifyEvent(event:ProactiveInputEvent,request:ProactiveAdvanceRequest):Promise<boolean>;
  verifyResponsibility(value:ProactiveResponsibility,request:ProactiveAdvanceRequest):Promise<boolean>;
  verifyReceipt(receipt:ProactiveHostReceipt,proposal:ProactiveHostProposal,request:ProactiveAdvanceRequest):Promise<boolean>;
  verifyControl(control:ProactiveControl,request:ProactiveAdvanceRequest):Promise<boolean>;
  now?:()=>number;onStage?:(timing:ProactiveStageTiming)=>void;
}
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown):value is string=>typeof value==='string'&&!!value.trim();
const refs=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(text);
const date=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const sha=(value:unknown):boolean=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const invalid=(message:string):never=>{throw new ProtocolError('INVALID_ARGUMENT',message);};
const canonical=(value:unknown):string=>{
  if(value===null||typeof value!=='object') {
    if(value===undefined||['function','symbol','bigint'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))return invalid('Proactive state must be finite JSON');
    return JSON.stringify(value);
  }
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
};
export const proactiveWorkflowDigest=(value:unknown):string=>createHash('sha256').update(canonical(value)).digest('hex');
const unique=(values:readonly string[])=>[...new Set(values)];
const actions:readonly ProactiveAction[]=['continue','research','delegate','local_plan','shadow','notify','request_user','defer','ignore'];
const kinds:readonly ProactiveCapabilityKind[]=['retrieve_context','local_decision_batch','teacher_decision',...actions,'update_item','schedule_wake'];
export function getProactiveWorkflowDescriptor() {
  return {id:'proactive.responsibility.v1',profile:'huawei_ict_agentarts',overarchingAddon:true,changesOwnedF01ToF28:false,
    entries:['connector','user_instruction','subtask_feedback','wake'],nodes:[
      {id:'P01',stage:'four_entry_frontier',purpose:'Persist source versions/evidence for all four independent entrances'},
      {id:'P02',stage:'dedupe_merge',purpose:'Exact identity dedupe; retain corrections/retractions and version conflicts'},
      {id:'P03',stage:'retrieve_context',purpose:'Read relevant original quotes, Goal, memory, experience and existing scope references'},
      {id:'P04',stage:'laya_first',purpose:'Batch only owner-declared independent questions under a reusable versioned contract'},
      {id:'P05',stage:'qualification',purpose:'Unqualified/complex/uncertain/important suppression candidates require teacher takeover'},
      {id:'P06',stage:'teacher',purpose:'Use same mature question contract; record actual teacher decision; no new question per event'},
      {id:'P07',stage:'branch',purpose:'Continue/research/delegate/local plan/shadow/notification/request user via original host ports'},
      {id:'P08',stage:'actual_receipt',purpose:'Bind operation/digest/revision and actual Evidence; unknown writes require original readback'},
      {id:'P09',stage:'update_item',purpose:'Persist actual completed/changed/pending/blocked item state'},
      {id:'P10',stage:'reasoned_wake',purpose:'Existing Scheduler only; no invented period or second scheduler'},
      {id:'P11',stage:'unattended',purpose:'Existing task/checkpoint continuation; device waits do not block independent branches'},
      {id:'P12',stage:'return',purpose:'Merge persisted done/changed/pending/blocked without replaying old notifications'}],
    authority:'All proposals require original Runtime Policy/ToolGateway; inferred interest and quotes are not grants',repairAlgorithm:'not_implemented'};
}
export function getProactiveWorkflowAdapterRequirements() {
  return kinds.filter(kind=>!['ignore','defer'].includes(kind)).map(kind=>({kind,capabilityRef:'proactive.'+kind,
    hostOnly:true,requiresActualEvidence:true,mutatesExistingHostState:['update_item','schedule_wake','notify','request_user','delegate','local_plan','shadow','continue'].includes(kind),
    batchResult:kind==='local_decision_batch'||kind==='teacher_decision'?'selections keyed by original itemId':undefined}));
}
/** Stateless signed frontier. Persist checkpoint via the existing trusted TaskRuntime anchor.
 * No Connector, model, Policy issuer, task database, scheduler or notification backend lives here.
 */
export class ProactiveWorkflowEngine {
  private readonly secret:Buffer;
  private readonly contracts:Map<string,ProactiveDecisionContract>;
  private readonly now:()=>number;
  constructor(private readonly options:ProactiveWorkflowOptions) {
    if(typeof options?.checkpointSecret!=='string'||Buffer.byteLength(options.checkpointSecret)<32
      ||!['verifyEvent','verifyResponsibility','verifyReceipt','verifyControl'].every(key=>typeof options[key as keyof ProactiveWorkflowOptions]==='function')
      ||!Array.isArray(options.decisionContracts))invalid('Trusted proactive host verifiers and checkpoint secret required');
    this.secret=Buffer.from(options.checkpointSecret);this.now=options.now??Date.now;
    this.contracts=new Map();
    for(const value of options.decisionContracts) {
      if(!text(value.id)||!text(value.version)||!text(value.criteria)||typeof value.qualifiedForMain!=='boolean'||typeof value.batchIndependent!=='boolean'
        ||!Array.isArray(value.candidates)||value.candidates.length<2||value.candidates.some(c=>!text(c.id)||!text(c.description)||!actions.includes(c.action))
        ||new Set(value.candidates.map(c=>c.id)).size!==value.candidates.length||this.contracts.has(value.id))invalid('Unique versioned proactive decision contracts required');
      this.contracts.set(value.id,structuredClone(value));
    }
  }
  private seal(state:ProactiveCheckpoint):string {
    const payload=Buffer.from(JSON.stringify(state)).toString('base64url');
    return payload+'.'+createHmac('sha256',this.secret).update('proactive-v1:'+payload).digest('base64url');
  }
  private open(checkpoint:string):ProactiveCheckpoint {
    const parts=checkpoint.split('.');if(parts.length!==2)invalid('Invalid proactive checkpoint');
    const expected=createHmac('sha256',this.secret).update('proactive-v1:'+parts[0]).digest(),actual=Buffer.from(parts[1]!,'base64url');
    if(actual.length!==expected.length||!timingSafeEqual(expected,actual))invalid('Proactive checkpoint integrity failed');
    let state:ProactiveCheckpoint;try{state=JSON.parse(Buffer.from(parts[0]!,'base64url').toString()) as ProactiveCheckpoint;}catch{return invalid('Invalid proactive checkpoint payload');}
    if(state.version!==1)invalid('Unsupported proactive checkpoint');return state;
  }
  private active(request:ProactiveAdvanceRequest):void {
    if(!(request.signal instanceof AbortSignal)||!date(request.deadline)||!date(request.taskDeadline))invalid('Original task lifetime and cancellation required');
    if(request.signal.aborted)throw new ProtocolError('CANCELLED','Proactive advance cancelled');
    if(this.now()>=Math.min(Date.parse(request.deadline),Date.parse(request.taskDeadline)))throw new ProtocolError('TIMEOUT','Original proactive task deadline expired');
  }
  private timing(state:ProactiveCheckpoint,request:ProactiveAdvanceRequest,stage:string,itemIds:readonly string[],startedAt:string):void {
    const finishedAtUtc=new Date(this.now()).toISOString(),value={stage,requestId:request.requestId,itemIds:[...itemIds],startedAtUtc:startedAt,
      finishedAtUtc,wallMs:Math.max(0,Date.parse(finishedAtUtc)-Date.parse(startedAt))};
    state.timeline.push(value);try{this.options.onStage?.(structuredClone(value));}catch{/* Timeline remains in the signed checkpoint if metrics delivery fails. */}
  }
  private capable(request:ProactiveAdvanceRequest,kind:ProactiveCapabilityKind):ProactiveHostCapability|undefined {
    return request.availableCapabilities.find(cap=>cap.kind===kind);
  }
  private emit(state:ProactiveCheckpoint,request:ProactiveAdvanceRequest,items:ProactiveWorkItem[],kind:ProactiveCapabilityKind,args:Record<string,unknown>):ProactiveHostProposal|undefined {
    const cap=this.capable(request,kind);
    if(!cap) {for(const item of items){item.state='blocked';item.reason='capability_unavailable:'+kind;}return;}
    if(cap.location==='local_device'&&!request.hostAvailability.localDevice||cap.location==='cloud_persistent'&&!request.hostAvailability.cloudPersistentHost) {
      for(const item of items){item.state='waiting_device';item.reason=cap.location==='local_device'?'local_device_offline':'no_actual_cloud_persistent_host';}return;
    }
    const itemIds=items.map(item=>item.itemId),argumentsDigest=proactiveWorkflowDigest(args),stage=items[0]!.stage as ProactiveHostProposal['stage'];
    const operationId='proactive-'+proactiveWorkflowDigest([state.taskId,state.controlRevision,itemIds,stage,items.map(item=>item.attempt),argumentsDigest]);
    if(state.proposals[operationId])throw new ProtocolError('REVISION_CONFLICT','Original proactive operation must be reconciled, never resubmitted');
    const proposal:ProactiveHostProposal={proposalId:operationId,operationId,itemIds,stage,capabilityRef:cap.ref,capabilityKind:kind,effect:cap.effect,
      location:cap.location,arguments:structuredClone(args),argumentsDigest,originControlRevision:state.controlRevision,taskDeadline:state.taskDeadline,createdAt:new Date(this.now()).toISOString()};
    state.proposals[operationId]=proposal;
    for(const item of items){item.pendingProposalId=operationId;item.state='waiting_host';delete item.reason;item.attempt++;}
    this.timing(state,request,'proposal:'+stage,itemIds,proposal.createdAt);return proposal;
  }
  private async ingest(state:ProactiveCheckpoint,request:ProactiveAdvanceRequest):Promise<void> {
    for(const input of request.responsibilities??[]) {
      const value=structuredClone(input);
      if(!text(value.id)||!Number.isSafeInteger(value.revision)||value.revision<1||!text(value.conversationId)
        ||!['explicit_instruction','inferred_interest'].includes(value.authority)||!refs(value.goalRefs)||!refs(value.scopeRefs)
        ||value.authority==='inferred_interest'&&value.scopeRefs.length>0||!Array.isArray(value.sourceQuotes)
        ||value.authority==='explicit_instruction'&&!value.sourceQuotes.length
        ||value.sourceQuotes.some(q=>!text(q.messageId)||!text(q.conversationId)||!text(q.quoteRef)||!sha(q.sha256)))invalid('Responsibility quote/Goal/authority references invalid');
      if(!await this.options.verifyResponsibility(value,request))throw new ProtocolError('UNAUTHORIZED','Responsibility has no trusted original source binding');
      this.active(request);const prior=state.responsibilities[value.id];
      if(prior&&(value.revision<prior.revision||value.revision===prior.revision&&proactiveWorkflowDigest(value)!==proactiveWorkflowDigest(prior)))
        throw new ProtocolError('REVISION_CONFLICT','Responsibility source revision changed');
      state.responsibilities[value.id]=value;
    }
    if(['cancel_requested','cancelled'].includes(state.mode)&&(request.events?.length??0)>0)throw new ProtocolError('REVISION_CONFLICT','Cancelled workflow cannot accept new work');
    for(const input of request.events??[]) {
      const event=structuredClone(input);
      if(!text(event.eventId)||!['connector','user_instruction','subtask_feedback','wake'].includes(event.entry)||!text(event.conversationId)
        ||![event.sourceId,event.entityRef,event.sourceVersion,event.payloadRef,event.contractRef].every(text)||!sha(event.payloadDigest)
        ||!date(event.observedAt)||Date.parse(event.observedAt)>this.now()||event.expiresAt!==undefined&&!date(event.expiresAt)
        ||!['upsert','delete','retract','correction'].includes(event.change)||!['important','normal','unknown'].includes(event.priority)
        ||![event.anchorRefs,event.responsibilityRefs,event.goalRefs,event.evidenceRefs].every(refs)||!event.evidenceRefs.length)
        invalid('Four-entry source event requires original version/anchors/evidence');
      if(!await this.options.verifyEvent(event,request))throw new ProtocolError('UNAUTHORIZED','Source event is not persisted trusted connector/user/child/wake Evidence');
      this.active(request);const {proof:_,...body}=event,digest=proactiveWorkflowDigest(body),prior=state.eventDigests[event.eventId];
      if(prior!==undefined) {if(prior!==digest)throw new ProtocolError('REVISION_CONFLICT','Original source event identity changed');continue;}
      const itemId='item-'+proactiveWorkflowDigest([event.sourceId,event.entityRef,event.sourceVersion,event.payloadDigest]),family=Object.values(state.items)
        .filter(item=>item.sourceId===event.sourceId&&item.entityRef===event.entityRef);
      const conflict=family.some(item=>item.sourceVersion===event.sourceVersion&&item.payloadDigest!==event.payloadDigest
        ||item.sourceVersion!==event.sourceVersion&&event.previousVersion!==item.sourceVersion);
      for(const item of family)if(item.sourceVersion!==event.sourceVersion||item.payloadDigest!==event.payloadDigest) {
        item.sourceConflict||=conflict;
        if(item.state!=='done'&&item.state!=='cancelled') {
          item.needsRefresh=true;
          if(item.pendingProposalId){item.state='waiting_reconciliation';item.reason='source_changed_after_proposal_requires_original_readback';}
          else {item.state='blocked';item.reason='superseded_source_version_retained';}
        }
      }
      state.events[event.eventId]=event;state.eventDigests[event.eventId]=digest;
      const existing=state.items[itemId];
      if(existing) {
        if(existing.contractRef!==event.contractRef)throw new ProtocolError('REVISION_CONFLICT','Merged source changed its judgment contract');
        existing.eventRefs=unique([...existing.eventRefs,event.eventId]);existing.responsibilityRefs=unique([...existing.responsibilityRefs,...event.responsibilityRefs]);
        existing.goalRefs=unique([...existing.goalRefs,...event.goalRefs]);if(event.priority==='important')existing.priority='important';
      } else state.items[itemId]={itemId,eventRefs:[event.eventId],sourceId:event.sourceId,entityRef:event.entityRef,sourceVersion:event.sourceVersion,
        payloadDigest:event.payloadDigest,contractRef:event.contractRef,responsibilityRefs:[...event.responsibilityRefs],goalRefs:[...event.goalRefs],priority:event.priority,
        sourceConflict:conflict,needsRefresh:event.expiresAt!==undefined&&Date.parse(event.expiresAt)<=this.now(),stage:'retrieve',state:'ready',evidenceRefs:[...event.evidenceRefs],attempt:0};
    }
  }
  private applySelection(item:ProactiveWorkItem,value:ProactiveSelection,stage:'laya'|'teacher'):void {
    const contract=this.contracts.get(item.contractRef),candidate=contract?.candidates.find(c=>c.id===value.candidateId)!;
    if(!candidate||Object.keys(value).some(key=>!['itemId','candidateId','decisionRef','decidedBy','uncertain','complex','importance','authorityRequired'].includes(key))
      ||!text(value.decisionRef)||typeof value.uncertain!=='boolean'||typeof value.complex!=='boolean'||typeof value.authorityRequired!=='boolean'
      ||!['important','normal','irrelevant'].includes(value.importance)
      ||stage==='laya'&&!['laya','verified_experience'].includes(value.decidedBy)||stage==='teacher'&&value.decidedBy!=='deepseek')invalid('Decision must select an original contract candidate with actual provenance');
    if(stage==='laya') {
      item.candidateSelection=structuredClone(value);
      if(!contract!.qualifiedForMain||value.uncertain||value.complex||item.sourceConflict||item.priority==='important'&&candidate.action==='ignore'
        ||candidate.action==='ignore'&&value.importance!=='irrelevant') {item.stage='teacher';item.state='ready';item.reason='laya_candidate_requires_teacher';return;}
    }
    item.selection=structuredClone(value);
    item.action=value.authorityRequired||value.uncertain||candidate.action==='ignore'&&(item.priority==='important'||value.importance!=='irrelevant')?'request_user':candidate.action;
    item.stage=['ignore','defer'].includes(item.action)?'update':'action';item.state='ready';
    if(item.action==='ignore'||item.action==='defer') {
      item.outcome=item.action==='ignore'?'completed':'pending';
      item.actionResult={status:item.outcome,resultRef:value.decisionRef};
    }
  }
  private async admit(state:ProactiveCheckpoint,request:ProactiveAdvanceRequest):Promise<void> {
    for(const input of request.receipts??[]) {
      const receipt=structuredClone(input),proposal=state.proposals[receipt.operationId]!;
      if(!proposal||receipt.proposalId!==proposal.proposalId||receipt.argumentsDigest!==proposal.argumentsDigest
        ||!['confirmed','failed','unknown'].includes(receipt.state)||!date(receipt.observedAt)
        ||Date.parse(receipt.observedAt)<Date.parse(proposal.createdAt)||Date.parse(receipt.observedAt)>this.now()
        ||!refs(receipt.evidenceRefs)||!receipt.evidenceRefs.length)invalid('Receipt has no original operation/version/time/Evidence');
      if(!await this.options.verifyReceipt(receipt,proposal,request))throw new ProtocolError('UNAUTHORIZED','Proactive host receipt not verified');
      this.active(request);const digest=proactiveWorkflowDigest(receipt),prior=state.receiptDigests[receipt.operationId];
      if(prior===digest)continue;
      if(prior!==undefined&&state.receiptStates[receipt.operationId]!=='unknown')throw new ProtocolError('REVISION_CONFLICT','Confirmed/failed operation cannot acquire a different result');
      state.receiptDigests[receipt.operationId]=digest;state.receiptStates[receipt.operationId]=receipt.state;
      state.receiptHistory.push({operationId:receipt.operationId,state:receipt.state,digest,evidenceRefs:[...receipt.evidenceRefs],observedAt:receipt.observedAt});
      this.timing(state,request,'receipt:'+proposal.stage+':'+receipt.state,proposal.itemIds,proposal.createdAt);
      let selections:ProactiveSelection[]=[];
      if(receipt.state==='confirmed'&&(proposal.stage==='laya'||proposal.stage==='teacher')) {
        const result=receipt.result as {selections?:ProactiveSelection[]};
        if(!Array.isArray(result?.selections)||result.selections.length!==proposal.itemIds.length
          ||new Set(result.selections.map(s=>s.itemId)).size!==proposal.itemIds.length||result.selections.some(s=>!proposal.itemIds.includes(s.itemId)))
          invalid('Independent decision batch must return exactly its original item IDs');
        selections=result.selections!;
      }
      for(const id of proposal.itemIds) {
        const item=state.items[id]!;item.evidenceRefs=unique([...item.evidenceRefs,...receipt.evidenceRefs]);
        if(item.pendingProposalId!==proposal.operationId)continue; // Late Laya readback never overwrites a teacher's newer pending operation.
        if(receipt.state==='unknown') {
          if(proposal.stage==='laya') {delete item.pendingProposalId;item.stage='teacher';item.state='ready';item.reason='laya_result_unknown_no_laya_retry';}
          else {item.state='waiting_reconciliation';item.reason='original_operation_unknown_no_replay';}
          continue;
        }
        delete item.pendingProposalId;
        if(['cancel_requested','cancelled'].includes(state.mode)){item.state='cancelled';continue;}
        if(proposal.originControlRevision!==state.controlRevision||item.reason==='source_changed_after_proposal_requires_original_readback'
          ||item.needsRefresh&&proposal.stage!=='retrieve') {item.state='blocked';item.reason='stale_revision_or_source_result_retained';continue;}
        if(receipt.state==='failed') {
          if(proposal.stage==='laya'){item.stage='teacher';item.state='ready';item.reason='laya_unavailable_teacher_takeover';}
          else {item.state='blocked';item.reason='actual_host_failure:'+proposal.stage;}
          continue;
        }
        if(proposal.stage==='retrieve') {
          const context=receipt.result as ProactiveContextReadback;
          if(!text(context?.contextRef)||!plain(context.sourceVersions)||Object.values(context.sourceVersions).some(v=>!text(v))
            ||context.sourceVersions[item.sourceId]!==item.sourceVersion||!Array.isArray(context.sourceQuotes)
            ||context.sourceQuotes.some(q=>!text(q.messageId)||!text(q.conversationId)||!text(q.quoteRef)||!sha(q.sha256))
            ||![context.goalRefs,context.memoryRefs,context.experienceRefs,context.scopeRefs].every(refs)
            ||context.dependsOnItemIds!==undefined&&!refs(context.dependsOnItemIds))invalid('Original quote/Goal/memory/experience readback and source version required');
          item.context=structuredClone(context);item.needsRefresh=false;item.stage='laya';item.state='ready';
          for(const current of context.itemReadbacks??[]) {
            if(!text(current.itemId)||!text(current.resultRef)||!['completed','changed','pending','blocked','waiting_user'].includes(current.status))invalid('Actual related-item TaskRuntime readback invalid');
            const related=state.items[current.itemId];
            // A child-feedback read may refresh a previously accepted pending result, never reconcile an unknown write.
            if(related&&related.stage==='done'&&!related.pendingProposalId) {
              related.actionResult={status:current.status,resultRef:current.resultRef};related.outcome=current.status;
              related.state=current.status==='waiting_user'?'waiting_user':current.status==='blocked'?'blocked':current.status==='pending'?'waiting_host':'done';
              related.evidenceRefs=unique([...related.evidenceRefs,...receipt.evidenceRefs]);
            }
          }
        } else if(proposal.stage==='laya'||proposal.stage==='teacher')this.applySelection(item,selections.find(s=>s.itemId===id)!,proposal.stage);
        else if(proposal.stage==='action') {
          const value=receipt.result as ProactiveActionReadback;
          if(!value||!['completed','changed','pending','blocked','waiting_user'].includes(value.status)||!text(value.resultRef))invalid('Action receipt must distinguish actual completion/change/pending/block');
          if(value.nextWake&&(!date(value.nextWake.runAt)||!text(value.nextWake.reason)||!text(value.nextWake.timeZone)||!['run_once','skip'].includes(value.nextWake.missedRunPolicy)))invalid('Wake needs an actual reason and existing Scheduler parameters');
          item.actionResult=structuredClone(value);item.outcome=value.status;item.stage='update';item.state='ready';
        } else if(proposal.stage==='update') {
          const result=receipt.result as {itemId?:string;stateRef?:string};if(result?.itemId!==id||!text(result.stateRef))invalid('Item update needs actual persisted state readback');
          item.stage=item.actionResult?.nextWake?'wake':'done';item.state=item.stage==='wake'?'ready':item.outcome==='waiting_user'?'waiting_user':item.outcome==='blocked'?'blocked':item.outcome==='pending'?'waiting_host':'done';
        } else {
          const result=receipt.result as {scheduleId?:string;runAt?:string;state?:string};
          if(!text(result?.scheduleId)||result.runAt!==item.actionResult?.nextWake?.runAt||!['pending','fired','skipped','cancelled'].includes(result.state??''))invalid('Wake must read back the actual existing Scheduler entry');
          item.stage='done';item.state=item.outcome==='waiting_user'?'waiting_user':item.outcome==='blocked'?'blocked':item.outcome==='pending'?'waiting_host':'done';
        }
      }
    }
  }
  async advance(input:ProactiveAdvanceRequest):Promise<ProactiveWorkflowResult> {
    const request:ProactiveAdvanceRequest={...input,events:structuredClone(input.events??[]),responsibilities:structuredClone(input.responsibilities??[]),
      receipts:structuredClone(input.receipts??[]),availableCapabilities:structuredClone(input.availableCapabilities),hostAvailability:structuredClone(input.hostAvailability),
      ...(input.control?{control:structuredClone(input.control)}:{})};
    this.active(request);const startedAt=new Date(this.now()).toISOString();
    if(!text(request.taskId)||!text(request.sessionId)||!text(request.requestId)||!Number.isSafeInteger(request.controlRevision)||request.controlRevision<0
      ||!request.hostAvailability||typeof request.hostAvailability.localDevice!=='boolean'||typeof request.hostAvailability.cloudPersistentHost!=='boolean'
      ||!Array.isArray(request.availableCapabilities)||request.availableCapabilities.some(cap=>!kinds.includes(cap.kind)||!text(cap.ref)
        ||!['local_device','cloud_persistent'].includes(cap.location)||!['read','write'].includes(cap.effect)
        ||['retrieve_context','local_decision_batch','teacher_decision'].includes(cap.kind)&&cap.effect!=='read'
        ||cap.kind==='local_decision_batch'&&cap.location!=='local_device')
      ||new Set(request.availableCapabilities.map(cap=>cap.kind)).size!==request.availableCapabilities.length)invalid('Trusted proactive task and capability snapshot required');
    const state:ProactiveCheckpoint=request.checkpoint?this.open(request.checkpoint):{version:1,taskId:request.taskId,sessionId:request.sessionId,
      controlRevision:request.controlRevision,taskDeadline:request.taskDeadline,advanceRevision:0,mode:'attended',events:{},eventDigests:{},responsibilities:{},
      items:{},proposals:{},receiptDigests:{},receiptStates:{},receiptHistory:[],controlDigests:{},timeline:[],lastReturnReceiptIds:[]};
    if(state.taskId!==request.taskId||state.sessionId!==request.sessionId||state.taskDeadline!==request.taskDeadline||request.controlRevision<state.controlRevision)
      throw new ProtocolError('REVISION_CONFLICT','Original proactive task/session/revision/deadline cannot change');
    if(request.controlRevision!==state.controlRevision&&!request.control)throw new ProtocolError('REVISION_CONFLICT','Control revision requires its original trusted command');
    let returning=false;
    if(request.control) {
      const command=request.control,digest=proactiveWorkflowDigest(command),prior=state.controlDigests[command.commandId];
      if(!text(command.commandId)||!['pause','resume','cancel','enter_unattended','return'].includes(command.action)||!refs(command.evidenceRefs)||!command.evidenceRefs.length)
        invalid('Actual host/user control Evidence required');
      if(prior!==undefined&&prior!==digest)throw new ProtocolError('REVISION_CONFLICT','Control command identity changed');
      if(prior!==undefined&&request.controlRevision!==state.controlRevision)throw new ProtocolError('REVISION_CONFLICT','Old control command cannot change a newer revision');
      returning=command.action==='return';
      if(prior===undefined) {
        if(!await this.options.verifyControl(command,request))throw new ProtocolError('UNAUTHORIZED','Proactive control is not verified');
        this.active(request);
        if(['cancel_requested','cancelled'].includes(state.mode)&&command.action!=='cancel')throw new ProtocolError('REVISION_CONFLICT','Cancelled workflow cannot be resumed');
        state.controlRevision=request.controlRevision;state.controlDigests[command.commandId]=digest;
        state.mode=command.action==='pause'?'paused':command.action==='cancel'?'cancel_requested':command.action==='enter_unattended'?'unattended':'attended';
        returning=command.action==='return';this.timing(state,request,'control:'+command.action,[],startedAt);
      }
    }
    await this.ingest(state,request);await this.admit(state,request);this.active(request);
    state.advanceRevision++;
    if(state.mode==='cancel_requested') {
      for(const item of Object.values(state.items)) {if(item.pendingProposalId){item.state='waiting_reconciliation';item.reason='cancel_requires_original_host_stop_or_result';}else item.state='cancelled';}
      if(!Object.values(state.items).some(item=>item.pendingProposalId))state.mode='cancelled';
    }
    let summary:ProactiveWorkflowResult['returnSummary'];
    if(returning) {
      const items=Object.values(state.items),operationIds=Object.keys(state.receiptDigests);
      summary={done:items.filter(i=>i.state==='done'&&i.outcome!=='changed').map(i=>i.itemId),changed:items.filter(i=>i.state==='done'&&i.outcome==='changed').map(i=>i.itemId),
        pending:items.filter(i=>!['done','blocked','cancelled'].includes(i.state)).map(i=>i.itemId),blocked:items.filter(i=>i.state==='blocked').map(i=>i.itemId),
        newEvidenceOperationIds:operationIds.filter(id=>!state.lastReturnReceiptIds.includes(id)),replayedNotifications:0};
      state.lastReturnReceiptIds=operationIds;
    }
    const proposals:ProactiveHostProposal[]=[];
    if(!returning&&['attended','unattended'].includes(state.mode)) {
      const decisionGroups=new Map<string,ProactiveWorkItem[]>();
      for(const item of Object.values(state.items)) {
        if(item.reason==='independent_question_dependencies_unsettled'&&item.context?.dependsOnItemIds?.every(id=>state.items[id]?.state==='done')) {
          item.state='ready';delete item.reason;
        }
        if(item.pendingProposalId||!['ready','waiting_device'].includes(item.state)&&!(item.state==='blocked'&&item.reason?.startsWith('capability_unavailable:')))continue;
        if(item.stage==='done')continue;
        const base={itemId:item.itemId,eventRefs:[...item.eventRefs],responsibilityRefs:[...item.responsibilityRefs],goalRefs:[...item.goalRefs],
          source:{sourceId:item.sourceId,entityRef:item.entityRef,version:item.sourceVersion,payloadDigest:item.payloadDigest},taskDeadline:state.taskDeadline};
        let proposal:ProactiveHostProposal|undefined;
        if(item.stage==='retrieve')proposal=this.emit(state,request,[item],'retrieve_context',{...base,
          requested:['source_quotes','goals','memory','experience','existing_scope_refs'],needsRefresh:item.needsRefresh,
          responsibilities:item.responsibilityRefs.map(id=>state.responsibilities[id]).filter(Boolean),authorityBoundary:'Quotes/inferred interest are context, never permission'});
        else if(item.stage==='laya'||item.stage==='teacher') {
          const contract=this.contracts.get(item.contractRef);
          if(!contract){item.state='blocked';item.reason='decision_contract_unavailable';continue;}
          if(item.context?.dependsOnItemIds?.some(id=>!state.items[id]||state.items[id]!.state!=='done')) {item.state='waiting_host';item.reason='independent_question_dependencies_unsettled';continue;}
          if(item.stage==='laya'&&(!this.capable(request,'local_decision_batch')||!request.hostAvailability.localDevice)) {
            if(!request.hostAvailability.localDevice&&!request.hostAvailability.cloudPersistentHost){item.state='waiting_device';item.reason='local_laya_offline_no_cloud_persistent_host';continue;}
            item.stage='teacher';item.state='ready';item.reason='local_laya_unavailable_not_a_verified_choice';
            this.timing(state,request,'laya_unavailable',[item.itemId],new Date(this.now()).toISOString());
          }
          const key=[item.stage,contract.id,contract.version,contract.batchIndependent?'independent':item.itemId].join(':');
          const group=decisionGroups.get(key)??[];group.push(item);decisionGroups.set(key,group);continue;
        } else if(item.stage==='action')proposal=this.emit(state,request,[item],item.action!,{...base,contextRef:item.context!.contextRef,
          decision:structuredClone(item.selection!),effectiveAction:item.action,layaCandidate:item.candidateSelection??null,
          scopeRefs:item.context!.scopeRefs,authorityBoundary:'Existing Runtime Policy/ToolGateway decides each operation; model suggestions grant no authorization'});
        else if(item.stage==='update')proposal=this.emit(state,request,[item],'update_item',{...base,actualOutcome:item.outcome,
          resultRef:item.actionResult!.resultRef,evidenceRefs:[...item.evidenceRefs],decisionRef:item.selection!.decisionRef});
        else if(item.stage==='wake')proposal=this.emit(state,request,[item],'schedule_wake',{...base,wake:item.actionResult!.nextWake!,
          taskIdempotencyKey:'proactive-wake-'+proactiveWorkflowDigest([state.taskId,item.itemId,item.actionResult!.nextWake]),scheduler:'existing_TaskRuntime_only'});
        if(proposal)proposals.push(proposal);
      }
      for(const group of decisionGroups.values()) {
        const contract=this.contracts.get(group[0]!.contractRef)!;
        const proposal=this.emit(state,request,group,group[0]!.stage==='laya'?'local_decision_batch':'teacher_decision',{contract:structuredClone(contract),
          independentQuestions:group.map(item=>({itemId:item.itemId,contextRef:item.context!.contextRef,sourceVersions:item.context!.sourceVersions,
            eventRefs:item.eventRefs,responsibilityRefs:item.responsibilityRefs,goalRefs:item.goalRefs,sourceConflict:item.sourceConflict,
            layaCandidate:item.candidateSelection??null,candidateOnly:item.stage==='laya'&&!contract.qualifiedForMain})),
          authorityBoundary:'Selection only, never a user/Policy grant; important/unknown events must not be silently discarded'});
        if(proposal)proposals.push(proposal);
      }
    }
    this.active(request);this.timing(state,request,'advance',[],startedAt);
    return {profileAddon:'proactive.responsibility.v1',verification:'unverified',checkpoint:this.seal(state),advanceRevision:state.advanceRevision,
      taskDeadline:state.taskDeadline,mode:state.mode,items:structuredClone(state.items),proposals:structuredClone(proposals),timeline:structuredClone(state.timeline),
      ...(summary?{returnSummary:summary}:{}),cancellationRequirements:Object.values(state.items).filter(item=>!!item.pendingProposalId&&item.state==='waiting_reconciliation')
        .map(item=>{const p=state.proposals[item.pendingProposalId!]!;return {operationId:p.operationId,effect:p.effect,reason:item.reason!};})};
  }
}
