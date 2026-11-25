import {ProtocolError} from '@personal-agent/contracts';

const fail=message=>{throw new ProtocolError('UNSUPPORTED_CAPABILITY',message);};
const time=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):NaN;

/** Fixed readback recipe over original ToolGateway receipts. Local command stdout is
 * never a CI identity. Publishing/triggering the repaired commit remains an explicit
 * prerequisite, performed by the existing authorized Git/CI path. */
export function selectF16RepairedRun({input,baseline,originalRun,head,command,patchRecord,runs}) {
  if(command?.result?.recipeId!==input.recipeId||command.result.exitCode!==0||command.record?.state!=='confirmed'
    ||command.record.policyDecision!=='allow'||!command.record.executionStarted)
    fail('F16 original fixed acceptance command did not pass');
  if(head?.result?.headSha===input.headSha||head?.result?.workspaceClean!==true||!/^[a-f0-9]{40,64}$/.test(head?.result?.headSha??''))
    fail('f16_ci_publication_required: publish the exact verified repair through the original authorized Git path');
  if(baseline?.policy!=='unchanged-acceptance-bytes-v1'||originalRun?.id!==input.runId||originalRun.headSha!==input.headSha
    ||originalRun.name!==baseline.workflowName||originalRun.status!=='completed'||originalRun.conclusion!=='failure'
    ||!Number.isFinite(time(patchRecord?.finishedAt))||patchRecord.state!=='confirmed'||!Array.isArray(runs?.result?.items))
    fail('F16 original CI definition or patch execution is unavailable');
  const matches=runs.result.items.filter(run=>run.id!==input.runId&&run.headSha===head.result.headSha&&run.name===baseline.workflowName
    &&run.status==='completed'&&run.conclusion==='success'&&time(run.createdAt)>=time(patchRecord.finishedAt));
  if(matches.length!==1)fail('F16 repaired commit requires one unambiguous fresh successful GitHub CI run');
  return {repository:input.repository,headSha:head.result.headSha,runId:matches[0].id};
}

export function selectF16RepairedJob({input,run,originalJob,jobs}) {
  if(originalJob?.id!==input.jobId||originalJob.runId!==input.runId||originalJob.status!=='completed'||originalJob.conclusion!=='failure'
    ||typeof originalJob.name!=='string'||!originalJob.name||!Array.isArray(jobs?.result?.items))fail('F16 original failed CI job is unavailable');
  const matches=jobs.result.items.filter(job=>job.runId===run.runId&&job.name===originalJob.name&&job.status==='completed'&&job.conclusion==='success');
  if(matches.length!==1)fail('F16 repaired CI requires the original named job to succeed unambiguously');
  return {...run,jobId:matches[0].id};
}
