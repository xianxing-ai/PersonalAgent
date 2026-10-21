import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {mkdir,mkdtemp,writeFile,readFile,access,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {recoverInputs} from './recover-existing-image-inputs.mjs';

const digest=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const root=fileURLToPath(new URL('../../../',import.meta.url));
const parent=path.join(root,'.cache','issue459');
function tar(entries){
  const chunks=[];
  for(const entry of entries){
    const content=Buffer.from(entry.content??''),header=Buffer.alloc(512);
    header.write(entry.name,0,100);header.write('0000644\0',100);header.write('0000000\0',108);header.write('0000000\0',116);
    header.write(content.length.toString(8).padStart(11,'0')+'\0',124);header.write('00000000000\0',136);
    header.fill(32,148,156);header.write(entry.type??'0',156);header.write('ustar\0',257);header.write('00',263);
    if(entry.link)header.write(entry.link,157,100);
    header.write([...header].reduce((sum,value)=>sum+value,0).toString(8).padStart(6,'0')+'\0 ',148);
    chunks.push(header,content,Buffer.alloc((512-content.length%512)%512));
  }
  return Buffer.concat([...chunks,Buffer.alloc(1024)]);
}
async function fixture(directory,{malicious,diffMismatch=false,blobMismatch=false,sizeMismatch=false,overwrite=false}={}){
  const first=tar([{name:'opt/personal-agent/package-lock.json',content:'{"lockfileVersion":3}\n'},
    {name:'opt/personal-agent/apps/agentarts-runtime/src/main.mjs',content:'export const version=1;\r\n'},...(malicious?[malicious]:[])]);
  const streams=[first,...(overwrite?[tar([{name:'opt/personal-agent/apps/agentarts-runtime/src/main.mjs',content:'export const version=2;\n'}])]:[])];
  const blobs=new Map(),put=(value,mediaType)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));const hash=digest(bytes);blobs.set(hash,bytes);return{digest:hash,size:bytes.length,mediaType};};
  const layers=streams.map(value=>put(gzipSync(value),'application/vnd.oci.image.layer.v1.tar+gzip'));
  const config=put({architecture:'arm64',os:'linux',config:{User:'node',WorkingDir:'/opt/personal-agent'},
    rootfs:{type:'layers',diff_ids:streams.map(value=>diffMismatch?'sha256:'+'0'.repeat(64):digest(value))},
    history:streams.map((_,index)=>({created_by:index===0?'COPY apps ./apps # buildkit':'RUN update-retained-input'}))},'application/vnd.oci.image.config.v1+json');
  const manifest=put({schemaVersion:2,mediaType:'application/vnd.oci.image.manifest.v1+json',config,layers},'application/vnd.oci.image.manifest.v1+json');
  const index=put({schemaVersion:2,mediaType:'application/vnd.oci.image.index.v1+json',manifests:[{...manifest,size:manifest.size+(sizeMismatch?1:0),platform:{os:'linux',architecture:'arm64'}}]},'application/vnd.oci.image.index.v1+json');
  if(blobMismatch){const bytes=Buffer.from(blobs.get(layers[0].digest));bytes[12]^=1;blobs.set(layers[0].digest,bytes);}
  const archive=path.join(directory,'image.tar');await writeFile(archive,tar([...blobs].map(([hash,content])=>({name:'blobs/sha256/'+hash.slice(7),content}))));
  return{archive,image:'registry.invalid/owned@'+index.digest,output:path.join(directory,'recovered')};
}
async function isolated(run){
  await mkdir(parent,{recursive:true});const directory=await mkdtemp(path.join(parent,'recovery-test-'));
  try{return await run(directory);}finally{assert.ok(path.relative(parent,directory).startsWith('recovery-test-'));await rm(directory,{recursive:true,force:true});}
}
test('recovers exact retained bytes and observes a later RUN overwrite',()=>isolated(async directory=>{
  const config=await fixture(directory,{overwrite:true}),result=await recoverInputs(config);
  assert.equal(result.recoveredFileCount,2);assert.equal(result.copyVersions.length,3);
  assert.equal(result.originalGitSourceEstablished,false);
  assert.equal(await readFile(path.join(config.output,'inputs/apps/agentarts-runtime/src/main.mjs'),'utf8'),'export const version=2;\n');
  assert.equal(result.files.find(file=>file.path.endsWith('main.mjs')).layer,result.layers[1].digest);
}));
for(const [name,options,error]of[
  ['tampered compressed blob',{blobMismatch:true},/blob digest mismatch/],
  ['wrong layer diff ID',{diffMismatch:true},/diff ID mismatch/],
  ['wrong OCI descriptor size',{sizeMismatch:true},/descriptor size mismatch/],
  ['parent traversal',{malicious:{name:'opt/personal-agent/../../escape',content:'unsafe'}},/Unsafe tar path/],
  ['Windows absolute path',{malicious:{name:'C:/escape',content:'unsafe'}},/Unsafe tar path/],
  ['POSIX absolute path',{malicious:{name:'/escape',content:'unsafe'}},/Unsafe tar path/],
  ['source symlink',{malicious:{name:'opt/personal-agent/apps/agentarts-runtime/src/link.mjs',type:'2',link:'../../escape'}},/regular files/],
  ['source directory hardlink',{malicious:{name:'opt/personal-agent/apps/agentarts-runtime/src',type:'1',link:'escape'}},/regular files/],
  ['source whiteout',{malicious:{name:'opt/personal-agent/apps/agentarts-runtime/src/.wh.main.mjs',content:''}},/whiteouts/],
  ['root opaque whiteout',{malicious:{name:'opt/personal-agent/.wh..wh..opq',content:''}},/whiteouts/],
  ['Windows device name',{malicious:{name:'opt/personal-agent/apps/agentarts-runtime/src/CON.mjs',content:'unsafe'}},/Nonportable/]
])test('rejects '+name+' before creating recovery output',()=>isolated(async directory=>{
  const config=await fixture(directory,options);await assert.rejects(recoverInputs(config),error);
  await assert.rejects(access(config.output));
}));
test('rejects output outside the project ignored recovery directory',()=>isolated(async directory=>{
  const config=await fixture(directory);config.output=path.join(root,'.cache','not-issue459-'+path.basename(directory));
  await assert.rejects(recoverInputs(config),/inside project \.cache\/issue459/);await assert.rejects(access(config.output));
}));
test('rejects ancestor deletion and opaque whiteouts',async()=>{
  for(const name of ['opt/.wh.personal-agent','opt/.wh..wh..opq','.wh.opt','.wh..wh..opq'])await isolated(async directory=>{
    const config=await fixture(directory,{malicious:{name,content:''}});
    await assert.rejects(recoverInputs(config),/whiteouts/);await assert.rejects(access(config.output));
  });
});
test('rejects a linked output ancestor and existing destination',()=>isolated(async directory=>{
  const config=await fixture(directory),target=path.join(directory,'target'),link=path.join(directory,'link');
  await mkdir(target);await symlink(target,link,process.platform==='win32'?'junction':'dir');
  await assert.rejects(recoverInputs({...config,output:path.join(link,'recovered')}),/real directory/);
  await mkdir(config.output);await writeFile(path.join(config.output,'user.txt'),'preserve');
  await assert.rejects(recoverInputs(config),/EEXIST/);
  assert.equal(await readFile(path.join(config.output,'user.txt'),'utf8'),'preserve');
}));
