import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import * as runtimeModule from '@personal-agent/runtime/application';
import * as mcpModule from '@personal-agent/mcp';
import * as codingModule from '@personal-agent/coding-tools';
import {Client} from '@personal-agent/client';
import {OwnedWorkflowEngine,createOwnedWorkflowReceiptVerifier} from '@personal-agent/agentarts';
import {createConfiguredDesktopF21WorkflowPorts} from '../electron/f21-workflow-worker-ports.js';
import {createDesktopAuthorizationQuestionHost} from '../electron/authorization-question-host.js';
import {createDesktopAuthorizationIntentHost,AUTHORIZATION_INTENT_TOOL} from '../electron/authorization-intent-host.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytes=value=>createHash('sha256').update(value).digest('hex');
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});

// Real production factories/Engine/Runtime/Policy/SQLite/Intent. Native, model, reference service and clicks are explicit Fixtures.
test('F21 exact reference chain requires its native enable decision and a reopened unknown probe never executes again',async t=>{
  const directory=realpathSync.native(await mkdtemp(join(tmpdir(),'pa-f21-worker-'))),workspace=join(directory,'source');await mkdir(workspace);
  let app,question,intent,executions=0,unknown=false,enabled=false,last;
  const mcp=mcpModule.createReadonlyMcpHost(),descriptor=mcp.tools[0].descriptor;
  const reference={readF21Configuration:()=>({workspace:{rootPath:workspace,nodeExecutable:process.execPath,bindingId:'synthetic-session'},
    manifest:app.referenceSkillSnapshot().manifest,descriptor}),readF21Connection:()=>enabled?{configurationRef:'synthetic-original-connection',mcp:{connected:true},
      skill:{...app.referenceSkillSnapshot().health,enabled:true,connected:true}}:undefined,
    async setMcpEnabled(_enabled,request){assert.equal(request.assertCurrent(),true);request.onBound({configurationRef:'synthetic-original-connection'});enabled=true;},
    setSkillEnabled(){assert.equal(enabled,true);}};
  const native={createCommandTool(options){return {async execute(args,context){options.beforeF21Probe(context);executions++;const original=options.readF21Binding(context);
    app.runtime.saveCheckpoint(context.taskId,'synthetic-f21-native-source',hash(original));
    if(unknown)throw Object.assign(Error('Synthetic unknown after original start'),{code:'RESULT_UNKNOWN'});
    return {recipeId:args.recipeId,exitCode:0,stderr:'',stdout:JSON.stringify({version:1,protocolVersion:'2025-11-25',server:{name:'secure-filesystem-server',version:'0.2.0'},
      tool:'read_text_file',filesReturned:1,sampleSha256:bytes('PersonalAgent F21 bounded MCP protocol probe.\n'),directoryDigest:'a'.repeat(64),osReadDenied:true,osWriteDenied:true})};}};},
    readOriginalF21Probe(value){if(app.runtime.loadCheckpoint(value.taskId,'synthetic-f21-native-source')!==value.sourceDigest)return;
      return {exitCode:0,auditDigest:'b'.repeat(64)};}};
  const bundle=createConfiguredDesktopF21WorkflowPorts({runtimeModule,mcpModule,codingModule,getApplication:()=>app,getReferenceHost:()=>reference,
    nativeExecutionHost:native,getAuthorizationIntentHost:()=>intent,probeRoot:join(directory,'probe'),authorizeExport:async()=>true});
  const choice={descriptor:{name:'decision.choose_candidate',version:'1.0.0',inputSchema:object({context:{type:'string'},candidates:{type:'array',items:object({id:{type:'string'},description:{type:'string'}})},requestId:{type:'string'}}),
    outputSchema:object({selectedId:{type:'string'}}),sideEffect:'read',requiredScopes:['decision:choose'],idempotencySupport:false,recoverySupport:false,requiresPresence:false},
    execute:async args=>({selectedId:args.candidates[0].id})};
  const secret='synthetic-f21-receipt-secret-32-characters';
  const engine=new OwnedWorkflowEngine({externalHost:true,checkpointSecret:'synthetic-f21-checkpoint-secret-32-characters',decisionTool:{name:choice.descriptor.name,version:'1.0.0'},
    receiptVerifier:createOwnedWorkflowReceiptVerifier({secret}),prepareCandidates:async()=>[{id:'selected',description:'Synthetic fixed reference',value:{arguments:{}}},
      {id:'abstain',description:'Preserve uncertainty',value:{},abstain:true}]});
  const image={bindingId:'synthetic-f21',receiptSecret:async()=>secret,advance:async request=>(last=await engine.advance(request))};
  function open(){
    question=createDesktopAuthorizationQuestionHost({createQuestions:options=>new runtimeModule.AuthorizationQuestions(options),getApplication:()=>app,
      namespace:'f21-test',resolveConversation:()=> 'synthetic-native-conversation',available:()=>true,
      profiles:[{ref:'app',label:'Synthetic application profile',mode:'workspace-write',revision:1,available:true}],defaultProfileRef:'app'});
    intent=createDesktopAuthorizationIntentHost({getApplication:()=>app,question,openConversation(){}});
    const tools=[...bundle.tools,choice,{descriptor,execute:async()=>{throw Error('Reference read is not a probe');}},intent.tool,
      runtimeModule.createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>app.runtime,getTools:()=>app.tools,
        runDefaultWorker:(task,worker,scope)=>app.runDefaultSubagentWorker(task,worker,scope)})];
    app=runtimeModule.createRuntimeApplication({path:join(directory,'runtime.sqlite'),profile:'huawei_ict_agentarts',hostUserNamespace:'f21-test',delegateUserTasks:true,tools,
      hostOnlyTools:[AUTHORIZATION_INTENT_TOOL],requiresToolAuthorization:()=>true,
      requestToolAuthorization:scope=>{intent.prepareQuestion(scope);return question.requestToolAuthorization(scope);},
      readDefaultExecutionModel:()=>({modelId:'synthetic-f21-model',catalogRevision:'a'.repeat(64)}),
      resolveExecutionModel:()=>({modelId:'synthetic-f21-model',catalogRevision:'a'.repeat(64)}),
      configuredWorkflowWorkers:bundle.configuredWorkflowWorkerPorts.map(worker=>({...worker,image})),coordinationBinding:'synthetic-f21',
      coordination:{execute:async request=>request.continuation?{kind:'text',text:'Synthetic finished',verification:'mock'}:{kind:'tool_proposal',proposalId:'f21-original',
        toolName:'workflow.skills.enable_reference',toolVersion:'1.0.0',arguments:{capability:'workspace-reference'},verification:'unverified'}},
      competitionToolAvailability:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',available:()=>true,publicEnumPaths:tool.descriptor.name==='subagent.dispatch'?['/subtasks/*/role']:[]})),
      competitionToolExports:tools.map(tool=>({toolName:tool.descriptor.name,toolVersion:'1.0.0',exportPolicyVersion:'synthetic',accepts:()=>true,project:({result})=>result}))});
    app.configureReferenceSkill({enabled:false,isToolAvailable:()=>false,currentConfigurationRef:()=>undefined});
  }
  open();t.after(async()=>{intent.close();question.close();app.close();await mcp.dispose();await rm(directory,{recursive:true,force:true});});
  async function run(id){const client=new Client(app);await client.connect();const parent=await client.call('task.submit',{goal:'Synthetic F21 reference',conversationId:'original-'+id},
    {idempotencyKey:id,timeoutMs:120000});let graph;const end=Date.now()+20000;
    while(Date.now()<end){
      for(const card of question.snapshot().filter(card=>card.state==='pending'))question.respond({questionId:card.questionId,expectedRevision:card.revision,decision:'allow_once'},card.conversationId);
      [graph]=app.readSubagentTasks(parent.taskId);if(graph&&app.activeTaskCount===0&&['succeeded','failed','waiting_reconciliation'].includes(graph.state))return graph;
      await new Promise(resolve=>setTimeout(resolve,5));}throw Error('F21 graph did not settle: '+JSON.stringify(app.runtime.listTasks({limit:100}).items.map(item=>({state:item.state,error:item.error,tool:app.runtime.loadCheckpoint(item.taskId,'host-tool-intent')?.toolName}))));}
  const result=await run('first');assert.equal(result.state,'succeeded',JSON.stringify(app.runtime.listTasks({limit:100}).items.map(item=>({state:item.state,error:item.error,
    tool:app.runtime.loadCheckpoint(item.taskId,'host-tool-intent')?.toolName})))+JSON.stringify(last?.nodes));assert.equal(executions,1);assert.equal(enabled,true);
  assert.equal(app.runtime.listTasks({limit:100}).items.filter(item=>app.runtime.loadCheckpoint(item.taskId,'host-tool-intent')?.toolName===AUTHORIZATION_INTENT_TOOL).length,1);
  unknown=true;assert.equal((await run('unknown')).state,'waiting_reconciliation');assert.equal(executions,2);
  intent.close();question.close();app.close();open();assert.equal((await run('after-restart')).state,'waiting_reconciliation');assert.equal(executions,2);
});
