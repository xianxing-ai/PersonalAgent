import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopWorkflowGraphComposition} from '../electron/workflow-graph-composition.js';

test('registered mail and local observation tools do not substitute for trusted graph ports',()=>{
  let factories=0;
  const runtimeModule={
    createRuntimeF08OperationScopeHost:()=>{factories++;return {tools:[{descriptor:{name:'workflow.host.f08_n10'}}]};},
    createRuntimeF13SystemProbeHost:()=>{factories++;return {tools:[{descriptor:{name:'workflow.host.f13_n02'}}]};},
  };
  const composed=createDesktopWorkflowGraphComposition({runtimeModule,getApplication:()=>({}),
    mailHost:{tools:[{descriptor:{name:'mail.inbox'}}]},
    systemObserveTool:{descriptor:{name:'computer.system.observe',requiredScopes:['computer:system:read']},execute:()=>assert.fail('direct execute')},
  });
  assert.equal(factories,0);
  assert.deepEqual(composed.tools,[]);
  assert.ok(composed.unavailable.includes('f08_operation_scope_mail_host_unavailable'));
  assert.ok(composed.unavailable.includes('f13_system_probe_observation_unavailable'));
});

test('graph composition forwards trusted operation checks and gateway invocation without fabricating probe facts',async()=>{
  let mail,probe,cancelled=false;
  const runtimeModule={
    createRuntimeF08OperationScopeHost:options=>{mail=options;return {tools:[]};},
    createRuntimeF13SystemProbeHost:options=>{probe=options;return {tools:[]};},
  };
  const verifyMailOperationScope=async()=>({ready:false,blockingReason:'exact_scope_denied'});
  const invokeSystemObserve=async()=>({cpu:1});
  const resolveSystemProbeOutcome=async()=>{throw Error('cloud probe unavailable');};
  createDesktopWorkflowGraphComposition({runtimeModule,
    getApplication:()=>({runtime:{getTask:()=>({state:'running',cancelRequested:cancelled})}}),
    mailHost:{tools:[{descriptor:{name:'mail.inbox'}}]},verifyMailOperationScope,
    systemObserveTool:{descriptor:{name:'computer.system.observe',requiredScopes:['computer:system:read']}},
    invokeSystemObserve,resolveSystemProbeOutcome,
  });
  assert.equal(mail.verifyOperationScope,verifyMailOperationScope);
  assert.equal(probe.invokeSystemObserve,invokeSystemObserve);
  assert.equal(probe.resolveProbeOutcome,resolveSystemProbeOutcome);
  const scope={parentTaskId:'parent',localTaskId:'child'};
  mail.assertCurrent(scope);probe.assertCurrent(scope);
  cancelled=true;
  assert.throws(()=>mail.assertCurrent(scope),/no longer current/);
  assert.throws(()=>probe.assertCurrent(scope),/no longer current/);
});
