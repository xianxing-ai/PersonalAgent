import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {MAX_COORDINATION_INITIAL_QUERY_BYTES,validateToolValue} from '@personal-agent/contracts';
import type {TaskSnapshot} from '@personal-agent/contracts';
import {parseCoordinationAvailableTools} from '@personal-agent/coordination';
import type {TaskRuntime} from '../index.js';
import {EXECUTION_CAPACITY_CHECKPOINT,MAX_OMITTED_TOOL_SUMMARIES,MAX_PRIOR_EXECUTION_CONTINUATIONS,
  assertExecutionCapacityReceiptPrefix,resolveExecutionStepLimit} from './execution-capacity.js';
import type {ExecutionCapacityReceipt,OmittedExecutionSummary} from './execution-capacity.js';
import {TOOL_DISCOVERY_DESCRIPTOR,TOOL_DISCOVERY_NAME,TOOL_DISCOVERY_VERSION} from './tool-discovery.js';

export interface RuntimeStartupHarnessEventOrigin {
  deliveryId:string;eventDigest:string;sourceTaskId:string;originalParentTaskId:string;
}
export interface RuntimeStartupHarnessEventScope {
  deadline:string;configurationRef:string;fence:string;assertCurrent():void;
}
export interface RuntimeStartupHarnessEventRequest {
  taskId:string;expectedRevision:number;conversationId:string;origin:RuntimeStartupHarnessEventOrigin;
  phase:'created_root'|'continuation';
}
export interface RuntimeStartupResumeRequest {
  taskId:string; expectedRevision:number; deadline:string;
  mode:'before_first_send'|'confirmed_read';
  /** Only the original atomically accepted root before its first enqueue. */
  harnessEventOrigin?:RuntimeStartupHarnessEventOrigin;
  /** Call synchronously immediately before the original Runtime worker handoff. */
  assertUnchanged():void;
}
export interface RuntimeStartupRecoveryOptions {
  runtime:TaskRuntime;
  configurationRef:string;
  /** True only for the exact bound WSS transport which persists intent before sending. */
  durableCloudDispatch:boolean;
  /** The Desktop singleton/runtime owner must hold exclusive ownership of this database. */
  exclusiveOwner:boolean;
  /** Pure current readback of the original durable event, responsibility, native lease and configuration. */
  canResumeHarnessEvent?:(request:RuntimeStartupHarnessEventRequest)=>RuntimeStartupHarnessEventScope|undefined;
  resumeOriginalTask(request:RuntimeStartupResumeRequest):{accepted:boolean}|Promise<{accepted:boolean}>;
  now?:()=>Date;
}
export interface RuntimeStartupRecoveryItem {
  taskId:string; revision:number;
  classification:'active'|'approval_required'|'unknown'|'confirmed_write'|'parent_wait'|'manual'
    |'before_first_send'|'confirmed_read'|'terminal';
  reason:string;
  outcome:'retained'|'resumed'|'cancelled'|'expired';
}
export interface RuntimeStartupRecoveryReport {version:'1.0'; items:RuntimeStartupRecoveryItem[];}
export interface RuntimeStartupRecovery {
  recover():Promise<RuntimeStartupRecoveryReport>;
  inspect(taskId:string):RuntimeStartupRecoveryItem;
}

const TERMINAL=new Set(['succeeded','failed','cancelled']);
const KEY='runtime-startup-recovery:v1';
const DISCOVERY_POOL='competition-tool-discovery-pool:v1',DISCOVERY_SELECTION='competition-tool-discovery-selection:';
const CAPACITY_DECISION='competition-capacity-decision:v1',CONTINUATION_WINDOW='competition-continuation-window:v1',
  SENT_WINDOW='competition-sent-continuation-window:v1';
const BASE_KEYS=new Set(['runtime-interruption:v1',KEY,'application-profile','application-goal','application-deadline',
  'competition-configuration-binding','competition-max-steps','competition-context:v1','competition-tool-catalog',
  'competition-loop','competition-confirmed-replay','competition-cloud-inflight','competition-cloud-unknown',
  'competition-cloud-received','competition-cloud-request-identity','competition-cloud-dispatch-binding',
  'competition-cloud-dispatch-context','execution-model','task-thinking','task-model-preference','required-subagent-delegation:v1',
  'subtask-parent','subtask-execution-binding','subtask-coordination-binding','subtask-tools-binding','subtask-thinking-binding',
  'subtask-progress-records','subagent-parent-wait','subagent-current-summary','harness-event-origin','developer-harness-executor:v1',
  EXECUTION_CAPACITY_CHECKPOINT,CAPACITY_DECISION,CONTINUATION_WINDOW,SENT_WINDOW,DISCOVERY_POOL]);
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const count=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const positive=(value:unknown):value is number=>count(value)&&value>0;
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const exact=(value:unknown,required:string[],optional:string[]=[]):value is Record<string,unknown>=>object(value)
  &&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const fingerprint=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function omissionMetadata(value:unknown):value is OmittedExecutionSummary {
  if(!exact(value,['count','digest','tools','unlisted'])||!count(value.count)||!hash(value.digest)
    ||!Array.isArray(value.tools)||value.tools.length>MAX_OMITTED_TOOL_SUMMARIES
    ||!exact(value.unlisted,['count','digest'])||!count(value.unlisted.count)||!hash(value.unlisted.digest))return false;
  let total=value.unlisted.count;const names=new Set<string>();
  for(const tool of value.tools){
    if(!exact(tool,['toolName','toolVersion','count','digest'])||typeof tool.toolName!=='string'
      ||!/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(tool.toolName)||typeof tool.toolVersion!=='string'
      ||!/^[0-9A-Za-z][0-9A-Za-z_.-]{0,63}$/.test(tool.toolVersion)||!positive(tool.count)||!hash(tool.digest))return false;
    const identity=JSON.stringify([tool.toolName,tool.toolVersion]);if(names.has(identity))return false;
    names.add(identity);total+=tool.count;
  }
  return Number.isSafeInteger(total)&&total===value.count;
}
/** Catalog pages may omit descriptions, but no structural Schema change is accepted. */
function withoutDescriptions(schema:Record<string,unknown>,keepRoot=false):Record<string,unknown> {
  const {description,...result}=schema;
  if(object(result.properties))result.properties=Object.fromEntries(Object.entries(result.properties)
    .map(([key,value])=>[key,withoutDescriptions(value as Record<string,unknown>)]));
  if(object(result.items))result.items=withoutDescriptions(result.items);
  return {...result,...(keepRoot&&typeof description==='string'?{description}:{})};
}
function reject(message:string):never {throw Object.assign(new Error(message),{code:'REVISION_CONFLICT'});}

/** Classifies the original durable tasks; execution remains in RuntimeApplication. */
export function createRuntimeStartupRecovery(options:RuntimeStartupRecoveryOptions):RuntimeStartupRecovery {
  const runtime=options.runtime,now=options.now??(()=>new Date());
  let recovery:Promise<RuntimeStartupRecoveryReport>|undefined;
  const inventory=(conversationId?:string):TaskSnapshot[]=>{
    const result:TaskSnapshot[]=[];let before:number|undefined,snapshot:number|undefined;
    do {
      const page=runtime.listTasks({limit:100,...(conversationId===undefined?{}:{conversationId}),
        ...(before===undefined?{}:{beforeSequence:before}),
        ...(snapshot===undefined?{}:{snapshotSequence:snapshot})});
      result.push(...page.items.filter(task=>conversationId===undefined||task.conversationId===conversationId));
      before=page.nextBeforeSequence;snapshot=page.snapshotSequence;
    }while(before!==undefined);
    return result;
  };
  const read=(taskId:string)=>{
    const task=runtime.getTask(taskId),keys=runtime.listCheckpointKeys(taskId);
    const checkpoints=Object.fromEntries(keys.filter(key=>key!==KEY).map(key=>[key,runtime.loadCheckpoint(taskId,key)]));
    const records=runtime.readToolExecutions(taskId),children=inventory(`desktop-subtask:${taskId}`);
    const parent=object(checkpoints['subtask-parent'])?checkpoints['subtask-parent']:undefined;
    let parentTask:TaskSnapshot|undefined;
    if(typeof parent?.parentTaskId==='string'){try{parentTask=runtime.getTask(parent.parentTaskId);}catch{/* Missing original parent stays manual. */}}
    const eventRoot=checkpoints['harness-event-origin']!==undefined?task
      :parentTask&&runtime.loadCheckpoint(parentTask.taskId,'harness-event-origin')!==undefined?parentTask:undefined;
    const origin=eventRoot?runtime.loadCheckpoint(eventRoot.taskId,'harness-event-origin'):undefined;
    let eventScope:{deadline:string;configurationRef:string;fence:string}|undefined;
    if(eventRoot&&typeof eventRoot.conversationId==='string'&&eventRoot.conversationId.trim().length>0
      &&object(origin)&&Object.keys(origin).sort().join(',')==='deliveryId,eventDigest,originalParentTaskId,sourceTaskId'
      &&['deliveryId','sourceTaskId','originalParentTaskId'].every(key=>typeof origin[key]==='string'&&(origin[key] as string).trim().length>0)
      &&typeof origin.eventDigest==='string'&&/^[a-f0-9]{64}$/.test(origin.eventDigest)
      &&runtime.findTaskByIdempotencyKey('harness-event-root:'+origin.deliveryId)?.taskId===eventRoot.taskId) {
      try {
        const scope=options.canResumeHarnessEvent?.({taskId:eventRoot.taskId,expectedRevision:eventRoot.revision,
          conversationId:eventRoot.conversationId,origin:origin as unknown as RuntimeStartupHarnessEventOrigin,
          phase:eventRoot.state==='created'?'created_root':'continuation'});
        if(scope&&scope.configurationRef===options.configurationRef&&typeof scope.fence==='string'&&scope.fence.length>0
          &&Number.isFinite(Date.parse(scope.deadline))&&typeof scope.assertCurrent==='function') {
          scope.assertCurrent();eventScope={deadline:scope.deadline,configurationRef:scope.configurationRef,fence:scope.fence};
        }
      } catch {/* Missing or stale original authority never becomes permission to enqueue. */}
    }
    return {task,keys,checkpoints,records,children,parent,parentTask,eventRoot,origin,eventScope,descriptors:runtime.readToolDescriptors()};
  };
  type RecoveryPlan={facts:ReturnType<typeof read>;item:RuntimeStartupRecoveryItem;deadline?:string;action?:'cancel'|'expire'|'resume'|undefined};
  /** New snapshots are recognized data, never an alternative execution or authorization proof. */
  const additionalCheckpointsSafe=(facts:ReturnType<typeof read>,stepLimit:number):boolean=>{
    const {task,checkpoints:cp,records,descriptors}=facts,capacity=cp[EXECUTION_CAPACITY_CHECKPOINT];
    const loop=cp['competition-loop'],receipts=object(loop)&&Array.isArray(loop.receipts)?loop.receipts:[];
    const originalProposal=(id:unknown)=>typeof id==='string'&&receipts.some(receipt=>object(receipt)&&object(receipt.proposal)
      &&receipt.proposal.proposalId===id);
    if(facts.keys.includes(EXECUTION_CAPACITY_CHECKPOINT)&&!object(capacity))return false;
    if(object(capacity)&&(!count(capacity.evaluatedReceiptCount)||capacity.evaluatedReceiptCount>receipts.length
      ||(capacity.extensions===0?capacity.evaluatedReceiptCount!==0:!positive(capacity.evaluatedReceiptCount))))return false;
    if(object(capacity)) {
      try {assertExecutionCapacityReceiptPrefix(capacity,receipts as ExecutionCapacityReceipt[]);}
      catch{return false;}
      // Capacity earned from reads remains bound to those original Runtime executions, not only a planner history digest.
      for(const receipt of receipts.slice(0,capacity.evaluatedReceiptCount as number)) {
        if(!object(receipt)||!object(receipt.proposal)||!object(receipt.proposal.arguments)||typeof receipt.runId!=='string')return false;
        const record=records.find(item=>item.evidenceId===receipt.runId);
        if(!record||record.toolName!==receipt.proposal.toolName||record.toolVersion!==receipt.proposal.toolVersion
          ||!runtime.matchesToolExecutionInput(record,{arguments:receipt.proposal.arguments,scopeRef:receipt.runId}))return false;
      }
    }
    const decision=cp[CAPACITY_DECISION];
    if(facts.keys.includes(CAPACITY_DECISION)&&(!object(capacity)||!exact(decision,['reason','step','windowEndStep'])
      ||!['extended','explicit_limit','unconfirmed_progress','no_confirmed_progress'].includes(decision.reason as string)
      ||!positive(decision.step)||decision.step>stepLimit||decision.windowEndStep!==stepLimit))return false;
    const window=cp[CONTINUATION_WINDOW];
    if(facts.keys.includes(CONTINUATION_WINDOW)&&(!object(capacity)
      ||!exact(window,['version','currentProposalId','originalReceiptCount','priorCount','omitted'])||window.version!=='1.0'
      ||!originalProposal(window.currentProposalId)||!positive(window.originalReceiptCount)||window.originalReceiptCount>receipts.length
      ||!count(window.priorCount)||window.priorCount>MAX_PRIOR_EXECUTION_CONTINUATIONS||!omissionMetadata(window.omitted)
      ||window.priorCount+window.omitted.count+1>window.originalReceiptCount))return false;
    const sent=cp[SENT_WINDOW];
    if(facts.keys.includes(SENT_WINDOW)&&(!object(capacity)
      ||!exact(sent,['version','currentProposalId','priorCount','queryBytes','additionallyOmitted'])||sent.version!=='1.0'
      ||!originalProposal(sent.currentProposalId)||!count(sent.priorCount)||sent.priorCount>MAX_PRIOR_EXECUTION_CONTINUATIONS
      ||!positive(sent.queryBytes)||sent.queryBytes>MAX_COORDINATION_INITIAL_QUERY_BYTES||!omissionMetadata(sent.additionallyOmitted)
      ||sent.priorCount+sent.additionallyOmitted.count>MAX_PRIOR_EXECUTION_CONTINUATIONS))return false;
    const selectionKeys=facts.keys.filter(key=>key.startsWith(DISCOVERY_SELECTION));
    if(!facts.keys.includes(DISCOVERY_POOL))return selectionKeys.length===0;
    const pool=cp[DISCOVERY_POOL],catalog=cp['competition-tool-catalog'];
    try {
      if(!exact(pool,['version','revision','deadline','digest','entries'])||pool.version!=='1.0'||!count(pool.revision)
        ||pool.revision>task.revision||pool.deadline!==cp['application-deadline']||!hash(pool.digest)||!Array.isArray(pool.entries)
        ||pool.digest!==fingerprint(pool.entries)||!exact(catalog,['revision','deadline','entries'],['discoveryRunId'])
        ||!count(catalog.revision)||catalog.revision<pool.revision||catalog.revision>task.revision||catalog.deadline!==pool.deadline)return false;
      // The full original pool can exceed one cloud page; validate each entry using the same public parser.
      const entries=pool.entries.map(entry=>parseCoordinationAvailableTools([entry])[0]!);
      if(!entries.some(entry=>entry.name===TOOL_DISCOVERY_NAME&&entry.version===TOOL_DISCOVERY_VERSION)
        ||!descriptors.some(tool=>tool.name===TOOL_DISCOVERY_NAME&&tool.version===TOOL_DISCOVERY_VERSION&&tool.sideEffect==='read')
        ||entries.some((entry,index)=>!descriptors.some(tool=>tool.name===entry.name&&tool.version===entry.version)
          ||entries.slice(0,index).some(prior=>prior.name===entry.name&&prior.version===entry.version)))return false;
      const originalEntries=(selected:unknown)=>parseCoordinationAvailableTools(selected).every(entry=>entries.some(original=>
        original.name===entry.name&&original.version===entry.version&&(isDeepStrictEqual(original.inputSchema,entry.inputSchema)
          ||isDeepStrictEqual(withoutDescriptions(original.inputSchema),entry.inputSchema)
          ||isDeepStrictEqual(withoutDescriptions(original.inputSchema,true),entry.inputSchema))));
      if(!originalEntries(catalog.entries)||!parseCoordinationAvailableTools(catalog.entries)
        .some(entry=>entry.name===TOOL_DISCOVERY_NAME&&entry.version===TOOL_DISCOVERY_VERSION))return false;
      for(const key of selectionKeys){
        const runId=key.slice(DISCOVERY_SELECTION.length),prefix=`competition-tool-${task.taskId}-`,selection=cp[key];
        const step=runId.startsWith(prefix)?Number(runId.slice(prefix.length)):NaN;
        if(!positive(step)||step>stepLimit||runId!==prefix+step
          ||!exact(selection,['version','poolDigest','arguments','entries','result'])||selection.version!=='1.0'
          ||selection.poolDigest!==pool.digest||!object(selection.arguments)||!originalEntries(selection.entries))return false;
        validateToolValue(TOOL_DISCOVERY_DESCRIPTOR.inputSchema,selection.arguments);
        validateToolValue(TOOL_DISCOVERY_DESCRIPTOR.outputSchema,selection.result);
        const selected=parseCoordinationAvailableTools(selection.entries),record=records.find(item=>item.evidenceId===runId),cache=cp['tool-result-'+runId];
        if(selected[0]?.name!==TOOL_DISCOVERY_NAME||selected[0]?.version!==TOOL_DISCOVERY_VERSION||!object(selection.result)
          ||selection.result.catalogRef!==pool.digest||selection.result.query!==selection.arguments.query
          ||!isDeepStrictEqual(selection.result.selectedTools,selected.slice(1).map(({name,version})=>({name,version}))))return false;
        if(!record||record.toolName!==TOOL_DISCOVERY_NAME||record.toolVersion!==TOOL_DISCOVERY_VERSION
          ||record.state!=='confirmed'||record.policyDecision!=='allow'||!record.executionStarted||!object(cache)
          ||!isDeepStrictEqual(cache.result,selection.result)
          ||!runtime.matchesToolExecutionInput(record,{arguments:selection.arguments,scopeRef:runId}))return false;
      }
      return catalog.discoveryRunId===undefined||typeof catalog.discoveryRunId==='string'
        &&selectionKeys.includes(DISCOVERY_SELECTION+catalog.discoveryRunId)
        &&object(cp[DISCOVERY_SELECTION+catalog.discoveryRunId])
        &&isDeepStrictEqual((cp[DISCOVERY_SELECTION+catalog.discoveryRunId] as Record<string,unknown>).entries,catalog.entries);
    }catch{return false;}
  };
  const plan=(taskId:string):RecoveryPlan=>{
    const facts=read(taskId),{task,checkpoints:cp,records,children,parent,parentTask,eventRoot,eventScope,descriptors}=facts;
    let classification:RuntimeStartupRecoveryItem['classification']='manual',reason='unsupported_original_checkpoint';
    const finish=(kind:RuntimeStartupRecoveryItem['classification'],why:string)=>({facts,
      item:{taskId,revision:task.revision,classification:kind,reason:why,outcome:'retained' as const}});
    if(TERMINAL.has(task.state))return finish('terminal','already_terminal');
    if(runtime.isTaskActive(taskId))return finish('active','original_worker_is_active');
    if(task.state==='waiting_approval')return finish('approval_required','original_approval_is_preserved');
    if(eventRoot&&!eventScope)return finish('manual','original_event_responsibility_or_native_lease_is_unavailable');
    if(eventRoot?.taskId===taskId&&task.state==='created'&&facts.keys.every(key=>key===KEY||key==='harness-event-origin')
      &&typeof task.goal==='string'&&task.goal.trim().length>0&&records.length===0&&children.length===0&&eventScope) {
      if(task.cancelRequested||now().getTime()>=Date.parse(eventScope.deadline))
        return {...finish('before_first_send','original_event_root_has_no_execution'),deadline:eventScope.deadline,
          action:task.cancelRequested?'cancel':'expire'};
      return {...finish('before_first_send','original_event_acceptance_preceded_enqueue'),deadline:eventScope.deadline,action:'resume'};
    }
    if(cp['application-profile']!=='huawei_ict_agentarts' || cp['competition-configuration-binding']!==options.configurationRef)
      return finish('manual','original_profile_or_configuration_differs');
    if(facts.keys.some(key=>!BASE_KEYS.has(key)&&!key.startsWith('tool-result-')&&!key.startsWith('routine-tool-policy:')
      &&!key.startsWith(DISCOVERY_SELECTION)))
      return finish('manual','checkpoint_requires_its_original_recovery_host');
    if(cp['competition-cloud-inflight'] || cp['competition-cloud-unknown'] || cp['competition-cloud-received'])
      return finish('unknown','original_cloud_result_is_not_consumed');
    if(records.some(record=>record.state!=='confirmed'||!record.executionStarted||record.policyDecision!=='allow'
      ||record.reconciliationOutcome==='unknown'||!object(cp['tool-result-'+record.evidenceId])
      ||!Object.hasOwn(cp['tool-result-'+record.evidenceId] as object,'result')))
      return finish('unknown','original_tool_result_is_not_confirmed');
    if(records.some(record=>descriptors.some(tool=>tool.name===record.toolName&&tool.version===record.toolVersion&&tool.sideEffect!=='read')))
      return finish('confirmed_write','confirmed_write_requires_original_readback');
    if(records.some(record=>!descriptors.some(tool=>tool.name===record.toolName&&tool.version===record.toolVersion&&tool.sideEffect==='read')))
      return finish('manual','original_exact_read_descriptor_is_unavailable');
    if(parent) {
      if(!parentTask||parent.parentDeadline!==cp['application-deadline']||task.conversationId!==`desktop-subtask:${parent.parentTaskId}`
        ||typeof parent.subtaskId!=='string'||typeof parent.goal!=='string'||typeof parent.role!=='string'
        ||runtime.findTaskByIdempotencyKey(`subagent-dispatch-${parent.parentTaskId}-${parent.subtaskId}`)?.taskId!==taskId
        ||TERMINAL.has(parentTask.state)||parentTask.cancelRequested
        ||!isDeepStrictEqual(cp['subtask-execution-binding'],{kind:'competition'})
        ||!isDeepStrictEqual(cp['subtask-coordination-binding'],{profile:'huawei_ict_agentarts',configurationRef:options.configurationRef}))
        return finish('manual','original_parent_or_child_worker_binding_differs');
    }
    if(children.some(child=>!TERMINAL.has(child.state)||runtime.isTaskActive(child.taskId)
      ||runtime.loadCheckpoint(child.taskId,'competition-cloud-inflight')||runtime.loadCheckpoint(child.taskId,'competition-cloud-unknown')))
      return finish('parent_wait','original_children_require_recovery');
    const deadline=cp['application-deadline'];
    if(typeof deadline!=='string'||!Number.isFinite(Date.parse(deadline))||typeof task.goal!=='string'||cp['application-goal']!==task.goal)
      return finish('manual','original_goal_or_deadline_is_unavailable');
    let stepLimit:number;
    try {stepLimit=resolveExecutionStepLimit(cp['competition-max-steps'],cp[EXECUTION_CAPACITY_CHECKPOINT],deadline);}
    catch{return finish('manual','original_execution_capacity_binding_is_invalid');}
    if(!additionalCheckpointsSafe(facts,stepLimit))return finish('manual','original_execution_metadata_or_discovery_binding_is_invalid');
    const interruption=cp['runtime-interruption:v1'];
    const adopted=task.state==='waiting_reconciliation'&&object(interruption)&&interruption.version==='1.0'
      &&interruption.taskId===taskId&&interruption.recoveredRevision===task.revision;
    if(task.state!=='created'&&!adopted)return finish('manual','task_requires_its_original_reconciliation');
    if(!options.durableCloudDispatch)return finish('manual','transport_has_no_durable_before_send_intent');
    const loop=cp['competition-loop'];
    if(records.length===0 && loop===undefined && options.durableCloudDispatch
      &&['competition-cloud-request-identity','competition-cloud-dispatch-binding','competition-cloud-dispatch-context']
        .every(key=>cp[key]===undefined)) {
      classification='before_first_send';reason='durable_dispatch_has_no_original_attempt';
    } else if(records.length>0&&object(loop)&&Number.isSafeInteger(loop.step)&&(loop.step as number)>=1
      &&(loop.step as number)<=stepLimit) {
      const matches=Array.isArray(loop.receipts)&&object(loop.continuation)?loop.receipts.filter(object)
        .filter(item=>object(item.proposal)&&item.proposal.proposalId===(loop.continuation as Record<string,unknown>).proposalId):[];
      const receipt=matches.length===1?matches[0]:undefined;
      const proposal=object(loop.pending)?loop.pending:receipt?.proposal;
      const runId=object(loop.pending)?`competition-tool-${taskId}-${loop.step}`:receipt?.runId;
      const record=records.find(item=>item.evidenceId===runId);
      if(object(proposal)&&object(proposal.arguments)&&record&&record.toolName===proposal.toolName&&record.toolVersion===proposal.toolVersion
        &&runtime.matchesToolExecutionInput(record,{arguments:proposal.arguments,scopeRef:record.evidenceId})
        &&(loop.pending!==undefined||(receipt&&receipt.runId===`competition-tool-${taskId}-${(loop.step as number)-1}`
          &&isDeepStrictEqual(receipt.continuation,loop.continuation)))) {
        classification='confirmed_read';reason='original_confirmed_read_cache_only';
      }
    }
    return {...finish(classification,reason),deadline,
      action:classification==='before_first_send'||classification==='confirmed_read'
        ?task.cancelRequested?'cancel':now().getTime()>=Date.parse(deadline)?'expire':'resume':undefined};
  };
  const inspect=(taskId:string):RuntimeStartupRecoveryItem=>plan(taskId).item;
  const recover=():Promise<RuntimeStartupRecoveryReport>=>recovery??=(async()=>{
    if(options.exclusiveOwner!==true)reject('Startup recovery requires exclusive original Runtime ownership');
    // Capture the old population before any host starts dispatching new work.
    const tasks=inventory().filter(task=>!TERMINAL.has(task.state));
    runtime.recoverInterruptedTasks();
    const items:RuntimeStartupRecoveryItem[]=[];
    for(const source of tasks) {
      const original=plan(source.taskId);let item:RuntimeStartupRecoveryItem={...original.item};
      if(original.action==='cancel'||original.action==='expire') {
        const current=plan(source.taskId);
        if(!isDeepStrictEqual(original,current))reject('Original startup termination facts changed');
        const task=runtime.getTask(source.taskId);
        if(original.action==='cancel') {
          if(task.state==='created')runtime.requestCancel(task.taskId);
          runtime.confirmCancellation(task.taskId);item.outcome='cancelled';
        } else {
          runtime.transitionTask(task.taskId,'failed',{error:{code:'TIMEOUT',message:'Original task deadline expired before safe startup continuation',retryable:false}});
          item.outcome='expired';
        }
      } else if(original.action==='resume') {
        const binding=createHash('sha256').update(JSON.stringify(original.facts)).digest('hex');
        let checked=false;
        const assertUnchanged=()=>{
          const current=plan(source.taskId);
          if(current.action!=='resume'||current.item.classification!==original.item.classification
            ||createHash('sha256').update(JSON.stringify(current.facts)).digest('hex')!==binding)
            reject('Original startup continuation facts changed');
          checked=true;
        };
        try {
          assertUnchanged();checked=false;
          const accepted=await options.resumeOriginalTask({taskId:item.taskId,expectedRevision:item.revision,
            deadline:original.deadline!,mode:original.item.classification as RuntimeStartupResumeRequest['mode'],assertUnchanged,
            ...(original.facts.eventRoot?.taskId===item.taskId&&original.facts.task.state==='created'
              &&original.facts.keys.every(key=>key===KEY||key==='harness-event-origin')
              ?{harnessEventOrigin:structuredClone(original.facts.origin) as unknown as RuntimeStartupHarnessEventOrigin}:{})});
          if(accepted.accepted&&checked)item.outcome='resumed';else item.reason='original_worker_did_not_accept_recovery';
        } catch {item.reason='original_worker_rejected_changed_or_unavailable_recovery';}
      }
      item.revision=runtime.getTask(item.taskId).revision;
      runtime.saveCheckpoint(item.taskId,KEY,{version:'1.0',...item,observedAt:now().toISOString(),cloudResent:false,toolReexecuted:false});
      items.push(item);
    }
    return {version:'1.0',items};
  })();
  return {recover,inspect};
}
