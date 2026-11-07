import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open,readdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=message=>{throw new ProtocolError('UNSUPPORTED_CAPABILITY',message);};
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;

/** A deliberately narrow byte-preservation policy, not semantic review. All workspace
 * files, including ignored files/dependencies, are sealed; only .git metadata is excluded.
 * Linked/large workspaces fail closed. No commands, credentials or file contents leave here. */
export async function readF16AcceptanceBytes({root,patch,assertCurrent}) {
  if(typeof assertCurrent!=='function')fail('Original workspace authority required');
  assertCurrent();
  if(!path.isAbsolute(root)||await realpath(root)!==path.resolve(root))fail('Canonical F16 workspace required');
  if(typeof patch?.path!=='string'||!/^src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:[cm]?[jt]s|tsx|jsx|py|rs|go|java|cs)$/u.test(patch.path)
    ||/(?:^|[\/_.-])(?:test|tests|spec|specs|fixture|fixtures|mock|mocks|build|config|setup|assert|coverage)(?:[\/_.-]|$)/iu.test(patch.path))
    fail('F16 byte policy accepts one ordinary src file; test, workflow and build edits require independent semantic review');
  const identity=await lstat(root,{bigint:true});
  if(!identity.isDirectory()||identity.isSymbolicLink())fail('Original F16 workspace directory required');
  const files=[],directories=[];let bytes=0,entries=0,workflowText;
  async function walk(relative=''){
    assertCurrent();const directory=path.join(root,relative),before=await lstat(directory,{bigint:true});
    if(!before.isDirectory()||before.isSymbolicLink()||await realpath(directory)!==directory)fail('Linked F16 acceptance directory');
    directories.push({path:relative||'.',mode:Number(before.mode&0o777n)});
    const names=(await readdir(directory)).sort();
    for(const name of names){
      if(!relative&&name==='.git')continue;
      if(++entries>16000||/[\x00-\x1f\\]/u.test(name))fail('F16 acceptance snapshot exceeds bounded file scope');
      const rel=relative?relative+'/'+name:name,full=path.join(root,rel),stat=await lstat(full,{bigint:true});
      if(stat.isSymbolicLink())fail('F16 acceptance snapshot cannot follow links');
      if(stat.isDirectory()){await walk(rel);continue;}
      if(!stat.isFile()||stat.size>4n*1024n*1024n||files.length>=8000)fail('F16 acceptance requires bounded regular files');
      bytes+=Number(stat.size);if(bytes>128*1024*1024)fail('F16 acceptance snapshot exceeds byte budget');
      assertCurrent();const handle=await open(full,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
      try{
        const opened=await handle.stat({bigint:true});if(!same(stat,opened))fail('F16 acceptance file replaced before read');
        const buffer=Buffer.alloc(Number(opened.size)+1);let size=0;
        while(size<buffer.length){const read=await handle.read(buffer,size,buffer.length-size,null);if(!read.bytesRead)break;size+=read.bytesRead;}
        if(size!==Number(opened.size)||!same(opened,await handle.stat({bigint:true})))fail('F16 acceptance file changed during read');
        if(await realpath(full)!==full||!same(opened,await lstat(full,{bigint:true})))fail('F16 acceptance path changed during read');
        const content=buffer.subarray(0,size);
        files.push({path:rel,sha256:sha(content),mode:Number(opened.mode&0o777n)});
        if(/^\.github\/workflows\/[^/]+\.ya?ml$/u.test(rel)){
          if(workflowText!==undefined)fail('F16 fixed CI identity currently requires exactly one workflow definition');
          workflowText=new TextDecoder('utf-8',{fatal:true}).decode(content);
        }
      }finally{await handle.close();}
    }
    if(!same(before,await lstat(directory,{bigint:true})))fail('F16 acceptance directory changed during enumeration');
  }
  await walk();assertCurrent();
  const after=await lstat(root,{bigint:true});if(identity.dev!==after.dev||identity.ino!==after.ino)fail('F16 workspace replaced');
  // Restrict to a single literal workflow name: existing GitHub public run DTO has
  // no workflow_id/path. Dynamic or ambiguous names cannot establish that identity.
  const names=workflowText?.match(/^name: [A-Za-z0-9][A-Za-z0-9 _.-]{0,127}\r?$/gmu)??[];
  if(names.length!==1||/^run-name\s*:/mu.test(workflowText)||!files.some(file=>file.path===patch.path)
    ||!files.some(file=>file.path==='package.json'))fail('F16 requires one literal named CI workflow and the original build definition');
  return {policy:'unchanged-acceptance-bytes-v1',files,directories,workflowName:names[0].slice(6).trim(),digest:sha(JSON.stringify({files,directories}))};
}

export function assertF16PreservedBytes(before,after,patch,patchResult){
  if(before?.policy!=='unchanged-acceptance-bytes-v1'||after?.policy!==before.policy||before.workflowName!==after.workflowName
    ||!Array.isArray(before.files)||!Array.isArray(after.files)||before.files.length!==after.files.length
    ||!Array.isArray(before.directories)||!isDeepStrictEqual(before.directories,after.directories))
    fail('F16 original acceptance file set changed');
  const original=before.files.find(file=>file.path===patch.path),updated=after.files.find(file=>file.path===patch.path);
  if(!original||!updated||original.sha256!==patch.expectedSha256||patchResult?.applied!==true||patchResult.path!==patch.path
    ||patchResult.beforeSha256!==original.sha256||patchResult.afterSha256!==updated.sha256||updated.sha256===original.sha256
    ||original.mode!==updated.mode||!isDeepStrictEqual(before.files.filter(file=>file.path!==patch.path),after.files.filter(file=>file.path!==patch.path)))
    fail('F16 repair changed acceptance bytes or differs from the original applied patch');
}
