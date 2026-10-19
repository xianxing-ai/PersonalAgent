import {appendFile,readFile} from 'node:fs/promises';
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

// GitHub's jobs endpoint can briefly lag a successful needs result. Re-read only
// unfinished/missing receipts; terminal failures and identity mismatches stay red.
export async function waitForSelectedJobs({routeResult,ciResult,matrix,headSha,readJobs,runId,attempt,maxReads=6,delayMs=2000,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),log=console.log}) {
  if(routeResult!=='success'||ciResult!=='success') throw Error('Router and selected CI must both succeed');
  if(!/^[a-f0-9]{40}$/.test(headSha??'')||!Number.isSafeInteger(maxReads)||maxReads<1||maxReads>10) throw Error('Invalid receipt polling context');
  // Validate the matrix independently of API visibility.
  verifySelectedJobs({routeResult,ciResult,matrix,jobs:matrix?.include?.map(selected=>({name:selected.name,status:'completed',conclusion:'success',runner_name:'matrix-validation',labels:selected.runner}))??[]});
  for(let read=1;read<=maxReads;read++) {
    const jobs=await readJobs();
    let pending=false;
    for(const selected of matrix.include) {
      const matches=jobs.filter(job=>job.name===selected.name);
      if(matches.length>1) throw Error(`Ambiguous actual job: ${selected.name}`);
      const job=matches[0];
      log(JSON.stringify({runId:String(runId),attempt:String(attempt),read,jobId:job?.id??null,status:job?.status??'missing',conclusion:job?.conclusion??null}));
      if(!job) {pending=true;continue;}
      if(String(job.run_id)!==String(runId)||String(job.run_attempt)!==String(attempt)||job.head_sha!==headSha) throw Error('Selected job context mismatch');
      if(job.conclusion!=null&&job.conclusion!=='success') throw Error(`Selected job did not pass: ${selected.name}`);
      if(job.status==='completed') {
        if(job.conclusion!=='success') throw Error(`Selected job did not pass: ${selected.name}`);
      } else if(['queued','in_progress','waiting','pending','requested'].includes(job.status)&&job.conclusion==null) pending=true;
      else throw Error(`Invalid selected job state: ${selected.name}`);
    }
    if(!pending) return verifySelectedJobs({routeResult,ciResult,matrix,jobs});
    if(read<maxReads) await sleep(delayMs);
  }
  throw Error('Selected job receipts did not settle within the bounded read budget');
}

export function expectedJobHead(event,checkoutSha) {
  // For pull_request runs GITHUB_SHA is the synthetic merge commit, while the
  // jobs API head_sha identifies the PR head recorded in the trusted event.
  return event?.pull_request?.head?.sha??checkoutSha;
}

async function main() {
  // Fail before any API request when a dependency was skipped, cancelled or red.
  if(process.env.ROUTE_RESULT!=='success'||process.env.CI_RESULT!=='success') throw Error('Router or selected CI did not succeed');
  const matrix=JSON.parse(process.env.CI_MATRIX);
  const context={repository:process.env.GITHUB_REPOSITORY,runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,token:process.env.GITHUB_TOKEN};
  const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
  const headSha=expectedJobHead(event,process.env.GITHUB_SHA);
  const receipts=await waitForSelectedJobs({routeResult:process.env.ROUTE_RESULT,ciResult:process.env.CI_RESULT,matrix,headSha,...context,readJobs:()=>readAttemptJobs(context)});
  console.log(JSON.stringify(receipts));
  const lines=['| Platform | Actual job | runner_name | Result |','| --- | --- | --- | --- |'];
  for(const platform of ['windows','image']) {
    const receipt=receipts.find(item=>item.platform===platform);
    lines.push(receipt?`| ${platform} | ${receipt.job} | ${receipt.runner} | success |`:`| ${platform} | not selected | not run | not a pass |`);
  }
  if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) await main();
