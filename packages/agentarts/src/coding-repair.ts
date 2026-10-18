import {createHash} from 'node:crypto';
import {structuredPatch} from 'diff';
import ts from 'typescript';
import {ProtocolError} from '@personal-agent/contracts';
import {parseCodingRepairInput,parseCodingRepairPatch,parseCodingRepairCheckReadback} from '@personal-agent/contracts/coding-repair';
import type {CodingRepairInput,CodingRepairSnapshot,CodingRepairPatch,CodingRepairVerificationReceipt,CodingRepairDiagnostic} from '@personal-agent/contracts/coding-repair';

/** Data analysis only. No filesystem, subprocess, model, authorization or task store. */
export interface CodingRepairRoundRecord {round:number;sourceFingerprint:string;failureFingerprint:string;patchDigest:string;
  snapshotId:string;operationIds:string[];evidenceRefs:string[]}
export interface CodingRepairFrontier {version:1;round:number;configuration:CodingRepairInput;snapshot:CodingRepairSnapshot;
  verification:CodingRepairVerificationReceipt[];diagnostics:CodingRepairDiagnostic[];history:CodingRepairRoundRecord[];
  scopePaths:string[];sourceReferences:Record<string,{sha256:string;valueDigest:string;operationId:string}>;readPath?:string;
  pendingPatch?:{diagnosis:string;patches:CodingRepairPatch[]};stoppedReason?:'no_progress'|'verification_unknown'}
export const codingRepairDigest=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const codingPackageGraphDigest=(snapshot:CodingRepairSnapshot):string=>codingRepairDigest(snapshot.packages
  .map(p=>({id:p.id,path:p.path,dependencies:[...p.dependencies].sort()})).sort((a,b)=>a.id.localeCompare(b.id)));
export function codingSnapshotFingerprint(snapshot:CodingRepairSnapshot):string {
  return codingRepairDigest({files:snapshot.files.map(f=>({path:f.path,sha256:f.sha256,packageId:f.packageId,kind:f.kind})).sort((a,b)=>a.path.localeCompare(b.path)),
    packages:snapshot.packages.map(p=>({id:p.id,path:p.path,dependencies:[...p.dependencies].sort()})).sort((a,b)=>a.id.localeCompare(b.id))});
}
export function codingRepairConfiguration(input:unknown):CodingRepairInput|undefined {
  if(!input||typeof input!=='object'||Array.isArray(input)||!Object.hasOwn(input,'codingRepair'))return;
  return parseCodingRepairInput((input as Record<string,unknown>).codingRepair);
}
export function compactCodingSnapshot(snapshot:CodingRepairSnapshot):CodingRepairSnapshot {
  return {...snapshot,files:snapshot.files.map(({content:_content,...file})=>file)};
}
export function createCodingRepairFrontier(configuration:CodingRepairInput):CodingRepairFrontier {
  return {version:1,round:0,configuration:{...configuration,initialSnapshot:compactCodingSnapshot(configuration.initialSnapshot)},
    snapshot:compactCodingSnapshot(configuration.initialSnapshot),verification:[],diagnostics:[],history:[],scopePaths:[],sourceReferences:{}};
}
/** Production workspace dependencies, not guesses from individual import statements. */
export function affectedCodingPackages(before:CodingRepairSnapshot,after:CodingRepairSnapshot):string[] {
  const prior=new Map(before.files.map(f=>[f.path,f])),next=new Map(after.files.map(f=>[f.path,f]));
  const affected=new Set<string>();let global=false;
  for(const name of new Set([...prior.keys(),...next.keys()])) {
    const a=prior.get(name),b=next.get(name);if(a?.sha256===b?.sha256&&a?.kind===b?.kind&&a?.packageId===b?.packageId)continue;
    for(const f of [a,b])if(f){affected.add(f.packageId);
      if(f.kind==='lock'||f.kind==='config'&&[...before.packages,...after.packages].some(p=>p.id===f.packageId&&p.path===''))global=true;}
  }
  const packages=new Map([...before.packages,...after.packages].map(p=>[p.id,p]));
  for(const p of packages.values())if(codingRepairDigest(before.packages.find(x=>x.id===p.id)??null)!==codingRepairDigest(after.packages.find(x=>x.id===p.id)??null))affected.add(p.id);
  if(global)return [...packages.keys()].sort();
  for(let changed=true;changed;){changed=false;for(const p of packages.values())if(!affected.has(p.id)&&p.dependencies.some(id=>affected.has(id))){affected.add(p.id);changed=true;}}
  return [...affected].sort();
}
function dependencyClosure(snapshot:CodingRepairSnapshot,packageIds:readonly string[]):Set<string> {
  const result=new Set(packageIds);for(let changed=true;changed;){changed=false;
    for(const p of snapshot.packages)if(result.has(p.id))for(const dep of p.dependencies)if(!result.has(dep)){result.add(dep);changed=true;}}
  return result;
}
export function codingVerificationCurrent(receipt:CodingRepairVerificationReceipt,snapshot:CodingRepairSnapshot,sessionId:string):boolean {
  if(receipt.sessionId!==sessionId||receipt.status!=='VALID'||receipt.exitCode!==0||receipt.evidenceRefs.length===0)return false;
  if(receipt.packageGraphDigest===undefined?receipt.inputSnapshotId!==snapshot.snapshotId:receipt.packageGraphDigest!==codingPackageGraphDigest(snapshot))return false;
  const covered=dependencyClosure(snapshot,receipt.packageIds);
  if([...covered].some(id=>!snapshot.packages.some(p=>p.id===id)))return false;
  const relevant=(file:CodingRepairSnapshot['files'][number])=>covered.has(file.packageId)||file.kind==='lock'
    ||file.kind==='config'&&snapshot.packages.some(p=>p.id===file.packageId&&p.path==='');
  const hashes=(files:CodingRepairSnapshot['files'])=>files.filter(relevant).map(({content:_content,...f})=>f).sort((a,b)=>a.path.localeCompare(b.path));
  return codingRepairDigest(hashes(receipt.files))===codingRepairDigest(hashes(snapshot.files));
}
export function requiredCodingVerification(frontier:CodingRepairFrontier):boolean {
  return frontier.configuration.recipes.filter(r=>r.required).every(recipe=>{
    const receipt=[...frontier.verification].reverse().find(r=>r.recipeId===recipe.recipeId);
    return receipt!==undefined&&codingRepairDigest([...receipt.packageIds].sort())===codingRepairDigest([...recipe.packageIds].sort())
      &&codingVerificationCurrent(receipt,frontier.snapshot,frontier.configuration.session.sessionId);
  });
}
export function acceptCodingChecks(frontier:CodingRepairFrontier,value:unknown,trustedExecutionEvidence:readonly string[]=[]):'passed'|'failed'|'unknown' {
  const readback=parseCodingRepairCheckReadback(value);
  // The outer verified HostBridge receipt is committed after the composite check tool returns.
  // Bind its real Evidence to derived validity only; never rewrite the original host result/signature.
  for(const receipt of readback.verification)if(receipt.evidenceRefs.length===0)receipt.evidenceRefs=[...trustedExecutionEvidence];
  if(readback.sessionId!==frontier.configuration.session.sessionId||readback.verification.some(r=>!frontier.configuration.recipes.some(recipe=>recipe.recipeId===r.recipeId)))
    throw new ProtocolError('REVISION_CONFLICT','Coding verification session or recipe changed');
  // A failed recipe can remain current across unrelated package edits, just like a pass.
  // Graph/files bind its dependency closure; legacy receipts still require the exact snapshot.
  if(readback.verification.some(r=>r.status==='FAILED'&&(
    codingRepairDigest([...r.packageIds].sort())!==codingRepairDigest([...frontier.configuration.recipes.find(recipe=>recipe.recipeId===r.recipeId)!.packageIds].sort())
    ||!codingVerificationCurrent({...r,status:'VALID',exitCode:0},readback.snapshot,readback.sessionId))))
    throw new ProtocolError('REVISION_CONFLICT','Failed verification does not match the current source snapshot');
  const affected=new Set(affectedCodingPackages(frontier.snapshot,readback.snapshot));
  frontier.verification=frontier.verification.map(receipt=>receipt.packageIds.some(id=>affected.has(id))?{...receipt,status:'STALE' as const}:receipt);
  frontier.verification.push(...readback.verification);frontier.snapshot=compactCodingSnapshot(readback.snapshot);
  frontier.diagnostics=readback.verification.flatMap(r=>r.diagnostics);
  if(requiredCodingVerification(frontier))return 'passed';
  const latest=frontier.configuration.recipes.filter(r=>r.required).map(recipe=>[...frontier.verification].reverse().find(r=>r.recipeId===recipe.recipeId));
  // A successful command with stale/missing coverage is not a verified pass or a known test failure.
  return latest.some(r=>r?.status==='FAILED'&&r.exitCode!==null&&r.exitCode!==0&&r.evidenceRefs.length>0)?'failed':'unknown';
}
export function parseCodingPatchCandidate(value:unknown):{diagnosis:string;patches:CodingRepairPatch[]} {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new ProtocolError('INVALID_ARGUMENT','Expected coding patch candidate');
  const v=value as Record<string,unknown>;
  if(Object.keys(v).some(k=>!['diagnosis','patches'].includes(k))||typeof v.diagnosis!=='string'||!v.diagnosis.trim()||!Array.isArray(v.patches)||v.patches.length===0)
    throw new ProtocolError('INVALID_ARGUMENT','Invalid coding patch candidate');
  const patches=v.patches.map(parseCodingRepairPatch);if(new Set(patches.map(p=>p.path)).size!==patches.length)throw new ProtocolError('INVALID_ARGUMENT','Duplicate coding patch path');
  return {diagnosis:v.diagnosis,patches};
}
export interface CodingPatchAnalysis {path:string;beforeSha256:string|null;afterSha256:string;addedLines:number;removedLines:number;
  hunks:{oldStart:number;oldLines:number;newStart:number;newLines:number}[];
  syntax:{supported:boolean;diagnostics:{message:string;line?:number}[];declarations:{kind:string;name?:string;startLine:number;endLine:number}[]}}
export function analyzeCodingPatches(candidate:ReturnType<typeof parseCodingPatchCandidate>,snapshot:CodingRepairSnapshot):CodingPatchAnalysis[] {
  return candidate.patches.map(patch=>{
    const file=snapshot.files.find(f=>f.path===patch.path);
    if(patch.expectedSha256===null?(file!==undefined&&file.sha256!==null):(file?.sha256!==patch.expectedSha256||typeof file.content!=='string'))
      throw new ProtocolError('REVISION_CONFLICT','Coding patch has no matching current source snapshot');
    const before=patch.expectedSha256===null?'':file!.content!;
    if(patch.expectedSha256!==null&&codingRepairDigestText(before)!==patch.expectedSha256)throw new ProtocolError('REVISION_CONFLICT','Coding source content does not match its SHA');
    let after=patch.createText??before;
    for(const edit of patch.edits){const at=after.indexOf(edit.oldText);if(at<0||after.indexOf(edit.oldText,at+1)>=0)throw new ProtocolError('INVALID_ARGUMENT','Coding patch must use a unique exact oldText');
      after=after.slice(0,at)+edit.newText+after.slice(at+edit.oldText.length);}
    if(after===before&&patch.expectedSha256!==null)throw new ProtocolError('INVALID_ARGUMENT','Coding patch makes no change');
    // jsdiff computes ranges only; its fuzzy application APIs are deliberately never used.
    const difference=structuredPatch(patch.path,patch.path,before,after);
    const hunks=difference.hunks.map(({oldStart,oldLines,newStart,newLines})=>({oldStart,oldLines,newStart,newLines}));
    let syntax:CodingPatchAnalysis['syntax']={supported:false,diagnostics:[],declarations:[]};
    if(/\.(?:[cm]?[jt]s|[jt]sx)$/i.test(patch.path)){
      const source=ts.createSourceFile(patch.path,after,ts.ScriptTarget.Latest,true);
      const diagnostics=(source as ts.SourceFile&{parseDiagnostics:readonly ts.Diagnostic[]}).parseDiagnostics;
      const declarations:CodingPatchAnalysis['syntax']['declarations']=[];
      const visit=(node:ts.Node):void=>{
        const startLine=source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,endLine=source.getLineAndCharacterOfPosition(node.end).line+1;
        if((ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)||ts.isMethodDeclaration(node)||ts.isInterfaceDeclaration(node)||ts.isVariableStatement(node))
          &&hunks.some(h=>startLine<=h.newStart+Math.max(1,h.newLines)&&endLine>=h.newStart)){
          const named=node as ts.Node&{name?:ts.Node};declarations.push({kind:ts.SyntaxKind[node.kind]??'Unknown',...(named.name?{name:named.name.getText(source)}:{}),startLine,endLine});
        }
        ts.forEachChild(node,visit);
      };visit(source);
      syntax={supported:true,diagnostics:diagnostics.map(d=>({message:ts.flattenDiagnosticMessageText(d.messageText,'\n'),
        ...(d.start===undefined?{}:{line:source.getLineAndCharacterOfPosition(d.start).line+1})})),declarations};
    }
    return {path:patch.path,beforeSha256:patch.expectedSha256,afterSha256:codingRepairDigestText(after),hunks,
      addedLines:difference.hunks.flatMap(h=>h.lines).filter(line=>line.startsWith('+')).length,
      removedLines:difference.hunks.flatMap(h=>h.lines).filter(line=>line.startsWith('-')).length,syntax};
  });
}
export const codingRepairDigestText=(value:string):string=>createHash('sha256').update(value,'utf8').digest('hex');
/** A local search objective over supplied candidates, not a proof of global or semantic optimality. */
export function codingPatchCost(frontier:CodingRepairFrontier,candidate:ReturnType<typeof parseCodingPatchCandidate>,snapshot:CodingRepairSnapshot) {
  const failingPackages=new Set(frontier.diagnostics.flatMap(d=>d.path?snapshot.files.filter(f=>f.path===d.path).map(f=>f.packageId):[]));
  const supported=dependencyClosure(snapshot,[...failingPackages]);
  for(const patch of candidate.patches){
    if(!frontier.scopePaths.includes(patch.path))throw new ProtocolError('UNSUPPORTED_CAPABILITY','Repair patch is outside its selected source scope');
    const file=snapshot.files.find(f=>f.path===patch.path);
    if(file&&supported.size>0&&!supported.has(file.packageId))throw new ProtocolError('UNSUPPORTED_CAPABILITY','Repair patch has no affected-package dependency evidence');
    // Deterministic detection of obvious check removal/disablement, never a general semantic proof.
    const checks=(text:string)=>(text.match(/\b(?:assert(?:\.[A-Za-z_$][\w$]*)?|expect|test|it)\s*\(/g)??[]).length;
    for(const edit of patch.edits)if(checks(edit.newText)<checks(edit.oldText)
      ||/\b(?:test|it|describe|suite)\.(?:skip|todo)\s*\(/.test(edit.newText)&&!/\b(?:test|it|describe|suite)\.(?:skip|todo)\s*\(/.test(edit.oldText))
      throw new ProtocolError('UNSUPPORTED_CAPABILITY','Repair candidate removes or disables verification; independent user-directed review required');
  }
  const analysis=analyzeCodingPatches(candidate,snapshot);
  return {changedFiles:analysis.length,changedLines:analysis.reduce((sum,f)=>sum+f.addedLines+f.removedLines,0),
    scopeBasis:supported.size?'actual_diagnostic_package_and_production_dependencies':'host_selected_scope_without_localized_failure',
    semanticCorrectness:'unproven_until_actual_current_verification',analysis};
}
export function rankCodingRepairCandidates<T extends {id:string;description:string;value:unknown;abstain?:true}>(frontier:CodingRepairFrontier,snapshot:CodingRepairSnapshot,candidates:readonly T[]):T[] {
  const accepted:{candidate:T;cost:ReturnType<typeof codingPatchCost>}[]=[];
  for(const candidate of candidates){if(candidate.abstain)continue;
    try{accepted.push({candidate,cost:codingPatchCost(frontier,parseCodingPatchCandidate(candidate.value),snapshot)});}
    catch(error){if(!(error instanceof ProtocolError))throw error;}
  }
  accepted.sort((a,b)=>a.cost.changedFiles-b.cost.changedFiles||a.cost.changedLines-b.cost.changedLines);
  if(accepted.length===0)throw new ProtocolError('UNSUPPORTED_CAPABILITY','No exact current-scope coding candidate passed local feasibility analysis');
  return accepted.map(({candidate,cost})=>({...candidate,description:candidate.description+'\nLocal repair cost (advisory; smaller does not prove correctness): '
    +JSON.stringify({changedFiles:cost.changedFiles,changedLines:cost.changedLines,scopeBasis:cost.scopeBasis,semanticCorrectness:cost.semanticCorrectness})}));
}
export function codingFailureFingerprint(frontier:CodingRepairFrontier):string {
  return codingRepairDigest(frontier.verification.filter(r=>r.status==='FAILED').map(r=>({recipeId:r.recipeId,exitCode:r.exitCode,diagnostics:r.diagnostics})).sort((a,b)=>a.recipeId.localeCompare(b.recipeId)));
}
export function codingPatchFingerprint(patches:CodingRepairPatch[]):string {
  return codingRepairDigest(patches.map(({expectedSha256:_sha,...p})=>p).sort((a,b)=>a.path.localeCompare(b.path)));
}
export function codingPatchRepeated(frontier:CodingRepairFrontier,patches:CodingRepairPatch[]):boolean {
  const sourceFingerprint=codingSnapshotFingerprint(frontier.snapshot),failureFingerprint=codingFailureFingerprint(frontier),patchDigest=codingPatchFingerprint(patches);
  return frontier.history.some(r=>r.sourceFingerprint===sourceFingerprint&&r.failureFingerprint===failureFingerprint&&r.patchDigest===patchDigest);
}
