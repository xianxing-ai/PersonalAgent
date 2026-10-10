import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
async function inventoryExport() {
const [input,output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: inventory <export.jsonl> <inventory.json>');
const bytes=await readFile(input);
if (bytes.length>32*1024*1024) throw Error('Export exceeds inventory limit');
const hash=value=>createHash('sha256').update(value).digest('hex');
const safe=value=>typeof value==='string' && value.length<=256 && !/[\r\n]/.test(value) ? value : undefined;
const records=bytes.toString('utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.trim()).map(line=>JSON.parse(line));
const ids=new Set(records.map(r=>r.resource_id));
const resources=records.map(r=>{
  if (!r || typeof r!=='object' || !safe(r.resource_id) || !safe(r.resource_type)) throw Error('Invalid export resource');
  const nodes=r.dsl?.nodes??[];
  if (!Array.isArray(nodes)) throw Error('Invalid workflow nodes');
  const snippets=[];
  // Only hashes and key paths are reported. Raw prompts, code, credentials and URLs stay in the original private export.
  function walk(value,keyPath='dsl') {
    if (typeof value==='string' && /prompt|code|script|template/i.test(keyPath)) snippets.push({path:keyPath,sha256:hash(value),length:value.length});
    else if (Array.isArray(value)) value.forEach((child,i)=>walk(child,`${keyPath}[${i}]`));
    else if (value && typeof value==='object') for (const [key,child] of Object.entries(value)) {
      if (!/key|token|secret|credential|authorization|password/i.test(key)) walk(child,`${keyPath}.${key}`);
    }
  }
  walk(r.dsl);
  const dependencies=Array.isArray(r.level2_resources)?r.level2_resources.filter(safe):[];
  return {id:r.resource_id,type:r.resource_type,name:safe(r.resource_name),level:r.resource_level,schema:safe(r.schema_version),
    dependencies,missingDependencies:dependencies.filter(id=>!ids.has(id)),
    nodes:nodes.map(n=>({id:safe(n.id),name:safe(n.name),type:safe(n.type),configKeys:Object.keys(n.configs??{}).filter(k=>!/key|token|secret|credential|authorization|password/i.test(k))})),
    snippetHashes:snippets};
});
// No source interpretation or arbitrary DSL/code execution occurs here.
const inventory={sourceSha256:hash(bytes),recordCount:records.length,topLevelCount:resources.filter(r=>r.level===1).length,
  resourceTypes:[...new Set(resources.map(r=>r.type))],resources};
await writeFile(output,JSON.stringify(inventory,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,sourceSha256:inventory.sourceSha256,records:inventory.recordCount,topLevel:inventory.topLevelCount,resourceTypes:inventory.resourceTypes,
  workflows:resources.filter(r=>r.level===1).map(r=>({name:r.name,id:r.id,nodes:r.nodes.map(n=>n.type),missingDependencies:r.missingDependencies}))}));
}
try { await inventoryExport(); }
catch {
  process.stderr.write('Agent inventory failed: check input and output files.\n');
  process.exitCode = 1;
}
