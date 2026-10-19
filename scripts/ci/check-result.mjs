import {appendFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export function verifySelectedJobs({routeResult,ciResult,matrix,jobs}) {
  if(routeResult!=='success'||ciResult!=='success') throw Error('Router and selected CI must both succeed');
  if(!Array.isArray(matrix?.include)||matrix.include.length<1||matrix.include.length>2||
    new Set(matrix.include.map(job=>job.kind)).size!==matrix.include.length) throw Error('Missing or invalid selected CI matrix');
  return matrix.include.map(selected=>{
    if(!['windows','image'].includes(selected.kind)||!Array.isArray(selected.runner)||!selected.runner.length) throw Error('Invalid selected platform');
    const matches=jobs.filter(job=>job.name===selected.name);
    if(matches.length!==1) throw Error(`Missing or ambiguous actual job: ${selected.name}`);
    const job=matches[0];
    if(job.status!=='completed'||job.conclusion!=='success') throw Error(`Selected job did not pass: ${selected.name}`);
    if(!job.runner_name||!Array.isArray(job.labels)||!selected.runner.every(label=>job.labels.includes(label))) throw Error(`Runner evidence missing or mismatched: ${selected.name}`);
    return {platform:selected.kind,job:job.name,runner:job.runner_name,result:job.conclusion,url:job.html_url};
  });
}

export async function readAttemptJobs({repository,runId,attempt,token,fetchImpl=fetch}) {
  if(!/^[-\w]+\/[-\w.]+$/.test(repository??'')||!/^\d+$/.test(String(runId))||!/^\d+$/.test(String(attempt))||!token) throw Error('Missing trusted run context');
  const jobs=[];
  for(let page=1;;page++) {
    const response=await fetchImpl(`https://api.github.com/repos/${repository}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100&page=${page}`,{
      headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},
      redirect:'error',signal:AbortSignal.timeout(30000)
    });
    if(!response.ok) throw Error(`Cannot read actual CI jobs (${response.status})`);
    const value=await response.json();
    if(!Array.isArray(value.jobs)||!Number.isSafeInteger(value.total_count)) throw Error('Incomplete CI job response');
    jobs.push(...value.jobs);
    if(value.jobs.length<100) {
      if(jobs.length!==value.total_count) throw Error('Incomplete CI job listing');
      return jobs;
    }
  }
}

async function main() {
  // Fail before any API request when a dependency was skipped, cancelled or red.
  if(process.env.ROUTE_RESULT!=='success'||process.env.CI_RESULT!=='success') throw Error('Router or selected CI did not succeed');
  const matrix=JSON.parse(process.env.CI_MATRIX);
  const jobs=await readAttemptJobs({repository:process.env.GITHUB_REPOSITORY,runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,token:process.env.GITHUB_TOKEN});
  const receipts=verifySelectedJobs({routeResult:process.env.ROUTE_RESULT,ciResult:process.env.CI_RESULT,matrix,jobs});
  console.log(JSON.stringify(receipts));
  const lines=['| Platform | Actual job | runner_name | Result |','| --- | --- | --- | --- |'];
  for(const platform of ['windows','image']) {
    const receipt=receipts.find(item=>item.platform===platform);
    lines.push(receipt?`| ${platform} | ${receipt.job} | ${receipt.runner} | success |`:`| ${platform} | not selected | not run | not a pass |`);
  }
  if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) await main();
