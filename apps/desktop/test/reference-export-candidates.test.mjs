// Prepared native metadata fixtures, not SDK/SQLite/native-UI acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createDesktopReferenceHost} from '../electron/reference-tools-host.js';
import {MCP_READ_RESULT_SCHEMA} from '@personal-agent/mcp';
import {CLOUD_SKILL_TOOL_NAME,CLOUD_SKILL_TOOL_VERSION} from '@personal-agent/skills';

test('native MCP candidates separate preflight from original confirmation and never expose body or borrow Skill run',async()=>{
  const checkpoints=new Map(),key=(taskId,k)=>JSON.stringify([taskId,k]);let active=true,records=[];
  const taskId='synthetic-task',proposalId='synthetic-proposal',deadline=new Date(Date.now()+60000).toISOString();
  const task={taskId,state:'running',cancelRequested:false,evidenceRefs:[]};
  const manifest={id:'workspace-reference-summary',version:'1.0.0',digest:'a'.repeat(64)};
  const runtime={loadCheckpoint:(t,k)=>structuredClone(checkpoints.get(key(t,k))),
    saveCheckpointOnce:(t,k,v)=>{if(checkpoints.has(key(t,k)))return false;checkpoints.set(key(t,k),structuredClone(v));return true;},
    getTask:()=>structuredClone(task),readToolExecutions:()=>structuredClone(records),requestCancel:()=>{},
    matchesToolExecutionInput:(record,input)=>JSON.stringify(record.input)===JSON.stringify(input)};
  const application={runtime,configureReferenceSkill:()=>{},setReferenceSkillEnabled:()=>{},referenceSkillSnapshot:()=>({manifest})};
  const descriptor={name:'mcp.workspace.read_text',version:'1.0.0',inputSchema:{type:'object',properties:{path:{type:'string',minLength:1,maxLength:1024}},required:['path'],additionalProperties:false},outputSchema:MCP_READ_RESULT_SCHEMA};
  const createMcp=()=>{let connected=false;return {tools:[{descriptor}],health:()=>({connected}),start:async()=>{connected=true;},dispose:async()=>{connected=false;}};};
  let publicRefs=['public-reference'],skillAllowed=true,replaceBindingOnAliasRead=false;
  const host=createDesktopReferenceHost({hostUserNamespace:'synthetic-user',workspace:{
    readWorkspaceBinding:()=>({rootPath:'synthetic-root',nodeExecutable:'synthetic-node',bindingId:'synthetic-session'}),
    isWorkspaceBindingCurrent:()=>active},createMcp,resolvePublicSkillPath:()=> 'public.md',
    publicSkillAvailability:async()=>skillAllowed,
    readPublicSkillSourceRefs:input=>{
      assert.equal(input.taskId,taskId);assert.equal(typeof input.configurationRef,'string');
      if(replaceBindingOnAliasRead) active=false;
      return publicRefs;
    }});
  host.bindApplication(application);await host.setMcpEnabled(true);host.bindTask(taskId);
  host.configureCloudSkillWorker({manifest:()=>manifest,health:()=>({connected:true}),invoke:async()=>{throw Error('catalog must not read');}});
  const catalogInput={taskId,deadline,signal:new AbortController().signal};
  const catalog=await host.cloudSkillCatalog(catalogInput);
  assert.deepEqual(catalog.inputSchema.properties.sourceRef.enum,['public-reference']);
  assert.equal(JSON.stringify(catalog).includes('public.md'),false);
  publicRefs=[];assert.equal(await host.cloudSkillCatalog(catalogInput),undefined);
  publicRefs=['../private.md'];assert.equal(await host.cloudSkillCatalog(catalogInput),undefined);
  publicRefs=['public-reference'];skillAllowed=false;assert.equal(await host.cloudSkillCatalog(catalogInput),undefined);skillAllowed=true;
  replaceBindingOnAliasRead=true;assert.equal(await host.cloudSkillCatalog(catalogInput),undefined);replaceBindingOnAliasRead=false;active=true;
  assert.equal(await host.cloudSkillCatalog({...catalogInput,signal:AbortSignal.abort()}),undefined);
  assert.equal(await host.cloudSkillCatalog({...catalogInput,deadline:new Date(0).toISOString()}),undefined);
  const put=(k,v)=>checkpoints.set(key(taskId,k),structuredClone(v));
  put('application-profile','huawei_ict_agentarts');put('application-deadline',deadline);
  const proposal={kind:'tool_proposal',proposalId,toolName:descriptor.name,toolVersion:descriptor.version,arguments:{path:'public.md'},verification:'unverified'};
  put('competition-loop',{step:1,pending:proposal,receipts:[]});
  const query={taskId,proposalId,path:'public.md',configurationRef:runtime.loadCheckpoint(taskId,'desktop-reference-binding-v1')};
  const preflight=host.readPublicReferencePreflightCandidate(query);
  assert.equal(preflight.runId,`competition-tool-${taskId}-1`);assert.equal(preflight.contentDigest,undefined);
  assert.deepEqual(preflight.arguments,{path:query.path});assert.ok(Object.isFrozen(preflight.arguments));
  assert.equal(host.readPublicReferenceCandidate(query),undefined);
  const text='PUBLIC fixture.',contentDigest=createHash('sha256').update(text).digest('hex');
  const result={path:query.path,text,contentDigest,source:'mcp',serverVersion:'2026.8.31'};
  const runId=preflight.runId;
  records=[{evidenceId:runId,state:'confirmed',policyDecision:'allow',executionStarted:true,finishedAt:new Date().toISOString(),
    toolName:descriptor.name,toolVersion:descriptor.version,input:{arguments:proposal.arguments,scopeRef:runId}}];
  task.evidenceRefs=[runId];put('tool-result-'+runId,{result});
  const candidate=host.readPublicReferenceCandidate(query);
  assert.equal(candidate.contentDigest,contentDigest);assert.equal(candidate.byteLength,Buffer.byteLength(text));
  assert.equal(candidate.text,undefined);assert.equal(candidate.result,undefined);
  assert.deepEqual(host.readConfirmedPublicReference({...query,arguments:proposal.arguments,contentDigest}),{runId,result});
  put('competition-loop',{step:2,receipts:[{proposal}]});assert.equal(host.readPublicReferenceCandidate(query).runId,runId);
  for(const change of [{taskId:'foreign-task'},{path:'private.md'},{configurationRef:'replacement'},{public:true}])
    assert.equal(host.readPublicReferenceCandidate({...query,...change}),undefined);
  task.evidenceRefs=[];assert.equal(host.readPublicReferenceCandidate(query),undefined);task.evidenceRefs=[runId];
  records[0].policyDecision='deny';assert.equal(host.readPublicReferenceCandidate(query),undefined);records[0].policyDecision='allow';
  put('tool-result-'+runId,{result:{...result,text:'changed'}});assert.equal(host.readPublicReferenceCandidate(query),undefined);
  put('tool-result-'+runId,{result});
  const skillProposal='synthetic-skill-proposal',choice={skillId:manifest.id,version:manifest.version,digest:manifest.digest,sourceRef:'public-source'};
  put('competition-loop',{step:2,pending:{kind:'tool_proposal',proposalId:skillProposal,toolName:CLOUD_SKILL_TOOL_NAME,
    toolVersion:CLOUD_SKILL_TOOL_VERSION,arguments:choice,verification:'unverified'},receipts:[{proposal}]});
  const skillQuery={...query,proposalId:skillProposal};
  assert.equal(host.readPublicReferencePreflightCandidate(skillQuery).runId,`skill-read-${taskId}-${manifest.digest.slice(0,16)}`);
  assert.equal(host.readPublicReferenceCandidate(skillQuery),undefined); // A confirmed Competition run cannot stand in for Skill.
  task.cancelRequested=true;assert.equal(host.readPublicReferencePreflightCandidate(skillQuery),undefined);task.cancelRequested=false;
  active=false;assert.equal(host.readPublicReferenceCandidate(query),undefined);
  await host.dispose();
});

test('cloud Skill selector recovers across MCP connect/reconnect while keeping prior session receipts isolated (L-01)',async()=>{
  const checkpoints=new Map(),key=(taskId,k)=>JSON.stringify([taskId,k]);
  let active=true,skillEnabled=false;
  const deadline=new Date(Date.now()+60000).toISOString();
  const manifest={id:'workspace-reference-summary',version:'1.0.0',digest:'b'.repeat(64)};
  const text='# Public Reference\nLine one.\nLine two.';
  const contentDigest=createHash('sha256').update(text).digest('hex');
  const tasksMap=new Map([
    ['task-a',{taskId:'task-a',state:'running',cancelRequested:false,evidenceRefs:[]}],
    ['task-b',{taskId:'task-b',state:'running',cancelRequested:false,evidenceRefs:[]}],
  ]);
  const runtime={
    loadCheckpoint:(t,k)=>structuredClone(checkpoints.get(key(t,k))),
    saveCheckpoint:(t,k,v)=>{checkpoints.set(key(t,k),structuredClone(v));},
    saveCheckpointOnce:(t,k,v)=>{if(checkpoints.has(key(t,k)))return false;checkpoints.set(key(t,k),structuredClone(v));return true;},
    getTask:t=>structuredClone(tasksMap.get(t)),
    readToolExecutions:()=>[],
    requestCancel:()=>{},
    matchesToolExecutionInput:()=>true,
  };
  const application={
    runtime,
    configureReferenceSkill:()=>{},
    setReferenceSkillEnabled:value=>{skillEnabled=value;},
    referenceSkillSnapshot:()=>({manifest,health:{state:skillEnabled?'ready':'unavailable',enabled:skillEnabled}}),
  };
  const descriptor={name:'mcp.workspace.read_text',version:'1.0.0',inputSchema:{type:'object',properties:{path:{type:'string',minLength:1,maxLength:1024}},required:['path'],additionalProperties:false},outputSchema:MCP_READ_RESULT_SCHEMA};
  const createMcp=()=>{let connected=false;return {tools:[{descriptor}],health:()=>({connected}),start:async()=>{connected=true;},dispose:async()=>{connected=false;}};};
  const host=createDesktopReferenceHost({
    hostUserNamespace:'synthetic-user',
    workspace:{
      readWorkspaceBinding:()=>({rootPath:'synthetic-root',nodeExecutable:'synthetic-node',bindingId:'synthetic-session'}),
      isWorkspaceBindingCurrent:()=>active,
    },
    createMcp,
    publicSkillAvailability:async()=>skillEnabled,
    readPublicSkillSourceRefs:()=>['public-ref-1'],
    resolvePublicSkillSource:input=>({
      path:'public.md',
      sourceRef:input.sourceRef,
      configurationRef:input.configurationRef,
      revision:input.revision,
      sensitivity:'PUBLIC',
      purpose:'reference-summary',
      maxExportBytes:262144,
      authorizationId:'auth-public-1',
      expiresAt:deadline,
    }),
    publicReferenceExport:{
      readPreflight:()=>({sensitivity:'PUBLIC',purpose:'reference-summary',maxExportBytes:262144,authorizationId:'auth-public-1',expiresAt:deadline}),
      readAuthorization:()=>({sensitivity:'PUBLIC',purpose:'reference-summary',maxExportBytes:262144,authorizationId:'auth-public-1',expiresAt:deadline,contentDigest}),
      readConfirmed:query=>query.contentDigest===contentDigest?{runId:'skill-read-run',result:{path:'public.md',text,contentDigest,source:'mcp',serverVersion:'2026.8.31'}}:undefined,
    },
  });
  // Production startup order (main.js): bindApplication + configureCloudSkillWorker BEFORE connecting MCP.
  host.bindApplication(application);
  const initialSelector=host.configureCloudSkillWorker({
    manifest:()=>manifest,
    health:()=>({connected:skillEnabled}),
    invoke:async()=>({state:'confirmed',sources:[{path:'public.md',contentDigest}]}),
  });
  assert.ok(initialSelector);
  // Before MCP connects, catalog is unavailable.
  assert.equal(await host.cloudSkillCatalog({taskId:'task-a',deadline,signal:new AbortController().signal}),undefined);

  // Connect MCP (calls stop() internally) and enable local reference Skill.
  await host.setMcpEnabled(true);
  host.setSkillEnabled(true);
  const catalogA=await host.cloudSkillCatalog({taskId:'task-a',deadline,signal:new AbortController().signal});
  assert.equal(catalogA?.name,CLOUD_SKILL_TOOL_NAME);
  assert.deepEqual(catalogA?.inputSchema.properties.sourceRef.enum,['public-ref-1']);

  const proposalA={
    kind:'tool_proposal',
    proposalId:'prop-a',
    toolName:CLOUD_SKILL_TOOL_NAME,
    toolVersion:CLOUD_SKILL_TOOL_VERSION,
    arguments:{skillId:manifest.id,version:manifest.version,digest:manifest.digest,sourceRef:'public-ref-1'},
    verification:'unverified',
  };
  const ctxA={
    taskId:'task-a',
    revision:1,
    deadline,
    signal:new AbortController().signal,
    loadCheckpoint:k=>runtime.loadCheckpoint('task-a',k),
    saveCheckpoint:(k,v)=>runtime.saveCheckpoint('task-a',k,v),
  };
  const receiptA=await host.dispatchCloudSkillProposal(proposalA,ctxA);
  assert.equal(receiptA.state,'confirmed');
  const savedA=runtime.loadCheckpoint('task-a','skill:cloud-selection:v1');
  assert.doesNotThrow(()=>host.assertCloudSkillReceiptAllowed(savedA.selection,receiptA,{...ctxA,proposalId:'prop-a'}));
  // The pre-connect selector instance was closed by stop() and must never stay active.
  assert.throws(()=>initialSelector.assertReceiptAllowed(savedA.selection,receiptA,{...ctxA,proposalId:'prop-a'}),/stopped/i);

  // Reconnect MCP: starts a fresh session with a new configurationRef.
  await host.setMcpEnabled(true);
  host.setSkillEnabled(true);
  // Prior session task must remain isolated and cannot reuse or validate receipts under the new connection.
  assert.equal(await host.cloudSkillCatalog({taskId:'task-a',deadline,signal:new AbortController().signal}),undefined);
  assert.throws(()=>host.assertCloudSkillReceiptAllowed(savedA.selection,receiptA,{...ctxA,proposalId:'prop-a'}));

  // New session task publishes the Skill catalog, dispatches, and passes receipt validation cleanly.
  const catalogB=await host.cloudSkillCatalog({taskId:'task-b',deadline,signal:new AbortController().signal});
  assert.equal(catalogB?.name,CLOUD_SKILL_TOOL_NAME);
  assert.deepEqual(catalogB?.inputSchema.properties.sourceRef.enum,['public-ref-1']);
  const proposalB={...proposalA,proposalId:'prop-b'};
  const ctxB={
    taskId:'task-b',
    revision:1,
    deadline,
    signal:new AbortController().signal,
    loadCheckpoint:k=>runtime.loadCheckpoint('task-b',k),
    saveCheckpoint:(k,v)=>runtime.saveCheckpoint('task-b',k,v),
  };
  const receiptB=await host.dispatchCloudSkillProposal(proposalB,ctxB);
  assert.equal(receiptB.state,'confirmed');
  const savedB=runtime.loadCheckpoint('task-b','skill:cloud-selection:v1');
  assert.doesNotThrow(()=>host.assertCloudSkillReceiptAllowed(savedB.selection,receiptB,{...ctxB,proposalId:'prop-b'}));

  // Disabling MCP clears cloudSkill and fails closed.
  await host.setMcpEnabled(false);
  assert.equal(await host.cloudSkillCatalog({taskId:'task-b',deadline,signal:new AbortController().signal}),undefined);
  await assert.rejects(()=>host.dispatchCloudSkillProposal(proposalB,ctxB),/unavailable/i);
  assert.throws(()=>host.assertCloudSkillReceiptAllowed(savedB.selection,receiptB,{...ctxB,proposalId:'prop-b'}),/unavailable/i);

  const mainSource=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
  assert.match(mainSource,/assertReceiptAllowed:\(selection,receipt,context\)=>referenceHost\.assertCloudSkillReceiptAllowed\(selection,receipt,context\)/);

  await host.dispose();
});
