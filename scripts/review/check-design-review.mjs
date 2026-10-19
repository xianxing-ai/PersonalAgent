import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {policy} from './design-manifest.mjs';

export function receiptFrom(body) {
  if(typeof body!=='string'||body.length>65536) return null;
  const marker=`<!-- ${policy.receiptMarker} -->`;
  const start=body.indexOf(marker);
  if(start<0) return null;
  const match=/^\s*```json\s*\n([\s\S]*?)\n```/.exec(body.slice(start+marker.length));
  if(!match) return null;
  try{return JSON.parse(match[1]);}catch{return null;}
}
export function evaluateReviews({headSha,author,reviews}) {
  const approved=[];
  const blocked=[];
  for(const login of policy.eligibleReviewers) {
    if(login.toLowerCase()===author.toLowerCase()) continue;
    const mine=reviews.filter(review=>review.user?.login?.toLowerCase()===login.toLowerCase()).sort((a,b)=>a.id-b.id);
    const governing=mine.filter(review=>['APPROVED','CHANGES_REQUESTED','DISMISSED'].includes(review.state)).at(-1);
    if(governing?.state==='CHANGES_REQUESTED') blocked.push(login);
    // One independent approval persists through later CI-fix commits. Explicit
    // dismissal or a later changes request still revokes/blocks that approval.
    if(governing?.state==='APPROVED'&&/^[a-f0-9]{40}$/.test(governing.commit_id??'')) approved.push(login);
  }
  return {passed:approved.length>=1&&blocked.length===0,approved,blocked};
}
async function run() {
  const token=process.env.GITHUB_TOKEN;
  const repository=process.env.GITHUB_REPOSITORY;
  const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
  const number=event.pull_request?.number;
  if(!token||!/^[-\w]+\/[-\w.]+$/.test(repository??'')||!Number.isSafeInteger(number)) throw Error('Missing trusted GitHub PR context');
  async function api(route) {
    const response=await fetch(`https://api.github.com/repos/${repository}/${route}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
    if(!response.ok) throw Error(`GitHub read failed (${response.status}); no approval accepted`);
    return response.json();
  }
  const pr=await api(`pulls/${number}`);
  const headSha=pr.head.sha;
  const reviews=[];
  for(let page=1;;page++) {
    const batch=await api(`pulls/${number}/reviews?per_page=100&page=${page}`);
    reviews.push(...batch);
    if(batch.length<100)break;
  }
  const result=evaluateReviews({headSha,author:pr.user.login,reviews});
  console.log(JSON.stringify({headSha,...result}));
  if(!result.passed) throw Error('Awaiting one eligible non-author approval and resolution of blocking reviews. Never bypass this check.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) await run();
