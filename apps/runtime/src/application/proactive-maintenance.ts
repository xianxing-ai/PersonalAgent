import type {RuntimeApplication} from './runtime-application.js';
import type {RuntimeProactiveWorkflowHost} from './proactive-workflow-application.js';

type Context={signal:AbortSignal;deadline:string};
export interface ProactiveMaintenanceBinding {
  taskId:string;sourceTaskId:string;sessionId:string;taskDeadline:string;imageBinding?:string;
}
export interface ProactiveMaintenanceWorkflow {
  snapshot():{state:string};
  maintenancePage(input:{beforeSequence?:number;snapshotSequence?:number}):{
    snapshotSequence:number;nextBeforeSequence?:number;items:{binding:ProactiveMaintenanceBinding;state:string;
      cancelRequested:boolean;withheld:boolean;conversationId?:string|undefined}[]};
  acquireMaintenance(taskId:string,context:Context):Promise<{host:RuntimeProactiveWorkflowHost}>;
}
/** Shared host maintenance. TaskRuntime owns schedules/tasks; the caller owns its existing poll. */
export function createRuntimeProactiveMaintenancePump(options:{
  getApplication():Pick<RuntimeApplication,'runtime'|'resumeProactiveTask'>|undefined;
  getWorkflow():ProactiveMaintenanceWorkflow|undefined;
  resolveUserConversation(taskId:string):string|undefined;
  recoverSources?(taskId:string,context:Context):Promise<{state:string;deliveries?:unknown[]}|undefined>;
  beforeNativeMaintenance?(taskId:string,context:Context):Promise<void>|void;
  afterNativeMaintenance?(taskId:string,context:Context):Promise<void>|void;
  now?:()=>number;
}) {
  if([options.getApplication,options.getWorkflow,options.resolveUserConversation].some(value=>typeof value!=='function'))
    throw Error('Original Runtime, proactive host and structural conversation resolver required');
  if(options.afterNativeMaintenance!==undefined&&typeof options.afterNativeMaintenance!=='function')throw Error('Native maintenance callback must be a function');
  const now=options.now??Date.now,terminal=new Set(['succeeded','failed','cancelled','cancelling']);
  const recovered=new Set<string>(),reentered=new Set<string>();
  let pending:Promise<unknown>|undefined,scanCursor:{beforeSequence:number;snapshotSequence:number}|undefined;
  async function run() {
    const application=options.getApplication(),workflow=options.getWorkflow();
    if(!application?.runtime||!workflow||workflow.snapshot().state!=='configured_not_verified')return {state:'unavailable',sessions:[]};
    const runtime=application.runtime,status:Record<string,unknown>[]=[],conversations=new Set<string|undefined>();
    let beforeSequence=scanCursor?.beforeSequence,snapshotSequence=scanCursor?.snapshotSequence,pages=0;
    do {
      const page=workflow.maintenancePage({...(beforeSequence===undefined?{}:{beforeSequence}),...(snapshotSequence===undefined?{}:{snapshotSequence})});
      snapshotSequence=page.snapshotSequence;
      for(const item of page.items) {
        const {binding}=item;
        if(terminal.has(item.state)||item.cancelRequested)continue;
        if(item.withheld||!options.resolveUserConversation(binding.sourceTaskId)){status.push({taskId:binding.taskId,state:'source_unavailable'});continue;}
        if(Date.parse(binding.taskDeadline)<=now()){status.push({taskId:binding.taskId,state:'deadline_expired'});continue;}
        if(!binding.imageBinding){status.push({taskId:binding.taskId,state:'legacy_requires_explicit_resume'});continue;}
        const context={signal:new AbortController().signal,deadline:new Date(Math.min(Date.parse(binding.taskDeadline),now()+5000)).toISOString()};
        try {
          await options.beforeNativeMaintenance?.(binding.taskId,context);
          const session=await workflow.acquireMaintenance(binding.taskId,context);
          const sourceRecovery=await options.recoverSources?.(binding.taskId,context);
          const schedules=Object.keys(session.host.inspect().application.state.schedules);
          if(schedules.length&&!conversations.has(item.conversationId)) {
            if(item.conversationId&&!recovered.has(item.conversationId)){runtime.recoverMissedSchedules(item.conversationId);recovered.add(item.conversationId);}
            runtime.dispatchDueSchedules(item.conversationId);conversations.add(item.conversationId);
          }
          let wakes=0;
          for(const scheduleId of schedules){const schedule=runtime.getSchedule(scheduleId);
            if(schedule.status!=='fired'||session.host.inspect().application.state.entries['runtime-wake:'+scheduleId])continue;
            session.host.ingestWake(scheduleId,context);wakes++;}
          const current=runtime.getTask(binding.taskId);
          if(!reentered.has(binding.taskId)&&['created','waiting_approval','waiting_reconciliation'].includes(current.state)){
            application.resumeProactiveTask(binding.taskId);reentered.add(binding.taskId);}
          await options.afterNativeMaintenance?.(binding.taskId,context);
          status.push({taskId:binding.taskId,state:sourceRecovery?.state==='unavailable'?'source_unavailable':'bound',wakes,
            ...(sourceRecovery?{sourceRecovery:{state:sourceRecovery.state,deliveries:sourceRecovery.deliveries?.length??0}}:{})});
        }catch(error){const code=error&&typeof error==='object'&&'code'in error?String(error.code):'';
          status.push({taskId:binding.taskId,state:'unavailable',code:['CANCELLED','TIMEOUT','REVISION_CONFLICT','RESULT_UNKNOWN','UNAUTHORIZED'].includes(code)?code:'HOST_UNAVAILABLE'});}
      }
      beforeSequence=page.nextBeforeSequence;
      if(++pages===10&&beforeSequence!==undefined){scanCursor={beforeSequence,snapshotSequence};return {state:'bounded',sessions:status,truncated:true};}
    }while(beforeSequence!==undefined);
    scanCursor=undefined;return {state:'processed',sessions:status,truncated:false};
  }
  return {tick(){if(pending)return pending;pending=run().finally(()=>{pending=undefined;});return pending;}};
}
