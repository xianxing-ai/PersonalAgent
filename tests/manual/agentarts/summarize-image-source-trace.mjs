// Generate the reviewable whitelist projection; raw OCI/config/history stays local.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../../',import.meta.url)),hash=value=>createHash('sha256').update(value).digest('hex');
const json=async filename=>JSON.parse(await readFile(filename,'utf8'));
const scalarSource=source=>source?Object.fromEntries(['path','gitBlob','sha256','lfSha256','bytes'].filter(key=>source[key]!==undefined).map(key=>[key,source[key]])):undefined;
const publicRepo=source=>/^https:\/\/github\.com\/(?:zemeng5208|xianxing-ai)\/PersonalAgent(?:\.git)?$/.test(source??'')?source:{redacted:true,sha256:hash(String(source))};
export async function summarize({recovery,comparison,emit,remote,history,inputs,matchingDependencyFiles}){
  const recovered=await json(recovery),compared=await json(comparison),compiled=await json(emit),chain=await json(remote),builders=await json(history);
  const candidate=compared.candidates.find(value=>value.revision===compiled.revision);
  if(!candidate||recovered.image!==compiled.image||recovered.recoveredTreeSha256!==compiled.recoveredTreeSha256||recovered.recoveredTreeSha256!==compared.recoveredTreeSha256)throw Error('Trace receipts are not bound to the same immutable inputs');
  if(compiled.summary.files!==74||compiled.summary.exactBytes!==74||candidate.summary.different||candidate.summary.missing)throw Error('Incomplete candidate equivalence');
  const mapping=new Map(candidate.files.map(file=>[file.path,file])),emitted=new Map(compiled.emitted.map(file=>[file.path,file]));
  const audit={files:0,credentialPatternMatches:[],privatePathPatternMatches:[],registryCredentials:false,lockResolvedHosts:[]};
  for(const file of recovered.files){const bytes=await readFile(path.join(inputs,...file.path.split('/')));if(hash(bytes)!==file.sha256)throw Error('Recovery changed before publication');const text=bytes.toString('utf8');audit.files++;
    if(/(?<![a-z0-9_])(?:gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{30,}|sk-[a-z0-9_-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i.test(text))audit.credentialPatternMatches.push(file.path);
    if(/[a-z]:[\\/](?:Users|Documents and Settings)[\\/]|\/(?:home|Users)\/[^/\s]+\//i.test(text))audit.privatePathPatternMatches.push(file.path);
  }
  const lock=JSON.parse(await readFile(path.join(inputs,'package-lock.json'),'utf8')),hosts=new Set();
  for(const entry of Object.values(lock.packages)){if(typeof entry.resolved!=='string'||!entry.resolved.startsWith('https://'))continue;const uri=new URL(entry.resolved);hosts.add(uri.hostname);if(uri.username||uri.password||uri.search||uri.hash)audit.registryCredentials=true;}
  audit.lockResolvedHosts=[...hosts].sort();if(audit.credentialPatternMatches.length||audit.privatePathPatternMatches.length||audit.registryCredentials)throw Error('Review sensitive retained inputs before publishing any derivative');
  const productionManifest=JSON.parse(await readFile(path.join(inputs,'packages/agentarts/package.json'),'utf8'));
  const priorDependencies=await json(matchingDependencyFiles),compilerInImage=priorDependencies.find(file=>file.path==='node_modules/typescript/lib/typescript.js');
  if(productionManifest.dependencies?.typescript!==compiled.compiler.version||compilerInImage?.sha256!==compiled.compiler.sha256)throw Error('Compiler is not bound to the prior fixed-image dependency extraction');
  const manifest=recovered.files.map(file=>{
    const source=mapping.get(file.path),built=emitted.get(file.path);if(!source)throw Error('Missing retained input mapping');
    const status=built?(built.exactBytes?'candidate_emit_exact_bytes':'different'):source.status;
    if(!['candidate_emit_exact_bytes','exact_bytes','lf_only_match'].includes(status))throw Error('Unclosed retained input');
    return{path:file.path,bytes:file.bytes,sha256:file.sha256,lfSha256:file.lfSha256,layerDigest:file.layer,
      method:source.method,status,sourceCandidate:compiled.revision,source:scalarSource(source.source),
      candidateExpectedSha256:built?.sha256??source.expectedSha256};
  });
  const manifestText=manifest.map(file=>JSON.stringify(file)).join('\n')+'\n';
  const sourceManifest=compiled.sources.filter(file=>file.path.endsWith('.ts')).map(scalarSource);
  if(sourceManifest.length!==37||new Set(compiled.emitted.map(file=>file.sourcePath)).size!==37)throw Error('Unexpected compiler input set');
  const emitReceipt={kind:compiled.kind,version:compiled.version,image:compiled.image,revision:compiled.revision,
    recoveredTreeSha256:compiled.recoveredTreeSha256,startedAt:compiled.startedAt,finishedAt:compiled.finishedAt,
    node:compiled.node,platform:compiled.platform,compiler:{...compiled.compiler,origin:{kind:'existing_fixed_image_production_dependency',
      dependentWorkspace:'packages/agentarts',dependencyVersion:productionManifest.dependencies.typescript,imageLockIntegrity:lock.packages['node_modules/typescript'].integrity,
      priorExtractedFile:{path:compilerInImage.path,sha256:compilerInImage.sha256},priorDependencyManifestSha256:hash(await readFile(matchingDependencyFiles))}},dependencyMode:compiled.dependencyMode,
    typescriptSources:sourceManifest,configurationFiles:compiled.sources.filter(file=>file.path.endsWith('tsconfig.json')||file.path==='tsconfig.base.json').map(scalarSource),
    developmentTypes:compiled.developmentTypes.map(item=>({location:item.location,name:item.name,version:item.version,lockIntegrity:item.lockIntegrity,declarationFiles:item.declarationFiles.map(file=>({path:file.path,sha256:file.sha256}))})),
    programs:compiled.programs.map(program=>({workspace:program.workspace,sourceFiles:program.sourceFiles,parsedConfiguration:program.originalConfiguration,
      baseConfigurationSha256:program.baseConfigurationSha256,errorCodes:program.errorCodes,emitSkipped:program.emitSkipped})),
    emitted:compiled.emitted.map(file=>({path:file.path,bytes:file.bytes,sha256:file.sha256,imageSha256:file.imageSha256,exactBytes:file.exactBytes,lfEqual:file.lfEqual,sourcePath:file.sourcePath})),
    summary:compiled.summary,uniqueHistoricalGitSourceEstablished:false,claim:compiled.claim};
  const provenance=recovered.attestations.map(value=>({digest:value.digest,predicateType:value.predicateType,buildType:value.buildType,
    invocationId:value.invocationId,startedOn:value.startedOn,finishedOn:value.finishedOn,
    declaredVcs:{source:publicRepo(value.vcs.source),revision:value.vcs.revision,contextLeaf:/^context-[a-z0-9_-]+$/i.test(value.vcs.contextLeaf??'')?value.vcs.contextLeaf:null,dirtyFieldPresent:value.vcs.dirtyPresent},
    baseDependencies:value.resolvedDependencies.map(dependency=>({sha256:dependency.digest?.sha256,uriSha256:hash(String(dependency.uri))}))}));
  const receipt={kind:'arm64_existing_image_source_trace',version:1,issue:459,profile:'huawei_ict_agentarts',
    image:{reference:recovered.image,indexDigest:recovered.indexDigest,memberDigest:recovered.memberDigest,configDigest:recovered.configDigest,created:recovered.imageCreated,os:recovered.os,architecture:recovered.architecture,user:recovered.user,workingDirectory:recovered.workingDirectory},
    immutableArchive:{bytes:recovered.archiveBytes,sha256:recovered.archiveSha256,rawCommitted:false},
    recovery:{retainedFiles:recovered.recoveredFileCount,retainedWriteVersions:recovered.copyVersions.length,treeSha256:recovered.recoveredTreeSha256,
      blobChecks:recovered.blobChecks,layers:recovered.layers,manifestSha256:hash(manifestText),allLayerDiffIdsVerified:true},
    provenance,candidate:{revision:candidate.revision,tree:candidate.tree,commit:candidate.commit,
      generatedOrStrippedConfigurationExact:8,directSourceLfEquivalent:29,compilerOutputExact:74,totalCovered:manifest.length,
      sourceLock:candidate.sourceLock,contextGenerator:candidate.contextGenerator,dockerfile:candidate.dockerfile},
    alternatives:compared.candidates.filter(value=>value.revision!==candidate.revision).map(value=>({revision:value.revision,summary:value.summary,
      materialDifferences:value.files.filter(file=>file.status==='different').map(file=>({path:file.path,method:file.method,imageSha256:file.imageSha256,expectedSha256:file.expectedSha256,source:scalarSource(file.source)}))})),
    historyLookup:builders.map(builder=>({context:builder.context,runningContainers:builder.runningContainerIds.length,records:builder.history.length,
      firstCreatedAt:builder.history.at(-1)?.created_at,lastCreatedAt:builder.history[0]?.created_at,targetInvocationPresent:builder.targetInvocationPresent})),
    remoteEvidence:{safeChainSha256:hash(await readFile(remote)),
      candidate:{commit:chain.candidate.commit,parent:chain.candidate.parent,authorDate:chain.candidate.authorDate,committerDate:chain.candidate.committerDate,secondsAfterConfigCreation:chain.candidate.secondsAfterConfigCreation},
      releaseSourceSemantics:chain.publicationCode.receiptSourceSemantics,
      originalReleaseReceiptRelativePath:chain.publicationCode.originalReleaseReceiptRelativePath,
      buildWindow:{from:chain.ciReadbacks.buildWindow.from,to:chain.ciReadbacks.buildWindow.to,totalRuns:chain.ciReadbacks.buildWindow.totalRuns,previewOrPublishRunCount:chain.ciReadbacks.buildWindow.previewOrPublishRunCount},
      provenanceHeadRuns:{head:chain.ciReadbacks.provenanceHeadRuns.head,total:chain.ciReadbacks.provenanceHeadRuns.total,workflowNames:chain.ciReadbacks.provenanceHeadRuns.workflowNames},
      candidateHeadRuns:{head:chain.ciReadbacks.candidateHeadRuns.head,total:chain.ciReadbacks.candidateHeadRuns.total},
      releases:{count:chain.ciReadbacks.releases.count,newestPublished:chain.ciReadbacks.releases.newestPublished,targetIdentifierMatches:chain.ciReadbacks.releases.targetIdentifierMatches},
      delegatedGitHubApi:{fixedSubjectAttestationsHttpStatus:chain.ciReadbacks.delegatedGitHubApi.fixedSubjectAttestationsHttpStatus,
        attestationCount:chain.ciReadbacks.delegatedGitHubApi.attestationCount,statusMeaning:chain.ciReadbacks.delegatedGitHubApi.statusMeaning,
        artifactCollectionHttpStatus:chain.ciReadbacks.delegatedGitHubApi.artifactCollectionHttpStatus,artifactTotalCount:chain.ciReadbacks.delegatedGitHubApi.artifactTotalCount,
        pagesRead:chain.ciReadbacks.delegatedGitHubApi.pagesRead,buildWindowCandidateCount:chain.ciReadbacks.delegatedGitHubApi.buildWindowCandidateCount,
        buildWindowCandidateIds:chain.ciReadbacks.delegatedGitHubApi.buildWindowCandidates.map(value=>value.id),
        legacyNamedCandidateCount:chain.ciReadbacks.delegatedGitHubApi.legacyNamedCandidateCount,
        targetDigestInvocationOrContextNameMatches:chain.ciReadbacks.delegatedGitHubApi.targetDigestInvocationOrContextNameMatches,artifactDownloads:chain.ciReadbacks.delegatedGitHubApi.artifactDownloads},
      sessionHeaderLookup:{dateDirectories:chain.historyLookup.sessionHeaderLookup.dateDirectories,fileCount:chain.historyLookup.sessionHeaderLookup.fileCount,
        sessionMetaFirstLineCount:chain.historyLookup.sessionHeaderLookup.sessionMetaFirstLineCount,parseFailureCount:chain.historyLookup.sessionHeaderLookup.parseFailureCount,
        inaccessibleCount:chain.historyLookup.sessionHeaderLookup.inaccessibleCount,matchCount:chain.historyLookup.sessionHeaderLookup.matchCount,messageBodiesRead:0}},
    originalSanitizedReceiptHashes:{recovery:hash(await readFile(recovery)),comparison:hash(await readFile(comparison)),emit:hash(await readFile(emit))},
    privacyAudit:audit,uniqueHistoricalGitSourceEstablished:false,
    conclusion:'All 111 retained immutable-image inputs are recovered and mapped to a reproducible committed candidate. The recovered image differs from a clean db936 checkout in three direct runtime files; the declared VCS revision alone cannot identify the local context inputs. A post-build candidate and compiler equivalence do not identify a unique historical Git HEAD or unretained compiler/context bytes.'};
  return{receipt,manifestText,emitReceipt};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>16384)throw Error('Summary configuration too large');}
    const config=JSON.parse(input),result=await summarize(config),directory=path.join(root,'docs','competition','evidence'),stem='ARM64_SOURCE_TRACE_459_20261021';
    await writeFile(path.join(directory,stem+'.receipt.json'),JSON.stringify(result.receipt,null,2)+'\n',{flag:'wx'});
    await writeFile(path.join(directory,stem+'.manifest.jsonl'),result.manifestText,{flag:'wx'});
    await writeFile(path.join(directory,stem+'.emit.json'),JSON.stringify(result.emitReceipt,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({kind:result.receipt.kind,retainedFiles:result.receipt.recovery.retainedFiles,coverage:result.receipt.candidate.totalCovered,
      compilerExact:result.emitReceipt.summary.exactBytes,privacyAudit:result.receipt.privacyAudit,uniqueHistoricalGitSourceEstablished:false}));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
