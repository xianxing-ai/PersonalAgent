import {readFile,appendFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const imageRoot='apps/agentarts-runtime/';
const sharedImageRoots=['packages/contracts/','packages/models/','packages/coordination/','packages/agentarts/','packages/client/','apps/runtime/','scripts/agentarts/','scripts/laya/','.github/workflows/','.github/actions/','scripts/ci/','tests/architecture/','tests/contracts/'];
const sharedImageFiles=new Set(['package.json','package-lock.json','tsconfig.base.json','.node-version','.npmrc','tests/integration/owned-agentarts-image.test.mjs']);
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
export function selectWindowsRunner({fork=false,number,windowsRunner='auto',windowsOverrides='{}'}={}) {
  if(!['auto','ecs','github'].includes(windowsRunner)) throw Error('Invalid Windows runner switch');
  const overrides=JSON.parse(windowsOverrides);
  if(!overrides||Array.isArray(overrides)||typeof overrides!=='object'||
    Object.entries(overrides).some(([key,value])=>!(/^[1-9]\d*$/.test(key))||!['ecs','github'].includes(value))) {
    throw Error('Invalid per-PR Windows runner overrides');
  }
  if(number!==undefined&&(!Number.isSafeInteger(number)||number<1)) throw Error('Invalid PR number');
  // Forks never enter a persistent runner, even with an explicit override.
  if(fork) return {pool:'github',reason:'fork uses an isolated GitHub-hosted runner'};
  if(number!==undefined&&Object.hasOwn(overrides,String(number))) return {pool:overrides[number],reason:`explicit override for PR #${number}`};
  if(windowsRunner!=='auto') return {pool:windowsRunner,reason:'explicit repository Windows runner switch'};
  if(number===undefined) return {pool:'github',reason:'main/manual validation uses GitHub Windows'};
  return {pool:number%2?'ecs':'github',reason:`PR #${number} is ${number%2?'odd: shared ECS pool':'even: GitHub Windows'}`};
}
export function matrixFor(mode,{fork=false,imageRunner='ecs',...windowsOptions}={}) {
  if(!['windows','image','both'].includes(mode)||!['ecs','github'].includes(imageRunner)) throw Error('Invalid CI routing configuration');
  const windows=selectWindowsRunner({fork,...windowsOptions});
  const include=[];
  if(mode!=='image')include.push({kind:'windows',name:`Windows CI (${windows.pool==='ecs'?'ECS':'GitHub'})`,runner:windows.pool==='ecs'?['self-hosted','Windows','X64','personalagent-windows']:['windows-latest']});
  if(mode!=='windows')include.push({kind:'image',name:'Linux image CI',runner:fork||imageRunner==='github'?['ubuntu-24.04']:['self-hosted','Linux','X64','personalagent-ecs']});
  return {include};
}
export async function resolveRoute({event,eventName,ref,sha,repository,token,imageRunner='ecs',windowsRunner='auto',windowsOverrides='{}',fetchImpl=fetch}) {
  if(!/^[-\w]+\/[-\w.]+$/.test(repository??'')||!token) throw Error('Missing trusted GitHub context');
  if(eventName==='repository_dispatch'&&(ref!=='refs/heads/main'||event.client_payload?.target_sha!==sha)) throw Error('Stale or non-main CI dispatch');
  let selection={mode:'both',reason:'main push or manual validation'},fork=false,number;
  if(event.pull_request) {
    number=event.pull_request.number;
    if(!Number.isSafeInteger(number)||number<1)throw Error('Invalid PR number');
    async function api(route) {
      const response=await fetchImpl(`https://api.github.com/repos/${repository}/${route}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(30000)});
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
  const windows=selectWindowsRunner({fork,number,windowsRunner,windowsOverrides});
  const matrix=matrixFor(selection.mode,{fork,number,imageRunner,windowsRunner,windowsOverrides});
  return {selection,windows,matrix};
}
async function route() {
  const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
  const {selection,windows,matrix}=await resolveRoute({event,eventName:process.env.GITHUB_EVENT_NAME,ref:process.env.GITHUB_REF,sha:process.env.GITHUB_SHA,
    repository:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN,imageRunner:process.env.PA_IMAGE_RUNNER||'ecs',
    windowsRunner:process.env.PA_WINDOWS_RUNNER||'auto',windowsOverrides:process.env.PA_WINDOWS_RUNNER_OVERRIDES||'{}'});
  await appendFile(process.env.GITHUB_OUTPUT,`matrix=${JSON.stringify(matrix)}\nmode=${selection.mode}\n`);
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`CI route: **${selection.mode}** — ${selection.reason}.\n\nWindows policy: ${windows.reason}.\n\nSelected jobs: ${matrix.include.map(job=>`${job.name} (${job.runner.join(', ')})`).join('; ')}\n\nUnselected platforms are not tested, not counted as successful. ECS jobs queue for a matching idle runner; they do not automatically move to GitHub-hosted runners.\n`);
  console.log(JSON.stringify({selection,windows,matrix}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await route();
