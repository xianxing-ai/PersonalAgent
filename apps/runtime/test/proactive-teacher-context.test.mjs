import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createAgentArtsRuntimeApplication,createRuntimeApplication} from '../dist/application.js';
import {ProactiveWorkflowEngine,createProactiveHostProofs} from '@personal-agent/agentarts';
import {Client} from '@personal-agent/client';
import {ProtocolError} from '@personal-agent/contracts';
import {createHash} from 'node:crypto';

const until=async predicate=>{for(let n=0;n<600;n++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Synthetic production teacher did not settle');};
const PREFIX='competition-context:v1:proactive-teacher:';
function fixture({unknown=false,mutateConfiguration=false,revokeGrant=false,holdAuthorization=false}={}) {
  const cache=resolve('.cache/wiring-20261018/core');mkdirSync(cache,{recursive:true});
  const folder=mkdtempSync(join(cache,'teacher-context-')),path=join(folder,'runtime.sqlite');
  const deadline=new Date(Date.now()+90_000).toISOString(),proofs=createProactiveHostProofs('synthetic-production-teacher-proof-key-32');
  const contract={id:'synthetic-teacher',version:'1',criteria:'Preserve each original public instruction',qualifiedForMain:false,
    batchIndependent:true,candidates:[{id:'defer',action:'defer',description:'Keep pending'},{id:'ignore',action:'ignore',description:'Ignore only irrelevant'}]};
  const engine=new ProactiveWorkflowEngine({checkpointSecret:'synthetic-production-teacher-state-key-32',decisionContracts:[contract],
    verifyEvent:async(value,binding)=>proofs.verify('event',value,binding),
    verifyResponsibility:async(value,binding)=>proofs.verify('responsibility',value,binding),
    verifyReceipt:async(value,_proposal,binding)=>proofs.verify('receipt',value,binding),
    verifyControl:async(value,binding)=>proofs.verify('control',value,binding)});
  let app,host,task,worker,changed=false,sends=0,credentials=0,originalSignal,releaseAuthorization;
  const guardCopies=[],hookCalls=[],payloads=[];
  const open=()=>{
    // Catalog-mode factory requires explicit bindings. This unused Synthetic tool never executes/exports;
    // the production teacher remains internal and sends textOnly with no catalog.
    const unused={descriptor:{name:'synthetic.unused',version:'1.0.0',inputSchema:{type:'object',properties:{}},outputSchema:{type:'object'},
      sideEffect:'read',requiredScopes:['synthetic:unused'],requiresPresence:false,idempotencySupport:true,recoverySupport:true},execute:()=>assert.fail('Unused catalog fixture')};
    const options={path,hostUserNamespace:'synthetic-teacher-context',proactiveWorkflows:true,tools:[unused],
      gatewayUrl:'https://synthetic-teacher.invalid',runtimeName:'synthetic-no-network',
      responseMode:'tool-proposal-json',initialRequestMode:'goal-with-tools-json',
      competitionToolAvailability:[{toolName:unused.descriptor.name,toolVersion:'1.0.0',available:()=>false}],
      competitionToolExports:[{toolName:unused.descriptor.name,toolVersion:'1.0.0',exportPolicyVersion:'synthetic-unused',accepts:()=>false,
        project:()=>assert.fail('Unused catalog export')}],
      assertDeploymentBinding:()=>{if(changed)throw Error('Synthetic deployment changed');},
      automaticTools:['proactive.retrieve_context','proactive.update_item','proactive.teacher_decision']
        .map(toolName=>({toolName,toolVersion:'1.0.0'})),
      coordinationInput:{prepareCoordinationGoal:async scope=>{originalSignal=scope.signal;return scope.publicGoal;},
        readConversationContext:async()=>[],beforeCoordinationSend:(request)=>{hookCalls.push(request.goal);}},
      authorizationProvider:{read:async()=>{credentials++;if(mutateConfiguration)changed=true;
        if(revokeGrant){const original=app.runtime.readToolExecutions(task.taskId).find(value=>value.toolName==='proactive.teacher_decision'&&value.state==='started');
          assert.ok(original);app.runtime.policy.revoke(original.evidenceId);}
        if(holdAuthorization)await new Promise(resolve=>{releaseAuthorization=resolve;});return 'Bearer synthetic';}},
      beforeCompetitionSend:request=>{
        assert.equal(request.textOnly,true);assert.equal(request.availableTools,undefined);assert.equal(request.continuation,undefined);
        assert.notEqual(request.signal,originalSignal,'Actual coordinator/AgentArts adapter supplied its combined signal');
        const foreign={...request,goal:request.goal+' foreign-input',signal:new AbortController().signal};
        assert.throws(()=>app.assertCompetitionExportAllowed(foreign),{code:'UNAUTHORIZED'});
        assert.throws(()=>app.assertCompetitionExportAllowed({...request,availableTools:[]}),{code:'UNAUTHORIZED'});
        if(guardCopies.length)assert.throws(()=>app.assertCompetitionExportAllowed({...guardCopies[0],signal:new AbortController().signal}),{code:'UNAUTHORIZED'},
          'Previous run cannot borrow the next live run slot');
        guardCopies.push(request);
      },
      fetchImpl:async(_url,init)=>{
        sends++;payloads.push(JSON.parse(init.body).query);
        const operation=Object.values(host.inspect().session.state.operations).find(value=>value.invocation.toolName==='proactive.teacher_decision'
          &&app.runtime.readToolExecutions(task.taskId).some(record=>record.evidenceId===value.invocation.runId&&record.state==='started'));
        assert.ok(operation);const questions=operation.invocation.arguments.independentQuestions;
        for(const question of questions)assert.ok(payloads.at(-1).includes(question.itemId));
        const result={kind:'text',text:JSON.stringify({selections:questions.map(question=>({itemId:question.itemId,candidateId:'defer',
          uncertain:false,complex:false,importance:'normal',authorityRequired:false}))})};
        return new Response(JSON.stringify({event:'message',data:{text:JSON.stringify(result)}}),{headers:{'content-type':'application/json'}});
      }};
    app=unknown?createRuntimeApplication({...options,profile:'huawei_ict_agentarts',
      assertCoordinationBinding:options.assertDeploymentBinding,coordinationBinding:'synthetic-teacher-unknown-v1',
      coordination:{execute:async request=>{
        // Explicit Synthetic unknown classification at the original CoordinationPort boundary.
        const copy={...request,signal:AbortSignal.any([request.signal,new AbortController().signal])};
        app.assertCompetitionExportAllowed(copy);sends++;payloads.push(request.goal);
        throw new ProtocolError('RESULT_UNKNOWN','Synthetic teacher provider requires original readback');
      }}}):createAgentArtsRuntimeApplication(options);
    task??=app.runtime.submitTask({goal:'Maintain the original public responsibility',conversationId:'desktop-panel',idempotencyKey:'responsibility'});
    host=app.createProactiveWorkflowHost({taskId:task.taskId,sessionId:'synthetic-teacher-session',taskDeadline:deadline,contractRef:contract.id,
      advancePort:async input=>proofs.sign('advance_result',{requestId:input.requestId,...await engine.advance(input)},input),
      verifyAdvance:(result,input)=>proofs.verify('advance_result',result,input),sign:proofs.sign,localDeviceAvailable:()=>true,
      bindings:[{kind:'teacher_decision',toolName:'proactive.teacher_decision',toolVersion:'1.0.0',location:'local_device',effect:'read'}]});
  };
  open();
  const source=number=>{const source=app.runtime.submitTask({goal:'Public source canary '+number,conversationId:'desktop-panel',idempotencyKey:'source-'+number});
    host.ingestUserInstruction({sourceTaskId:source.taskId},{deadline,signal:new AbortController().signal});return source;};
  const teacherRecords=()=>app.runtime.readToolExecutions(task.taskId).filter(value=>value.toolName==='proactive.teacher_decision');
  return {get app(){return app;},get host(){return host;},get task(){return task;},deadline,source,teacherRecords,payloads,hookCalls,guardCopies,
    sends:()=>sends,credentials:()=>credentials,release:()=>releaseAuthorization?.(),
    start(){worker=app.runProactiveTask(task.taskId);worker.catch(()=>{});return worker;},
    async reopen(){await worker?.catch(()=>{});app.close();open();worker=undefined;},
    async close(){releaseAuthorization?.();if(app.runtime.getTask(task.taskId).state==='running')app.runtime.requestCancel(task.taskId,'Synthetic cleanup');
      await worker?.catch(()=>{});await until(()=>app.activeTaskCount===0);app.close();rmSync(folder,{recursive:true,force:true});}};
}

test('Production teacher + Runtime input hooks handles two signed public rounds with per-run immutable context and actual copied final guard',async()=>{
  const f=fixture();try {
    f.source(1);f.start();await until(()=>f.teacherRecords().length>0&&f.teacherRecords().every(value=>value.state!=='started'));
    assert.equal(f.teacherRecords()[0].state,'confirmed',JSON.stringify({record:f.teacherRecords()[0],
      credentials:f.credentials(),sends:f.sends(),hooks:f.hookCalls.length}));
    await until(()=>Object.values(f.host.inspect().application.state.lastResult?.items??{}).every(item=>item.stage==='done'));
    f.source(2);await until(()=>f.teacherRecords().filter(value=>value.state==='confirmed').length===2);
    assert.equal(f.sends(),2);assert.notEqual(f.payloads[0],f.payloads[1]);assert.ok(f.hookCalls.length>=4);
    assert.equal(f.app.runtime.loadCheckpoint(f.task.taskId,'competition-context:v1'),undefined,'Ordinary task slot remains untouched');
    const proposals=Object.values(f.host.inspect().session.state.proposals).filter(value=>value.capabilityKind==='teacher_decision');
    for(const proposal of proposals) {
      const receipt=await f.host.executeProposal(proposal,{deadline:f.deadline,signal:new AbortController().signal});
      assert.equal(receipt.state,'confirmed','Exact confirmed run is read back without another exchange');
      const record=f.teacherRecords().find(value=>value.evidenceId===proposal.operationId);assert.equal(record.policyDecision,'allow');
      const key=PREFIX+createHash('sha256').update(proposal.operationId).digest('hex');
      const metadata=f.app.runtime.loadCheckpoint(f.task.taskId,key);assert.equal(metadata.version,1);
      assert.doesNotMatch(JSON.stringify(metadata),/Public source canary|independentQuestions|sourceTexts/);
      assert.equal(f.app.runtime.loadCheckpoint(f.task.taskId,key+':attempt').runId,proposal.operationId);
    }
    assert.equal(f.sends(),2);
    const invocation=Object.values(f.host.inspect().session.state.operations).find(value=>value.invocation.toolName==='proactive.teacher_decision').invocation;
    await assert.rejects(f.app.tools.invoke({...invocation,arguments:{...invocation.arguments,authorityBoundary:'changed'},
      signal:new AbortController().signal}));
    assert.equal(f.sends(),2,'Changed original run arguments never obtain a new context slot');
  }finally{await f.close();}
});

test('Production teacher final credential guard rejects changed deployment or revoked original Policy grant before HTTP',async()=>{
  for(const options of [{mutateConfiguration:true},{revokeGrant:true}]) {
    const f=fixture(options);try {
      f.source(1);f.start();await until(()=>f.teacherRecords().length>0&&f.teacherRecords().every(value=>value.state!=='started'));
      assert.equal(f.credentials(),1);assert.equal(f.sends(),0);
      assert.equal(f.app.teacherLeases.size,0);assert.equal(f.app.ephemeralSends.size,0);
      assert.equal(f.app.ephemeralGoals.size,0);assert.equal(f.app.ephemeralContexts.size,0);
    }finally{await f.close();}
  }
});

test('Task cancellation while teacher credentials wait revokes the original run lease and blocks the copied late send',async()=>{
  const f=fixture({holdAuthorization:true});try {
    f.source(1);const worker=f.start();await until(()=>f.credentials()===1);
    const client=new Client(f.app);await client.connect();await client.call('task.cancel',{taskId:f.task.taskId,reason:'Synthetic cancellation'});
    assert.equal(f.app.teacherLeases.size,0);assert.equal(f.app.ephemeralSends.size,0);
    f.release();await worker;assert.equal(f.sends(),0);assert.equal(f.app.ephemeralContexts.size,0);
  }finally{await f.close();}
});

test('Unknown teacher run survives SQLite reopen as readback-only and never resends the original request',async()=>{
  const f=fixture({unknown:true});try {
    f.source(1);f.start();await until(()=>f.app.runtime.getTask(f.task.taskId).state==='waiting_reconciliation'||f.app.activeTaskCount===0);
    assert.equal(f.sends(),1);
    assert.equal(f.app.runtime.getTask(f.task.taskId).state,'waiting_reconciliation');
    await f.reopen();await assert.rejects(f.start());
    assert.equal(f.sends(),1);assert.equal(f.app.teacherLeases.size,0);
    assert.equal(f.app.runtime.getTask(f.task.taskId).state,'waiting_reconciliation');
  }finally{await f.close();}
});

test('Original copy erasure revokes every task teacher lease before the credential wait can export',async()=>{
  const f=fixture({holdAuthorization:true});try {
    f.app.runtime.saveCheckpoint(f.task.taskId,'application-deadline',f.deadline);
    f.source(1);f.start();await until(()=>f.credentials()===1);
    const hash=value=>createHash('sha256').update(value).digest('hex');
    const binding={taskId:f.task.taskId,conversationId:'desktop-panel',destination:'agentarts',
      configurationRef:f.app.coordinationConfigurationRef,deadline:f.deadline,userGoalDigest:hash(f.task.goal),
      fact:{ref:{id:'synthetic-private-identity',revision:1},summaryDigest:hash('synthetic summary'),
        sourceDigest:hash('synthetic source'),configurationRef:'synthetic-private-v1'}};
    f.app.writePrivateTaskBinding(f.task.taskId,binding);
    assert.equal((await f.app.eraseTaskCopies({taskId:f.task.taskId,factId:binding.fact.ref.id,
      bindingDigest:hash(JSON.stringify(binding)),deadline:f.deadline,signal:new AbortController().signal})).state,'withheld');
    assert.equal(f.app.teacherLeases.size,0);assert.equal(f.app.ephemeralSends.size,0);
    assert.equal(f.app.ephemeralGoals.size,0);assert.equal(f.app.ephemeralContexts.size,0);
    f.release();await until(()=>f.teacherRecords().every(value=>value.state!=='started'));assert.equal(f.sends(),0);
  }finally{await f.close();}
});
