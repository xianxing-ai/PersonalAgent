// Build only the fixed Runtime/coding-tools dependency closure in the existing root order.
import {readFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=JSON.parse(readFileSync('package.json','utf8'));
const packages=new Map();
for(const base of ['packages','packages/connectors','apps'])for(const name of readdirSync(base)){
  try{const item=JSON.parse(readFileSync(`${base}/${name}/package.json`,'utf8'));packages.set(item.name,item);}catch(error){if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')throw error;}
}
const needed=new Set();
function include(name){if(needed.has(name)||!packages.has(name))return;needed.add(name);
  const item=packages.get(name);for(const dependency of Object.keys({...item.dependencies,...item.devDependencies}))include(dependency);}
include('@personal-agent/runtime');include('@personal-agent/coding-tools');
for(const command of root.scripts.build.split(' && ')){
  const name=/^npm run build --workspace=(@personal-agent\/[\w-]+)$/u.exec(command)?.[1];
  assert.ok(name,'Unexpected root build command');
  if(!needed.has(name))continue;
  const result=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['run','build','--workspace='+name],{stdio:'inherit',shell:process.platform==='win32'});
  assert.equal(result.status,0,'Required build failed: '+name);
  needed.delete(name);
}
assert.deepEqual([...needed].filter(name=>packages.get(name).scripts?.build),[],'Required build missing from root order');
