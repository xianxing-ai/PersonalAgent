// Offline recovery only: no Docker, registry, model, install, build or deploy calls.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {open,stat,mkdir,writeFile,lstat} from 'node:fs/promises';
import {createGunzip} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const sha256=value=>createHash('sha256').update(value).digest('hex');
const repositoryRoot=fileURLToPath(new URL('../../../',import.meta.url));
const text=(buffer,start,length)=>buffer.subarray(start,start+length).toString('utf8').replace(/\0.*$/s,'');
const octal=(buffer,start,length)=>{
  const value=text(buffer,start,length).trim();
  if(!/^[0-7]*$/.test(value))throw Error('Unsupported tar number');
  const number=Number.parseInt(value||'0',8);
  if(!Number.isSafeInteger(number)||number<0)throw Error('Invalid tar number');
  return number;
};
export function safeTarName(name,{portable=true}={}){
  while(name.startsWith('./'))name=name.slice(2);
  const reason=!name?'empty':name.startsWith('/')||/^[a-z]:/i.test(name)?'absolute':/[\\\x00-\x1f\x7f]/.test(name)||(portable&&name.includes(':'))?'nonportable':name.split('/').some(part=>part==='..'||part==='.')?'dot segment':name.includes('//')?'empty segment':null;
  if(reason)throw Error('Unsafe tar path ('+reason+')');
  if(portable&&name.split('/').some(part=>/[. ]$/.test(part)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))throw Error('Nonportable retained input name');
  return name.replace(/\/$/,'');
}
function header(buffer){
  if(buffer.length!==512)throw Error('Truncated tar header');
  if(buffer.every(value=>value===0))return null;
  const expected=octal(buffer,148,8);
  let actual=0;for(let index=0;index<512;index++)actual+=index>=148&&index<156?32:buffer[index];
  if(actual!==expected)throw Error('Tar header checksum mismatch');
  const prefix=text(buffer,345,155),name=text(buffer,0,100),type=text(buffer,156,1)||'0',rawName=prefix?prefix+'/'+name:name;
  return {name:type==='5'&&/^\.\/?$/.test(rawName)?'.':safeTarName(rawName,{portable:false}),bytes:octal(buffer,124,12),
    type,mode:octal(buffer,100,8),uid:octal(buffer,108,8),gid:octal(buffer,116,8)};
}
function pax(buffer){
  const result={};let offset=0;
  while(offset<buffer.length){
    const space=buffer.indexOf(32,offset),length=Number(buffer.subarray(offset,space).toString());
    if(space<offset||!Number.isSafeInteger(length)||length<4||offset+length>buffer.length)throw Error('Invalid PAX entry');
    const entry=buffer.subarray(space+1,offset+length-1).toString('utf8'),equal=entry.indexOf('=');
    if(equal<1)throw Error('Invalid PAX field');result[entry.slice(0,equal)]=entry.slice(equal+1);offset+=length;
  }
  return result;
}
async function tarIndex(filename){
  const handle=await open(filename,'r'),size=(await handle.stat()).size,entries=new Map();let offset=0;
  try{
    while(offset+512<=size){
      const buffer=Buffer.alloc(512),read=await handle.read(buffer,0,512,offset);
      if(read.bytesRead!==512)throw Error('Truncated archive');
      const entry=header(buffer);offset+=512;if(!entry)return entries;
      if(offset+entry.bytes>size)throw Error('Truncated archive entry');
      if(entry.type==='0'){
        if(!/^(?:blobs\/sha256\/[a-f0-9]{64}|index\.json|manifest\.json|oci-layout)$/.test(entry.name)||entries.has(entry.name))throw Error('Unexpected archive entry');
        entries.set(entry.name,{offset,bytes:entry.bytes});
      }else if(entry.type!=='5')throw Error('Archive links/extensions unsupported');
      offset+=Math.ceil(entry.bytes/512)*512;
    }
    throw Error('Archive end marker missing');
  }finally{await handle.close();}
}
async function digestRange(filename,entry){
  const digest=createHash('sha256');
  if(entry.bytes)for await(const chunk of createReadStream(filename,{start:entry.offset,end:entry.offset+entry.bytes-1}))digest.update(chunk);
  return digest.digest('hex');
}
async function readRange(filename,entry,limit=32*1024*1024){
  if(!entry||entry.bytes>limit)throw Error('Missing or oversized recovery blob');
  const handle=await open(filename,'r'),buffer=Buffer.alloc(entry.bytes);
  try{let read=0;while(read<buffer.length){const part=await handle.read(buffer,read,buffer.length-read,entry.offset+read);if(!part.bytesRead)throw Error('Truncated recovery blob');read+=part.bytesRead;}return buffer;}
  finally{await handle.close();}
}
// Stream every layer, including RUN layers, so an overwrite after COPY cannot
// silently leave an older file in the recovered final inputs. Only selected
// first-party regular-file bodies are buffered, at most 4 MiB per file.
async function readLayer(filename,range,visit){
  const source=createReadStream(filename,{start:range.offset,end:range.offset+range.bytes-1});
  const unzip=createGunzip();source.on('error',error=>unzip.destroy(error));source.pipe(unzip);
  const digest=createHash('sha256'),iterator=unzip[Symbol.asyncIterator]();let pending=Buffer.alloc(0),ended=false;
  async function next(){const value=await iterator.next();ended=value.done;if(!ended){pending=value.value;digest.update(pending);}}
  async function take(length,collect=false){
    const parts=[];let remaining=length;
    while(remaining){if(!pending.length){if(ended)throw Error('Truncated layer tar');await next();if(ended)throw Error('Truncated layer tar');}
      const size=Math.min(remaining,pending.length);if(collect)parts.push(Buffer.from(pending.subarray(0,size)));pending=pending.subarray(size);remaining-=size;}
    return collect?Buffer.concat(parts):undefined;
  }
  let extended={},longName;
  while(true){
    const entry=header(await take(512,true));
    if(!entry){
      while(true){if(pending.some(value=>value!==0))throw Error('Unexpected data after tar footer');pending=Buffer.alloc(0);if(ended)break;await next();}
      return 'sha256:'+digest.digest('hex');
    }
    const extension=['x','g','L','K'].includes(entry.type);
    if(extension&&entry.bytes>1024*1024)throw Error('Oversized tar extension');
    if(!extension){const name=extended.path??longName??entry.name;entry.name=entry.type==='5'&&/^\.\/?$/.test(name)?'.':safeTarName(name,{portable:false});extended={};longName=undefined;}
    const selected=!extension&&inputPath(entry.name);
    if(selected&&entry.bytes>4*1024*1024)throw Error('Oversized retained input');
    const content=await take(entry.bytes,extension||Boolean(selected));
    await take((512-entry.bytes%512)%512);
    if(entry.type==='x'){extended=pax(content);continue;}
    if(entry.type==='g'){if(Object.keys(pax(content)).some(key=>key==='path'||key==='linkpath'))throw Error('Global PAX path unsupported');continue;}
    if(entry.type==='L'){longName=content.toString('utf8').replace(/\0.*$/s,'');continue;}
    if(entry.type==='K')continue;
    await visit(entry,content,selected);
  }
}
const workspaces=['packages/contracts','packages/coordination','packages/models','packages/agentarts','apps/agentarts-runtime'];
const inputDirectories=workspaces.flatMap(workspace=>[workspace,...(workspace.startsWith('apps/')?['src']:workspace==='packages/contracts'?['dist','schema']:['dist']).map(directory=>workspace+'/'+directory)]);
function inputWhiteout(name){
  const basename=path.posix.basename(name);if(!basename.startsWith('.wh.'))return false;
  const parent=path.posix.dirname(name),root='opt/personal-agent';
  if(basename==='.wh..wh..opq')return parent==='.'||parent===root||root.startsWith(parent+'/')||parent.startsWith(root+'/');
  const removed=path.posix.join(parent,basename.slice(4));
  return removed===root||root.startsWith(removed+'/')||removed.startsWith(root+'/');
}
function inputPath(name){
  const prefix='opt/personal-agent/';if(!name.startsWith(prefix))return;
  const relative=name.slice(prefix.length);
  if(['package.json','package-lock.json','npm-registry.json'].includes(relative))return safeTarName(relative);
  for(const workspace of workspaces){
    if(relative===workspace+'/package.json')return safeTarName(relative);
    const directories=workspace.startsWith('apps/')?['src']:workspace==='packages/contracts'?['dist','schema']:['dist'];
    if(directories.some(directory=>relative.startsWith(workspace+'/'+directory+'/')))return safeTarName(relative);
  }
}
export async function validateRecoveryOutput(directory){
  const absolute=path.resolve(directory),allowed=path.join(repositoryRoot,'.cache','issue459');
  const relative=path.relative(allowed,absolute);
  if(!relative||relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative))throw Error('Output must be a fresh directory inside project .cache/issue459');
  let parent=path.dirname(absolute);
  while(true){const info=await lstat(parent);if(info.isSymbolicLink()||!info.isDirectory())throw Error('Output parent must be a real directory');const next=path.dirname(parent);if(next===parent)break;parent=next;}
  return absolute;
}
async function freshOutput(directory){
  const absolute=await validateRecoveryOutput(directory);await mkdir(absolute);return absolute;
}
export async function recoverInputs({archive,image,output}){
  const expected=/@sha256:([a-f0-9]{64})$/.exec(image??'')?.[1];if(!expected)throw Error('An immutable image digest is required');
  const entries=await tarIndex(archive),blobChecks=[];
  for(const [name,entry]of entries){if(!name.startsWith('blobs/'))continue;
    const actual=await digestRange(archive,entry);if(actual!==name.split('/').at(-1))throw Error('OCI blob digest mismatch');blobChecks.push({digest:'sha256:'+actual,bytes:entry.bytes});}
  const blob=async digest=>{if(!/^sha256:[a-f0-9]{64}$/.test(digest??''))throw Error('Invalid OCI digest');return readRange(archive,entries.get('blobs/sha256/'+digest.slice(7)));};
  const json=async digest=>JSON.parse((await blob(digest)).toString('utf8'));
  const descriptorSize=descriptor=>{const entry=entries.get('blobs/sha256/'+descriptor.digest?.slice(7));if(!entry||entry.bytes!==descriptor.size)throw Error('OCI descriptor size mismatch');};
  const index=await json('sha256:'+expected);
  if(index.schemaVersion!==2||index.mediaType!=='application/vnd.oci.image.index.v1+json')throw Error('Expected immutable OCI index');
  const members=index.manifests.filter(value=>value.platform?.os==='linux'&&value.platform?.architecture==='arm64');
  if(members.length!==1)throw Error('Expected exactly one ARM64 member');
  const member=members[0];descriptorSize(member);const manifest=await json(member.digest);descriptorSize(manifest.config);const config=await json(manifest.config.digest);
  if(config.os!=='linux'||config.architecture!=='arm64'||config.rootfs?.diff_ids?.length!==manifest.layers.length)throw Error('Image configuration mismatch');
  const attestations=[];
  for(const descriptor of index.manifests.filter(value=>value.annotations?.['vnd.docker.reference.type']==='attestation-manifest')){
    descriptorSize(descriptor);
    if(descriptor.annotations['vnd.docker.reference.digest']!==member.digest)throw Error('Unbound attestation descriptor');
    const attachment=await json(descriptor.digest);if(attachment.subject?.digest!==member.digest)throw Error('Unbound attestation manifest');
    for(const layer of attachment.layers){descriptorSize(layer);const statement=await json(layer.digest);
      if(!statement.subject?.some(value=>value.digest?.sha256===member.digest.slice(7)))throw Error('Unbound provenance subject');
      const predicate=statement.predicate??{},metadata=predicate.runDetails?.metadata??{},vcs=metadata.buildkit_metadata?.vcs??{};
      attestations.push({digest:layer.digest,predicateType:statement.predicateType,buildType:predicate.buildDefinition?.buildType,
        invocationId:metadata.invocationId,startedOn:metadata.startedOn,finishedOn:metadata.finishedOn,
        vcs:{source:vcs.source,revision:vcs.revision,contextLeaf:typeof vcs['localdir:context']==='string'?vcs['localdir:context'].split(/[\\/]/).at(-1):null,
          dirtyPresent:Object.hasOwn(vcs,'dirty')},resolvedDependencies:predicate.buildDefinition?.resolvedDependencies??[]});
    }
  }
  const files=new Map(),versions=[],layers=[];let layerIndex=-1;
  for(const history of config.history??[]){if(history.empty_layer)continue;layerIndex++;
    const descriptor=manifest.layers[layerIndex];if(!descriptor)throw Error('History/layer mismatch');
    const recover=/^COPY (?:package\.json package-lock\.json npm-registry\.json|dependency-manifests\/|packages |apps )/.test(history.created_by??'');
    descriptorSize(descriptor);
    const record={index:layerIndex,digest:descriptor.digest,bytes:descriptor.size,diffId:config.rootfs.diff_ids[layerIndex],
      commandSha256:sha256(history.created_by??''),inputCopy:recover};layers.push(record);
    let recovered=0;
    const diffId=await readLayer(archive,entries.get('blobs/sha256/'+descriptor.digest.slice(7)),async(entry,content,relative)=>{
      if(inputWhiteout(entry.name))throw Error('Recovery whiteouts require explicit reconciliation');
      const ancestor=['opt/personal-agent',...inputDirectories.map(directory=>'opt/personal-agent/'+directory)].some(root=>root===entry.name||root.startsWith(entry.name+'/'));
      if((relative||ancestor)&&!['0','5'].includes(entry.type))throw Error('Recovery inputs must be regular files/directories');
      if(!relative||entry.type==='5')return;
      const file={path:relative,bytes:content.length,sha256:sha256(content),
        lfSha256:sha256(content.toString('utf8').replaceAll('\r\n','\n')),mode:entry.mode,uid:entry.uid,gid:entry.gid,layer:descriptor.digest};
      files.set(relative,{...file,content});versions.push(file);recovered++;
    });
    if(diffId!==record.diffId)throw Error('Layer diff ID mismatch');
    record.recoveredVersions=recovered;
  }
  if(layerIndex+1!==manifest.layers.length||!files.has('package-lock.json')||!files.has('apps/agentarts-runtime/src/main.mjs'))throw Error('Incomplete input recovery');
  const ordered=[...files.values()].sort((left,right)=>left.path.localeCompare(right.path));
  const receipt={kind:'immutable_image_copied_input_recovery',version:1,image,indexDigest:'sha256:'+expected,
    memberDigest:member.digest,configDigest:manifest.config.digest,archiveBytes:(await stat(archive)).size,
    archiveSha256:await digestRange(archive,{offset:0,bytes:(await stat(archive)).size}),
    architecture:config.architecture,os:config.os,user:config.config?.User,workingDirectory:config.config?.WorkingDir,
    imageCreated:config.created,blobChecks,attestations,layers,files:ordered.map(({content,...file})=>file),copyVersions:versions,
    recoveredFileCount:ordered.length,recoveredTreeSha256:sha256(JSON.stringify(ordered.map(({path:filename,sha256:digest})=>({path:filename,sha256:digest})))),
    originalGitSourceEstablished:false,scope:'Exact retained COPY inputs; compiler inputs and unretained context files require separate evidence.'};
  const destination=await freshOutput(output);
  for(const file of ordered){const target=path.join(destination,'inputs',...file.path.split('/'));await mkdir(path.dirname(target),{recursive:true});await writeFile(target,file.content,{flag:'wx'});}
  await writeFile(path.join(destination,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  return receipt;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>16384)throw Error('Recovery configuration too large');}
    const config=JSON.parse(input);if(Object.keys(config).some(key=>!['archive','image','output'].includes(key)))throw Error('Unknown recovery option');
    const result=await recoverInputs(config);console.log(JSON.stringify({kind:result.kind,recoveredFileCount:result.recoveredFileCount,
      indexDigest:result.indexDigest,recoveredTreeSha256:result.recoveredTreeSha256,originalGitSourceEstablished:false}));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
