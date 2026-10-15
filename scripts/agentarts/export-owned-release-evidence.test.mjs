import assert from 'node:assert/strict';
import test from 'node:test';
import {projectOwnedReleaseEvidence,projectOwnedLayaTokenTelemetry} from './export-owned-release-evidence.mjs';

const tokenWindow={formatVersion:'1.0.0',truncated:false,droppedTokens:0,encoderMaxTokens:8192,maxLength:2001,headMaxLength:512,
  stateTokens:[1890],requiredSequenceTokens:[2001],expectedInputTokens:[2001],headerTokens:[110],encodedTokens:2001};

test('batch telemetry preserves validated shared identity without exporting or summing repeated forward timing',()=>{
  const batchId='11111111-2222-4333-8444-555555555555';
  const records=[0,1].map(index=>projectOwnedLayaTokenTelemetry({batchId,batchSize:2,submittedBatchSize:2,
    batchItemId:`11111111-2222-4333-8444-55555555555${index}`,sharedForwardScope:'sdk_heterogeneous_forward',
    tokenWindow,queueWaitMs:index,inferenceMetrics:{forwardMs:25},privateCandidate:'never export this'}));
  assert.ok(records.every(item=>item.batchId===batchId&&item.batchSize===2&&item.sharedForwardScope==='sdk_heterogeneous_forward'));
  assert.equal(new Set(records.map(item=>item.batchId)).size,1);
  assert.equal(new Set(records.map(item=>item.batchItemId)).size,2);assert.ok(records.every(item=>item.submittedBatchSize===2));
  assert.equal(JSON.stringify(records).includes('forwardMs'),false);assert.equal(JSON.stringify(records).includes('never export'),false);
  const single=projectOwnedLayaTokenTelemetry({batchId,batchSize:1});
  assert.equal(single.batchSize,1);assert.equal(Object.hasOwn(single,'sharedForwardScope'),false);
  const partial=projectOwnedLayaTokenTelemetry({batchId,batchSize:1,submittedBatchSize:2,sharedForwardScope:'sdk_heterogeneous_forward'});
  assert.equal(partial.batchSize,1);assert.equal(partial.submittedBatchSize,2);
  for(const invalid of [{batchId:'private arbitrary text',batchSize:2},{batchId,batchSize:5},{batchId,batchSize:0},
    {batchId,batchSize:2,submittedBatchSize:1}]) {
    const value=projectOwnedLayaTokenTelemetry(invalid);assert.equal(Object.hasOwn(value,'batchId'),false);assert.equal(Object.hasOwn(value,'batchSize'),false);
  }
  assert.equal(Object.hasOwn(projectOwnedLayaTokenTelemetry({batchId,batchSize:2,sharedForwardScope:'private text'}),'sharedForwardScope'),false);
});

test('new Laya window telemetry preserves exact counts and queue wait; old missing fields stay absent and invalid accounting is rejected',()=>{
  const value=projectOwnedLayaTokenTelemetry({queueWaitMs:17,fullCriterionDescriptions:'included_in_selector_state',tokenWindow,
    privateCandidateDescriptions:'never export this'});
  assert.equal(value.queueWaitMs,17);assert.equal(value.tokenWindow.encodedTokens,2001);assert.equal(value.tokenWindow.droppedTokens,0);
  assert.equal(value.tokenWindowValidated,true);assert.equal(value.completeDecisionContextReported,true);
  assert.equal(JSON.stringify(value).includes('never export'),false);
  const old=projectOwnedLayaTokenTelemetry({});assert.deepEqual(old,{tokenWindowStatus:'not_recorded'});
  for(const changed of [{...tokenWindow,droppedTokens:1},{...tokenWindow,encodedTokens:1000},
    {...tokenWindow,headerTokens:[111]},{...tokenWindow,maxLength:1000},{...tokenWindow,truncated:true}]) {
    const invalid=projectOwnedLayaTokenTelemetry({tokenWindow:changed,fullCriterionDescriptions:'included_in_selector_state'});
    assert.equal(invalid.tokenWindowValidated,false);assert.equal(invalid.completeDecisionContextReported,false);
  }
});

const metadata={schemaVersion:1,sourceRevision:'f'.repeat(40),indexDigest:'sha256:'+'1'.repeat(64),arm64Digest:'sha256:'+'2'.repeat(64),
  imageReference:'swr.cn-southwest-2.myhuaweicloud.com/public/owned:laya-preview',cpuTorchVersion:'2.14.0+cpu',
  layaModelRevision:'5'.repeat(40),layout:'single-arm64-manifest',imageValidationEnvironment:'local-qemu-arm64'};
const image={schemaVersion:1,evidenceKind:'owned-image-acceptance',status:'passed',sourceRevision:metadata.sourceRevision,
  arm64Digest:metadata.arm64Digest,cpuTorchVersion:metadata.cpuTorchVersion,layaModelRevision:metadata.layaModelRevision,
  workflowCount:28,nodeCount:185,executionEnvironment:'local-qemu-arm64',
  laya:{warmed:true,typedChoiceValidated:true,instances:1,startupMs:74294,choiceMs:58697},maasCalls:0,toolExecutions:0,externalEffects:0};
const cloud={schemaVersion:1,profile:'huawei_ict_agentarts',status:'passed_public_read_and_graph_resume',
  providers:{fakeSelector:false,fakeExecutionModel:false,cloud:'real_agentarts_https',localTool:'production_workspace.read_text'},
  target:{runtime:'public-runtime',requestedVersion:'Latest',invokeMode:'published',requestedVersionVerified:false},
  catalog:{workflowCount:28,selectedWorkflow:'F20',templateVersion:'2026.10.14.1',templateDigest:'8'.repeat(64)},
  network:['catalog','proposal','receipt_resume'].map((stage,index)=>({stage,httpStatus:200,transport:'https',durationMs:5,requestId:'req-'+index})),
  tool:{operationId:'op-1',proposalId:'op-1',originControlRevision:1,toolName:'workspace.read_text',toolVersion:'1.0.0',
    executionCount:1,localState:'succeeded',policyDecision:'allow',runId:'host-tool-local-1',signedReceipt:true,
    evidence:[{evidenceId:'host-tool-local-1',verification:'conditional'}],independentlyReadContentSha256:'3'.repeat(64)},
  continuation:{receiptAccepted:true,originalToolNodeState:'completed',graphState:'progress',completedPostReceiptModelNodes:['F20_N02']},
  persistence:{reopened:true,toolRecordCount:1,evidenceCount:1,additionalNetworkCalls:0,additionalToolExecutions:0},
  laya:{status:'not_observed_from_invocation_api',records:[]},unavailable:[{nodeId:'F20_N03',capabilities:['tool:workspace.run_allowed_command']}],
  runDirectory:'C:\\Users\\private-user\\private-cache'};

test('metadata/local image alone keeps cloud/platform/log evidence missing and does not verify all businesses',()=>{
  const value=projectOwnedReleaseEvidence({metadata,imageAcceptance:image});
  assert.equal(value.phases.imageAcceptance.verified,true);
  assert.equal(value.phases.platformDeployment.status,'not_provided');assert.equal(value.phases.platformDeployment.verified,false);
  assert.equal(value.phases.cloudPublicFixture.status,'not_provided');assert.equal(value.productionVerified,false);
  assert.equal(value.releaseStatus,'development_preview');assert.equal(value.businessMatrix.length,28);
  assert.ok(value.businessMatrix.every(item=>item.fullyVerified===false));
  assert.match(value.phases.imageAcceptance.laya.latencyScope,/not native cloud latency/);
  const checked={observed:true,status:'found',manifestDigest:metadata.arm64Digest,imageReference:metadata.imageReference};
  assert.equal(projectOwnedReleaseEvidence({metadata:{...metadata,registryReadback:checked}}).phases.registryPublication.verified,true);
  assert.equal(projectOwnedReleaseEvidence({metadata:{...metadata,registryReadback:{...checked,imageReference:'swr.example.invalid/other/image:wrong-tag'}}}).phases.registryPublication.verified,false);
});
test('actual CPU JSONL receipt shape projects typed choice but does not invent native performance or embedded source binding',()=>{
  const actual={status:'passed',profile:'huawei_ict_agentarts',acceptance:'owned ARM64 CPU image; real embedded Laya only',
    platform:'linux',architecture:'arm64',cpu:{torch:metadata.cpuTorchVersion},model:{revision:metadata.layaModelRevision,warmed:true},
    measurements:{startupMs:74294,inferenceMs:58697},typedChoice:{validated:true},workflows:{templates:28,detailNodes:185},layaInstances:1};
  const projected=projectOwnedReleaseEvidence({metadata,imageAcceptance:actual});
  const value=projected.phases.imageAcceptance;
  assert.equal(value.verified,true);assert.equal(value.sourceBinding,'not_embedded_in_receipt');
  assert.equal(value.executionEnvironment,'local-qemu-arm64');assert.equal(value.laya.measurements.choiceMs,58697);
  assert.ok(projected.businessMatrix.every(item=>item.graphTemplate==='catalog_count_observed_unbound'));
  for(const changed of [{...image,status:'failed'},{...image,laya:{...image.laya,warmed:false}},
    {...image,arm64Digest:'sha256:'+'9'.repeat(64)}]) {
    assert.ok(projectOwnedReleaseEvidence({metadata,imageAcceptance:changed}).businessMatrix.every(item=>item.graphTemplate==='not_verified'));
  }
});
test('draft/unsaved logging is not published; requested Latest and missing Laya logs stay separate facts',()=>{
  const platform={schemaVersion:1,evidenceKind:'owned-platform-readback',observed:true,published:false,deploymentState:'draft',
    version:'v2',sourceRevision:metadata.sourceRevision,imageDigest:metadata.arm64Digest,logging:{enabled:true,saved:false}};
  const value=projectOwnedReleaseEvidence({metadata,imageAcceptance:image,cloudReceipt:cloud,platformReadback:platform});
  assert.equal(value.phases.cloudPublicFixture.verified,true);assert.equal(value.phases.cloudPublicFixture.requestedVersionVerified,false);
  assert.equal(value.phases.cloudPublicFixture.laya.status,'missing');assert.equal(value.phases.platformDeployment.published,false);
  assert.equal(value.phases.platformDeployment.logging.saved,false);assert.equal(value.phases.platformDeployment.verified,false);
  assert.equal(value.releaseStatus,'development_preview');assert.ok(!JSON.stringify(value).includes('C:\\Users'));
  assert.equal(value.businessMatrix.find(item=>item.featureId==='F20').businessStatus,'unavailable_nodes_reported');
});
test('published source/manifest/version readback is scoped evidence; digest mismatch and Fake/mock receipts never upgrade',()=>{
  const platform={schemaVersion:1,evidenceKind:'owned-platform-readback',observed:true,published:true,deploymentState:'ready',
    runtimeName:'public-runtime',version:'v2',endpointAlias:'Latest',aliasResolvedVersion:'v2',
    sourceRevision:metadata.sourceRevision,sourceRevisionBasis:'platform_reported',
    imageDigest:metadata.arm64Digest,imageDigestBasis:'platform_reported',logging:{enabled:true,saved:true}};
  const value=projectOwnedReleaseEvidence({metadata,imageAcceptance:image,cloudReceipt:cloud,platformReadback:platform});
  assert.equal(value.phases.platformDeployment.verified,true);assert.equal(value.phases.platformDeployment.requestedToReadback,'alias_readback_matched');
  assert.equal(value.releaseStatus,'development_preview_with_real_public_read');assert.equal(value.productionVerified,false);
  assert.equal(projectOwnedReleaseEvidence({metadata,platformReadback:{...platform,imageDigest:'sha256:'+'9'.repeat(64)}}).phases.platformDeployment.verified,false);
  assert.equal(projectOwnedReleaseEvidence({metadata,cloudReceipt:{...cloud,providers:{...cloud.providers,fakeSelector:true}}}).phases.cloudPublicFixture.verified,false);
  assert.equal(projectOwnedReleaseEvidence({metadata,cloudReceipt:{...cloud,tool:{...cloud.tool,evidence:[{evidenceId:'host-tool-local-1',verification:'mock'}]}}}).phases.cloudPublicFixture.verified,false);
});

test('runtime, recorded invoke mode and exact version or read-back alias are all required to link independent deployment evidence',()=>{
  const platform={schemaVersion:1,evidenceKind:'owned-platform-readback',observed:true,published:true,deploymentState:'ready',
    runtimeName:'public-runtime',version:'v2',endpointAlias:'Latest',aliasResolvedVersion:'v2',
    sourceRevision:metadata.sourceRevision,sourceRevisionBasis:'platform_reported',
    imageDigest:metadata.arm64Digest,imageDigestBasis:'platform_reported'};
  const cases=[
    {platform:{...platform,runtimeName:'different-runtime'}},
    {platform:{...platform,endpointAlias:undefined,aliasResolvedVersion:undefined}},
    {platform:{...platform,aliasResolvedVersion:'v1'}},
    {cloud:{...cloud,target:{...cloud.target,runtime:undefined}}},
    {cloud:{...cloud,target:{...cloud.target,invokeMode:undefined}}},
    {cloud:{...cloud,target:{...cloud.target,invokeMode:'debug'}}},
    {cloud:{...cloud,target:{...cloud.target,requestedVersion:'v1'}}}
  ];
  for(const changed of cases) {
    const value=projectOwnedReleaseEvidence({metadata,imageAcceptance:image,cloudReceipt:changed.cloud??cloud,platformReadback:changed.platform??platform});
    assert.equal(value.phases.platformDeployment.deploymentReadbackVerified,true);
    assert.equal(value.phases.platformDeployment.verified,false);
    assert.equal(value.phases.platformDeployment.invocationBinding.verified,false);
    assert.equal(value.phases.cloudPublicFixture.verified,true);
    assert.equal(value.releaseStatus,'development_preview');
  }
  const exact=projectOwnedReleaseEvidence({metadata,cloudReceipt:{...cloud,target:{...cloud.target,requestedVersion:'v2'}},
    platformReadback:{...platform,endpointAlias:undefined,aliasResolvedVersion:undefined}});
  assert.equal(exact.phases.platformDeployment.verified,true);
  assert.equal(exact.phases.platformDeployment.requestedToReadback,'matched');
  const independent=projectOwnedReleaseEvidence({metadata,platformReadback:platform});
  assert.equal(independent.phases.platformDeployment.deploymentReadbackVerified,true);
  assert.equal(independent.phases.platformDeployment.verified,false);
});

test('derived source/digest bases require the exact configured SWR reference and retain absence of console full revision',()=>{
  const basis={kind:'buildx_provenance_vcs_revision',artifactName:'public-build.json',artifactSha256:'7'.repeat(64),
    field:'buildx.build.provenance.invocation.parameters.root.request.args.vcs:revision',
    directContainerReadback:false,consoleFullRevisionObserved:false};
  const checked={observed:true,status:'found',manifestDigest:metadata.arm64Digest,imageReference:metadata.imageReference};
  const boundMetadata={...metadata,sourceRevisionBasis:basis,registryReadback:checked};
  const platform={schemaVersion:1,evidenceKind:'owned-platform-readback',observed:true,published:true,deploymentState:'ready',
    runtimeName:'public-runtime',version:'v2',endpointAlias:'Latest',aliasResolvedVersion:'v2',
    sourceRevision:metadata.sourceRevision,sourceRevisionBasis:'build_provenance_and_registry_digest',
    imageDigest:metadata.arm64Digest,imageDigestBasis:'registry_manifest_for_configured_reference',
    imageReference:metadata.imageReference,consoleFullRevisionObserved:false};
  const value=projectOwnedReleaseEvidence({metadata:boundMetadata,cloudReceipt:cloud,platformReadback:platform});
  assert.equal(value.phases.platformDeployment.deploymentReadbackVerified,true);
  assert.equal(value.phases.platformDeployment.consoleFullRevisionObserved,false);
  assert.equal(value.phases.platformDeployment.sourceRevisionBasis,'build_provenance_and_registry_digest');
  assert.equal(value.build.sourceRevisionBasis.directContainerReadback,false);
  for(const changed of [{metadata},{metadata:boundMetadata,platform:{...platform,imageReference:'swr.example.invalid/other/image:wrong'}},
    {metadata:{...boundMetadata,registryReadback:{...checked,observed:false}}},
    {metadata:boundMetadata,platform:{...platform,sourceRevisionBasis:undefined}}]) {
    assert.equal(projectOwnedReleaseEvidence({metadata:changed.metadata,cloudReceipt:cloud,
      platformReadback:changed.platform??platform}).phases.platformDeployment.deploymentReadbackVerified,false);
  }
});

test('partial real public read/receipt/persistence retains its evidence and console logs without claiming post-receipt model completion',()=>{
  const partial={...cloud,status:'partial_receipt_admitted_model_recheck',unavailable:[],
    target:{...cloud.target,invokeMode:undefined},continuation:{...cloud.continuation,graphState:'unknown',completedPostReceiptModelNodes:[]},
    laya:{status:'correlated_platform_console_readback',sourceFileSha256:'6'.repeat(64),
      sourceAuthenticity:'authenticated AgentArts Runtime console readback; exact requestId match',
      records:[{event:'laya_choice',model:'multilingual',requestId:'req-2',candidateId:'owned-review',durationMs:1477}]}};
  const value=projectOwnedReleaseEvidence({metadata,imageAcceptance:image,cloudReceipt:partial});
  const phase=value.phases.cloudPublicFixture;
  assert.equal(phase.runtime,'public-runtime');assert.equal(phase.invokeMode,'not_recorded');
  assert.equal(phase.status,'partial_receipt_admitted_model_recheck');assert.equal(phase.verified,false);
  assert.equal(phase.publicReadVerified,true);assert.equal(phase.postReceiptModelVerified,false);
  assert.equal(phase.resume.graphState,'unknown');assert.equal(phase.laya.status,'correlated_platform_console_readback');
  assert.equal(value.businessMatrix.find(item=>item.featureId==='F20').businessStatus,'partial_public_read_step_verified');
  assert.equal(value.releaseStatus,'development_preview');
  const unattributed=projectOwnedReleaseEvidence({metadata,cloudReceipt:{...partial,laya:{...partial.laya,sourceAuthenticity:undefined}}});
  assert.equal(unattributed.phases.cloudPublicFixture.laya.status,'unattributed_supplied_log');
  assert.equal(unattributed.phases.cloudPublicFixture.laya.sourceFileSha256,null);
});

test('full fixed F20 evidence requires actual compiler tool closure, every graph node, exact artifacts and legal durable Runtime completion',()=>{
  const full={...cloud,status:'passed_public_f20_documentation_workflow',unavailable:[],
    providers:{...cloud.providers,validationTool:'production_workspace.run_allowed_command',compiler:'real_typescript_noEmit'},
    network:[...cloud.network,{stage:'validation_receipt_resume',httpStatus:200,transport:'https',requestId:'validation-req'}],
    candidate:{candidateSha256:'4'.repeat(64),docSha256:'5'.repeat(64)},
    validationTool:{nodeId:'F20_N03',operationId:'op-check',runId:'host-tool-check',toolName:'workspace.run_allowed_command',actualSideEffect:'local_write',
      executionCount:1,policyDecision:'allow',localState:'succeeded',signedReceipt:true,evidence:[{evidenceId:'host-tool-check',verification:'conditional'}]},
    validation:{state:'passed',sourceSha256:cloud.tool.independentlyReadContentSha256,candidateSha256:'4'.repeat(64),docSha256:'5'.repeat(64),
      checkArtifactSha256:'6'.repeat(64),sampleSha256:'7'.repeat(64),compiler:{name:'TypeScript',version:'5.9.3',exitCode:0},checks:{typeCheckPassed:true,noPhantomFields:true}},
    workflowCompletion:{workflowId:'F20',graphState:'settled',allRequiredNodesCompleted:true,
      nodeStates:Object.fromEntries(['F20_N01','F20_N02','F20_N03','F20_N04'].map(node=>[node,'completed'])),
      sourceSha256:cloud.tool.independentlyReadContentSha256,candidateSha256:'4'.repeat(64),docSha256:'5'.repeat(64),checkArtifactSha256:'6'.repeat(64),
      docVersion:'public-fixture-1',synchronized:false,finalArtifactReadback:true,finalArtifactName:'owned-api-final-doc.md',
      sourceRefs:['owned-workflow-public-fixture.txt','owned-api-check-result.json']},
    parentTask:{state:'succeeded',terminalAuthority:'existing TaskRuntime.runTask',completionProducedByWorker:true,evidenceRefs:['host-tool-local-1','host-tool-check']},
    continuation:{...cloud.continuation,graphState:'settled',completedPostReceiptModelNodes:['F20_N02','F20_N04']},
    persistence:{...cloud.persistence,parentState:'succeeded',validation:{localState:'succeeded',toolRecordCount:1,evidenceCount:1}}};
  const value=projectOwnedReleaseEvidence({metadata,cloudReceipt:full}),phase=value.phases.cloudPublicFixture;
  assert.equal(phase.verified,true);assert.equal(phase.publicReadVerified,true);assert.equal(phase.publicValidationVerified,true);
  assert.equal(phase.workflowVerified,true);assert.equal(phase.workflowCompletion.parentState,'succeeded');
  assert.equal(value.businessMatrix.find(item=>item.featureId==='F20').fixtureWorkflowVerified,true);
  assert.equal(value.businessMatrix.find(item=>item.featureId==='F20').fullyVerified,false);
  assert.equal(value.releaseStatus,'development_preview'); // no deployment linkage was supplied
  for(const changed of [
    {...full,workflowCompletion:{...full.workflowCompletion,nodeStates:{...full.workflowCompletion.nodeStates,F20_N04:'unknown'}}},
    {...full,validation:{...full.validation,compiler:{...full.validation.compiler,exitCode:1}}},
    {...full,validationTool:{...full.validationTool,actualSideEffect:'read'}},
    {...full,parentTask:{...full.parentTask,state:'created'}},
    {...full,persistence:{...full.persistence,parentState:'waiting_reconciliation'}},
    {...full,workflowCompletion:{...full.workflowCompletion,checkArtifactSha256:'wrong'}},
    {...full,workflowCompletion:{...full.workflowCompletion,synchronized:true}},
    {...full,workflowCompletion:{...full.workflowCompletion,sourceRefs:['invented']}}
  ]) {
    const projected=projectOwnedReleaseEvidence({metadata,cloudReceipt:changed});
    assert.equal(projected.phases.cloudPublicFixture.workflowVerified,false);
    assert.equal(projected.phases.cloudPublicFixture.publicReadVerified,true);
  }
  const local={...full,status:'passed_local_image_f20_documentation_workflow',providers:{...full.providers,cloud:'real_owned_image_http'},
    target:{...full.target,validationSurface:'local_owned_image'},network:full.network.map(request=>({...request,transport:'http_loopback'})),
    laya:{status:'correlated_supplied_image_log',sourceAuthenticity:'supplied image stdout; provenance requires independent image/source binding',
      sourceFileSha256:'8'.repeat(64),records:[{event:'laya_choice',model:'multilingual',requestId:'req-2',candidateId:'candidate-001',
        durationMs:100,queueWaitMs:17,fullCriterionDescriptions:'included_in_selector_state',tokenWindow}]}};
  const platform={schemaVersion:1,evidenceKind:'owned-platform-readback',observed:true,published:true,deploymentState:'ready',runtimeName:'public-runtime',
    version:'v2',endpointAlias:'Latest',aliasResolvedVersion:'v2',sourceRevision:metadata.sourceRevision,sourceRevisionBasis:'platform_reported',
    imageDigest:metadata.arm64Digest,imageDigestBasis:'platform_reported'};
  const isolated=projectOwnedReleaseEvidence({metadata,imageWorkflowReceipt:local,platformReadback:platform});
  assert.equal(isolated.phases.imageWorkflowFixture.workflowVerified,true);
  assert.equal(isolated.phases.imageWorkflowFixture.status,'passed_local_image_f20_documentation_workflow');
  assert.equal(isolated.phases.imageWorkflowFixture.huaweiDeploymentVerified,false);
  assert.equal(isolated.phases.imageWorkflowFixture.laya.allObservedChoiceWindowsValidated,true);
  assert.equal(isolated.phases.cloudPublicFixture.verified,false);assert.equal(isolated.phases.cloudPublicFixture.status,'not_provided');
  assert.equal(isolated.phases.platformDeployment.invocationBinding.verified,false);assert.equal(isolated.releaseStatus,'development_preview');
  assert.equal(isolated.businessMatrix.find(item=>item.featureId==='F20').imageFixtureWorkflowVerified,true);
  assert.equal(isolated.businessMatrix.find(item=>item.featureId==='F20').fixtureWorkflowVerified,false);
  const wrongSlot=projectOwnedReleaseEvidence({metadata,cloudReceipt:local,platformReadback:platform});
  assert.equal(wrongSlot.phases.cloudPublicFixture.workflowVerified,false);assert.equal(wrongSlot.phases.platformDeployment.invocationBinding.verified,false);
  const badWindow={...local,laya:{...local.laya,records:[{...local.laya.records[0],tokenWindow:{...tokenWindow,droppedTokens:1}}]}};
  assert.equal(projectOwnedReleaseEvidence({metadata,imageWorkflowReceipt:badWindow}).phases.imageWorkflowFixture.workflowVerified,false);
  const native={...local,status:'passed_local_runtime_f20_documentation_workflow',providers:{...local.providers,cloud:'real_owned_runtime_http'},
    target:{...local.target,kind:'local_owned_source_runtime',validationSurface:'local_owned_source_runtime'},
    laya:{...local.laya,status:'correlated_supplied_runtime_log',sourceAuthenticity:'supplied source runtime stdout; provenance requires independent source/model binding'}};
  const nativeOnly=projectOwnedReleaseEvidence({metadata,localRuntimeWorkflowReceipt:native,platformReadback:platform});
  assert.equal(nativeOnly.phases.localRuntimeWorkflowFixture.workflowVerified,true);
  assert.equal(nativeOnly.phases.localRuntimeWorkflowFixture.status,'passed_local_runtime_f20_documentation_workflow');
  assert.equal(nativeOnly.phases.localRuntimeWorkflowFixture.laya.status,'correlated_supplied_runtime_log');
  assert.equal(nativeOnly.phases.imageWorkflowFixture.verified,false);assert.equal(nativeOnly.phases.cloudPublicFixture.verified,false);
  assert.equal(nativeOnly.phases.platformDeployment.invocationBinding.verified,false);assert.equal(nativeOnly.productionVerified,false);
  assert.equal(nativeOnly.releaseStatus,'development_preview');
  assert.equal(projectOwnedReleaseEvidence({metadata,imageWorkflowReceipt:native}).phases.imageWorkflowFixture.workflowVerified,false);
});
test('credential/env/raw-log input is rejected and absolute image paths are never emitted',()=>{
  for(const field of ['inboundAuthorization','env','rawNetworkLog','headers']) {
    assert.throws(()=>projectOwnedReleaseEvidence({metadata:{...metadata,[field]:field==='env'?{secret:'private'}:'private'}}));
  }
  assert.throws(()=>projectOwnedReleaseEvidence({metadata:{...metadata,imageReference:'C:/Users/private/image.tar'}}));
  assert.throws(()=>projectOwnedReleaseEvidence({metadata,cloudReceipt:{...cloud,rawBody:'Bearer sensitive-value-not-for-output'}}));
});
