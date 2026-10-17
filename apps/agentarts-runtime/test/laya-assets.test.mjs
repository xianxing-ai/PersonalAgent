import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {exportLayaAssets,exportLayaWheelhouse,LAYA_ASSET_FILES,LAYA_CPU_TORCH_WHEEL} from '../scripts/laya-assets.mjs';

async function fixture(t) {
  const parent=await mkdtemp(path.join(os.tmpdir(),'laya-assets-'));t.after(()=>rm(parent,{recursive:true,force:true}));
  const source=path.join(parent,'trusted','snapshot','multilingual'),trustRoot=path.join(parent,'trusted'),destination=path.join(parent,'output');
  for(const name of LAYA_ASSET_FILES){const file=path.join(source,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,name==='model.safetensors'?'synthetic weights':JSON.stringify({tokenizer_class:'TokenizersBackend',extra_special_tokens:['synthetic']}));}
  await writeFile(path.join(source,'.env'),'synthetic private not exported');
  return {parent,source,trustRoot,destination,revision:'5'.repeat(40)};
}
test('export includes only explicit offline assets and hashes the actual exported bytes',async t=>{
  const f=await fixture(t);const result=await exportLayaAssets(f);
  assert.deepEqual(result.files.map(file=>file.path),LAYA_ASSET_FILES);assert.equal(result.revision,f.revision);
  for(const file of result.files){const bytes=await readFile(path.join(f.destination,file.path));assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
  assert.deepEqual((await readdir(f.destination)).sort(),['asset-manifest.json','encoder','model.safetensors','rl_agent_config.json','tokenizer']);
  const tokenizer=JSON.parse(await readFile(path.join(f.destination,'tokenizer/tokenizer_config.json'),'utf8'));
  assert.equal(tokenizer.tokenizer_class,'PreTrainedTokenizerFast');assert.deepEqual(tokenizer.extra_special_tokens,{extra_0:'synthetic'});
  assert.equal(JSON.stringify(result).includes(f.source),false);assert.equal(JSON.stringify(result).includes('.env'),false);
});
test('explicit Hugging Face blob link stays inside model trust root; escape is rejected',async t=>{
  const f=await fixture(t), weights=path.join(f.source,'model.safetensors');
  await rm(weights);await mkdir(path.join(f.trustRoot,'blobs'));
  const blob=path.join(f.trustRoot,'blobs','synthetic');await writeFile(blob,'synthetic linked weight bytes');
  try {await symlink(blob,weights,'file');} catch(error){if(process.platform==='win32'&&error.code==='EPERM'){t.skip('Windows symlink privilege unavailable; regular allowlist remains tested');return;}throw error;}
  const result=await exportLayaAssets(f);assert.equal(result.files[0].bytes,29);
  const outside=path.join(f.parent,'outside');await writeFile(outside,'synthetic private outside');
  await rm(weights);await symlink(outside,weights,'file');
  await assert.rejects(exportLayaAssets({...f,destination:path.join(f.parent,'second-output')}),/outside trust root/);
});
test('missing assets and an absent trusted configuration cannot produce a runnable image context',async t=>{
  const f=await fixture(t);await assert.rejects(exportLayaAssets({...f,trustRoot:undefined}),/Explicit Laya/);
  await rm(path.join(f.source,'model.safetensors'));
  await assert.rejects(exportLayaAssets(f),error=>error.code==='ENOENT');
});
test('optional offline wheelhouse copies only actual ARM64/pure wheels and records their bytes',async t=>{
  const f=await fixture(t),source=path.join(f.parent,'wheels'),destination=path.join(f.parent,'exported-wheels');
  await mkdir(source);await writeFile(path.join(source,'synthetic-1.0-py3-none-any.whl'),'synthetic wheel fixture');
  await writeFile(path.join(source,LAYA_CPU_TORCH_WHEEL),'synthetic export fixture; never installed');
  await writeFile(path.join(source,'synthetic_native-1.0-cp311-cp311-manylinux_2_28_aarch64.whl'),'synthetic native wheel fixture');
  await writeFile(path.join(source,'.env'),'synthetic private ignored');
  const result=await exportLayaWheelhouse({source,destination});assert.equal(result.files.length,3);assert.equal(result.mode,'offline-wheelhouse');
  assert.equal((await readdir(destination)).includes('.env'),false);
  for(const file of result.files)assert.equal(file.sha256,createHash('sha256').update(await readFile(path.join(destination,file.path))).digest('hex'));
  await writeFile(path.join(source,'wrong-1.0-cp311-cp311-win_amd64.whl'),'synthetic wrong-platform wheel');
  await assert.rejects(exportLayaWheelhouse({source,destination:path.join(f.parent,'wrong-export')}),/ARM64 or pure Python/);
});
test('CPU wheelhouse cannot accidentally choose the old PyPI CUDA Torch or omit its explicit CPU package',async t=>{
  const f=await fixture(t),source=path.join(f.parent,'wheels');await mkdir(source);
  await assert.rejects(exportLayaWheelhouse({destination:path.join(f.parent,'unconfigured')}),/Explicit CPU ARM64/);
  await writeFile(path.join(source,'torch-2.14.0-cp311-cp311-manylinux_2_28_aarch64.whl'),'synthetic PyPI GPU wheel');
  await assert.rejects(exportLayaWheelhouse({source,destination:path.join(f.parent,'gpu-export')}),/incompatible Torch or CUDA/);
});
