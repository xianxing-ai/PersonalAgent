import {readFile,appendFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const imageRoot='apps/agentarts-runtime/';
const sharedImageRoots=['packages/contracts/','packages/models/','packages/coordination/','packages/agentarts/','scripts/agentarts/','scripts/laya/','.github/workflows/','.github/actions/','scripts/ci/','tests/architecture/','tests/contracts/'];
const sharedImageFiles=new Set(['package.json','package-lock.json','tsconfig.base.json','.node-version','.npmrc']);
function validPath(name) {return typeof name==='string'&&name.length>0&&!name.startsWith('/')&&!name.includes('\\')&&!name.split('/').some(part=>part==='..'||part==='.'||part==='');}
export function classifyPullRequest(files,expectedCount) {
  if(!Array.isArray(files)||!files.length||!Number.isSafeInteger(expectedCount)||files.length!==expectedCount) return {mode:'both',reason:'incomplete or empty changed-file evidence'};
  let image=false,windows=false;
  for(const file of files) {
    if(!file||typeof file!=='object')return {mode:'both',reason:'unrecognized changed-file evidence'};
    const names=[file.filename,...(file.previous_filename?[file.previous_filename]:[])];
    if(names.some(name=>!validPath(name))) return {mode:'both',reason:'unrecognized changed path'};
    for(const name of names) {
      if(name.startsWith(imageRoot)) image=true;
      else {
        windows=true;
        if(sharedImageRoots.some(prefix=>name.startsWith(prefix))||sharedImageFiles.has(name)) image=true;
      }
    }
  }
  return {mode:image?(windows?'both':'image'):'windows',reason:image?(windows?'image and shared/Windows changes':'only the Linux image application changed'):'Windows or other repository changes'};
}
export function matrixFor(mode,{fork=false,imageRunner='ecs'}={}) {
  if(!['windows','image','both'].includes(mode)||!['ecs','github'].includes(imageRunner)) throw Error('Invalid CI routing configuration');
  const include=[];
  if(mode!=='image')include.push({kind:'windows',name:'Windows CI',runner:['windows-latest']});
  if(mode!=='windows')include.push({kind:'image',name:'Linux image CI',runner:fork||imageRunner==='github'?['ubuntu-24.04']:['self-hosted','Linux','X64','personalagent-ecs']});
  return {include};
}
async function route() {
  const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
  const repository=process.env.GITHUB_REPOSITORY,token=process.env.GITHUB_TOKEN;
  if(!/^[-\w]+\/[-\w.]+$/.test(repository??'')||!token) throw Error('Missing trusted GitHub context');
  let selection={mode:'both',reason:'main push or manual validation'},fork=false;
  if(event.pull_request) {
    const number=event.pull_request.number;
    if(!Number.isSafeInteger(number))throw Error('Invalid PR number');
    async function api(route) {
      const response=await fetch(`https://api.github.com/repos/${repository}/${route}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw Error(`Changed-file read failed (${response.status})`);
      return response.json();
    }
    const pr=await api(`pulls/${number}`);
    if(pr.head.sha!==event.pull_request.head.sha)throw Error('PR head moved; use the new run');
    fork=pr.head.repo?.full_name!==repository;
    const files=[];
    for(let page=1;page<=30;page++) {
      const batch=await api(`pulls/${number}/files?per_page=100&page=${page}`);
      if(!Array.isArray(batch))throw Error('Invalid changed-file response');
      files.push(...batch);if(batch.length<100)break;
    }
    selection=classifyPullRequest(files,pr.changed_files);
    if((await api(`pulls/${number}`)).head.sha!==pr.head.sha)throw Error('PR head moved during file listing; use the new run');
  }
  const matrix=matrixFor(selection.mode,{fork,imageRunner:process.env.PA_IMAGE_RUNNER||'ecs'});
  await appendFile(process.env.GITHUB_OUTPUT,`matrix=${JSON.stringify(matrix)}\nmode=${selection.mode}\n`);
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`CI route: **${selection.mode}** — ${selection.reason}.\n\nSelected jobs: ${matrix.include.map(job=>`${job.name} (${job.runner.join(', ')})`).join('; ')}\n`);
  console.log(JSON.stringify({selection,matrix}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await route();
