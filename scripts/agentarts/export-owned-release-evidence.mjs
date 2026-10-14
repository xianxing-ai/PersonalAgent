import {readFile,writeFile,lstat,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative,isAbsolute,dirname,extname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const sourceSha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value)?value:null;
const artifactSha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)?value:null;
const imageDigest=value=>typeof value==='string'&&/^sha256:[a-f0-9]{64}$/.test(value)?value:null;
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_.-]{1,128}$/.test(value)?value:null;
const number=value=>Number.isFinite(value)&&value>=0?value:null;
const absolute=value=>typeof value==='string'&&(isAbsolute(value)||/^[A-Za-z]:[\\/]/.test(value)||/^\\\\/.test(value));
const fail=code=>{throw Object.assign(new Error(code),{code});};
const imageRef=value=>typeof value==='string'&&value.length<=512&&!absolute(value)
  &&/^[A-Za-z0-9][A-Za-z0-9._:/@-]+$/.test(value)&&!value.includes('://')&&value.includes('/')?value:null;
const forbidden=new Set(['authorization','inboundauthorization','innerauthorization','apikey','modelkey','accesskey','secretkey',
  'receiptsecret','checkpointkey','password','credentials','privatekey','xpaagenttoken','headers','requestheaders','responseheaders',
  'env','environment','cloudenv','rawnetworklog','rawlog','pushlog','rawbody','rawresponse','stdout','stderr']);

/** Public-file admission. No raw credentials, environment, request headers or network logs are accepted. */
function publicInput(value) {
  if(!plain(value))fail('PUBLIC_JSON_OBJECT_REQUIRED');
  const visit=(item,depth=0)=>{
    if(depth>32)fail('PUBLIC_INPUT_DEPTH');
    if(Array.isArray(item)){for(const child of item)visit(child,depth+1);return;}
    if(plain(item))for(const [key,child] of Object.entries(item)) {
      if(forbidden.has(key.toLowerCase().replace(/[^a-z0-9]/g,'')))fail('PRIVATE_INPUT_FIELD_REJECTED');
      visit(child,depth+1);
    }
    else if(typeof item==='string'&&/\bBearer\s+[^\s<>]{8,}|-----BEGIN .*PRIVATE KEY|[?&](?:token|key|signature|authorization|auth)=/i.test(item)) {
      fail('PRIVATE_INPUT_VALUE_REJECTED');
    }
  };
  visit(value);return value;
}

function metadataProjection(input) {
  const value=publicInput(input);
  if(value.schemaVersion!==1||!sourceSha(value.sourceRevision)||!imageDigest(value.indexDigest)
    ||!imageDigest(value.arm64Digest)||!imageRef(value.imageReference)
    ||typeof value.cpuTorchVersion!=='string'||!/^\d+\.\d+\.\d+\+cpu$/.test(value.cpuTorchVersion)
    ||!sourceSha(value.layaModelRevision))fail('INVALID_PUBLIC_METADATA_SCHEMA');
  const registry=value.registryReadback;
  const registryMatched=plain(registry)&&registry.observed===true&&registry.status==='found'
    &&imageDigest(registry.manifestDigest)===value.arm64Digest&&imageRef(registry.imageReference)===value.imageReference;
  const sourceBasis=value.sourceRevisionBasis;
  return {sourceRevision:value.sourceRevision,indexDigest:value.indexDigest,arm64Digest:value.arm64Digest,
    imageReference:value.imageReference,cpuTorchVersion:value.cpuTorchVersion,layaModelRevision:value.layaModelRevision,
    layout:value.layout==='single-arm64-manifest'?'single-arm64-manifest':'not_recorded',
    imageValidationEnvironment:['local-qemu-arm64','native-arm64-cloud'].includes(value.imageValidationEnvironment)
      ?value.imageValidationEnvironment:'not_recorded',
    sourceRevisionBasis:{kind:sourceBasis?.kind==='buildx_provenance_vcs_revision'?'buildx_provenance_vcs_revision':'not_recorded',
      artifactName:id(sourceBasis?.artifactName),artifactSha256:artifactSha(sourceBasis?.artifactSha256),
      field:sourceBasis?.field==='buildx.build.provenance.invocation.parameters.root.request.args.vcs:revision'
        ?sourceBasis.field:'not_recorded',
      directContainerReadback:typeof sourceBasis?.directContainerReadback==='boolean'?sourceBasis.directContainerReadback:null,
      consoleFullRevisionObserved:typeof sourceBasis?.consoleFullRevisionObserved==='boolean'?sourceBasis.consoleFullRevisionObserved:null},
    buildStatus:'metadata_recorded',registry:{status:registryMatched?'manifest_readback_matched'
      :registry?.status==='not_found'?'manifest_not_found':registry?.status==='pending'?'push_pending':'not_independently_read_back',
      readbackManifestDigest:imageDigest(registry?.manifestDigest),verified:registryMatched}};
}

function imageProjection(input,metadata) {
  if(input===undefined)return {status:'not_provided',verified:false,laya:{status:'missing'},workflowCatalog:{status:'missing'}};
  const value=publicInput(input);
  // Accept the actual one-line CPU image receipt, or the canonical public normalization below.
  const actual=value.profile==='huawei_ict_agentarts'&&value.platform==='linux'&&value.architecture==='arm64'
    &&value.acceptance==='owned ARM64 CPU image; real embedded Laya only';
  const canonical=value.schemaVersion===1&&value.evidenceKind==='owned-image-acceptance';
  if(!actual&&!canonical)fail('INVALID_PUBLIC_IMAGE_ACCEPTANCE_SCHEMA');
  const cpuTorchVersion=actual?value.cpu?.torch:value.cpuTorchVersion;
  const modelRevision=actual?value.model?.revision:value.layaModelRevision;
  const modelWarmed=actual?value.model?.warmed:value.laya?.warmed;
  const choiceValidated=actual?value.typedChoice?.validated:value.laya?.typedChoiceValidated;
  const templates=actual?value.workflows?.templates:value.workflowCount;
  const nodes=actual?value.workflows?.detailNodes:value.nodeCount;
  const source=value.sourceRevision===undefined?null:sourceSha(value.sourceRevision);
  const manifest=value.arm64Digest===undefined?null:imageDigest(value.arm64Digest);
  if(value.sourceRevision!==undefined&&source===null||value.arm64Digest!==undefined&&manifest===null)fail('INVALID_IMAGE_SOURCE_BINDING');
  const sourceMatch=source===null?'not_embedded_in_receipt':source===metadata.sourceRevision?'matched':'mismatched';
  const digestMatch=manifest===null?'not_embedded_in_receipt':manifest===metadata.arm64Digest?'matched':'mismatched';
  const runtimePassed=value.status==='passed'&&cpuTorchVersion===metadata.cpuTorchVersion&&modelRevision===metadata.layaModelRevision
    &&modelWarmed===true&&choiceValidated===true&&templates===28&&nodes===185
    &&sourceMatch!=='mismatched'&&digestMatch!=='mismatched';
  const timings=actual?value.measurements:value.laya;
  const suppliedEnvironment=value.executionEnvironment??metadata.imageValidationEnvironment;
  const executionEnvironment=['local-qemu-arm64','native-arm64-cloud'].includes(suppliedEnvironment)?suppliedEnvironment:'not_recorded';
  return {status:runtimePassed?'real_embedded_laya_passed':'reported_failed_or_incomplete',verified:runtimePassed,
    sourceBinding:sourceMatch,manifestBinding:digestMatch,platform:'linux/arm64',cpuTorchVersion,
    modelRevision:sourceSha(modelRevision),executionEnvironment,
    laya:{status:runtimePassed?'actual_embedded_forward_observed':'missing_or_incomplete',warmed:modelWarmed===true,
      typedChoiceValidated:choiceValidated===true,calibrated:false,instances:number(value.layaInstances??value.laya?.instances),
      measurements:{cpuProbeMs:number(timings?.cpuProbeMs),startupMs:number(timings?.startupMs),
        choiceMs:number(timings?.inferenceMs??timings?.choiceMs),shutdownMs:number(timings?.shutdownMs)},
      latencyScope:executionEnvironment==='local-qemu-arm64'?'local QEMU measurements; not native cloud latency':'reported environment only; no extrapolation'},
    workflowCatalog:{templates:number(templates),detailNodes:number(nodes),
      boundAcceptanceVerified:runtimePassed&&sourceMatch==='matched'&&digestMatch==='matched',businessExecutionVerified:false},
    maasCalls:number(value.maasCalls),toolExecutions:number(value.toolExecutions),externalEffects:number(value.externalEffects)};
}

function cloudProjection(input) {
  if(input===undefined)return {status:'not_provided',verified:false,laya:{status:'missing',records:[]},unavailable:[]};
  const value=publicInput(input);
  if(value.schemaVersion!==1||value.profile!=='huawei_ict_agentarts'||!plain(value.providers))fail('INVALID_PUBLIC_CLOUD_RECEIPT_SCHEMA');
  const tool=value.tool,continuation=value.continuation,persistence=value.persistence;
  const realProviders=value.providers.fakeSelector===false&&value.providers.fakeExecutionModel===false
    &&value.providers.cloud==='real_agentarts_https'&&value.providers.localTool==='production_workspace.read_text';
  const network=(value.network??[]).filter(item=>plain(item)).map(item=>({stage:id(item.stage),requestId:id(item.requestId),
    httpStatus:Number.isInteger(item.httpStatus)?item.httpStatus:null,durationMs:number(item.durationMs),
    transport:item.transport==='https'?'https':'not_recorded'}));
  const networkPassed=['catalog','proposal','receipt_resume'].every(stage=>network.some(item=>item.stage===stage&&item.httpStatus===200));
  const evidence=Array.isArray(tool?.evidence)?tool.evidence.map(item=>({evidenceId:id(item.evidenceId),
    verification:['conditional','verified','unverified','mock'].includes(item.verification)?item.verification:'not_recorded'})):[];
  const publicReadVerified=realProviders&&networkPassed
    &&value.catalog?.workflowCount===28&&tool?.toolName==='workspace.read_text'&&tool?.executionCount===1
    &&tool?.policyDecision==='allow'&&tool?.localState==='succeeded'&&tool?.signedReceipt===true&&evidence.length===1
    &&evidence[0].evidenceId!==null&&evidence[0].evidenceId===id(tool.runId)
    &&['conditional','verified'].includes(evidence[0].verification)
    &&continuation?.receiptAccepted===true&&continuation?.originalToolNodeState==='completed'
    &&persistence?.reopened===true&&persistence?.toolRecordCount===1&&persistence?.evidenceCount===1
    &&persistence?.additionalNetworkCalls===0&&persistence?.additionalToolExecutions===0;
  const postReceiptModelVerified=realProviders&&value.status==='passed_public_read_and_graph_resume'
    &&Array.isArray(continuation?.completedPostReceiptModelNodes)
    &&continuation.completedPostReceiptModelNodes.some(node=>/^F(?:15|20)_N\d{2}$/.test(node));
  const publicReadPassed=publicReadVerified&&postReceiptModelVerified;
  const layaRecords=Array.isArray(value.laya?.records)?value.laya.records.flatMap(item=>{
    if(item?.event==='laya_ready'&&item.model==='multilingual'&&item.service==='embedded'&&item.warmed===true) {
      return [{event:'laya_ready',model:'multilingual',service:'embedded',warmed:true}];
    }
    if(item?.event==='laya_choice'&&item.model==='multilingual'&&id(item.requestId)&&id(item.candidateId)
      &&network.some(request=>request.requestId===item.requestId)&&number(item.durationMs)!==null) {
      return [{event:'laya_choice',model:'multilingual',requestId:item.requestId,candidateId:item.candidateId,durationMs:item.durationMs}];
    }
    return [];
  }):[];
  const unavailable=Array.isArray(value.unavailable)?value.unavailable.flatMap(item=>
    id(item?.nodeId)&&Array.isArray(item.capabilities)?[{nodeId:item.nodeId,
      capabilities:item.capabilities.filter(cap=>typeof cap==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(cap))}]:[]):[];
  const consoleLogBasis=value.laya?.status==='correlated_platform_console_readback'
    &&value.laya?.sourceAuthenticity==='authenticated AgentArts Runtime console readback; exact requestId match'
    &&artifactSha(value.laya?.sourceFileSha256)!==null;
  return {status:publicReadPassed?'passed_public_read_fixture_and_resume':value.status==='partial_receipt_admitted_model_recheck'
    ?'partial_receipt_admitted_model_recheck':'failed_or_unknown',verified:publicReadPassed,scope:'one fixed public workspace.read_text fixture; not all business workflows',
    runtime:id(value.target?.runtime),invokeMode:['published','debug'].includes(value.target?.invokeMode)?value.target.invokeMode:'not_recorded',
    requestedVersion:id(value.target?.requestedVersion),requestedVersionVerified:false,publicReadVerified,postReceiptModelVerified,
    selectedWorkflow:/^F(?:15|20)$/.test(value.catalog?.selectedWorkflow??'')?value.catalog.selectedWorkflow:null,
    templateVersion:id(value.catalog?.templateVersion),templateDigest:typeof value.catalog?.templateDigest==='string'
      &&/^[a-f0-9]{64}$/.test(value.catalog.templateDigest)?value.catalog.templateDigest:null,
    catalogCount:number(value.catalog?.workflowCount),realProviders,network,
    tool:tool?{operationId:id(tool.operationId),proposalId:id(tool.proposalId),originControlRevision:number(tool.originControlRevision),
      toolName:tool.toolName==='workspace.read_text'?'workspace.read_text':null,toolVersion:id(tool.toolVersion),
      runId:id(tool.runId),localState:tool.localState==='succeeded'?'succeeded':'not_confirmed',
      executionCount:number(tool.executionCount),policyDecision:tool.policyDecision==='allow'?'allow':'not_confirmed',evidence,
      signedReceipt:tool.signedReceipt===true,contentSha256:typeof tool.independentlyReadContentSha256==='string'
        &&/^[a-f0-9]{64}$/.test(tool.independentlyReadContentSha256)?tool.independentlyReadContentSha256:null}:null,
    resume:{receiptAccepted:continuation?.receiptAccepted===true,originalToolNodeState:continuation?.originalToolNodeState==='completed'?'completed':'not_confirmed',
      graphState:id(continuation?.graphState),completedPostReceiptModelNodes:Array.isArray(continuation?.completedPostReceiptModelNodes)
        ?continuation.completedPostReceiptModelNodes.filter(node=>/^F(?:15|20)_N\d{2}$/.test(node)):[]},
    persistence:{reopened:persistence?.reopened===true,toolRecordCount:number(persistence?.toolRecordCount),evidenceCount:number(persistence?.evidenceCount),
      additionalNetworkCalls:number(persistence?.additionalNetworkCalls),additionalToolExecutions:number(persistence?.additionalToolExecutions)},
    laya:{status:layaRecords.some(item=>item.event==='laya_choice')
      ?consoleLogBasis?'correlated_platform_console_readback':'unattributed_supplied_log':'missing',
      sourceAuthenticity:consoleLogBasis?'authenticated_platform_console_readback_reported':'not_independently_verified',
      observationMethod:consoleLogBasis?'Runtime console DOM readback; not an official log file export':'not_recorded',
      sourceFileSha256:consoleLogBasis?value.laya.sourceFileSha256:null,records:layaRecords},unavailable,
    unknown:Array.isArray(value.unknown)?value.unknown.map(item=>({stage:id(item.stage),requestId:id(item.requestId),code:id(item.code)})):[]};
}

function platformProjection(input,metadata,cloud) {
  if(input===undefined)return {status:'not_provided',verified:false,deploymentReadbackVerified:false,published:false,
    invocationBinding:{verified:false,runtimeMatch:'not_checked',versionMatch:'not_checked',invokeMode:cloud.invokeMode??'not_recorded'},
    logging:{enabled:null,saved:null},requestedVersion:cloud.requestedVersion??null};
  const value=publicInput(input);
  if(value.schemaVersion!==1||value.evidenceKind!=='owned-platform-readback')fail('INVALID_PUBLIC_PLATFORM_READBACK_SCHEMA');
  const published=value.published===true&&value.observed===true&&value.deploymentState==='ready';
  const source=sourceSha(value.sourceRevision),manifest=imageDigest(value.imageDigest),version=id(value.version);
  const digestMatched=manifest===metadata.arm64Digest,sourceMatched=source===metadata.sourceRevision;
  const sourceRevisionBasis=['platform_reported','build_provenance_and_registry_digest'].includes(value.sourceRevisionBasis)
    ?value.sourceRevisionBasis:'not_recorded';
  const imageDigestBasis=['platform_reported','registry_manifest_for_configured_reference'].includes(value.imageDigestBasis)
    ?value.imageDigestBasis:'not_recorded';
  const exactConfiguredRegistryImage=metadata.registry.verified&&imageRef(value.imageReference)===metadata.imageReference;
  const sourceEvidenceBound=sourceRevisionBasis==='platform_reported'
    ||sourceRevisionBasis==='build_provenance_and_registry_digest'&&exactConfiguredRegistryImage
      &&metadata.sourceRevisionBasis.kind==='buildx_provenance_vcs_revision'&&metadata.sourceRevisionBasis.artifactSha256!==null;
  const digestEvidenceBound=imageDigestBasis==='platform_reported'
    ||imageDigestBasis==='registry_manifest_for_configured_reference'&&exactConfiguredRegistryImage;
  const runtimeId=id(value.runtimeId),runtimeName=id(value.runtimeName);
  const runtimeMatch=cloud.runtime===undefined||cloud.runtime===null||runtimeId===null&&runtimeName===null?'not_checked'
    :cloud.runtime===runtimeId||cloud.runtime===runtimeName?'matched':'mismatched';
  const requestMatch=cloud.requestedVersion===undefined||cloud.requestedVersion===null?'not_checked'
    :cloud.requestedVersion==='Latest'?version!==null&&value.endpointAlias==='Latest'&&id(value.aliasResolvedVersion)===version?'alias_readback_matched':'not_checked'
    :cloud.requestedVersion===version?'matched':'mismatched';
  const deploymentReadbackVerified=published&&digestMatched&&sourceMatched&&sourceEvidenceBound&&digestEvidenceBound
    &&version!==null&&(runtimeId!==null||runtimeName!==null);
  const verified=deploymentReadbackVerified&&runtimeMatch==='matched'
    &&['matched','alias_readback_matched'].includes(requestMatch)&&cloud.invokeMode==='published';
  return {status:value.deploymentState==='draft'||value.published===false?'draft_or_unpublished'
    :deploymentReadbackVerified?'published_deployment_readback_matched':value.deploymentState==='failed'?'deployment_failed':'incomplete_or_mismatched_readback',
    verified,deploymentReadbackVerified,published,runtimeId,runtimeName,
    version,requestedVersion:cloud.requestedVersion??null,requestedToReadback:requestMatch,
    invocationBinding:{verified,runtimeMatch,versionMatch:requestMatch,invokeMode:cloud.invokeMode??'not_recorded'},
    sourceRevision:source,imageDigest:manifest,sourceMatched,digestMatched,sourceRevisionBasis,imageDigestBasis,
    sourceEvidenceBound,digestEvidenceBound,
    consoleFullRevisionObserved:typeof value.consoleFullRevisionObserved==='boolean'?value.consoleFullRevisionObserved:null,
    logging:{enabled:typeof value.logging?.enabled==='boolean'?value.logging.enabled:null,
      saved:typeof value.logging?.saved==='boolean'?value.logging.saved:null},
    imageReference:imageRef(value.imageReference)};
}

const FEATURES=['主对话与责任理解','语音交互与确认','世界状态与局部重规划','Wiki与作用域记忆','记忆搜索与来源回答',
  '待办提醒','日历安排','邮件','订阅信号','深度研究','天气出行','主动通知','故障诊断','浏览器桌面','编码与命令',
  'CI修复','测试定位','PR审查合并','Issue修复','API文档','MCP与Skills','影子实验','评估晋升','调度取消恢复',
  '账户与数据范围','镜像部署','上下文管理','模型与思考分配'];

/** Artifact projection, not a network verifier or authority to mark every workflow complete. */
export function projectOwnedReleaseEvidence({metadata,imageAcceptance,cloudReceipt,platformReadback}) {
  const build=metadataProjection(metadata),image=imageProjection(imageAcceptance,build),cloud=cloudProjection(cloudReceipt);
  const platform=platformProjection(platformReadback,build,cloud);
  const businessMatrix=FEATURES.map((name,index)=>{
    const featureId='F'+String(index+1).padStart(2,'0');
    const unavailable=(cloud.unavailable??[]).filter(item=>item.nodeId.startsWith(featureId+'_'));
    return {featureId,name,graphTemplate:image.workflowCatalog?.boundAcceptanceVerified===true?'image_catalog_verified'
      :image.verified&&image.workflowCatalog?.templates===28&&image.workflowCatalog?.detailNodes===185?'catalog_count_observed_unbound':'not_verified',
      businessStatus:unavailable.length?'unavailable_nodes_reported':cloud.publicReadVerified&&cloud.selectedWorkflow===featureId
        ?'partial_public_read_step_verified':'not_verified',fullyVerified:false,unavailable};
  });
  const result={schemaVersion:1,evidenceKind:'personal-agent-owned-release-public',profile:'huawei_ict_agentarts',
    releaseStatus:cloud.verified&&platform.verified?'development_preview_with_real_public_read':'development_preview',
    productionVerified:false,provenance:'projection of explicitly supplied public artifacts; no independent network or credential access',
    source:{revision:build.sourceRevision},build,
    phases:{imageAcceptance:image,registryPublication:build.registry,platformDeployment:platform,cloudPublicFixture:cloud},
    businessMatrix,
    nativePlatformCapabilities:{inferenceGateway:'not_verified_by_these_artifacts',mcpGateway:'not_verified_by_these_artifacts',
      knowledgeBase:'not_verified_by_these_artifacts',trace:'not_verified_by_these_artifacts',evaluation:'not_verified_by_these_artifacts'},
    limitations:['Local QEMU startup/choice measurements are not native cloud latency.',
      'requestedVersion is distinct from actual platform deployment/version readback.',
      'Runtime identity, a read-back version/alias and recorded published invoke mode must match before linking a cloud invocation to deployment.',
      'An image catalog count without the acceptance receipt source/manifest binding is not a verified release template.',
      'Missing platform/cloud/Laya log evidence stays missing; container acceptance alone does not verify cloud publication.',
      'One real public tool/receipt/resume fixture does not complete all 28 business workflows.',
      'A source receipt signature is not a Policy grant or independently verified external effect.']};
  const inspect=(item)=>{
    if(typeof item==='string'&&(absolute(item)||/\bBearer\s+|[?&](?:token|key|signature|authorization|auth)=/i.test(item)))fail('UNSAFE_PUBLIC_PROJECTION');
    if(Array.isArray(item))item.forEach(inspect);else if(plain(item))Object.values(item).forEach(inspect);
  };
  inspect(result);return result;
}

async function readPublic(path) {
  if(typeof path!=='string'||!['.json','.jsonl'].includes(extname(path).toLowerCase())
    ||/(?:^|[-_.])(env|credential|secret|private|token|raw|push-log|network-log)(?:[-_.]|$)/i.test(basename(path)))fail('PUBLIC_JSON_PATH_REQUIRED');
  const file=await lstat(path);if(!file.isFile()||file.isSymbolicLink()||file.size>1_200_000)fail('PUBLIC_REGULAR_JSON_REQUIRED');
  const text=await readFile(path,'utf8');let parsed;
  try {
    if(extname(path).toLowerCase()==='.jsonl') {
      const lines=text.split(/\r?\n/).filter(line=>line.trim());if(lines.length!==1)fail('ONLY_SINGLE_PUBLIC_RECEIPT_JSONL_ACCEPTED');
      parsed=JSON.parse(lines[0]);
    }else parsed=JSON.parse(text);
  }catch(error){if(error.code)throw error;fail('INVALID_PUBLIC_JSON');}
  return {value:publicInput(parsed),sha256:sha(text)};
}

export async function main(argv=process.argv.slice(2)) {
  try {
    const allowed=new Set(['--metadata','--image-acceptance','--cloud-receipt','--platform-readback','--output']),args={};
    for(let index=0;index<argv.length;index+=2) {
      const key=argv[index],value=argv[index+1];if(!allowed.has(key)||!value||args[key]!==undefined)fail('INVALID_ARGUMENTS');args[key]=value;
    }
    if(!args['--metadata'])fail('METADATA_REQUIRED');
    const inputs={};const hashes={};
    for(const [flag,key] of [['--metadata','metadata'],['--image-acceptance','imageAcceptance'],['--cloud-receipt','cloudReceipt'],['--platform-readback','platformReadback']]) {
      if(args[flag]){const artifact=await readPublic(args[flag]);inputs[key]=artifact.value;hashes[key]=artifact.sha256;}
    }
    const result={...projectOwnedReleaseEvidence(inputs),publicInputSha256:hashes};
    const encoded=JSON.stringify(result,null,2)+'\n';
    if(args['--output']) {
      const output=args['--output'],target=resolve(ROOT,output),inside=relative(ROOT,target);
      if(isAbsolute(output)||/^[A-Za-z]:/.test(output)||!inside||inside.startsWith('..')||isAbsolute(inside)
        ||extname(output).toLowerCase()!=='.json')fail('OUTPUT_MUST_BE_REPOSITORY_RELATIVE_JSON');
      await mkdir(dirname(target),{recursive:true});await writeFile(target,encoded);
    }
    process.stdout.write(encoded);
  }catch(error){process.stdout.write(JSON.stringify({schemaVersion:1,status:'projection_rejected',
    code:/^[A-Z_0-9]+$/.test(error.code??'')?error.code:'PUBLIC_ARTIFACT_READ_FAILED'})+'\n');process.exitCode=1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
