import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {evaluateReviews} from './check-design-review.mjs';

const execute=promisify(execFile);
const requiredChecks=['check','ecs-linux-check'];
const actionsAppId=15368;

export function evaluateMerge({pr,mainSha,reviews,checks,statuses,repository,mergeQueueEnabled=false}) {
  if(pr.state!=='open'||pr.draft||pr.merged||pr.base?.ref!=='main'||
    pr.base.repo.full_name!==repository||pr.head?.repo?.full_name!==repository) return 'ineligible PR';
  // Queue admission checks the latest concrete CI below. GitHub's aggregate
  // "unstable" state is not itself a conflict; the protected queue still
  // enforces repository requirements and validates the combined commit.
  if(!/^[a-f0-9]{40}$/.test(pr.head.sha)||
    (!mergeQueueEnabled&&pr.base.sha!==mainSha)||pr.mergeable!==true||
    !(mergeQueueEnabled?['clean','behind','unstable']:['clean']).includes(pr.mergeable_state)) return 'branch protection or main update pending';
  if(!evaluateReviews({headSha:pr.head.sha,author:pr.user.login,reviews}).passed) return 'one eligible non-author approval required';
  const latest=new Map();
  for(const check of checks) {
    if(check.head_sha!==pr.head.sha) continue;
    const key=`${check.app?.id}:${check.name}`;
    if(!latest.has(key)||latest.get(key).id<check.id) latest.set(key,check);
  }
  for(const name of requiredChecks) {
    const check=latest.get(`${actionsAppId}:${name}`);
    if(check?.status!=='completed'||check.conclusion!=='success') return `${name} has not passed`;
  }
  if([...latest.values()].some(check=>check.status!=='completed'||check.conclusion!=='success')) return 'another check has not passed';
  const latestStatuses=new Map();
  for(const status of statuses) {
    if(!latestStatuses.has(status.context)||latestStatuses.get(status.context).id<status.id) latestStatuses.set(status.context,status);
  }
  if([...latestStatuses.values()].some(status=>status.state!=='success')) return 'another status has not passed';
  return null;
}

// These PullRequest fields reflect the effective base-branch queue, including
// rulesets. An unavailable/partial GraphQL response is never treated as "off".
export async function readMergeQueueState({repository,number,headSha,token,fetchImpl=fetch}) {
  if(!/^[-\w]+\/[-\w.]+$/.test(repository??'')||!Number.isSafeInteger(number)||number<1||
    !/^[a-f0-9]{40}$/.test(headSha??'')||!token) throw Error('Missing trusted queue context');
  const [owner,name]=repository.split('/');
  const response=await fetchImpl('https://api.github.com/graphql',{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/vnd.github+json'},
    body:JSON.stringify({query:'query QueueState($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){number headRefOid baseRefName isMergeQueueEnabled isInMergeQueue autoMergeRequest{enabledAt}}}}',variables:{owner,name,number}}),
    redirect:'error',signal:AbortSignal.timeout(30000)
  });
  if(!response.ok) throw Error('GitHub queue read failed ('+response.status+')');
  const value=await response.json();
  const pr=value?.data?.repository?.pullRequest;
  if(value?.errors?.length||!pr||pr.number!==number||pr.headRefOid!==headSha||pr.baseRefName!=='main'||
    typeof pr.isMergeQueueEnabled!=='boolean'||typeof pr.isInMergeQueue!=='boolean'||
    !Object.hasOwn(pr,'autoMergeRequest')||
    (pr.autoMergeRequest!==null&&(typeof pr.autoMergeRequest!=='object'||typeof pr.autoMergeRequest.enabledAt!=='string'))) {
    throw Error('Incomplete or stale merge queue evidence');
  }
  return {enabled:pr.isMergeQueueEnabled,queued:pr.isInMergeQueue,autoMerge:pr.autoMergeRequest!==null};
}

// The CLI deliberately has no queue writer: its repository GITHUB_TOKEN may
// suppress the merge_group workflow. A trusted caller can separately supply an
// authorized external-identity adapter; token strings/actor names are not proof
// of that identity, and no environment switch enables this capability.
export async function mergeApproved({repository=process.env.GITHUB_REPOSITORY,token=process.env.GITHUB_TOKEN,fetchImpl=fetch,executeImpl=execute,queueAdmissionImpl,log=console.log}={}) {
  if(!/^[-\w]+\/[-\w.]+$/.test(repository??'')||!token) throw Error('Missing trusted repository context');
  async function api(route) {
    const response=await fetchImpl('https://api.github.com/repos/'+repository+'/'+route,{
      headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},
      redirect:'error',signal:AbortSignal.timeout(30000)
    });
    if(!response.ok) throw Error('GitHub read failed ('+response.status+')');
    return response.json();
  }
  async function pages(route,key) {
    const all=[];
    for(let page=1;;page++) {
      const value=await api(route+(route.includes('?')?'&':'?')+'per_page=100&page='+page);
      const batch=key?value[key]:value;
      if(!Array.isArray(batch)) throw Error('Incomplete GitHub result');
      all.push(...batch);
      if(batch.length<100) return all;
    }
  }
  async function mainSha() {
    const sha=(await api('branches/main'))?.commit?.sha;
    if(!/^[a-f0-9]{40}$/.test(sha??'')) throw Error('Invalid main SHA');
    return sha;
  }
  const baselineSha=await mainSha();
  const prs=await pages('pulls?state=open&base=main');
  for(const candidate of prs) {
    if(candidate.draft||candidate.auto_merge||candidate.head?.repo?.full_name!==repository) continue;
    let pr,reason,queue;
    try {
      pr=await api('pulls/'+candidate.number);
      queue=await readMergeQueueState({repository,number:pr.number,headSha:pr.head.sha,token,fetchImpl});
      if(queue.queued||queue.autoMerge) {log('#'+pr.number+': already queued or auto-merge enabled');continue;}
      const [reviews,checks,statuses]=await Promise.all([
        pages('pulls/'+pr.number+'/reviews'),
        pages('commits/'+pr.head.sha+'/check-runs?filter=latest','check_runs'),
        pages('commits/'+pr.head.sha+'/statuses')
      ]);
      reason=evaluateMerge({pr,mainSha:baselineSha,reviews,checks,statuses,repository,mergeQueueEnabled:queue.enabled});
    } catch(error) {
      log('#'+candidate.number+': not reviewed (GitHub evidence unavailable)');
      continue;
    }
    if(reason) {log('#'+pr.number+': '+reason);continue;}
    if(pr.auto_merge) {log('#'+pr.number+': another auto-merge is already queued');continue;}
    if(queue.enabled&&typeof queueAdmissionImpl!=='function') {
      log('#'+pr.number+': eligible, but queue admission requires an authorized external-identity adapter; no request sent');
      continue;
    }
    if(!queue.enabled&&await mainSha()!==baselineSha) {
      log('Main SHA changed before merge request');
      return;
    }
    // Recheck queue policy and head immediately before the protected command.
    // Never turn a stale queue decision into an ordinary direct merge.
    let currentQueue;
    try {currentQueue=await readMergeQueueState({repository,number:pr.number,headSha:pr.head.sha,token,fetchImpl});}
    catch {log('#'+pr.number+': queue or head evidence changed/unavailable');return;}
    if(currentQueue.enabled!==queue.enabled||currentQueue.queued||currentQueue.autoMerge) {
      log('#'+pr.number+': queue policy or request state changed');return;
    }
    // The short-lived Actions token has no owner bypass. GitHub rechecks all
    // protected-branch rules and atomically matches this exact reviewed head.
    try {
      if(queue.enabled) {
        // The adapter must use its own verified identity, enforce this exact
        // head and normal queue rules, and respect any user cancellation.
        // Never pass the workflow token or fall back to the CLI on failure.
        await queueAdmissionImpl({repository,number:pr.number,headSha:pr.head.sha});
      } else await executeImpl('gh',['pr','merge',String(pr.number),'--repo',repository,'--squash','--match-head-commit',pr.head.sha],{
        env:{...process.env,GH_TOKEN:token},timeout:60000,windowsHide:true,maxBuffer:1048576
      });
    } catch(error) {
      // The CLI may have submitted a request before failing. Never retry it here.
      log('#'+pr.number+': merge request outcome unconfirmed');
      return;
    }
    let final;
    try {final=await api('pulls/'+pr.number);}
    catch {log('#'+pr.number+': merge request outcome unconfirmed (readback unavailable)');return;}
    if(final.merged===true&&/^[a-f0-9]{40}$/.test(final.merge_commit_sha??'')) {
      log('#'+pr.number+': merged at '+final.merge_commit_sha);
    } else {
      try {
        const finalQueue=await readMergeQueueState({repository,number:pr.number,headSha:pr.head.sha,token,fetchImpl});
        if(finalQueue.queued) log('#'+pr.number+': queued for protected merge; not merged yet');
        else if(finalQueue.autoMerge) log('#'+pr.number+': auto-merge enabled; waiting for requirements, not merged yet');
        else log('#'+pr.number+': merge request returned; final state unconfirmed');
      } catch {log('#'+pr.number+': merge request outcome unconfirmed (queue readback unavailable or head changed)');}
    }
    return;
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  await mergeApproved();
}
