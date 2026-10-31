import {createHash,createPublicKey,randomUUID} from 'node:crypto';
import {closeSync,existsSync,fstatSync,lstatSync,mkdirSync,openSync,readFileSync,realpathSync,renameSync,statSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {ProtocolError} from '@personal-agent/contracts';

const hash=value=>createHash('sha256').update(value).digest('hex');
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const identity=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(value);
const validKey=value=>plain(value)&&Object.keys(value).sort().join(',')==='patchDigest,sessionId,snapshotId,taskId'
  &&[value.taskId,value.sessionId,value.snapshotId].every(identity)&&/^[a-f0-9]{64}$/.test(value.patchDigest);
const reviewFile=value=>'f15-review-'+hash(JSON.stringify({taskId:value.taskId,sessionId:value.sessionId,
  snapshotId:value.snapshotId,patchDigest:value.patchDigest}))+'.json';
const fail=()=>{throw Error('独立审核配置或原任务授权不可用');};
const sameFile=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
function selectedLocal(value,kind){
  if(typeof value!=='string'||!path.isAbsolute(value)||value.startsWith('\\\\')||lstatSync(value).isSymbolicLink())fail();
  const resolved=realpathSync.native(value),stat=statSync(resolved,{bigint:true});
  if(kind==='directory'?!stat.isDirectory()||resolved===path.parse(resolved).root:!stat.isFile())fail();
  return {path:resolved,stat};
}
function boundedFile(file,limit){
  const before=lstatSync(file,{bigint:true});if(!before.isFile()||before.isSymbolicLink()||before.size>BigInt(limit))fail();
  const fd=openSync(file,'r');try{const current=fstatSync(fd,{bigint:true});
    if(!current.isFile()||!sameFile(before,current)||current.size>BigInt(limit))fail();
    const data=readFileSync(fd);if(data.length>limit||!sameFile(current,lstatSync(file,{bigint:true})))fail();return data;
  }finally{closeSync(fd);}
}
function readPublicKey(file){
  const pem=boundedFile(file,16384).toString('utf8');
  if(!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/.test(pem))fail();
  const key=createPublicKey(pem);if(key.asymmetricKeyType!=='ed25519')fail();
  return {pem,fingerprint:hash(key.export({format:'der',type:'spki'}))};
}

/** Native-only configuration. File paths and signing inputs never come from a model.
 * The reviewer independently signs one JSON envelope per original task/patch. */
export function createDesktopF15ReviewConfigHost({userData,safeStorage,selectPublicKey,selectReviewDirectory,confirmConfiguration,confirmIndependence,
  readAuthorIdentity,assertOriginalOwner,getApplication,createSignedReview,onPendingChange}) {
  const file=path.join(userData,'coding-independent-review.json');let saved,encoded,generation=randomUUID();const pending=new Map();
  const notify=()=>{try{onPendingChange?.();}catch{/* UI notification grants no authority. */}};
  const available=()=>typeof readAuthorIdentity==='function'&&typeof assertOriginalOwner==='function'&&typeof getApplication==='function'&&typeof createSignedReview==='function';
  function decode(){
    if(!safeStorage?.isEncryptionAvailable?.()||!existsSync(file))return;
    const content=boundedFile(file,32768).toString('utf8'),outer=JSON.parse(content);
    if(!plain(outer)||outer.version!==1||typeof outer.encrypted!=='string')return;
    const value=JSON.parse(safeStorage.decryptString(Buffer.from(outer.encrypted,'base64')));
    if(!plain(value)||value.version!==1||value.enabled!==true||!identity(value.reviewerId)||!identity(value.authorId)
      ||!identity(value.policyId)||value.reviewerId===value.authorId||typeof value.keyPath!=='string'||typeof value.directoryPath!=='string'
      ||value.independence!=='user_confirmed'||!Number.isFinite(Date.parse(value.confirmedAt))||!/^[a-f0-9]{64}$/.test(value.fingerprint))return;
    encoded=content;saved=value;
  }
  try{decode();}catch{saved=undefined;encoded=undefined;}
  function persist(value){
    if(!safeStorage?.isEncryptionAvailable?.())fail();mkdirSync(userData,{recursive:true});
    const content=JSON.stringify({version:1,encrypted:safeStorage.encryptString(JSON.stringify(value)).toString('base64')});
    const temp=file+'.'+randomUUID()+'.tmp';writeFileSync(temp,content,{flag:'wx',mode:0o600});renameSync(temp,file);encoded=content;
  }
  function checked(){
    if(!available()||!saved||!encoded||readAuthorIdentity()!==saved.authorId||boundedFile(file,32768).toString('utf8')!==encoded)fail();
    const key=selectedLocal(saved.keyPath,'file'),directory=selectedLocal(saved.directoryPath,'directory');
    const publicKey=readPublicKey(key.path);if(key.path!==saved.keyPath||directory.path!==saved.directoryPath||publicKey.fingerprint!==saved.fingerprint)fail();
    return {key,directory,publicKey};
  }
  function snapshot(){
    if(!saved)return {configured:false,available:false,reason:'independent_reviewer_not_configured'};
    try{checked();return {configured:true,available:true,reviewerId:saved.reviewerId,authorId:saved.authorId,
      policyId:saved.policyId,publicKeyFingerprint:saved.fingerprint,independence:'user_confirmed',confirmedAt:saved.confirmedAt};}
    catch{return {configured:true,available:false,reason:'independent_reviewer_configuration_unavailable'};}
  }
  return {
    snapshot,
    pending(){return [...pending.values()].map(value=>structuredClone(value));},
    /** Called only by the trusted IPC handler; paths come exclusively from native selectors. */
    async configure(input){
      if(!plain(input)||Object.keys(input).sort().join(',')!=='authorId,policyId,reviewerId'
        ||![input.reviewerId,input.authorId,input.policyId].every(identity)||input.reviewerId===input.authorId
        ||typeof selectPublicKey!=='function'||typeof selectReviewDirectory!=='function'||typeof confirmConfiguration!=='function'
        ||typeof confirmIndependence!=='function'||!available()||input.authorId!==readAuthorIdentity())fail();
      const initial=generation,keyPath=await selectPublicKey();if(generation!==initial)fail();if(!keyPath)return snapshot();
      const selectedKey=selectedLocal(keyPath,'file'),key=readPublicKey(selectedKey.path);
      const directoryPath=await selectReviewDirectory();if(generation!==initial)fail();if(!directoryPath)return snapshot();
      const directory=selectedLocal(directoryPath,'directory');
      if(await confirmConfiguration({reviewerId:input.reviewerId,authorId:input.authorId,policyId:input.policyId,
        publicKeyFingerprint:key.fingerprint,publicKeyPath:selectedKey.path,reviewDirectoryPath:directory.path})!==true)return snapshot();
      if(await confirmIndependence({reviewerId:input.reviewerId,authorId:input.authorId,policyId:input.policyId,
        publicKeyFingerprint:key.fingerprint})!==true)return snapshot();
      if(generation!==initial)fail();
      const againKey=selectedLocal(selectedKey.path,'file'),againDir=selectedLocal(directory.path,'directory');
      if(!sameFile(selectedKey.stat,againKey.stat)||!sameFile(directory.stat,againDir.stat)||readPublicKey(againKey.path).fingerprint!==key.fingerprint)fail();
      if(input.authorId!==readAuthorIdentity())fail();
      const value={version:1,enabled:true,reviewerId:input.reviewerId,authorId:input.authorId,policyId:input.policyId,
        independence:'user_confirmed',confirmedAt:new Date().toISOString(),
        keyPath:selectedKey.path,directoryPath:directory.path,fingerprint:key.fingerprint};
      persist(value);saved=value;generation=randomUUID();return snapshot();
    },
    revoke(){generation=randomUUID();saved=undefined;persist({version:1,enabled:false});return snapshot();},
    /** Main composition must register tool and inject port into the existing F15 worker. */
    createBinding(){
      const initial=generation,selected=checked(),{publicKey}=selected,binding=structuredClone(saved);
      const current=key=>{try{const now=checked();return validKey(key)&&generation===initial
        &&sameFile(selected.key.stat,now.key.stat)&&sameFile(selected.directory.stat,now.directory.stat)&&assertOriginalOwner({...key,
        reviewerId:binding.reviewerId,authorId:binding.authorId,policyId:binding.policyId})===true;}catch{return false;}};
      const read=key=>{
          if(!current(key))return undefined;
          try{const dir=checked().directory,filename=path.join(dir.path,reviewFile(key)),selected=selectedLocal(filename,'file');
            if(path.dirname(selected.path)!==dir.path)return undefined;
            const value=JSON.parse(boundedFile(selected.path,65536).toString('utf8'));
            if(!plain(value)||Object.keys(value).sort().join(',')!=='review,signature'||!plain(value.review)||typeof value.signature!=='string'
              ||Object.keys(value.review).sort().join(',')!=='authorId,decision,expiresAt,patchDigest,policyId,reviewedAt,reviewerId,sessionId,snapshotId,taskId,version')return undefined;
            return current(key)?value:undefined;
          }catch{return undefined;}
        };
      const signed=createSignedReview(getApplication,{reviewerId:binding.reviewerId,authorId:binding.authorId,policyId:binding.policyId,
        publicKey:publicKey.pem,assertCurrent:current,read});
      const original=signed.tool;
      return {...signed,tool:{...original,async execute(input,context){
        const application=getApplication(),parent=application.runtime.loadCheckpoint(context.taskId,'coding-repair:parent');
        if(!plain(input)||Object.keys(input).sort().join(',')!=='patchDigest,sessionId,snapshotId'
          ||!plain(parent)||typeof parent.taskId!=='string'||typeof parent.operationId!=='string')fail();
        const key={taskId:parent.taskId,sessionId:input.sessionId,snapshotId:input.snapshotId,patchDigest:input.patchDigest};
        if(!validKey(key)||parent.operationId!==reviewFile(key).slice(0,-5)
          ||JSON.stringify(application.runtime.loadCheckpoint(parent.taskId,'coding-repair:review-preflight:'+parent.operationId))!==JSON.stringify(key)
          ||context.runId!=='host-tool-'+context.taskId||!current(key))fail();
        const deadline=Date.parse(context.deadline);if(!Number.isFinite(deadline))fail();
        pending.set(context.taskId,{...key,reviewerId:binding.reviewerId,authorId:binding.authorId,policyId:binding.policyId,
          publicKeyFingerprint:binding.fingerprint,recordFileName:reviewFile(key),deadline:context.deadline});
        notify();
        try{
          while(true){
            if(context.signal.aborted)throw new ProtocolError('CANCELLED','Independent review was cancelled');
            if(Date.now()>=deadline)throw new ProtocolError('TIMEOUT','Independent review deadline expired');
            if(!current(key))throw new ProtocolError('UNAUTHORIZED','Independent review configuration or task authorization changed');
            if(read(key)!==undefined)return await original.execute(input,context);
            await new Promise((resolve,reject)=>{
              const onAbort=()=>{clearTimeout(timer);reject(new ProtocolError('CANCELLED','Independent review was cancelled'));};
              const timer=setTimeout(()=>{context.signal.removeEventListener('abort',onAbort);resolve();},Math.min(1000,deadline-Date.now()));
              context.signal.addEventListener('abort',onAbort,{once:true});
              if(context.signal.aborted)onAbort();
            });
          }
        }finally{pending.delete(context.taskId);notify();}
      }}};
    },
    close(){generation=randomUUID();saved=undefined;encoded=undefined;},
  };
}
