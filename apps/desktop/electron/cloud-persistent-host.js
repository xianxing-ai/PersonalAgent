import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {parseCloudPersistentCommand,parseCloudPersistentReply} from '@personal-agent/contracts/cloud-persistent';
import {toolArgumentsDigest} from '@personal-agent/tool-gateway';

const KEY='desktop-cloud-persistent-v1',hash=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>hash(JSON.stringify(value));
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
export function createDesktopCloudPersistentHost({application,getRunner,userData,resolveUserConversation,now=Date.now}) {
  const runtime=application.runtime,file=join(userData,'cloud-persistent-binding.json');
  const inFlight=new Set();
  function configuration() {
    if(!existsSync(file))fail('UNSUPPORTED_CAPABILITY','独立云持续宿主尚未配置或验收');
    let value;try{value=JSON.parse(readFileSync(file,'utf8'));}catch{fail('UNSUPPORTED_CAPABILITY','独立云持续宿主配置不可用');}
    if(value.version!==1||!value.qualificationEvidenceRef||!value.owner||!value.originRuntimeId)
      fail('UNSUPPORTED_CAPABILITY','需要固定云宿主资格记录');
    const host=getRunner()?.service.list().find(host=>host.id===value.owner.hostId&&host.enabled);
    if(!host)fail('UNSUPPORTED_CAPABILITY','原云宿主未启用');
    return {value,hostVersion:host.version};
  }
  function source(taskId,historical=false) {
    const task=runtime.getTask(taskId);
    if(!resolveUserConversation(taskId)||!historical&&(!task.goal||task.cancelRequested||runtime.loadCheckpoint(taskId,'private-copy-erasure')!==undefined
      ||runtime.loadCheckpoint(taskId,'private-copy-erasure-binding')!==undefined))fail('UNAUTHORIZED','原用户指令已失效');
    return task;
  }
  const key=id=>KEY+':'+hash(id);
  function original(sourceTaskId,commandId) {
    const saved=runtime.loadCheckpoint(sourceTaskId,key(commandId));
    if(!saved||saved.version!==1||saved.sourceTaskId!==sourceTaskId||saved.command.commandId!==commandId||saved.command.operation!=='submit')
      fail('NOT_FOUND','原云提交记录不存在');
    return saved;
  }
  async function send(sourceTaskId,command,entry,entryKey) {
    const operationKey=sourceTaskId+':'+entryKey;
    if(inFlight.has(operationKey))fail('RESULT_UNKNOWN','原云操作仍在发送，请等待原读回');
    inFlight.add(operationKey);
    try {
    const restrictive=command.operation==='readback'||command.operation==='control'&&['pause','cancel'].includes(command.control.action)
      ||command.operation==='approval'&&command.approval.decision==='deny';
    const config=configuration(),task=source(sourceTaskId,restrictive),originalGoal=hash(task.goal??''),originalConfig=digest(config);
    if(digest(config.value.owner)!==digest(command.owner))fail('REVISION_CONFLICT','原云会话宿主配置已改变');
    const epoch=runtime.readExecutionEpoch(sourceTaskId),controller=new AbortController();
    const assertCurrent=()=>{runtime.assertExecutionEpoch(sourceTaskId,epoch);
      if(hash(source(sourceTaskId,restrictive).goal??'')!==originalGoal||digest(configuration())!==originalConfig)fail('REVISION_CONFLICT','原指令或云宿主已改变');};
    const result=await getRunner().service.submit({kind:'cloud-persistent',hostId:command.owner.hostId,
      taskId:sourceTaskId,idempotencyKey:'cloud-persistent:'+command.owner.runtimeId+':'+command.commandId,payload:command,
      deadline:command.deadline,signal:controller.signal,assertCurrent});
    // Never interpret an SSH receipt as task success. Only the fixed Runtime reply supplies current state.
    let reply;
    if(result.location==='remote'&&result.hostId===command.owner.hostId&&result.receipt?.state==='succeeded') {
      reply=parseCloudPersistentReply(result.receipt.data);
      if(reply.approvals.some(value=>toolArgumentsDigest(value.arguments)!==value.argumentsDigest))
        fail('RESULT_UNKNOWN','审批参数读回与原摘要不一致，不能批准');
      if(reply.commandId!==command.commandId||digest(reply.owner)!==digest(command.owner)
        ||command.target&&digest(reply.target)!==digest(command.target))fail('RESULT_UNKNOWN','云读回未匹配原会话');
    }
    const latest=runtime.loadCheckpoint(sourceTaskId,entryKey)??entry;
    if(reply&&latest.lastReply&&(latest.lastReply.controlRevision>reply.controlRevision||latest.lastReply.task.revision>reply.task.revision))reply=latest.lastReply;
    const next={...latest,transportState:reply?'confirmed':result.receipt?.state??'unknown',
      ...(reply?{target:reply.target,lastReply:reply}:{})};
    runtime.saveCheckpoint(sourceTaskId,entryKey,next);return {state:next.transportState,...(reply?{reply}:{})};
    }finally{inFlight.delete(operationKey);}
  }
  async function start(input) {
    if(!input||Object.keys(input).some(k=>!['sourceTaskId','commandId','taskDeadline'].includes(k)))fail('INVALID_ARGUMENT','云持续提交字段无效');
    const config=configuration(),task=source(input.sourceTaskId);
    const command=parseCloudPersistentCommand({version:1,commandId:input.commandId,owner:config.value.owner,
      deadline:new Date(Math.min(now()+55_000,Date.parse(input.taskDeadline))).toISOString(),operation:'submit',
      submit:{originRuntimeId:config.value.originRuntimeId,originTaskId:task.taskId,goal:task.goal,goalDigest:hash(task.goal),taskDeadline:input.taskDeadline}});
    const entryKey=key(command.commandId),prior=runtime.loadCheckpoint(task.taskId,entryKey);
    if(prior)fail('RESULT_UNKNOWN','该云提交已存在，请读回原操作，不要重提');
    const entry={version:1,sourceTaskId:task.taskId,command,transportState:'unknown'};
    runtime.saveCheckpointOnce(task.taskId,entryKey,entry);
    runtime.saveCheckpointOnce(task.taskId,KEY,{version:1});
    return send(task.taskId,command,entry,entryKey);
  }
  async function act(operation,input) {
    if(!input||Object.keys(input).some(k=>!['sourceTaskId','originCommandId','commandId','target','control','approval'].includes(k)))
      fail('INVALID_ARGUMENT','云会话操作字段无效');
    const saved=original(input.sourceTaskId,input.originCommandId),deadline=new Date(operation==='readback'?now()+55_000:
      Math.min(now()+55_000,Date.parse(saved.command.submit.taskDeadline))).toISOString();
    if(operation!=='readback'&&saved.transportState!=='confirmed')fail('RESULT_UNKNOWN','原云操作结果未知，请先读回，不能重提控制或审批');
    if(operation!=='readback'&&(!saved.lastReply||digest(input.target)!==digest(saved.lastReply.target)))
      fail('UNAUTHORIZED','请先读回原云会话再提交控制');
    if(operation==='approval'){
      const known=saved.lastReply.approvals.find(value=>value.approvalId===input.approval?.approvalId);
      if(!known||known.state!=='pending'||known.revision!==input.approval.expectedRevision||known.argumentsDigest!==input.approval.argumentsDigest
        ||known.expiresAt!==input.approval.expiresAt)fail('REVISION_CONFLICT','审批必须匹配原云会话的当前请求');
    }
    const command=parseCloudPersistentCommand({version:1,commandId:input.commandId??randomUUID(),owner:saved.command.owner,deadline,operation,
      ...(operation==='readback'?{originCommandId:input.originCommandId}:{target:input.target,[operation]:input[operation]})});
    const entryKey=key(input.originCommandId),pending=operation==='readback'?saved:{...saved,transportState:'unknown'};
    if(inFlight.has(input.sourceTaskId+':'+entryKey))fail('RESULT_UNKNOWN','原云操作仍在发送，请等待读回');
    if(operation!=='readback')runtime.saveCheckpoint(input.sourceTaskId,entryKey,pending);
    return send(input.sourceTaskId,command,pending,entryKey);
  }
  function status() {
    let configured;try{configured=configuration();}catch{return {state:'unavailable',sourceTasks:[],sessions:[]};}
    const page=runtime.listTasks({limit:100}),sourceTasks=[],sessions=[];
    for(const task of page.items){try{source(task.taskId);sourceTasks.push({taskId:task.taskId,goal:task.goal});}catch{}}
    const owned=runtime.listTaskCheckpointPage({limit:100},[KEY]);
    for(const task of owned.items){try{source(task.taskId,true);}catch{continue;}
      for(const entryKey of runtime.listCheckpointKeys(task.taskId).filter(value=>value.startsWith(KEY+':'))){
        const entry=runtime.loadCheckpoint(task.taskId,entryKey);
        if(entry?.version===1&&entry.sourceTaskId===task.taskId&&entry.command?.operation==='submit'
          &&digest(entry.command.owner)===digest(configured.value.owner))sessions.push({sourceTaskId:task.taskId,
          commandId:entry.command.commandId,transportState:entry.transportState,...(entry.target?{target:entry.target}:{}),...(entry.lastReply?{lastReply:entry.lastReply}:{})});
      }
    }
    return {state:'configured_not_verified',hostId:configured.value.owner.hostId,sourceTasks,sessions};
  }
  return {status,start,read:input=>act('readback',input),control:input=>act('control',input),approval:input=>act('approval',input)};
}
