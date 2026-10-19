import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {evaluateReviews} from './check-design-review.mjs';

const execute=promisify(execFile);
const requiredChecks=['check','ecs-linux-check'];
const actionsAppId=15368;

export function evaluateMerge({pr,mainSha,reviews,checks,statuses,repository}) {
  if(pr.state!=='open'||pr.draft||pr.merged||pr.base?.ref!=='main'||
    pr.base.repo.full_name!==repository||pr.head?.repo?.full_name!==repository) return 'ineligible PR';
  if(!/^[a-f0-9]{40}$/.test(pr.head.sha)||pr.base.sha!==mainSha||
    pr.mergeable!==true||pr.mergeable_state!=='clean') return 'branch protection or main update pending';
  if(!evaluateReviews({headSha:pr.head.sha,author:pr.user.login,reviews}).passed) return 'eligible non-author current-head approval required';
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

export async function mergeApproved({repository=process.env.GITHUB_REPOSITORY,token=process.env.GITHUB_TOKEN,fetchImpl=fetch,executeImpl=execute,log=console.log}={}) {
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
  async function postDispatch(sha) {
    // Foundation now produces both required contexts in one routed run.
    const eventType='post_merge_foundation_ci';
    const response=await fetchImpl('https://api.github.com/repos/'+repository+'/dispatches',{
      method:'POST',
      headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},
      body:JSON.stringify({event_type:eventType,client_payload:{target_sha:sha}}),
      redirect:'error',signal:AbortSignal.timeout(30000)
    });
    if(response.status!==204) throw Error('GitHub dispatch failed ('+response.status+')');
  }
  async function reconcileMain() {
    const sha=await mainSha();
    const checks=await pages('commits/'+sha+'/check-runs?filter=latest','check_runs');
    const latest=new Map();
    for(const check of checks) {
      if(check.head_sha!==sha||check.app?.id!==actionsAppId||!requiredChecks.includes(check.name)) continue;
      if(!latest.has(check.name)||latest.get(check.name).id<check.id) latest.set(check.name,check);
    }
    const missing=[],pending=[],failed=[];
    for(const name of requiredChecks) {
      const check=latest.get(name);
      if(!check||(check.status==='completed'&&['skipped','cancelled','neutral'].includes(check.conclusion))) missing.push(name);
      else if(check.status!=='completed') pending.push(name);
      else if(check.conclusion!=='success') failed.push(name);
    }
    if(failed.length) return {state:'failed',sha};
    if(missing.length) {
      if(await mainSha()!==sha) return {state:'changed',sha};
      await postDispatch(sha);
      return {state:'dispatched',sha};
    }
    if(pending.length) return {state:'pending',sha};
    if(await mainSha()!==sha) return {state:'changed',sha};
    return {state:'ready',sha};
  }

  const baseline=await reconcileMain();
  if(baseline.state!=='ready') {
    log('Main checks not ready ('+baseline.state+')');
    return;
  }
  const prs=await pages('pulls?state=open&base=main');
  for(const candidate of prs) {
    if(candidate.draft||candidate.auto_merge||candidate.head?.repo?.full_name!==repository) continue;
    let pr,reason;
    try {
      pr=await api('pulls/'+candidate.number);
      const [reviews,checks,statuses]=await Promise.all([
        pages('pulls/'+pr.number+'/reviews'),
        pages('commits/'+pr.head.sha+'/check-runs?filter=latest','check_runs'),
        pages('commits/'+pr.head.sha+'/statuses')
      ]);
      reason=evaluateMerge({pr,mainSha:baseline.sha,reviews,checks,statuses,repository});
    } catch(error) {
      log('#'+candidate.number+': not reviewed (GitHub evidence unavailable)');
      continue;
    }
    if(reason) {log('#'+pr.number+': '+reason);continue;}
    if(pr.auto_merge) {log('#'+pr.number+': another auto-merge is already queued');continue;}
    const current=await reconcileMain();
    if(current.state!=='ready'||current.sha!==baseline.sha) {
      log('Main checks or SHA changed before merge request');
      return;
    }
    // The short-lived Actions token has no owner bypass. GitHub rechecks all
    // protected-branch rules and atomically matches this exact reviewed head.
    try {
      await executeImpl('gh',['pr','merge',String(pr.number),'--repo',repository,'--squash','--match-head-commit',pr.head.sha],{
        env:{...process.env,GH_TOKEN:token},timeout:60000,windowsHide:true,maxBuffer:1048576
      });
    } catch(error) {
      // The CLI may have submitted a request before failing. Never retry it here.
      log('#'+pr.number+': merge request outcome unconfirmed');
      return;
    }
    const final=await api('pulls/'+pr.number);
    if(final.merged===true&&/^[a-f0-9]{40}$/.test(final.merge_commit_sha??'')) {
      log('#'+pr.number+': merged at '+final.merge_commit_sha);
      const post=await reconcileMain();
      log('Postmerge main checks: '+post.state);
    } else {
      log('#'+pr.number+': immediate merge command returned; final state unconfirmed');
    }
    return;
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  await mergeApproved();
}
