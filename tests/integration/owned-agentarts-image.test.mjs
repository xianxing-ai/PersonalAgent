import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {Client} from '@personal-agent/client';
import {createAgentArtsRuntimeApplication} from '@personal-agent/runtime/application';
import {OwnedAgentOrchestrator} from '@personal-agent/agentarts';
import {FakeModelProvider} from '@personal-agent/models';
import {createAgentServer} from '@personal-agent/agentarts-runtime';
const wait=async(app,id,states)=>{
  for(let i=0;i<300;i++) {const task=app.runtime.getTask(id); if(states.includes(task.state)) return task; await new Promise(r=>setTimeout(r,5));}
  throw Error(`Task did not reach expected state: ${app.runtime.getTask(id).state}`);
};
for (const failContinuation of [false,true]) test(`owned HTTP agent uses Runtime approval and confirmed file evidence; continuationFailure=${failContinuation}`,async t=>{
  const base=new URL('../../.cache/owned-image-integration/',import.meta.url); await mkdir(base,{recursive:true});
  const directory=await mkdtemp(new URL('case-',base));
  await writeFile(directory+'/public-fixture.txt','合成工作区文件：会议16:00。','utf8');
  const proposal={kind:'tool_proposal',proposalId:'file-1',toolName:'fixture.read',toolVersion:'1.0.0',arguments:{path:'public-fixture.txt'}};
  const fast=new FakeModelProvider([{kind:'final',text:JSON.stringify(proposal)},
    {kind:'final',text:failContinuation ? 'malformed' : JSON.stringify({kind:'text',text:'已确认文件中会议为16:00。'})}]);
  const unused=new FakeModelProvider([]);
  const server=createAgentServer({mode:'standalone-validation',orchestrator:new OwnedAgentOrchestrator({fast,world:unused,plan:unused,review:unused},2048)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let app;
  t.after(async()=>{app?.close(); await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await rm(directory,{recursive:true,force:true});});
  let executions=0; const sent=[];
  app=createAgentArtsRuntimeApplication({path:directory+'/runtime.sqlite',gatewayUrl:'https://synthetic-agentarts.test',runtimeName:'owned',
    responseMode:'tool-proposal-json',initialRequestMode:'goal-with-tools-json',repairCandidateVersion:'1.0',
    authorizationProvider:{read:async()=> 'Bearer synthetic-token'},
    competitionToolAvailability:[{toolName:proposal.toolName,toolVersion:proposal.toolVersion,available:()=>true,publicEnumPaths:['/path']}],
    competitionToolExports:[{toolName:proposal.toolName,toolVersion:proposal.toolVersion,exportPolicyVersion:'fixture-v1',accepts:({arguments:args})=>args.path==='public-fixture.txt',project:({result})=>({value:result.value})}],
    tools:[{descriptor:{name:proposal.toolName,version:proposal.toolVersion,
      inputSchema:{type:'object',properties:{path:{type:'string',enum:['public-fixture.txt']}},required:['path'],additionalProperties:false},
      outputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},
      sideEffect:'read',requiredScopes:['fixture:read'],idempotencySupport:true,recoverySupport:true,requiresPresence:false},
      execute:async()=>{executions++;return {value:await readFile(directory+'/public-fixture.txt','utf8')};}}],
    fetchImpl:async(_url,init)=>{sent.push(JSON.parse(init.body));return fetch(`http://127.0.0.1:${server.address().port}/invocations`,init);},
  });
  {
    const client=new Client(app); await client.connect();
    const {taskId}=await client.call('task.submit',{goal:'读取public-fixture.txt',conversationId:'owned-image'},{idempotencyKey:'owned-file'});
    assert.equal((await wait(app,taskId,['waiting_approval','failed'])).state,'waiting_approval');
    assert.equal(executions,0);
    const approval=(await client.call('approval.list',{taskId})).items[0];
    await client.call('authorization.respond',{approvalId:approval.approvalId,expectedRevision:approval.revision,decision:'allow_once'});
    const task=await wait(app,taskId,['succeeded','failed','waiting_reconciliation']);
    assert.equal(task.state,failContinuation?'waiting_reconciliation':'succeeded');
    assert.equal(executions,1); assert.equal(app.runtime.readToolExecutions(taskId)[0].state,'confirmed');
    assert.equal(task.evidenceRefs.length>0,true);
    assert.equal(sent.length,2); assert.equal(sent[1].query.includes('repairContext'),false);
    assert.equal(fast.requests.length,2); assert.equal(unused.requests.length,0);
    if(failContinuation) assert.equal(task.resultSummary,undefined);
    else assert.match(task.resultSummary,/16:00/);
  }
});
