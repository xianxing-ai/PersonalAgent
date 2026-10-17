import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cache=new Map();
function load(relative) {
  let file=path.resolve(root,relative);
  if(!fs.existsSync(file))file=path.join(file.replace(/\.ts$/,''),'index.ts');
  if(file.endsWith('.json'))return JSON.parse(fs.readFileSync(file,'utf8'));
  if(cache.has(file))return cache.get(file);
  const exports={};cache.set(file,exports);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  new Function('require','exports','module',code)(id=>load(path.resolve(path.dirname(file),id)+(path.extname(id)?'':'.ts')),exports,{exports});
  return exports;
}
const features=JSON.parse(fs.readFileSync(path.join(root,'src/data/architecture.json'),'utf8'));
assert.equal(features.length,28);assert.equal(new Set(features.map(f=>f.id)).size,28);
let detailNodes=0;
for(const feature of features) {
  const nodes=new Set(feature.nodes.map(n=>n.id));assert.equal(nodes.size,feature.nodes.length);detailNodes+=nodes.size;
  assert.equal(new Set(feature.edges.map(e=>e.id)).size,feature.edges.length,feature.id+' duplicate edge ID');
  for(const edge of feature.edges)assert(nodes.has(edge.source)&&nodes.has(edge.target),feature.id+' dangling edge');
  for(const node of feature.nodes)for(const dependency of node.dependencies)assert(nodes.has(dependency),feature.id+' dangling dependency');
  for(const node of feature.nodes)for(const dependency of node.dependencies)assert(feature.edges.some(e=>e.source===dependency&&e.target===node.id),feature.id+' dependency without graph edge');
}
const {ARCHITECTURE_AREAS,ARCHITECTURE_MECHANISMS}=load('src/data/currentMechanisms.ts');
assert.equal(ARCHITECTURE_AREAS.length,6);
assert.deepEqual(ARCHITECTURE_AREAS.flatMap(a=>a.features).sort(),features.map(f=>f.id).sort(),'Six areas must cover each feature once');
const {OVERVIEW_LINKS,SHARED_NODES}=load('src/data/overview.ts');
const ids=new Set([...features.map(f=>f.id),...SHARED_NODES.map(n=>n.id)]),adj=new Map([...ids].map(id=>[id,[]]));
for(const [source,target] of OVERVIEW_LINKS){assert(ids.has(source)&&ids.has(target));adj.get(source).push(target);adj.get(target).push(source);}
for(const mechanism of ARCHITECTURE_MECHANISMS)for(const id of [...mechanism.features,...mechanism.shared])assert(ids.has(id),mechanism.id+' invalid focus node');
const reached=new Set(['USER']),queue=['USER'];
for(let i=0;i<queue.length;i++)for(const target of adj.get(queue[i]))if(!reached.has(target)){reached.add(target);queue.push(target);}
assert.equal(reached.size,ids.size,'Overview must be one connected graph');
const f28=features.find(f=>f.id==='F28');
assert.deepEqual(f28.nodes.find(n=>n.id==='F28_N06').dependencies,f28.nodes.find(n=>n.id==='F28_N07').dependencies);
assert(f28.nodes.find(n=>n.id==='F28_N08').dependencies.includes('F28_N06'));
const stop=features.find(f=>f.id==='F02').nodes.find(n=>n.id==='F02_N09');
assert.equal(stop.kind,'deterministic_check');assert.deepEqual(stop.dependencies,[]);assert(!stop.modelAssignment);
const send=features.find(f=>f.id==='F08');
assert(send.edges.some(e=>e.source==='F08_N10'&&e.target==='F08_N07'),'Email needs direct authorized path');
assert.equal(send.nodes.find(n=>n.id==='F08_N06').required,false,'Voice question is conditional');
assert.equal(send.nodes.find(n=>n.id==='F08_N07').joinMode,'selected','Direct path must not wait for unused approval branch');
assert(OVERVIEW_LINKS.some(([s,t])=>s==='MODELS'&&t==='POLICY'),'Executors need existing Policy tool path');
const html=fs.readFileSync(path.join(root,'dist/architecture.html'),'utf8');
const current=JSON.parse(fs.readFileSync(path.join(root,'src/data/currentDesign.generated.json'),'utf8'));
assert.equal(current.workflows.length,28);assert.equal(current.workPackages.length,10);assert.equal(current.modules.length,39);
assert.equal(detailNodes,185);assert(html.includes('本机Laya'));assert(html.includes('未最终定型'));
const release=features.find(f=>f.id==='F23');
assert(!JSON.stringify(release.nodes).includes('trainSet'),'Release detail must not retain obsolete training contract');
assert(release.nodes.find(n=>n.id==='F23_N04').outputFields.includes('operationId'),'CAS release keeps original operation');
const replay=features.find(f=>f.id==='F22');
assert(replay.nodes.find(n=>n.id==='F22_N06').condition.includes('完整与缺失记录均核对'),'Successful replay must also reach comparison join');
assert(replay.edges.some(e=>e.source==='F22_N04'&&e.target==='F22_N06')&&replay.edges.some(e=>e.source==='F22_N06'&&e.target==='F22_N07'));
assert(!/<script\b[^>]*\bsrc=/.test(html));assert(!/<link\b[^>]*rel="stylesheet"/.test(html));
console.log(JSON.stringify({features:features.length,detailNodes,logicalAreas:ARCHITECTURE_AREAS.length,mechanisms:ARCHITECTURE_MECHANISMS.length,connectedOverviewNodes:reached.size,relations:OVERVIEW_LINKS.length,localStopIndependent:true,parallelDependencies:true,conditionalVoice:true,offlineFileBytes:Buffer.byteLength(html),externalAssetTags:0}));
