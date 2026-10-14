import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
const design='docs/design/workflow-architecture-20261013';
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const features=JSON.parse(read(design+'/source/src/data/architecture.json'));
const {modules}=JSON.parse(read(design+'/modules.json'));
const policy=JSON.parse(read('scripts/review/design-policy.json'));
const issues=[];
assert.equal(features.length,28);
assert.equal(features.reduce((sum,feature)=>sum+feature.nodes.length,0),185,'final workflow detail node count');
assert.equal(modules.length,39);
assert.equal(new Set(modules.map(m=>m.id)).size,39);
assert.equal(policy.designDirectory,design);
for(const f of policy.requiredFiles)assert.ok(fs.existsSync(path.join(root,design,f)),f);
const featureIds=new Set(features.map(f=>f.id));
for(const m of modules) {
 assert.ok(['zemeng5208','goo122','Potatos498'].includes(m.owner),m.id);
 for(const f of m.workflows)assert.ok(featureIds.has(f),m.id+':'+f);
}
const workflows=read(design+'/WORKFLOWS.md');
for(const f of features) {
 assert.ok(workflows.includes('## '+f.id+' '+f.name),f.id);
 assert.ok(modules.some(m=>m.workflows.includes(f.id)),f.id+' unowned');
 for(const n of f.nodes)assert.ok(workflows.includes('#### '+n.id+' '+n.label),n.id);
}
const requirements=[...read('docs/PRD.md').matchAll(/^\| (PA-\d{3}) \|/gm)].map(m=>m[1]);
assert.equal(requirements.length,31);
assert.equal(new Set(requirements).size,31);
for(let i=1;i<=31;i++)assert.ok(requirements.includes('PA-'+String(i).padStart(3,'0')));
const core=['README.md','docs/README.md','docs/CURRENT_DESIGN_CONTEXT.md','docs/PRD.md','docs/ARCHITECTURE.md','docs/PROJECT_STRUCTURE.md','docs/MODULE_ASSIGNMENTS.md','docs/DEVELOPMENT_PROTOCOL.md','docs/competition/HUAWEI_ICT_AGENTARTS_PROFILE.md'];
for(const file of core) {
 const body=read(file);
 assert.ok(!body.includes('](design/resident-developer-agent-20261008/'),file+' obsolete entry');
 assert.ok(!body.includes('](docs/design/resident-developer-agent-20261008/'),file+' obsolete entry');
}
function missingLinks(file,body) {
 const missing=[];
 const text=body.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm,'');
 for(const match of text.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
  let target=match[1].trim().replace(/^<|>$/g,'').split(/\s+"/)[0];
  if(/^(https?:|mailto:|data:|#|app:|thread:)/i.test(target))continue;
  target=target.split('#')[0];if(!target)continue;
  try{target=decodeURIComponent(target);}catch{}
  if(!fs.existsSync(path.resolve(root,path.dirname(file),target)))missing.push(target);
 }
 return [...new Set(missing)];
}
const working=process.argv.includes('--working-tree');
const changed=execFileSync('git',working?['diff','origin/main','--name-only','--','*.md']:['diff','--name-only','--cached','--','*.md'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean);
const untracked=working?execFileSync('git',['ls-files','--others','--exclude-standard','--','*.md'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean):[];
const files=[...new Set([...changed,...untracked])];
for(const file of files) {
 const now=missingLinks(file,read(file));if(!now.length)continue;
 let previous='';try{previous=execFileSync('git',['show','origin/main:'+file],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']});}catch{}
 const before=new Set(missingLinks(file,previous));
 for(const target of now)if(!before.has(target)||core.includes(file)||file.startsWith(design+'/'))issues.push({file,target});
}
const protectedFiles=execFileSync('git',['diff',...(working?['origin/main']:['--cached']),'--name-only','--','packages/contracts/schema','package.json','package-lock.json','apps/runtime/src','packages/cognition/src','packages/models/src'],{cwd:root,encoding:'utf8'}).trim();
assert.equal(protectedFiles,'','documentation migration changed production contracts/code/dependencies');
assert.equal(issues.length,0,JSON.stringify(issues,null,2));
process.stdout.write(JSON.stringify({changedMarkdown:files.length,features:features.length,nodes:features.reduce((s,f)=>s+f.nodes.length,0),modules:modules.length,requirements:requirements.length,newBrokenLinks:issues.length,productionCodeChanged:false})+'\n');
