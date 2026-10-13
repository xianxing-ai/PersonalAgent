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
  for(const edge of feature.edges)assert(nodes.has(edge.source)&&nodes.has(edge.target),feature.id+' dangling edge');
  for(const node of feature.nodes)for(const dependency of node.dependencies)assert(nodes.has(dependency),feature.id+' dangling dependency');
}
const {OVERVIEW_LINKS,SHARED_NODES}=load('src/data/overview.ts');
const ids=new Set([...features.map(f=>f.id),...SHARED_NODES.map(n=>n.id)]),adj=new Map([...ids].map(id=>[id,[]]));
for(const [source,target] of OVERVIEW_LINKS){assert(ids.has(source)&&ids.has(target));adj.get(source).push(target);adj.get(target).push(source);}
const reached=new Set(['USER']),queue=['USER'];
for(let i=0;i<queue.length;i++)for(const target of adj.get(queue[i]))if(!reached.has(target)){reached.add(target);queue.push(target);}
assert.equal(reached.size,ids.size,'Overview must be one connected graph');
const f28=features.find(f=>f.id==='F28');
assert.deepEqual(f28.nodes.find(n=>n.id==='F28_N06').dependencies,f28.nodes.find(n=>n.id==='F28_N07').dependencies);
assert(f28.nodes.find(n=>n.id==='F28_N08').dependencies.includes('F28_N06'));
const stop=features.find(f=>f.id==='F02').nodes.find(n=>n.id==='F02_N09');
assert.equal(stop.kind,'deterministic_check');assert.deepEqual(stop.dependencies,[]);assert(!stop.modelAssignment);
const html=fs.readFileSync(path.join(root,'dist/architecture.html'),'utf8');
assert(!/<script\b[^>]*\bsrc=/.test(html));assert(!/<link\b[^>]*rel="stylesheet"/.test(html));
console.log(JSON.stringify({features:features.length,detailNodes,connectedOverviewNodes:reached.size,relations:OVERVIEW_LINKS.length,localStopIndependent:true,parallelDependencies:true,offlineFileBytes:Buffer.byteLength(html),externalAssetTags:0}));
