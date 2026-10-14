import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {cp, lstat, mkdir, readFile, readdir, realpath, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';

export const LAYA_ASSET_FILES = Object.freeze(['model.safetensors','rl_agent_config.json',
  'encoder/config.json','tokenizer/tokenizer_config.json','tokenizer/tokenizer.json']);
export const LAYA_CPU_TORCH_WHEEL = 'torch-2.14.0+cpu-cp311-cp311-manylinux_2_28_aarch64.whl';
const within = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const sha256 = source => new Promise((resolve, reject) => {
  const hash = createHash('sha256'), stream = createReadStream(source);
  stream.on('data', chunk => hash.update(chunk)); stream.once('error', reject);
  stream.once('end', () => resolve(hash.digest('hex')));
});

/** Only five named model assets; Hugging Face blob links must stay inside explicit trustRoot. */
export async function exportLayaAssets({source, trustRoot, revision, destination}) {
  if (![source,trustRoot,destination].every(value => typeof value === 'string' && path.isAbsolute(value))
    || typeof revision !== 'string' || !/^[a-f0-9]{40}$/.test(revision)) throw new Error('Explicit Laya source, trust root and revision required');
  const boundary = await realpath(trustRoot), model = await realpath(source);
  if (!within(boundary, model) || !(await stat(model)).isDirectory()) throw new Error('Laya source outside trust root');
  const files=[];
  for (const relative of LAYA_ASSET_FILES) {
    const name = path.join(model,relative);
    // Directory aliases cannot smuggle an arbitrary tree into the allowlist.
    for (let parent=path.dirname(name); parent !== model; parent=path.dirname(parent)) {
      const entry = await lstat(parent);
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Invalid Laya asset directory');
    }
    const actual = await realpath(name);
    if (!within(boundary,actual) || !(await stat(actual)).isFile()) throw new Error('Laya asset link outside trust root');
    const output = path.join(destination,relative); await mkdir(path.dirname(output),{recursive:true});
    await cp(actual,output,{dereference:true,errorOnExist:true,force:false});
    if (relative === 'tokenizer/tokenizer_config.json') {
      // Same deterministic compatibility normalization as laya 0.3.20, performed
      // on this private export rather than mutating shared cache blobs at boot.
      const tokenizer=JSON.parse(await readFile(output,'utf8'));
      if (tokenizer.tokenizer_class == null || tokenizer.tokenizer_class === 'TokenizersBackend') {
        tokenizer.tokenizer_class='PreTrainedTokenizerFast'; delete tokenizer.backend; delete tokenizer.is_local;
      }
      if (Array.isArray(tokenizer.extra_special_tokens)) tokenizer.extra_special_tokens=Object.fromEntries(tokenizer.extra_special_tokens.map((value,index)=>[`extra_${index}`,value]));
      await writeFile(output,JSON.stringify(tokenizer,null,2)+'\n');
    }
    const details = await stat(output);
    if (!details.size) throw new Error('Empty Laya model asset');
    files.push({path:relative,bytes:details.size,sha256:await sha256(output)});
  }
  const manifest={formatVersion:'1.0.0',sdk:'laya[serve]==0.3.20',model:'multilingual',revision,files};
  await writeFile(path.join(destination,'asset-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}

/** Optional predownloaded Linux ARM64/pure Python wheels, not an existing venv. */
export async function exportLayaWheelhouse({source,destination}) {
  await mkdir(destination,{recursive:true});
  if(source===undefined) {
    throw new Error('Explicit CPU ARM64 wheelhouse required; no automatic CUDA or overseas download');
  }
  if(typeof source!=='string'||!path.isAbsolute(source)) throw new Error('Explicit absolute ARM64 wheelhouse required');
  const boundary=await realpath(source),files=[];
  if(!(await stat(boundary)).isDirectory())throw new Error('Invalid ARM64 wheelhouse');
  for(const entry of await readdir(boundary,{withFileTypes:true})) {
    if(!entry.name.endsWith('.whl'))continue;
    if(!entry.isFile()||!/^[A-Za-z0-9_.+-]+\.whl$/.test(entry.name)||!/(?:aarch64|any)\.whl$/.test(entry.name)) {
      throw new Error('Wheelhouse must contain only regular ARM64 or pure Python wheels');
    }
    if(entry.name.startsWith('torch-')&&entry.name!==LAYA_CPU_TORCH_WHEEL
      ||/^(?:cuda[-_]|nvidia[-_]|triton-)/.test(entry.name)) throw new Error('CPU wheelhouse contains an incompatible Torch or CUDA runtime');
    const input=path.join(boundary,entry.name),output=path.join(destination,entry.name);
    await cp(input,output,{errorOnExist:true,force:false});const details=await stat(output);
    if(!details.size)throw new Error('Empty ARM64 wheel');
    files.push({path:entry.name,bytes:details.size,sha256:await sha256(output)});
  }
  if(!files.some(file=>file.path===LAYA_CPU_TORCH_WHEEL))throw new Error('Configured CPU ARM64 Torch wheel is missing');
  files.sort((a,b)=>a.path.localeCompare(b.path));
  const manifest={formatVersion:'1.0.0',mode:'offline-wheelhouse',platform:'linux/arm64',
    torch:{version:'2.14.0+cpu',filename:LAYA_CPU_TORCH_WHEEL,runtimeVerification:'required by image build'},files};
  await writeFile(path.join(destination,'wheelhouse-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
