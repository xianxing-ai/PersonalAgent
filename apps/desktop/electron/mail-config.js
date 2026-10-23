import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const valid = value => value && typeof value.user === 'string'
  && /^[A-Za-z0-9._+-]+@qq\.com$/i.test(value.user) && value.user.length <= 254
  && typeof value.authCode === 'string' && /^[A-Za-z0-9]{8,128}$/.test(value.authCode);
const mask = user => user ? `${user.slice(0, 1)}***@qq.com` : '';

/** Main-process only. Persist credentials, never persist the local read consent. */
export function createMailConfig({userData, safeStorage, namespace, question, now=Date.now, onRevoke = async () => {}, onCloudRevoke = async () => {}}) {
  const target = path.join(userData, 'mail-config.json');
  let saved, sessionAllowed = false, boundRevision, failure = '';
  let cloudGeneration;
  const batches=new Map(),hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const resource=()=>saved?hash({namespace,kind:'mail-local-batch',user:saved.user,revision:saved.revision}):undefined;
  const batchKey=batch=>JSON.stringify([batch.batchId,batch.generation]);
  const canRequest=()=>Boolean(question&&saved&&boundRevision===saved.revision&&namespace);
  const requireBatch=batch=>{
    const entry=batches.get(batchKey(batch));
    if(!entry||!entry.active||!canRequest()||entry.batchDigest!==hash(batch)||entry.resource!==resource()
      ||Date.parse(batch.deadline)<=now()||question.readResourceGeneration(entry.resource)!==entry.resourceGeneration)throw Error('本次邮箱批次授权已失效');
    return entry;
  };
  const requirePages=batch=>{const entry=requireBatch(batch);if(!entry.pagesActive)throw Error('本次邮箱批次分页已结束');return entry;};
  const batchAuthorization={
    canRequest,
    preparePage(scope,batch,parentScope) {
      if(!canRequest()||batch.accountRef!=='desktop-qq-inbox'||batch.folder!=='INBOX'||!Number.isSafeInteger(batch.limit)
        ||batch.limit<1||batch.limit>100||!Number.isFinite(Date.parse(batch.deadline))||scope.deadline!==batch.deadline||scope.signal.aborted
        ||typeof batch.batchId!=='string'||!batch.batchId||typeof batch.generation!=='string'||!batch.generation
        ||typeof batch.queryDigest!=='string'||!/^[a-f0-9]{64}$/u.test(batch.queryDigest))throw Error('邮箱批次原范围无效');
      const id=batchKey(batch),selected=resource();
      // Retain closed-batch tombstones until expiry so the same binding cannot be recreated.
      for(const [key,entry]of batches)if(Date.parse(entry.deadline)<=now())batches.delete(key);
      const entry=batches.get(id)??{active:true,pagesActive:true,batchDigest:hash(batch),resource:selected,
        resourceGeneration:question.readResourceGeneration(selected),deadline:batch.deadline};
      if(entry.batchDigest!==hash(batch)||entry.resource!==selected)throw Error('邮箱批次不能更换配置或查询');
      if(!entry.pagesActive)throw Error('本次邮箱批次分页已结束');
      batches.set(id,entry);requireBatch(batch);
      const ruleBindingDigest=hash({resource:selected,resourceGeneration:entry.resourceGeneration,
        folder:batch.folder,limit:batch.limit,queryDigest:batch.queryDigest,toolName:scope.toolName,toolVersion:scope.toolVersion});
      question.prepare(scope,{requirements:[{requirementId:'mail-local-batch',kind:'connector_session',scopes:['mail:read'],
        bindingDigest:hash({batch,resource:selected,resourceGeneration:entry.resourceGeneration,taskId:scope.taskId,runId:scope.runId}),
        ruleBindingDigest,summary:`本次手动批次：读取已配置邮箱的 INBOX 信头，在本机分类；每页最多 ${batch.limit} 条，总量未知；仅至 ${batch.deadline}，结束或取消即失效。不含正文、写信或云端分析。`}],
        assertCurrent:()=>{try{requireBatch(batch);return !scope.signal.aborted;}catch{return false;}}});
      if(parentScope)question.deriveMailBatch(parentScope,scope,{batchId:batch.batchId,requirementId:'mail-local-batch',
        assertCurrent:()=>{try{requireBatch(batch);return !scope.signal.aborted;}catch{return false;}}});
    },
    assertCurrent(batch){
      if(!batches.has(batchKey(batch))){if(!canRequest()||Date.parse(batch.deadline)<=now())throw Error('本次邮箱配置不可请求授权');return;}
      requireBatch(batch);
    },
    assertPage(scope,batch){requirePages(batch);question.currentRequirement(scope,'mail-local-batch');},
    // Existing execution receipts remain readable after pagination ends; this grants no new page execution.
    assertConsumed(scope,batch){requireBatch(batch);question.assertConsumedResult(scope,'mail-local-batch');},
    finishPages(batch){const entry=batches.get(batchKey(batch));if(entry)entry.pagesActive=false;},
    finish(batch){const entry=batches.get(batchKey(batch));if(entry){entry.active=false;entry.pagesActive=false;}},
  };
  if (existsSync(target)) {
    try {
      const data = JSON.parse(readFileSync(target, 'utf8'));
      if (data.version !== 1 || typeof data.encrypted !== 'string' || !safeStorage.isEncryptionAvailable()) throw Error();
      const value = JSON.parse(safeStorage.decryptString(Buffer.from(data.encrypted, 'base64')));
      if (!valid(value) || !Number.isSafeInteger(value.revision) || value.revision < 1) throw Error();
      saved = value;
    } catch {failure = '邮箱加密配置无法读取，请重新保存';}
  }
  const snapshot = () => ({account: mask(saved?.user), configured: Boolean(saved), sessionAllowed,
    cloudAnalysisAllowed: Boolean(cloudGeneration && sessionAllowed && boundRevision === saved?.revision),
    requiresRestart: Boolean(saved && boundRevision !== saved.revision), headersOnly: true,
    status: failure ? 'unavailable' : sessionAllowed ? 'enabled' : saved ? 'disabled' : 'unconfigured',
    reason: failure || (sessionAllowed ? '允许本会话整批收件箱信头本地分类；不会发送或修改邮件'
      : '读取许可不会跨应用重启恢复')});
  const revoke = async () => {
    sessionAllowed = false;
    cloudGeneration = undefined;
    for(const entry of batches.values())entry.active=false;
    const resources=new Set([...batches.values()].map(entry=>entry.resource));
    if(question&&boundRevision!==undefined&&resource())resources.add(resource());
    await onCloudRevoke();
    await onRevoke();
    if(question)for(const id of resources){const previous=question.readResourceGeneration(id);question.rotateResourceGeneration(id,previous);}
    return snapshot();
  };
  return Object.freeze({
    snapshot,
    ...(question?{batchAuthorization}:{}),
    current: () => saved ? {...saved} : undefined,
    cloudLease: () => sessionAllowed && boundRevision === saved?.revision ? cloudGeneration : undefined,
    enableCloudAnalysis(input) {
      if(question)throw Error('请在当前对话提问卡确认本次邮件分析与出机范围');
      if (!saved || !sessionAllowed || boundRevision !== saved.revision || input?.cloudAnalysisConsent !== true
        || Object.keys(input).some(key => key !== 'cloudAnalysisConsent')) throw Error('请先启用本地分类，并单独允许将待分析信头发送到 AgentArts');
      cloudGeneration ??= randomUUID();
      return snapshot();
    },
    async revokeCloudAnalysis() {
      cloudGeneration = undefined;
      await onCloudRevoke();
      return snapshot();
    },
    canRequestReadAuthorization:revision=>Boolean(question?.prepare&&saved&&saved.revision===revision&&boundRevision===revision),
    isSessionAllowed(revision,scope) {
      if(saved?.revision!==revision||boundRevision!==revision)return false;
      if(!question)return sessionAllowed;
      if(!scope)return false;
      try{return question.currentRequirement(scope,'mail-local-batch')===true;}catch{return false;}
    },
    markBound(revision) {
      if (!saved || revision !== saved.revision) throw Error('邮箱装配版本不匹配');
      boundRevision = revision;
    },
    async configure(input) {
      if (!input || Object.keys(input).some(key => !['user', 'authCode', 'readConsent'].includes(key))
        ||input.readConsent!==undefined&&typeof input.readConsent!=='boolean')throw Error('邮箱配置格式无效');
      const user = typeof input.user === 'string' ? input.user.trim().toLowerCase() : '';
      const value = {user, authCode: input.authCode || (user === saved?.user ? saved.authCode : ''),
        revision: (saved?.revision ?? 0) + 1};
      if (!valid(value)) throw Error('请填写 QQ 邮箱地址和 IMAP 授权码');
      if (!safeStorage.isEncryptionAvailable()) throw Error('本机安全存储不可用，未保存邮箱配置');
      const encrypted = safeStorage.encryptString(JSON.stringify(value)).toString('base64');
      await revoke();
      try {
        mkdirSync(userData, {recursive: true});
        const temporary = `${target}.tmp-${process.pid}`;
        writeFileSync(temporary, JSON.stringify({version: 1, encrypted}), 'utf8');
        renameSync(temporary, target);
      } catch {throw Error('邮箱加密配置保存失败');}
      saved = value; failure = ''; sessionAllowed = false;
      return snapshot();
    },
    enableSession(input) {
      if(question)throw Error('请在当前对话提问卡确认本次邮箱访问');
      if (!saved || !input || Object.keys(input).some(key => key !== 'readConsent') || input.readConsent !== true) {
        throw Error('请确认本会话收件箱信头读取和本地分类用途');
      }
      sessionAllowed = true;
      return snapshot();
    },
    revoke,
  });
}
