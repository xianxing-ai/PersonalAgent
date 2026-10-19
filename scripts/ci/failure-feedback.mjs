import path from 'node:path';
import {fileURLToPath} from 'node:url';

const failed=value=>['failure','timed_out'].includes(value);
const label=value=>String(value).replace(/[\r\n@]/g,' ').replace(/[\\`*_[\]<>]/g,'').slice(0,150);

export async function notifyFailure({repository,runId,token,fetchImpl=fetch,log=console.log}) {
  if(!/^[-\w]+\/[-\w.]+$/.test(repository??'')||!/^\d+$/.test(String(runId))||!token) throw Error('Missing trusted CI notification context');
  async function api(route,body) {
    const response=await fetchImpl(`https://api.github.com/repos/${repository}/${route}`,{
      method:body?'POST':'GET',
      headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)
    });
    if(!response.ok) throw Error(`CI feedback request failed (${response.status}); do not blindly retry a comment write`);
    return response.json();
  }
  async function pages(route,key) {
    const all=[];
    for(let page=1;;page++) {
      const value=await api(`${route}${route.includes('?')?'&':'?'}per_page=100&page=${page}`);
      const batch=key?value[key]:value;
      if(!Array.isArray(batch)) throw Error('Incomplete CI feedback evidence');
      all.push(...batch);
      if(batch.length<100) return all;
    }
  }
  const run=await api(`actions/runs/${runId}`);
  if(String(run.id)!==String(runId)||run.name!=='Foundation'||run.path!=='.github/workflows/ci.yml'||run.event!=='pull_request'||
    run.status!=='completed'||!failed(run.conclusion)) return {notified:[],reason:'Not a failed PR CI run'};
  if(!/^[a-f0-9]{40}$/.test(run.head_sha??'')||!Number.isSafeInteger(run.run_attempt)||run.run_attempt<1) throw Error('Invalid failed run identity');
  const [prs,jobs]=await Promise.all([
    pages(`commits/${run.head_sha}/pulls`),pages(`actions/runs/${runId}/attempts/${run.run_attempt}/jobs`,'jobs')
  ]);
  const failures=jobs.filter(job=>failed(job.conclusion));
  if(!failures.length) throw Error('Failed CI has no failed job evidence');
  const detailed=failures.some(job=>job.name!=='check')?failures.filter(job=>job.name!=='check'):failures;
  if(detailed.some(job=>!Number.isSafeInteger(job.id)||job.id<1)) throw Error('Invalid failed job identity');
  const marker=`<!-- personalagent-ci-failure:${runId}:${run.run_attempt} -->`,notified=[];
  for(const candidate of prs) {
    if(!Number.isSafeInteger(candidate.number)||candidate.number<1) throw Error('Invalid PR identity');
    const pr=await api(`pulls/${candidate.number}`);
    if(pr.state!=='open'||pr.head?.sha!==run.head_sha||pr.base?.ref!=='main'||pr.base.repo?.full_name!==repository) continue;
    if(!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(pr.user?.login??'')) throw Error('Invalid PR author identity');
    const comments=await pages(`issues/${pr.number}/comments`);
    if(comments.some(comment=>comment.user?.login==='github-actions[bot]'&&comment.body?.includes(marker))) continue;
    // Recheck after pagination so an old run cannot notify a newer revision.
    const current=await api(`pulls/${pr.number}`);
    if(current.state!=='open'||current.head?.sha!==run.head_sha) continue;
    const body=`${marker}\n@${pr.user.login} 本轮 CI 未通过，请由原作者修复后推送更新。评审者负责审批和验证，不代改代码。\n\n提交：\`${run.head_sha}\`；第 ${run.run_attempt} 次运行。\n\n${detailed.map(job=>`- [${label(job.name)}](https://github.com/${repository}/actions/runs/${runId}/job/${job.id})：${job.conclusion}`).join('\n')}\n\n已有的首次非作者批准保持有效；修改后当前提交的全部 CI 通过即进入受保护自动合并，main 不重复测试。\n`;
    const created=await api(`issues/${pr.number}/comments`,{body});
    notified.push({pr:pr.number,comment:created.id});
    log(`Notified original author for PR #${pr.number}, run ${runId}, attempt ${run.run_attempt}`);
  }
  return {notified};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  await notifyFailure({repository:process.env.GITHUB_REPOSITORY,runId:process.env.CI_FAILED_RUN_ID,token:process.env.GITHUB_TOKEN});
}
