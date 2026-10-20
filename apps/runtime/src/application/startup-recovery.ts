import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {TaskSnapshot} from '@personal-agent/contracts';
import type {TaskRuntime} from '../index.js';

export interface RuntimeStartupResumeRequest {
  taskId:string; expectedRevision:number; deadline:string;
  mode:'before_first_send'|'confirmed_read';
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
const BASE_KEYS=new Set(['runtime-interruption:v1',KEY,'application-profile','application-goal','application-deadline',
  'competition-configuration-binding','competition-max-steps','competition-context:v1','competition-tool-catalog',
  'competition-loop','competition-confirmed-replay','competition-cloud-inflight','competition-cloud-unknown',
  'competition-cloud-received','competition-cloud-request-identity','competition-cloud-dispatch-binding',
  'competition-cloud-dispatch-context','execution-model','task-thinking','task-model-preference','required-subagent-delegation:v1',
  'subtask-parent','subtask-execution-binding','subtask-coordination-binding','subtask-tools-binding','subtask-thinking-binding',
  'subtask-progress-records','subagent-parent-wait','subagent-current-summary']);
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function reject(message:string):never {throw Object.assign(new Error(message),{code:'REVISION_CONFLICT'});}

/** Classifies the original durable tasks; execution remains in RuntimeApplication. */
export function createRuntimeStartupRecovery(options:RuntimeStartupRecoveryOptions):RuntimeStartupRecovery {
  const runtime=options.runtime,now=options.now??(()=>new Date());
  let recovery:Promise<RuntimeStartupRecoveryReport>|undefined;
  const inventory=():TaskSnapshot[]=>{
    const result:TaskSnapshot[]=[];let before:number|undefined,snapshot:number|undefined;
    do {
      const page=runtime.listTasks({limit:100,...(before===undefined?{}:{beforeSequence:before}),
        ...(snapshot===undefined?{}:{snapshotSequence:snapshot})});
      result.push(...page.items);before=page.nextBeforeSequence;snapshot=page.snapshotSequence;
    }while(before!==undefined);
    return result;
  };
  const read=(taskId:string)=>{
    const task=runtime.getTask(taskId),keys=runtime.listCheckpointKeys(taskId);
    const checkpoints=Object.fromEntries(keys.filter(key=>key!==KEY).map(key=>[key,runtime.loadCheckpoint(taskId,key)]));
    const records=runtime.readToolExecutions(taskId),children=inventory().filter(child=>child.conversationId===`desktop-subtask:${taskId}`);
    const parent=object(checkpoints['subtask-parent'])?checkpoints['subtask-parent']:undefined;
    let parentTask:TaskSnapshot|undefined;
    if(typeof parent?.parentTaskId==='string'){try{parentTask=runtime.getTask(parent.parentTaskId);}catch{/* Missing original parent stays manual. */}}
    return {task,keys,checkpoints,records,children,parent,parentTask,descriptors:runtime.readToolDescriptors()};
  };
  type RecoveryPlan={facts:ReturnType<typeof read>;item:RuntimeStartupRecoveryItem;deadline?:string;action?:'cancel'|'expire'|'resume'|undefined};
  const plan=(taskId:string):RecoveryPlan=>{
    const facts=read(taskId),{task,checkpoints:cp,records,children,parent,parentTask,descriptors}=facts;
    let classification:RuntimeStartupRecoveryItem['classification']='manual',reason='unsupported_original_checkpoint';
    const finish=(kind:RuntimeStartupRecoveryItem['classification'],why:string)=>({facts,
      item:{taskId,revision:task.revision,classification:kind,reason:why,outcome:'retained' as const}});
    if(TERMINAL.has(task.state))return finish('terminal','already_terminal');
    if(runtime.isTaskActive(taskId))return finish('active','original_worker_is_active');
    if(task.state==='waiting_approval')return finish('approval_required','original_approval_is_preserved');
    if(cp['application-profile']!=='huawei_ict_agentarts' || cp['competition-configuration-binding']!==options.configurationRef)
      return finish('manual','original_profile_or_configuration_differs');
    if(facts.keys.some(key=>!BASE_KEYS.has(key)&&!key.startsWith('tool-result-')&&!key.startsWith('routine-tool-policy:')))
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
    if(typeof deadline!=='string'||!Number.isFinite(Date.parse(deadline))||cp['application-goal']!==task.goal)
      return finish('manual','original_goal_or_deadline_is_unavailable');
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
      &&Number.isSafeInteger(cp['competition-max-steps'])&&(loop.step as number)<=(cp['competition-max-steps'] as number)) {
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
            deadline:original.deadline!,mode:original.item.classification as RuntimeStartupResumeRequest['mode'],assertUnchanged});
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
