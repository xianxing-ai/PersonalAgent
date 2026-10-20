import {appendFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const DEFAULT_WAIT_MS=10*60*1000;
export const DEFAULT_RETRY_DELAY_MS=5000;
const REQUEST_TIMEOUT_MS=30*1000;
const SHA_PATTERN=/^[0-9a-f]{40}$/i;

function normalizeSha(value) {
  return typeof value==='string'&&SHA_PATTERN.test(value)?value.toLowerCase():undefined;
}

export function selectExpectedHeadSha({eventName,eventPayload,githubSha}) {
  if(eventName==='pull_request'||eventName==='pull_request_target') {
    const headSha=normalizeSha(eventPayload?.pull_request?.head?.sha);
    if(!headSha) throw Error('Missing trusted PR head SHA');
    return headSha;
  }
  const headSha=normalizeSha(githubSha);
  if(!headSha) throw Error('Missing trusted run context');
  return headSha;
}

export async function readExpectedHeadSha({eventName,eventPath,githubSha,readFileImpl=readFile}) {
  let eventPayload;
  if(eventName==='pull_request'||eventName==='pull_request_target') {
    if(typeof eventPath!=='string'||!eventPath) throw Error('Missing trusted run context');
    try {
      eventPayload=JSON.parse(await readFileImpl(eventPath,'utf8'));
    } catch {
      throw Error('Missing trusted run context');
    }
  }
  return selectExpectedHeadSha({eventName,eventPayload,githubSha});
}

function validateSelectionMatrix(matrix) {
  if(!Array.isArray(matrix?.include)||matrix.include.length<1||matrix.include.length>2||
    new Set(matrix.include.map(job=>job.kind)).size!==matrix.include.length||
    new Set(matrix.include.map(job=>job.name)).size!==matrix.include.length) throw Error('Missing or invalid selected CI matrix');
  return matrix.include.map(selected=>{
    if(!['windows','image'].includes(selected.kind)||typeof selected.name!=='string'||!selected.name||
      !Array.isArray(selected.runner)||!selected.runner.length||selected.runner.some(label=>typeof label!=='string'||!label)) throw Error('Invalid selected platform');
    return selected;
  });
}

function validateTrustedRunContext({repository,runId,attempt,token}) {
  if(!/^[-\w]+\/[-\w.]+$/.test(repository??'')||!/^[0-9]+$/.test(String(runId))||!/^[0-9]+$/.test(String(attempt))||!token) throw Error('Missing trusted run context');
}

function assertJobIdentity(job,selected,{expectedRunId,expectedAttempt,expectedHeadSha}={}) {
  if(expectedRunId!==undefined&&String(job.run_id)!==String(expectedRunId)||
    expectedAttempt!==undefined&&String(job.run_attempt)!==String(expectedAttempt)||
    expectedHeadSha!==undefined&&String(job.head_sha)!==String(expectedHeadSha)) throw Error(`Job identity mismatch: ${selected.name}`);
}

function assertRunnerEvidence(job,selected) {
  if(!job.runner_name||!Array.isArray(job.labels)||!selected.runner.every(label=>job.labels.includes(label))) throw Error(`Runner evidence missing or mismatched: ${selected.name}`);
}

function assertPendingRunnerLabels(job,selected) {
  if(job.labels===undefined||job.labels===null||(Array.isArray(job.labels)&&job.labels.length===0)) return;
  if(!Array.isArray(job.labels)||!selected.runner.every(label=>job.labels.includes(label))) throw Error(`Runner evidence missing or mismatched: ${selected.name}`);
}

export function verifySelectedJobs({routeResult,ciResult,matrix,jobs,expectedRunId,expectedAttempt,expectedHeadSha}) {
  if(routeResult!=='success'||ciResult!=='success') throw Error('Router and selected CI must both succeed');
  const selections=validateSelectionMatrix(matrix);
  return selections.map(selected=>{
    const matches=jobs.filter(job=>job.name===selected.name);
    if(matches.length!==1) throw Error(`Missing or ambiguous actual job: ${selected.name}`);
    const job=matches[0];
    assertJobIdentity(job,selected,{expectedRunId,expectedAttempt,expectedHeadSha});
    if(job.status!=='completed'||job.conclusion!=='success') throw Error(`Selected job did not pass: ${selected.name}`);
    assertRunnerEvidence(job,selected);
    return {platform:selected.kind,job:job.name,runner:job.runner_name,result:job.conclusion,url:job.html_url};
  });
}

function inspectSelectedJobs({matrix,jobs,expectedRunId,expectedAttempt,expectedHeadSha}) {
  const selections=validateSelectionMatrix(matrix);
  const pending=[];
  for(const selected of selections) {
    const matches=jobs.filter(job=>job.name===selected.name);
    if(matches.length>1) throw Error(`Missing or ambiguous actual job: ${selected.name}`);
    if(matches.length===0) {
      pending.push({name:selected.name,state:'missing'});
      continue;
    }
    const job=matches[0];
    assertJobIdentity(job,selected,{expectedRunId,expectedAttempt,expectedHeadSha});
    if(job.status==='completed') {
      if(job.conclusion!=='success') throw Error(`Selected job did not pass: ${selected.name}`);
      assertRunnerEvidence(job,selected);
      continue;
    }
    if(!['queued','in_progress','waiting','requested','pending'].includes(job.status)) throw Error(`Selected job did not pass: ${selected.name}`);
    assertPendingRunnerLabels(job,selected);
    pending.push({name:selected.name,state:'nonterminal',status:job.status,conclusion:job.conclusion});
  }
  return pending.length?{kind:'pending',pending}:{kind:'success'};
}

function transientReadError(message) {
  const error=Error(message);
  error.transient=true;
  return error;
}

function isTransientNetworkError(error) {
  return error?.name==='AbortError'||error?.name==='TimeoutError'||error instanceof TypeError||
    ['ECONNRESET','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','ECONNREFUSED'].includes(error?.code);
}

function createRequestSignal(parent,timeoutMs) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),Math.max(1,Math.min(2_147_483_647,Number(timeoutMs)||REQUEST_TIMEOUT_MS)));
  const abort=()=>controller.abort(parent?.reason);
  if(parent?.aborted) abort();
  else parent?.addEventListener('abort',abort,{once:true});
  return {signal:controller.signal,cleanup:()=>{clearTimeout(timeout);parent?.removeEventListener('abort',abort)}};
}

function deadlineReadError() {
  const error=Error('CI job read deadline exceeded');
  error.deadline=true;
  return error;
}

function remainingUntil(deadline,now) {
  const remaining=deadline-Number(now());
  if(!Number.isFinite(remaining)) throw Error('Invalid CI job wait clock');
  if(remaining<=0) throw deadlineReadError();
  return remaining;
}

export async function readAttemptJobs({repository,runId,attempt,token,fetchImpl=fetch,signal,requestTimeoutMs=REQUEST_TIMEOUT_MS,deadline,now=Date.now}) {
  validateTrustedRunContext({repository,runId,attempt,token});
  const jobs=[];
  for(let page=1;;page++) {
    const url=`https://api.github.com/repos/${repository}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100&page=${page}`;
    const requestTimeout=deadline===undefined?requestTimeoutMs:Math.min(requestTimeoutMs,remainingUntil(deadline,now));
    const request=createRequestSignal(signal,requestTimeout);
    let response;
    try {
      response=await fetchImpl(url,{
        headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},
        redirect:'error',signal:request.signal
      });
    } catch(error) {
      request.cleanup();
      if(signal?.aborted) throw signal.reason??error;
      if(!isTransientNetworkError(error)) throw Error('Cannot read actual CI jobs (request failure)');
      throw transientReadError('Cannot read actual CI jobs (network failure)');
    }
    if(!response||typeof response.ok!=='boolean') {
      request.cleanup();
      throw Error('Cannot read actual CI jobs (invalid response)');
    }
    if(!response.ok) {
      request.cleanup();
      const status=Number.isInteger(response.status)?response.status:'unknown';
      const error=Error(`Cannot read actual CI jobs (${status})`);
      if(Number.isInteger(response.status)&&response.status>=500&&response.status<=599) error.transient=true;
      throw error;
    }
    let value;
    try {
      value=await response.json();
    } catch(error) {
      request.cleanup();
      if(signal?.aborted) throw signal.reason??error;
      if(isTransientNetworkError(error)) throw transientReadError('Cannot read actual CI jobs (network failure)');
      throw Error('Incomplete CI job response');
    }
    request.cleanup();
    if(!Array.isArray(value.jobs)||!Number.isSafeInteger(value.total_count)||value.total_count<0) throw Error('Incomplete CI job response');
    jobs.push(...value.jobs);
    if(jobs.length>value.total_count) throw Error('Incomplete CI job listing');
    if(jobs.length===value.total_count) {
      if(deadline!==undefined&&Number(now())>deadline) throw deadlineReadError();
      return jobs;
    }
    if(value.jobs.length<100) {
      if(jobs.length!==value.total_count) throw Error('Incomplete CI job listing');
      if(deadline!==undefined&&Number(now())>deadline) throw deadlineReadError();
      return jobs;
    }
  }
}

function defaultSleep(milliseconds,signal) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted) {
      reject(signal.reason??Error('CI job verification cancelled'));
      return;
    }
    const timer=setTimeout(done,milliseconds);
    const abort=()=>{
      clearTimeout(timer);
      signal?.removeEventListener('abort',abort);
      reject(signal.reason??Error('CI job verification cancelled'));
    };
    function done() {
      signal?.removeEventListener('abort',abort);
      resolve();
    }
    signal?.addEventListener('abort',abort,{once:true});
  });
}

function timeoutError(timeoutMs,pending,lastTransient) {
  const detail=pending?.length?pending.map(item=>item.state==='missing'?`${item.name} (missing)`:`${item.name} (status=${item.status}, conclusion=${item.conclusion??'none'})`).join('; '):
    lastTransient?.deadline?'GitHub API read reached the deadline':lastTransient?'GitHub API reads remained transient':'selected jobs remained unreadable';
  return Error(`Timed out waiting for selected CI jobs after ${timeoutMs}ms: ${detail}`);
}

export async function waitForSelectedJobs({routeResult,ciResult,matrix,repository,runId,attempt,token,expectedHeadSha,fetchImpl=fetch,
  sleep=defaultSleep,now=Date.now,timeoutMs=DEFAULT_WAIT_MS,retryDelayMs=DEFAULT_RETRY_DELAY_MS,signal}) {
  if(routeResult!=='success'||ciResult!=='success') throw Error('Router and selected CI must both succeed');
  validateSelectionMatrix(matrix);
  validateTrustedRunContext({repository,runId,attempt,token});
  if(!Number.isFinite(timeoutMs)||timeoutMs<0||!Number.isFinite(retryDelayMs)||retryDelayMs<0) throw Error('Invalid CI job wait settings');
  const currentTime=()=>{
    const value=Number(now());
    if(!Number.isFinite(value)) throw Error('Invalid CI job wait clock');
    return value;
  };
  const start=currentTime();
  const deadline=start+timeoutMs;
  let pending;
  let lastTransient;
  for(;;) {
    if(signal?.aborted) throw signal.reason??Error('CI job verification cancelled');
    let jobs;
    try {
      jobs=await readAttemptJobs({repository,runId,attempt,token,fetchImpl,signal,requestTimeoutMs:REQUEST_TIMEOUT_MS,deadline,now:currentTime});
    } catch(error) {
      if(error?.deadline) throw timeoutError(timeoutMs,pending,error);
      if(!error?.transient) throw error;
      lastTransient=error;
      if(currentTime()>=deadline) throw timeoutError(timeoutMs,pending,lastTransient);
      const remaining=deadline-currentTime();
      await sleep(Math.min(Math.max(1,retryDelayMs),remaining),signal);
      continue;
    }
    if(currentTime()>deadline) throw timeoutError(timeoutMs,pending,deadlineReadError());
    const state=inspectSelectedJobs({matrix,jobs,expectedRunId:runId,expectedAttempt:attempt,expectedHeadSha});
    if(state.kind==='success') return verifySelectedJobs({routeResult,ciResult,matrix,jobs,expectedRunId:runId,expectedAttempt:attempt,expectedHeadSha});
    pending=state.pending;
    if(currentTime()>=deadline) throw timeoutError(timeoutMs,pending,lastTransient);
    const remaining=deadline-currentTime();
    await sleep(Math.min(Math.max(1,retryDelayMs),remaining),signal);
  }
}

async function main() {
  // Fail before any API request when a dependency was skipped, cancelled or red.
  if(process.env.ROUTE_RESULT!=='success'||process.env.CI_RESULT!=='success') throw Error('Router or selected CI did not succeed');
  const matrix=JSON.parse(process.env.CI_MATRIX);
  const expectedHeadSha=await readExpectedHeadSha({eventName:process.env.GITHUB_EVENT_NAME,eventPath:process.env.GITHUB_EVENT_PATH,githubSha:process.env.GITHUB_SHA});
  const receipts=await waitForSelectedJobs({routeResult:process.env.ROUTE_RESULT,ciResult:process.env.CI_RESULT,matrix,
    repository:process.env.GITHUB_REPOSITORY,runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,
    token:process.env.GITHUB_TOKEN,expectedHeadSha});
  console.log(JSON.stringify(receipts));
  const lines=['| Platform | Actual job | runner_name | Result |','| --- | --- | --- | --- |'];
  for(const platform of ['windows','image']) {
    const receipt=receipts.find(item=>item.platform===platform);
    lines.push(receipt?`| ${platform} | ${receipt.job} | ${receipt.runner} | success |`:`| ${platform} | not selected | not run | not a pass |`);
  }
  if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) await main();
