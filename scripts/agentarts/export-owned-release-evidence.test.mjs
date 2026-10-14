import assert from 'node:assert/strict';
import test from 'node:test';
import {projectOwnedReleaseEvidence} from './export-owned-release-evidence.mjs';

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
test('credential/env/raw-log input is rejected and absolute image paths are never emitted',()=>{
  for(const field of ['inboundAuthorization','env','rawNetworkLog','headers']) {
    assert.throws(()=>projectOwnedReleaseEvidence({metadata:{...metadata,[field]:field==='env'?{secret:'private'}:'private'}}));
  }
  assert.throws(()=>projectOwnedReleaseEvidence({metadata:{...metadata,imageReference:'C:/Users/private/image.tar'}}));
  assert.throws(()=>projectOwnedReleaseEvidence({metadata,cloudReceipt:{...cloud,rawBody:'Bearer sensitive-value-not-for-output'}}));
});
