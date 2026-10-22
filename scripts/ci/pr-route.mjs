import {readFile,appendFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {validateMergeGroup} from './merge-group-context.mjs';

const imageRoot='apps/agentarts-runtime/';
const sharedImageRoots=['packages/contracts/','packages/models/','packages/coordination/','packages/agentarts/','packages/client/','apps/runtime/','scripts/agentarts/','scripts/laya/','.github/workflows/','.github/actions/','scripts/ci/','tests/architecture/','tests/contracts/'];
const sharedImageFiles=new Set(['package.json','package-lock.json','tsconfig.base.json','.node-version','.npmrc','tests/integration/owned-agentarts-image.test.mjs']);
function defaultPullRequestPool(number) {return number%10<=6?'github':'ecs';}
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
  if(number===undefined) return {pool:'github',reason:'explicit manual validation uses GitHub Windows'};
  const pool=defaultPullRequestPool(number);
  return {pool,reason:`PR #${number} ends in ${number%10}: ${pool==='ecs'?'shared ECS pool':'GitHub-hosted'}`};
}
// Approved one-off integration only; do not broaden this to a branch prefix or global switch.
export function isHostedIntegrationPullRequest({eventName,repository,pr}={}) {
  return eventName==='pull_request'&&repository==='zemeng5208/PersonalAgent'&&
    pr?.head?.repo?.full_name===repository&&pr.head.ref==='codex/pr-harness-big-batch-20261020'&&
    pr?.base?.repo?.full_name===repository&&pr.base.ref==='main';
}
export function matrixFor(mode,{fork=false,imageRunner='auto',...windowsOptions}={}) {
  if(!['windows','image','both'].includes(mode)||!['auto','ecs','github'].includes(imageRunner)) throw Error('Invalid CI routing configuration');
  const windows=selectWindowsRunner({fork,...windowsOptions});
  // Manual Linux validation keeps its existing ECS default. Ordinary PRs use
  // the same digit policy for both platforms unless explicitly overridden.
  const imagePool=fork?'github':imageRunner!=='auto'?imageRunner:
    windowsOptions.number===undefined?'ecs':defaultPullRequestPool(windowsOptions.number);
  const include=[];
  if(mode!=='image')include.push({kind:'windows',name:`Windows CI (${windows.pool==='ecs'?'ECS':'GitHub'})`,runner:windows.pool==='ecs'?['self-hosted','Windows','X64','personalagent-windows']:['windows-latest']});
  if(mode!=='windows')include.push({kind:'image',name:'Linux image CI',runner:imagePool==='github'?['ubuntu-24.04']:['self-hosted','Linux','X64','personalagent-ecs']});
  return {include};
}
export async function resolveRoute({event,eventName,ref,sha,repository,token,imageRunner='auto',windowsRunner='auto',windowsOverrides='{}',fetchImpl=fetch}) {
  if(!/^[-\w]+\/[-\w.]+$/.test(repository??'')||!token) throw Error('Missing trusted GitHub context');
  if(['push','repository_dispatch'].includes(eventName)) throw Error('Automatic post-merge CI is disabled');
  if(!['pull_request','workflow_dispatch','merge_group'].includes(eventName)) throw Error('Unsupported CI event');
  if(eventName==='merge_group') {
    validateMergeGroup({event,repository,ref,sha});
    // Group refs are in this repository even when they include fork code. Never
    // infer trusted provenance from that ref or reuse ordinary PR ECS overrides.
    return {selection:{mode:'both',reason:'merge queue validates the complete synthetic group on both platforms'},
      windows:{pool:'github',reason:'merge queue uses isolated GitHub-hosted runners'},
      matrix:matrixFor('both',{imageRunner:'github',windowsRunner:'github'})};
  }
  if(eventName==='pull_request'&&!event?.pull_request) throw Error('Missing PR event');
  let selection={mode:'both',reason:'explicit manual validation'},fork=false,number,hostedIntegration=false,hostedWindows=false;
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
    const currentPr=await api(`pulls/${number}`);
    if(currentPr.head.sha!==pr.head.sha)throw Error('PR head moved during file listing; use the new run');
    hostedWindows=eventName==='pull_request'&&Array.isArray(currentPr.labels)&&
      currentPr.labels.some(label=>label?.name==='ci:windows-github');
    hostedIntegration=isHostedIntegrationPullRequest({eventName,repository,pr});
  }
  const windows=selectWindowsRunner({fork,number,windowsRunner,windowsOverrides});
  const matrix=matrixFor(selection.mode,{fork,number,imageRunner,windowsRunner,windowsOverrides});
  // Validate the original configuration above before applying the narrowly scoped exception.
  if(hostedIntegration) return {
    selection,
    windows:{pool:'github',reason:'approved one-off integration branch; every selected platform uses GitHub-hosted runners'},
    matrix:matrixFor(selection.mode,{fork,number,imageRunner:'github',windowsRunner:'github',windowsOverrides:'{}'})
  };
  // A hosted-only opt-in takes precedence over valid pool selectors. Validate
  // those selectors above first; a label must never conceal invalid config.
  if(hostedWindows) return {
    selection,
    windows:{pool:'github',reason:'explicit ci:windows-github PR label'},
    matrix:matrixFor(selection.mode,{fork,number,imageRunner,windowsRunner:'github',windowsOverrides:'{}'})
  };
  return {selection,windows,matrix};
}
async function route() {
  const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
  const {selection,windows,matrix}=await resolveRoute({event,eventName:process.env.GITHUB_EVENT_NAME,ref:process.env.GITHUB_REF,sha:process.env.GITHUB_SHA,
    repository:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN,imageRunner:process.env.PA_IMAGE_RUNNER||'auto',
    windowsRunner:process.env.PA_WINDOWS_RUNNER||'auto',windowsOverrides:process.env.PA_WINDOWS_RUNNER_OVERRIDES||'{}'});
  await appendFile(process.env.GITHUB_OUTPUT,`matrix=${JSON.stringify(matrix)}\nmode=${selection.mode}\n`);
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`CI route: **${selection.mode}** — ${selection.reason}.\n\nWindows policy: ${windows.reason}.\n\nSelected jobs: ${matrix.include.map(job=>`${job.name} (${job.runner.join(', ')})`).join('; ')}\n\nUnselected platforms are not tested, not counted as successful. ECS jobs queue for a matching idle runner; they do not automatically move to GitHub-hosted runners.\n`);
  console.log(JSON.stringify({selection,windows,matrix}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await route();
