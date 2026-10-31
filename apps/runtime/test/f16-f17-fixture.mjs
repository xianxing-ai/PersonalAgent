import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {register as registerGitHub} from '@personal-agent/github';
import {createGitTools,createWorkspaceCommandTool} from '@personal-agent/coding-tools';
import {createRuntimeApplication} from '../dist/application.js';
import {createRuntimeF16CiFailureHost} from '../dist/application/workflow-f16-ci-failure-host.js';
import {createRuntimeF17FailureReportHost} from '../dist/application/workflow-f17-failure-report-host.js';
import {createF16CiFailurePorts} from '../dist/application/f16-ci-failure-ports.js';
import {createF17ReproductionPorts} from '../dist/application/f17-reproduction-ports.js';

export async function fixture(t,workflow='F16') {
  const base=resolve('.cache/f16-f17');await mkdir(base,{recursive:true});
  const directory=await mkdtemp(join(base,'case-')),root=join(directory,'workspace');await mkdir(root);
  await writeFile(join(root,'failure.test.mjs'),"import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('real reproduction',()=>assert.equal(1,2));\n");
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-b','fixture');git('config','user.name','Synthetic Test');git('config','user.email','fixture@example.invalid');
  git('add','failure.test.mjs');git('commit','-qm','Synthetic failing reproduction');git('remote','add','origin','https://github.com/xianxing-ai/PersonalAgent.git');
  const head=git('rev-parse','HEAD'),repository='xianxing-ai/PersonalAgent',recipe={id:'reproduce',executable:process.execPath,args:['--test','--test-reporter=tap','failure.test.mjs']};
  const deadlines=new Date(Date.now()+120000).toISOString(),controller=new AbortController();
  const counters={github:0,head:0,command:0};let app,client,host,ports,scope,parent,bridge,proposal,original,gate=true;
  let exportAction=async()=>true,headAction;
  const tools=[];
  const provider={verification:'mock',execute:async(op,input)=>{
    counters.github++;
    const page=items=>({items,page:1,nextPage:null,hasMore:false});
    if(op==='actions.run.list')return page([{id:7,name:'Synthetic CI',status:'completed',conclusion:'failure',headSha:head,url:'https://github.com/xianxing-ai/PersonalAgent/actions/runs/7',createdAt:new Date().toISOString()}]);
    if(op==='actions.job.list')return page([{id:8,runId:7,name:'Synthetic test job',status:'completed',conclusion:'failure',url:'https://github.com/xianxing-ai/PersonalAgent/actions/runs/7/job/8'}]);
    if(op==='actions.log.read')return {text:'Synthetic public CI failure',offset:0,nextOffset:null,truncated:false};
    throw new ProtocolError('UNSUPPORTED_CAPABILITY','Synthetic fixture only supports CI reads');
  }};
  registerGitHub({register:tool=>{tools.push(tool);return ()=>{};}},{provider});
  const gitTool=createGitTools({repository,rootPath:root,sourceBranch:'fixture',remoteName:'origin',remoteUrl:'https://github.com/xianxing-ai/PersonalAgent.git',
    allowedPaths:['failure.test.mjs'],authorName:'Synthetic Test',authorEmail:'fixture@example.invalid',readVerification:async()=>undefined}).head;
  tools.push({...gitTool,execute:async(...args)=>{counters.head++;if(headAction)await headAction();return gitTool.execute(...args);}});
  const commandTool=createWorkspaceCommandTool({rootPath:root,recipes:[recipe]});
  tools.push({...commandTool,execute:async(...args)=>{counters.command++;return commandTool.execute(...args);}});
  const shellOptions={application:{runtime:{},readHostToolTask(){}},requiredScopes:['fixture:report'],now:()=>new Date(),assertCurrent(){},
    resolveFailure:async()=>undefined,readCurrentHead:async()=>head,authorizeExport:async()=>true,
    driverCheckpointKey:'driver',workspaceRoot:root,resolveReproduction:async()=>undefined};
  const createHost=workflow==='F16'?createRuntimeF16CiFailureHost:createRuntimeF17FailureReportHost;
  const descriptor=createHost(shellOptions).tools[0].descriptor;
  tools.push({descriptor,execute:(...args)=>host.tools[0].execute(...args)});
  const config={path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'f16-f17-synthetic',tools};
  async function wait(id,states) {
    for(let i=0;i<2000;i++){const read=app.readHostToolTask(id);if(states.includes(read.task.state))return read;await new Promise(r=>setTimeout(r,3));}
    assert.fail('Runtime did not reach '+states.join('/')+'; actual='+app.runtime.getTask(id).state);
  }
  async function approve(id,decision='allow_once') {
    const read=await wait(id,['waiting_approval','succeeded','failed','waiting_reconciliation']);
    if(read.task.state==='waiting_approval')await client.call('authorization.respond',{approvalId:read.approval.approvalId,expectedRevision:read.approval.revision,decision});
    return wait(id,['succeeded','failed','cancelled','waiting_reconciliation']);
  }
  const ref=read=>({taskId:read.task.taskId,runId:read.confirmed.runId,scopeRef:read.confirmed.runId,toolVersion:read.toolVersion,
    arguments:app.runtime.loadCheckpoint(read.task.taskId,'host-tool-intent').arguments});
  async function source(request,decision='allow_once') {
    const prepared=app.prepareHostToolTask(request);
    app.runtime.saveCheckpointOnce(prepared.taskId,'coding-repair:parent',{taskId:parent.taskId,operationId:request.commandId});
    app.runtime.saveCheckpointOnce(parent.taskId,'coding-repair:host:'+request.commandId,{localTaskId:prepared.taskId,request});
    app.finalizeHostToolTask({taskId:prepared.taskId,commandId:request.commandId,expectedTaskRevision:prepared.revision,arguments:request.arguments});
    const read=await approve(prepared.taskId,decision);
    if(!read.confirmed)throw new ProtocolError(read.task.error?.code??'UNAUTHORIZED','Source did not confirm');
    return ref(read);
  }
  async function reopen() {
    if(app){while(app.activeTaskCount)await new Promise(r=>setTimeout(r,3));app.close();}
    app=createRuntimeApplication(config);client=new Client(app);await client.connect();
    const common={application:app,now:()=>new Date(),invokeWorkspaceHead:(_scope,request)=>source(request)};
    ports=workflow==='F16'?createF16CiFailurePorts({...common,selectionCheckpointKey:'f16:selection'}):
      createF17ReproductionPorts({...common,checkpointPrefix:'f17:reproduction:',recipes:[recipe]});
    const options={...shellOptions,application:app,...ports,assertCurrent:s=>{
      if(!gate)throw Error('Revoked original graph');
      assert.equal(s.parentTaskId,parent.taskId);assert.equal(s.sessionId,'session');
      if(workflow==='F16')ports.assertSelectionCurrent(s);
    },authorizeExport:(...args)=>exportAction(...args)};
    host=createHost(options);
    if(parent)bridge=app.createOwnedWorkflowHost({receiptSecret:'synthetic-f16-f17-receipt-key-long-enough',parentTaskId:parent.taskId,
      assertActive:()=>{if(!gate)throw Error('revoked');}});
  }
  await reopen();parent=app.runtime.submitTask({goal:'Synthetic public failure binding',conversationId:'f16-f17',idempotencyKey:'parent'});
  app.runtime.transitionTask(parent.taskId,'planning');app.runtime.transitionTask(parent.taskId,'running');
  const nodeId=workflow==='F16'?'F16_N01':'F17_N04';
  original={taskId:parent.taskId,workflowId:workflow,sessionId:'session',controlRevision:1,deadline:deadlines,signal:controller.signal};
  proposal={kind:'tool_proposal',originControlRevision:1,operationId:'report-op',nodeId,toolName:descriptor.name,toolVersion:descriptor.version,arguments:{}};
  bridge=app.createOwnedWorkflowHost({receiptSecret:'synthetic-f16-f17-receipt-key-long-enough',parentTaskId:parent.taskId,assertActive:()=>{if(!gate)throw Error('revoked');}});
  scope={parentTaskId:parent.taskId,localTaskId:'not-yet-submitted',operationId:proposal.operationId,sessionId:'session',deadline:deadlines,signal:controller.signal};
  const request=(commandId,toolName,args)=>({commandId,toolName,toolVersion:tools.find(v=>v.descriptor.name===toolName).descriptor.version,arguments:args,deadline:deadlines});
  t.after(async()=>{if(app){while(app.activeTaskCount)await new Promise(r=>setTimeout(r,3));app.close();}await rm(directory,{recursive:true,force:true});});
  return {root,directory,head,repository,recipe,counters,controller,scope,original,proposal,request,source,approve,wait,ref,git,
    get app(){return app;},get host(){return host;},get ports(){return ports;},get bridge(){return bridge;},reopen,
    gateOff:()=>{gate=false;},onExport:fn=>{exportAction=fn;},onHead:fn=>{headAction=fn;},
    context(id){return {taskId:id,runId:'host-tool-'+id,authorizationRef:'host-tool-'+id,scopes:['fixture:report'],deadline:deadlines,signal:controller.signal};},
    async prepareF16(){
      const runList=await source(request('runs','github.actions.run.list',{repo:repository,status:'failure'}));
      const jobList=await source(request('jobs','github.actions.job.list',{repo:repository,runId:7}));
      const logRead=await source(request('log','github.actions.log.read',{repo:repository,runId:7,jobId:8}));
      const binding={repo:repository,headSha:head,runId:7,jobId:8,runList,jobList,logRead};ports.bindSelection(scope,binding);return binding;
    },
    async prepareF17(){
      const beforeHead=await source(request('before','workspace.git.head',{repository}));
      ports.prepareReproduction(scope,{operationId:'repro',repository,recipeId:recipe.id,beforeHead});
      const command=await source(request('repro','workspace.run_allowed_command',{recipeId:recipe.id}));
      const afterHead=await source(request('after','workspace.git.head',{repository}));
      ports.bindReproduction(scope,{operationId:'repro',repository,command,beforeHead,afterHead});
      const entry={nodeId:'F17_N03',toolName:'workspace.run_allowed_command',localTaskId:command.taskId,operationId:'repro',result:app.readHostToolTask(command.taskId).confirmed.result};
      app.runtime.saveCheckpoint(parent.taskId,'driver',{sessionId:'session',controlRevision:1,confirmedOperations:{repro:entry}});
      app.runtime.saveCheckpoint(parent.taskId,'driver:driver-binding',{taskId:parent.taskId,workflowId:'F17',sessionId:'session',deadline:deadlines});
      app.runtime.saveCheckpoint(parent.taskId,'owned-workflow:operation:repro',{taskId:parent.taskId,workflowId:'F17',sessionId:'session',localTaskId:command.taskId,
        proposal:{nodeId:'F17_N03',operationId:'repro',toolName:'workspace.run_allowed_command',arguments:{recipeId:recipe.id}}});
      return {command,beforeHead,afterHead};
    },
  };
}
