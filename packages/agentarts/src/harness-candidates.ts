import {ProtocolError} from '@personal-agent/contracts';
import {parseHarnessCandidateBinding,parseHarnessCandidateTrial,harnessCandidateRecipeFingerprint} from '@personal-agent/contracts/harness-candidates';
import type {HarnessCandidateContext,HarnessCandidateComparison} from '@personal-agent/contracts/harness-candidates';
import {parseCodingRepairInput} from '@personal-agent/contracts/coding-repair';
import type {CodingRepairSnapshot} from '@personal-agent/contracts/coding-repair';
import {codingRepairDigest,codingSnapshotFingerprint,codingPackageGraphDigest,codingVerificationCurrent} from './coding-repair.js';

export const harnessRecipeFingerprint=harnessCandidateRecipeFingerprint;
const fail=(message:string):never=>{throw new ProtocolError('REVISION_CONFLICT',message);};
const metadata=(snapshot:CodingRepairSnapshot)=>snapshot.files.every(f=>f.content===undefined&&f.sha256!==null);
const testFingerprint=(snapshot:CodingRepairSnapshot)=>codingRepairDigest(snapshot.files.filter(f=>f.kind==='test')
  .map(f=>({path:f.path,sha256:f.sha256,packageId:f.packageId})).sort((a,b)=>a.path.localeCompare(b.path)));
const changedPaths=(before:CodingRepairSnapshot,after:CodingRepairSnapshot)=>[...new Set([...before.files,...after.files].map(f=>f.path))]
  .filter(path=>before.files.find(f=>f.path===path)?.sha256!==after.files.find(f=>f.path===path)?.sha256).sort();

/** Pure comparison of already observed trials. This neither runs a candidate nor grants publication. */
export function compareHarnessCandidates(context:HarnessCandidateContext,values:readonly unknown[]):HarnessCandidateComparison {
  const expected=parseHarnessCandidateBinding({...context.binding,trialTaskId:'context',candidateId:'context',artifactId:'context',sessionId:'context',
    artifactDigest:'0'.repeat(64),parentArtifactDigests:[]});
  const configuration=parseCodingRepairInput({version:1,session:{version:1,sessionId:'context',taskId:expected.taskId,
    workspaceId:expected.workspaceId,mode:'isolated',baselineSnapshotId:expected.baselineSnapshotId},initialSnapshot:context.baseline,recipes:context.recipes});
  if(!['unique_verified','fewest_changed_files'].includes(context.selectionPolicy)||!metadata(configuration.initialSnapshot)
    ||harnessRecipeFingerprint(configuration.recipes)!==expected.recipeFingerprint)fail('Trusted trial comparison configuration changed');
  if(values.length>16)throw new ProtocolError('INVALID_ARGUMENT','Too many candidate trials');
  const trials=values.map(parseHarnessCandidateTrial),ids=new Set<string>(),artifacts=new Set<string>(),sessions=new Set<string>(),runs=new Set<string>();
  const candidates:HarnessCandidateComparison['candidates']=[];
  for(const trial of trials) {
    const {binding:b,session,checkReadback:checked}=trial;
    for(const key of Object.keys(context.binding) as (keyof HarnessCandidateContext['binding'])[])if(b[key]!==expected[key])fail('Candidate comparison identity differs');
    if(session.taskId!==b.trialTaskId||session.workspaceId!==b.workspaceId||session.sessionId!==b.sessionId||session.mode!=='isolated'
      ||session.baselineSnapshotId!==b.baselineSnapshotId||checked.sessionId!==b.sessionId
      ||!metadata(checked.snapshot)||checked.verification.some(r=>r.files.some(f=>f.content!==undefined))
      ||b.artifactDigest!==codingSnapshotFingerprint(checked.snapshot))fail('Candidate artifact or isolation binding differs');
    if(ids.has(b.candidateId)||artifacts.has(b.artifactId)||sessions.has(b.sessionId))fail('Candidate identities must be independent');
    ids.add(b.candidateId);artifacts.add(b.artifactId);sessions.add(b.sessionId);
    // A comparison is against the same test suite and package graph. Changing these needs a new experiment.
    if(testFingerprint(checked.snapshot)!==testFingerprint(context.baseline)
      ||codingPackageGraphDigest(checked.snapshot)!==codingPackageGraphDigest(context.baseline))fail('Candidate changed comparison tests or package graph');
    const recipeIds=new Set<string>();
    for(const r of checked.verification) {
      if(runs.has(r.runId)||recipeIds.has(r.recipeId))fail('Verification cannot be inherited or replayed');
      runs.add(r.runId);recipeIds.add(r.recipeId);
      const recipe=context.recipes.find(p=>p.recipeId===r.recipeId);
      if(!recipe||codingRepairDigest([...recipe.packageIds].sort())!==codingRepairDigest([...r.packageIds].sort())
        ||new Set(r.files.map(f=>f.path)).size!==r.files.length)fail('Candidate verification recipe differs');
    }
    const current=(r:typeof checked.verification[number])=>r.inputSnapshotId===checked.snapshot.snapshotId
      &&codingVerificationCurrent({...r,status:'VALID',exitCode:0},checked.snapshot,b.sessionId);
    const required=context.recipes.filter(r=>r.required).map(r=>checked.verification.find(v=>v.recipeId===r.recipeId));
    const status=required.some(r=>r?.status==='FAILED'&&r.exitCode!==null&&r.exitCode!==0&&current(r))?'failed'
      :required.every(r=>r?.status==='VALID'&&r.exitCode===0&&current(r))?'verified':'unknown';
    candidates.push({candidateId:b.candidateId,artifactId:b.artifactId,status,changedFiles:changedPaths(context.baseline,checked.snapshot).length});
  }
  for(const trial of trials)if(trial.binding.parentArtifactDigests.length) {
    const b=trial.binding;
    if(b.parentArtifactDigests.length<2||b.parentArtifactDigests.some(d=>!trials.some(t=>t!==trial&&t.binding.artifactDigest===d)))
      fail('Combination must reference independently observed parent artifacts');
    // Fresh artifact/session and run IDs were checked above; no parent result is substituted here.
    if(b.parentArtifactDigests.some(d=>d===b.artifactDigest))fail('Combination must be a separately validated artifact');
  }
  const visiting=new Set<string>(),visited=new Set<string>();
  const visit=(artifactId:string):void=>{
    if(visiting.has(artifactId))fail('Combination ancestry cannot contain a cycle');
    if(visited.has(artifactId))return;
    visiting.add(artifactId);
    const trial=trials.find(t=>t.binding.artifactId===artifactId)!;
    for(const digest of trial.binding.parentArtifactDigests)for(const parent of trials.filter(t=>t.binding.artifactDigest===digest))visit(parent.binding.artifactId);
    visiting.delete(artifactId);visited.add(artifactId);
  };
  for(const trial of trials)visit(trial.binding.artifactId);
  const eligible=candidates.filter(c=>c.status==='verified').sort((a,b)=>a.changedFiles-b.changedFiles);
  const selected=eligible.length===1?eligible[0]:context.selectionPolicy==='fewest_changed_files'&&eligible[0]
    &&eligible[0].changedFiles<eligible[1]!.changedFiles?eligible[0]:undefined;
  if(!selected)return {version:1,state:'abstained',reason:eligible.length?'ambiguous_verified_candidates':'no_verified_candidate',candidates,verification:'unverified'};
  const trial=trials.find(t=>t.binding.candidateId===selected.candidateId)!;
  return {version:1,state:'selected',reason:eligible.length===1?'only_verified_candidate':'trusted_change_count_criterion',candidates,
    recommendation:{candidateId:selected.candidateId,artifactId:selected.artifactId,artifactDigest:trial.binding.artifactDigest,
      publishRequest:{version:1,sessionId:trial.session.sessionId,baselineSnapshotId:trial.binding.baselineSnapshotId,
        snapshotId:trial.checkReadback.snapshot.snapshotId,paths:changedPaths(context.baseline,trial.checkReadback.snapshot),
        verificationRunIds:trial.checkReadback.verification.filter(r=>r.status==='VALID').map(r=>r.runId)}},verification:'unverified'};
}
