import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const run=promisify(execFile),script=fileURLToPath(new URL('../scripts/inventory.mjs',import.meta.url));
const marker='synthetic-private-export-body',credential='synthetic-private-credential',url='https://synthetic-private.invalid/endpoint';
const hash=value=>createHash('sha256').update(value).digest('hex');
const valid=()=>({resource_id:'synthetic-workflow',resource_type:'workflow',resource_name:'Synthetic workflow',
  resource_level:1,schema_version:'1.0',level2_resources:['synthetic-missing'],dsl:{prompt:marker,code:marker,
    api_key:credential,endpoint:url,nodes:[{id:'n1',name:'Synthetic node',type:'llm',configs:{prompt:marker,
      code:marker,api_key:credential,password:credential,endpoint:url}}]}});
async function fixture(t){const directory=await mkdtemp(path.join(os.tmpdir(),'owned-inventory-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));return directory;}
const call=async(input,output)=>{try{return {...await run(process.execPath,[script,input,output]),code:0};}
  catch(error){return {stdout:error.stdout,stderr:error.stderr,code:error.code};}};
for(const kind of ['malformed','missing-input','missing-output-parent','invalid-shape','null-resource','null-node','existing-output'])
  test(`inventory ${kind} fails without disclosing private data or paths`,async t=>{
    const directory=await fixture(t),input=path.join(directory,'SYNTHETIC_PRIVATE_PATH_input.jsonl'),
      output=path.join(directory,...(kind==='missing-output-parent'?['missing-private-directory']:[]),'SYNTHETIC_PRIVATE_PATH_output.json');
    let source;
    if(kind!=='missing-input'){
      let record=valid();if(kind==='invalid-shape')record={private:marker};
      if(kind==='null-resource')record=null;if(kind==='null-node')record.dsl.nodes=[null];
      source=kind==='malformed'?marker+' invalid export\n':JSON.stringify(record)+'\n';await writeFile(input,source);
    }
    if(kind==='existing-output')await writeFile(output,'synthetic-existing-output-do-not-overwrite\n');
    const result=await call(input,output);assert.equal(result.code,1);assert.equal(result.stdout,'');
    assert.equal(result.stderr,'Agent inventory failed: check input and output files.\n');
    assert.doesNotMatch(result.stderr,/synthetic-private|SYNTHETIC_PRIVATE_PATH|SyntaxError|TypeError/);
    if(source!==undefined)assert.equal(await readFile(input,'utf8'),source);
    if(kind==='existing-output')assert.equal(await readFile(output,'utf8'),'synthetic-existing-output-do-not-overwrite\n');
    else await assert.rejects(readFile(output),{code:'ENOENT'});
  });
test('inventory preserves source bytes and existing metadata/hash contract without interpreting DSL',async t=>{
  const directory=await fixture(t),input=path.join(directory,'input.jsonl'),output=path.join(directory,'inventory.json');
  const bytes=Buffer.from('\ufeff'+JSON.stringify(valid())+'\r\n');await writeFile(input,bytes);
  const result=await call(input,output);assert.equal(result.code,0);assert.equal(result.stderr,'');
  const saved=await readFile(output,'utf8'),inventory=JSON.parse(saved),summary=JSON.parse(result.stdout);
  assert.deepEqual(await readFile(input),bytes);assert.equal(inventory.sourceSha256,hash(bytes));
  assert.equal(inventory.recordCount,1);assert.equal(inventory.topLevelCount,1);
  assert.deepEqual(inventory.resourceTypes,['workflow']);assert.equal(summary.records,1);
  const resource=inventory.resources[0];assert.equal(resource.id,'synthetic-workflow');assert.equal(resource.name,'Synthetic workflow');
  assert.deepEqual(resource.dependencies,['synthetic-missing']);assert.deepEqual(resource.missingDependencies,['synthetic-missing']);
  assert.deepEqual(resource.nodes,[{id:'n1',name:'Synthetic node',type:'llm',configKeys:['prompt','code','endpoint']}]);
  assert.deepEqual(resource.snippetHashes.map(s=>s.path),['dsl.prompt','dsl.code','dsl.nodes[0].configs.prompt','dsl.nodes[0].configs.code']);
  for(const snippet of resource.snippetHashes){assert.equal(snippet.sha256,hash(marker));assert.equal(snippet.length,marker.length);}
  for(const content of [saved,result.stdout])for(const privateValue of [marker,credential,url])assert.equal(content.includes(privateValue),false);
});
for(const [name,level] of [['object',{privatePrompt:marker,credential}],['array',[marker,credential]],['private-string',marker]])
  test(`inventory omits nonnumeric optional resource level: ${name}`,async t=>{
    const directory=await fixture(t),input=path.join(directory,'input.jsonl'),output=path.join(directory,'inventory.json');
    const source=JSON.stringify({...valid(),resource_level:level})+'\n';await writeFile(input,source);
    const result=await call(input,output);assert.equal(result.code,0);assert.equal(result.stderr,'');
    const saved=await readFile(output,'utf8'),inventory=JSON.parse(saved);
    assert.equal(Object.hasOwn(inventory.resources[0],'level'),false);assert.equal(inventory.topLevelCount,0);
    assert.equal(await readFile(input,'utf8'),source);
    for(const content of [saved,result.stdout])for(const privateValue of [marker,credential,url])assert.equal(content.includes(privateValue),false);
  });
test('inventory retains actual numeric levels 1 and 2 and the existing top-level summary',async t=>{
  const directory=await fixture(t),input=path.join(directory,'input.jsonl'),output=path.join(directory,'inventory.json');
  const records=[valid(),{...valid(),resource_id:'synthetic-code',resource_type:'code',resource_level:2,level2_resources:[]}];
  const source=records.map(r=>JSON.stringify(r)).join('\n')+'\n';await writeFile(input,source);
  const result=await call(input,output);assert.equal(result.code,0);assert.equal(result.stderr,'');
  const inventory=JSON.parse(await readFile(output,'utf8')),summary=JSON.parse(result.stdout);
  assert.deepEqual(inventory.resources.map(r=>r.level),[1,2]);assert.equal(inventory.recordCount,2);assert.equal(inventory.topLevelCount,1);
  assert.deepEqual(summary.workflows.map(r=>r.id),['synthetic-workflow']);assert.equal(await readFile(input,'utf8'),source);
});
