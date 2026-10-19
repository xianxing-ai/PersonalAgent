import {appendFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export function probeMatrix(target) {
  const pool=['self-hosted','Windows','X64','personalagent-windows'];
  if(target==='windows-github') return {include:[{name:'Probe Windows GitHub',runner:['windows-latest']}]};
  if(target==='windows-pool') return {include:[{name:'Probe Windows pool',runner:pool}]};
  if(target==='windows-pool-pair') return {include:[1,2].map(slot=>({name:`Probe Windows pool ${slot}`,runner:pool}))};
  if(target==='ecs-17f8') return {include:[{name:'Probe ECS-17F8',runner:[...pool,'ecs-17f8']}]};
  throw Error('Unknown probe target; never infer readiness from a runner name');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const target=process.env.GITHUB_EVENT_NAME==='workflow_dispatch'?process.env.PROBE_TARGET:
    /^refs\/heads\/codex\/ci-probe\/([^/]+)\/[^/]+$/.exec(process.env.GITHUB_REF??'')?.[1];
  await appendFile(process.env.GITHUB_OUTPUT,`matrix=${JSON.stringify(probeMatrix(target))}\n`);
}
