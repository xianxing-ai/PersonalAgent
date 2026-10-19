import {readFile,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../../',import.meta.url));
const config=JSON.parse(await readFile(new URL('./partition.json',import.meta.url),'utf8'));
export function validatePartition(partition,{workspaces,integrationFiles}) {
  if(partition.version!==1) throw Error('Unknown CI partition version');
  for(const [groups,expected] of [[['linux','windows'],workspaces],[['integration-linux','integration-windows'],integrationFiles]]) {
    const assigned=[];
    for(const group of groups) {
      if(!Array.isArray(partition[group])||!partition[group].length) throw Error(`Missing CI group ${group}`);
      assigned.push(...partition[group]);
    }
    if(assigned.some(item=>typeof item!=='string')||new Set(assigned).size!==assigned.length) throw Error('Duplicate CI assignment');
    if(assigned.length!==expected.length||expected.some(item=>!assigned.includes(item))) throw Error('CI partition must cover every existing test exactly once');
  }
  return partition;
}
export async function catalog() {
  const manifest=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  const workspaces=[];
  for(const pattern of manifest.workspaces) {
    if(!/^(?:packages|packages\/connectors|apps)\/\*$/.test(pattern)) throw Error('Review CI partition discovery for new workspace patterns');
    const parent=path.join(root,pattern.slice(0,-2));
    for(const entry of await readdir(parent,{withFileTypes:true})) {
      if(!entry.isDirectory()) continue;
      let pkg;
      try {pkg=JSON.parse(await readFile(path.join(parent,entry.name,'package.json'),'utf8'));}
      catch(error) {if(error.code==='ENOENT')continue;throw error;}
      if(typeof pkg.scripts?.test==='string') workspaces.push(pkg.name);
    }
  }
  const integrationFiles=(await readdir(path.join(root,'tests/integration'))).filter(name=>name.endsWith('.test.mjs'));
  return {workspaces,integrationFiles};
}
async function run(group) {
  const partition=validatePartition(config,await catalog());
  if(group==='validate') {
    console.log(`CI partitions cover ${partition.linux.length+partition.windows.length} workspaces and ${partition['integration-linux'].length+partition['integration-windows'].length} integration files exactly once`);
    return;
  }
  if(!['linux','windows','integration-linux','integration-windows'].includes(group)) throw Error('Unknown CI partition');
  let args;
  if(group.startsWith('integration-')) args=['--test',...partition[group].map(name=>path.join(root,'tests/integration',name))];
  else {
    if(!process.env.npm_execpath) throw Error('Run workspace partitions through npm run ci:test');
    args=[process.env.npm_execpath,'run','test',...partition[group].map(name=>`--workspace=${name}`)];
  }
  console.log(`Running ${group}: ${partition[group].join(', ')}`);
  const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',env:process.env,shell:false,windowsHide:true});
  if(result.error||result.signal||result.status!==0) throw Error(`CI partition ${group} failed; no tests waived`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) await run(process.argv[2]);
