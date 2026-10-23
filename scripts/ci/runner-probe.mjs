import {appendFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export function probeMatrix(target) {
  if(target==='psec-strict') return {include:[{name:'Strict real Windows PSEC acceptance',runner:['windows-2025'],psecStrict:true}]};
  if(target==='psec-strict-arm64') return {include:[{name:'Strict native ARM64 Windows PSEC acceptance',runner:['windows-11-vs2026-arm'],psecStrict:true,psecArchitecture:'arm64'}]};
  if(target==='windows-github') return {include:[{name:'Probe Windows GitHub',runner:['windows-latest']}]};
  // Old manual inputs and push-ref targets must fail, not queue on ECS or
  // silently claim that a hosted run tested a particular private machine.
  throw Error('Unknown probe target; never infer readiness from a runner name');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const target=process.env.GITHUB_EVENT_NAME==='workflow_dispatch'?process.env.PROBE_TARGET:
    /^refs\/heads\/codex\/ci-probe\/([^/]+)\/[^/]+$/.exec(process.env.GITHUB_REF??'')?.[1];
  if(['psec-strict','psec-strict-arm64'].includes(target)&&process.env.GITHUB_EVENT_NAME!=='workflow_dispatch')throw Error('Strict PSEC acceptance requires explicit workflow_dispatch');
  await appendFile(process.env.GITHUB_OUTPUT,`matrix=${JSON.stringify(probeMatrix(target))}\n`);
}
