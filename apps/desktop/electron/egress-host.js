import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';

const fail=(code='UNAUTHORIZED',message='本次出机内容未通过本机分类与原范围确认')=>{throw new ProtocolError(code,message);};
const digest=value=>createHash('sha256').update(value).digest('hex');
const secretField=/^(?:password|passwd|api[_-]?key|secret(?:[_-]?key)?|access[_-]?token|refresh[_-]?token|authorization|private[_-]?key|verification[_-]?code|otp|密码|口令|验证码|私钥)$/iu;
const piiField=/^(?:full[_-]?name|first[_-]?name|last[_-]?name|phone|mobile|email|postal[_-]?address|home[_-]?address|passport|id[_-]?number|bank[_-]?account|credit[_-]?card|姓名|电话|手机|邮箱|住址|证件号|精确位置|健康信息|金融标识)$/iu;
const secretText=/(?:-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9_-]{16,}|\bBearer\s+[A-Za-z0-9_.~+/-]{8,}|(?:password|passwd|api[_ -]?key|secret[_ -]?key|access[_ -]?token|密码|口令|验证码)\s*[:=]\s*["']?[^\s"',;}]{3,})/iu;
const piiText=/(?:[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}|(?<!\d)1[3-9]\d{9}(?!\d)|(?<!\d)[1-9]\d{16}[\dX](?!\d))/iu;

function classifySecretCategory(hint) {
  if(/-----BEGIN|private|私钥/iu.test(hint))return '私钥';
  if(/password|passwd|密码|口令/iu.test(hint))return '密码/口令';
  if(/verification|otp|验证码/iu.test(hint))return '验证码';
  return '密钥/令牌';
}

/** Collect safe Chinese categories and SHA-256 secret fingerprints without returning raw secret values. */
export function extractSecretDetections(payload) {
  if(typeof payload!=='string'||Buffer.byteLength(payload,'utf8')>2*1024*1024)return {categories:[],fingerprints:[]};
  const categories=new Set(),fingerprints=new Set();
  const inspect=(value,depth=0)=>{
    if(depth>24)return;
    if(typeof value==='string'){
      const globalSecret=new RegExp(secretText.source,'giu');
      for(const match of value.matchAll(globalSecret)){
        categories.add(classifySecretCategory(match[0]));
        fingerprints.add(digest('text:'+match[0].trim()));
      }
      try{
        const decoded=JSON.parse(value);
        if(decoded!==value)inspect(decoded,depth+1);
      }catch{}
      return;
    }
    if(Array.isArray(value)){for(const item of value)inspect(item,depth+1);return;}
    if(value&&typeof value==='object'){
      for(const [key,item] of Object.entries(value)){
        if(item!==null&&item!==undefined&&typeof item!=='object'&&String(item).trim()!==''&&secretField.test(key)){
          categories.add(classifySecretCategory(key));
          fingerprints.add(digest('field:'+key.toLowerCase()+':'+String(item).trim()));
        }
        inspect(item,depth+1);
      }
    }
  };
  inspect(payload);
  if(fingerprints.size===0&&classifyEgressSensitivity(payload)==='secret'){
    categories.add('密钥/凭据');
    fingerprints.add(digest('payload:'+digest(payload)));
  }
  return {categories:[...categories],fingerprints:[...fingerprints].sort()};
}

const pemPrivateKeyBlock=/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|$)/giu;

/** Redact detected secret substrings/fields while leaving safe surrounding context visible for user confirmation. */
export function redactSecretPreview(payload,maxLength=2000) {
  if(typeof payload!=='string')return '';
  const globalPem=()=>new RegExp(pemPrivateKeyBlock.source,'giu');
  const globalSecret=()=>new RegExp(secretText.source,'giu');
  const scrubString=text=>{
    try{
      const decoded=JSON.parse(text);
      if(decoded&&typeof decoded==='object')return JSON.stringify(scrub(decoded));
    }catch{}
    return text.replace(globalPem(),'[已脱敏凭据]').replace(globalSecret(),'[已脱敏凭据]');
  };
  const scrub=(value,depth=0)=>{
    if(depth>16)return '[嵌套过深，内容已整体遮蔽]';
    if(typeof value==='string')return scrubString(value);
    if(Array.isArray(value))return value.map(item=>scrub(item,depth+1));
    if(value&&typeof value==='object'){
      const copy={};
      for(const [key,item] of Object.entries(value)){
        if(item!==null&&item!==undefined&&typeof item!=='object'&&String(item).trim()!==''&&secretField.test(key))copy[key]='[已脱敏凭据]';
        else copy[key]=scrub(item,depth+1);
      }
      return copy;
    }
    return value;
  };
  let rendered;
  try{
    const parsed=JSON.parse(payload);
    rendered=JSON.stringify(scrub(parsed),null,2);
  }catch{
    rendered=scrubString(payload);
  }
  if(new RegExp(secretText.source,'iu').test(rendered)||new RegExp(pemPrivateKeyBlock.source,'iu').test(rendered)){
    return '[内容包含未完全脱敏凭据，预览已整体遮蔽]';
  }
  return rendered.length>maxLength?`${rendered.slice(0,maxLength)}\n…（内容共 ${rendered.length} 字符，已截断预览）`:rendered;
}

function classifyPiiCategory(hint) {
  if (hint.includes('@') || /email|邮箱/iu.test(hint)) return '邮箱地址';
  if (/^1[3-9]\d{9}$/u.test(hint) || /phone|mobile|电话|手机/iu.test(hint)) return '手机号码';
  if (/^[1-9]\d{16}[\dX]$/iu.test(hint) || /passport|id[_-]?number|证件号/iu.test(hint)) return '证件号码';
  return '个人敏感信息';
}

/** Collect safe Chinese PII categories and SHA-256 fingerprints without returning raw PII values. */
export function extractPiiDetections(payload) {
  if (typeof payload !== 'string' || Buffer.byteLength(payload, 'utf8') > 2 * 1024 * 1024) return {categories: [], fingerprints: []};
  const categories = new Set(), fingerprints = new Set();
  const inspect = (value, depth = 0) => {
    if (depth > 24) return;
    if (typeof value === 'string') {
      const globalPii = new RegExp(piiText.source, 'giu');
      for (const match of value.matchAll(globalPii)) {
        const normalized = match[0].trim().toLowerCase();
        categories.add(classifyPiiCategory(normalized));
        fingerprints.add(digest('pii-text:' + normalized));
      }
      try {
        const decoded = JSON.parse(value);
        if (decoded !== value) inspect(decoded, depth + 1);
      } catch {}
      return;
    }
    if (Array.isArray(value)) { for (const item of value) inspect(item, depth + 1); return; }
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (item !== null && item !== undefined && typeof item !== 'object' && String(item).trim() !== '' && piiField.test(key)) {
          categories.add(classifyPiiCategory(key));
          fingerprints.add(digest('pii-field:' + key.toLowerCase() + ':' + String(item).trim().toLowerCase()));
        }
        inspect(item, depth + 1);
      }
    }
  };
  inspect(payload);
  if (fingerprints.size === 0 && classifyEgressSensitivity(payload) === 'pii') {
    categories.add('个人敏感信息');
    fingerprints.add(digest('pii-payload:' + digest(payload)));
  }
  return {categories: [...categories], fingerprints: [...fingerprints].sort()};
}

/** Mask detected PII/secret substrings for safe in-conversation preview. */
export function redactPiiPreview(payload, maxLength = 2000) {
  if (typeof payload !== 'string') return '';
  const globalPem = () => new RegExp(pemPrivateKeyBlock.source, 'giu');
  const globalSecret = () => new RegExp(secretText.source, 'giu');
  const globalPii = () => new RegExp(piiText.source, 'giu');
  const scrubString = text => {
    try {
      const decoded = JSON.parse(text);
      if (decoded && typeof decoded === 'object') return JSON.stringify(scrub(decoded));
    } catch {}
    return text.replace(globalPem(), '[已脱敏凭据]').replace(globalSecret(), '[已脱敏凭据]').replace(globalPii(), match => {
      if (match.includes('@')) {
        const [local, domain] = match.split('@');
        return `${local.slice(0, 2)}***@${domain}`;
      }
      return `${match.slice(0, 3)}****${match.slice(-2)}`;
    });
  };
  const scrub = (value, depth = 0) => {
    if (depth > 16) return '[嵌套过深，内容已整体遮蔽]';
    if (typeof value === 'string') return scrubString(value);
    if (Array.isArray(value)) return value.map(item => scrub(item, depth + 1));
    if (value && typeof value === 'object') {
      const copy = {};
      for (const [key, item] of Object.entries(value)) {
        if (item !== null && item !== undefined && typeof item !== 'object' && String(item).trim() !== '' && secretField.test(key)) copy[key] = '[已脱敏凭据]';
        else if (item !== null && item !== undefined && typeof item !== 'object' && String(item).trim() !== '' && piiField.test(key)) copy[key] = '[已脱敏个人信息]';
        else copy[key] = scrub(item, depth + 1);
      }
      return copy;
    }
    return value;
  };
  let rendered;
  try {
    const parsed = JSON.parse(payload);
    rendered = JSON.stringify(scrub(parsed), null, 2);
  } catch {
    rendered = scrubString(payload);
  }
  if (new RegExp(secretText.source, 'iu').test(rendered) || new RegExp(pemPrivateKeyBlock.source, 'iu').test(rendered)) {
    return '[内容包含未完全脱敏凭据，预览已整体遮蔽]';
  }
  return rendered.length > maxLength ? `${rendered.slice(0, maxLength)}\n…（内容共 ${rendered.length} 字符，已截断预览）` : rendered;
}

/** Positive detections only. Returns 'secret', 'pii', or 'unknown'. */
export function classifyEgressSensitivity(payload) {
  if(typeof payload!=='string'||Buffer.byteLength(payload,'utf8')>2*1024*1024)fail('INVALID_ARGUMENT','出机内容超出限制或格式无效');
  const inspect=(value,depth=0)=>{
    if(depth>24)fail('INVALID_ARGUMENT','出机内容嵌套层级过深');
    if(typeof value==='string'){
      if(/data:(?:image|audio|video)\/[a-z0-9.+-]+;base64,/iu.test(value))fail('UNSUPPORTED_CAPABILITY','媒体或二进制内容暂不支持通过当前文本出机门禁发送');
      if(secretText.test(value))return 'secret';
      let result=piiText.test(value)?'pii':'unknown';
      try {
        const decoded=JSON.parse(value);
        if(decoded!==value){
          const nested=inspect(decoded,depth+1);
          if(nested==='secret')return 'secret';
          if(nested==='pii')result='pii';
        }
      }catch(error){if(error?.code)throw error;}
      return result;
    }
    if(Array.isArray(value)){
      let result='unknown';
      for(const item of value){
        const nested=inspect(item,depth+1);
        if(nested==='secret')return 'secret';
        if(nested==='pii')result='pii';
      }
      return result;
    }
    if(value&&typeof value==='object'){
      let result='unknown';
      for(const [key,item] of Object.entries(value)){
        if((['dataBase64','audio','image_url'].includes(key)&&typeof item==='string'&&item)
          ||key==='image_url'&&item&&typeof item.url==='string')fail('UNSUPPORTED_CAPABILITY','媒体或二进制内容暂不支持通过当前文本出机门禁发送');
        if(item!==null&&typeof item!=='object'&&String(item).trim()!==''){
          if(secretField.test(key))return 'secret';
          if(piiField.test(key))result='pii';
        }
        const nested=inspect(item,depth+1);
        if(nested==='secret')return 'secret';
        if(nested==='pii')result='pii';
      }
      return result;
    }
    return 'unknown';
  };
  return inspect(payload);
}

/** Positive detections only. A miss is unknown, never evidence that free text is public. */
export function classifyKnownEgressContent(payload) {
  return classifyEgressSensitivity(payload)==='unknown'?'unknown':'forbidden';
}

// The image serializes two JSON envelopes inside the platform query. Only classify
// a projection when all three layers are losslessly parsed and the local graph
// holds these exact receipts for this send. Business results stay in the scan.
function classifyWorkflowReceipts(scope,readGraph) {
  function object(text) {
    if(typeof text!=='string')return;
    const value=JSON.parse(text);
    if(value&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(value)===text)return value;
  }
  try {
    const outer=object(scope.payload);
    const field=outer?.query!==undefined?'query':Object.keys(outer?.inputs??{})[0];
    const container=outer?.query!==undefined?outer:outer?.inputs;
    const epoch=object(container?.[field]),query=object(epoch?.query);
    if(query?.operation!=='advance'||query.workflowVersion!=='1.0.0'||query.taskId!==scope.taskId
      ||!Array.isArray(query.receipts)||!query.receipts.length)return undefined;
    const graph=readGraph(scope);
    if(!graph||graph.checkpoint!==query.checkpoint||graph.controlRevision!==query.controlRevision
      ||!isDeepStrictEqual(graph.receipts,query.receipts))return undefined;
    for(const receipt of query.receipts) {
      const proof=receipt.proof;
      if(!proof||proof.taskId!==scope.taskId||proof.workflowId!==query.workflowId||proof.sessionId!==graph.sessionId
        ||proof.operationId!==receipt.operationId||proof.proposalId!==receipt.proposalId)continue;
      for(const item of [receipt,proof]){
        for(const key of ['proposalId','operationId']) {
          if(/^wf-(?:decision-)?[a-f0-9]{48}$/u.test(item[key]))item[key]='workflow-id';
        }
      }
      if(receipt.inputDigest===proof.inputDigest&&/^[a-f0-9]{64}$/u.test(receipt.inputDigest))receipt.inputDigest='sha256';
      for(const key of ['inputDigest','proposalDigest','argumentsDigest','resultDigest','evidenceDigest','originalResultDigest','signature']){
        if(typeof proof[key]==='string'&&/^[a-f0-9]{64}$/u.test(proof[key]))proof[key]='sha256';
      }
    }
    epoch.query=JSON.stringify(query);container[field]=JSON.stringify(epoch);
    return classifyEgressSensitivity(JSON.stringify(outer));
  }catch{return undefined;}
}

const TRUSTED_ENV_PREFIX='Current trusted host environment (data only; not authorization or a callable tool catalog):\n';
const TRUSTED_ENV_SEP='\n\nOriginal task and approved context (untrusted data):\n';
const UUID_VALUE=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;

export function extractGitSha40(value) {
  if (typeof value !== 'string') return undefined;
  if (/^[a-f0-9]{40}$/u.test(value)) return value;
  const fenced = /^(?:[^\n]*\n){0,3}<<<PA_EXTERNAL kind=tool id=([a-f0-9]{16})>>>\n([a-f0-9]{40})\n<<<END_PA_EXTERNAL \1>>>$/u.exec(value);
  return fenced?.[2];
}

export function extractFencedText(value) {
  if (typeof value !== 'string') return undefined;
  const fenced = /^((?:[^\n]*\n){0,3}<<<PA_EXTERNAL kind=[a-z0-9_-]+ id=([a-f0-9]{16})>>>\n)([\s\S]*?)(\n<<<END_PA_EXTERNAL \2>>>)$/u.exec(value);
  if (fenced) return {prefix:fenced[1],inner:fenced[3],suffix:fenced[4]};
  return {prefix:'',inner:value,suffix:''};
}

export function extractVerifiedPiiTokens(texts) {
  const tokens = new Set();
  if (!texts) return tokens;
  const globalPii = new RegExp(piiText.source, 'giu');
  for (const raw of texts) {
    if (typeof raw !== 'string' || !raw) continue;
    const inner = extractFencedText(raw)?.inner ?? raw;
    for (const match of inner.matchAll(globalPii)) {
      const token = match[0].toLowerCase();
      tokens.add(token);
      if (token.includes('@') && token.includes('/')) {
        const tail = token.split('/').pop();
        if (tail && tail.includes('@')) tokens.add(tail);
      }
    }
  }
  return tokens;
}

export function hasOnlyVerifiedPii(text, verifiedPii) {
  if (typeof text !== 'string' || !text || !verifiedPii?.size) return false;
  const inner = extractFencedText(text)?.inner ?? text;
  const matches = [...inner.matchAll(new RegExp(piiText.source, 'giu'))];
  return matches.length > 0 && matches.every(m => verifiedPii.has(m[0].toLowerCase()));
}

const COMPETITION_FOOTER = /\n\[profile=huawei_ict_agentarts; verification=(?:mock|unverified)\]$/u;

export function stripTrustedResultMetadata(value) {
  return typeof value === 'string' ? value.replace(COMPETITION_FOOTER, '') : value;
}

function normalizeTrustedConnectorTexts(rawTexts) {
  if (!rawTexts) return undefined;
  const normalized = new Set();
  for (const item of rawTexts) {
    if (typeof item !== 'string' || !item) continue;
    normalized.add(item);
    const inner = extractFencedText(item)?.inner;
    if (inner) {
      normalized.add(inner);
      const stripped = stripTrustedResultMetadata(inner);
      if (stripped) normalized.add(stripped);
    }
    const itemStripped = stripTrustedResultMetadata(item);
    if (itemStripped) normalized.add(itemStripped);
  }
  return normalized;
}

function classifyTrustedTaskEnvelope(scope,isTrustedIdentifier,readTrustedGitHubShas,readTrustedConnectorOutputs) {
  function object(text) {
    if(typeof text!=='string')return;
    const value=JSON.parse(text);
    if(value&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(value)===text)return value;
  }
  const assistantPiiCache=new Map();
  const readAssistantAllowedPii=msgTaskId=>{
    if(assistantPiiCache.has(msgTaskId))return assistantPiiCache.get(msgTaskId);
    const tokens=typeof readTrustedConnectorOutputs==='function'
      ?extractVerifiedPiiTokens(readTrustedConnectorOutputs(msgTaskId))
      :new Set();
    assistantPiiCache.set(msgTaskId,tokens);
    return tokens;
  };
  const sanitizeId=id=>{
    if(typeof id!=='string')return id;
    if(UUID_VALUE.test(id)&&isTrustedIdentifier(id)===true)return 'trusted-id';
    let match=/^(task|turn):([a-f0-9-]{36})(:(?:user|assistant))?$/iu.exec(id);
    if(match&&isTrustedIdentifier(match[2])===true)return `${match[1]}:trusted-id${match[3]??''}`;
    match=/^([a-f0-9-]{36}):(user|assistant)$/iu.exec(id);
    if(match&&isTrustedIdentifier(match[1])===true)return `trusted-id:${match[2]}`;
    match=/^(conversation-prohibition|pending-confirmation):([a-f0-9-]{36}):(\d+)$/iu.exec(id);
    if(match&&isTrustedIdentifier(match[2])===true)return `${match[1]}:trusted-id:${match[3]}`;
    match=/^(execution-conflict):([a-f0-9]{64}|[a-f0-9-]{36}):(true|false)$/iu.exec(id);
    if(match&&isTrustedIdentifier(match[2])===true)return `${match[1]}:trusted-id:${match[3]}`;
    return id;
  };
  const sanitizeCompiledJson=text=>{
    let obj;try{obj=object(text);}catch{return undefined;}
    if(!obj||obj.conversationContext?.treatment!=='untrusted_data'||!Array.isArray(obj.conversationContext.messages))return undefined;
    for(const msg of obj.conversationContext.messages){
      if(!msg||typeof msg!=='object')continue;
      const msgTaskId=msg.taskId;
      if(typeof msgTaskId==='string'&&UUID_VALUE.test(msgTaskId)&&typeof isTrustedIdentifier==='function'&&isTrustedIdentifier(msgTaskId)===true){
        if(msg.role==='assistant'&&typeof msg.content==='string'&&typeof readTrustedConnectorOutputs==='function'){
          const allowedPii=readAssistantAllowedPii(msgTaskId);
          if(allowedPii.size>0){
            msg.content=msg.content.replace(new RegExp(piiText.source,'giu'),match=>
              allowedPii.has(match.toLowerCase())?'[verified-pii]':match);
          }
        }
        msg.taskId='trusted-id';
      }
      if(typeof msg.id==='string')msg.id=sanitizeId(msg.id);
    }
    if(Array.isArray(obj.conversationContext.selection?.omittedAssistantIds)){
      obj.conversationContext.selection.omittedAssistantIds=obj.conversationContext.selection.omittedAssistantIds.map(sanitizeId);
    }
    return JSON.stringify(obj);
  };
  const sanitizeGoal=value=>{
    if(typeof value!=='string')return value;
    if(value.startsWith(TRUSTED_ENV_PREFIX)){
      const sepIndex=value.indexOf(TRUSTED_ENV_SEP,TRUSTED_ENV_PREFIX.length);
      if(sepIndex<0)return value;
      const envRaw=value.slice(TRUSTED_ENV_PREFIX.length,sepIndex);
      const envSanitized=envRaw.split('\n').map(line=>{
        try{
          const lineObj=object(line);
          if(!lineObj)return line;
          const progress=lineObj.capabilityStatus?.executionProgress;
          if(progress&&typeof progress.nextProposalId==='string'&&/^proposal-[a-f0-9-]{36}$/iu.test(progress.nextProposalId)){
            progress.nextProposalId='proposal-trusted-id';
          }
          return JSON.stringify(lineObj);
        }catch{return line;}
      }).join('\n');
      let rest=value.slice(sepIndex+TRUSTED_ENV_SEP.length);
      if(rest.startsWith('{')){
        const tailIndex=rest.indexOf('\n\n');
        const jsonPart=tailIndex>=0?rest.slice(0,tailIndex):rest;
        const tailPart=tailIndex>=0?rest.slice(tailIndex):'';
        const sanitized=sanitizeCompiledJson(jsonPart);
        if(sanitized!==undefined)rest=sanitized+tailPart;
      }
      return TRUSTED_ENV_PREFIX+envSanitized+TRUSTED_ENV_SEP+rest;
    }
    return sanitizeCompiledJson(value)??value;
  };
  const sanitizeGitHubShas=(value,trustedShas,key='',depth=0)=>{
    if(!trustedShas?.size||depth>10||value==null)return value;
    if(typeof value==='string'){
      if(!['sha','headSha','baseSha'].includes(key))return value;
      const hex=extractGitSha40(value);
      return hex&&trustedShas.has(hex)?value.replace(hex,'git-sha1'):value;
    }
    if(Array.isArray(value))return value.map(item=>sanitizeGitHubShas(item,trustedShas,'',depth+1));
    if(typeof value==='object'){
      for(const [k,v]of Object.entries(value))value[k]=sanitizeGitHubShas(v,trustedShas,k,depth+1);
    }
    return value;
  };
  const sanitizeTrustedConnectorPii=(value,trustedTexts,depth=0)=>{
    if(!trustedTexts?.size||depth>10||value==null)return value;
    if(typeof value==='string'){
      const parts=extractFencedText(value);
      if(!parts||(!trustedTexts.has(parts.inner)&&!trustedTexts.has(value)))return value;
      // Only mask PII (emails/phones/IDs) inside verified connector outputs; never mask secret patterns.
      const masked=parts.inner.replace(new RegExp(piiText.source,'giu'),'[verified-pii]');
      return parts.prefix+masked+parts.suffix;
    }
    if(Array.isArray(value))return value.map(item=>sanitizeTrustedConnectorPii(item,trustedTexts,depth+1));
    if(typeof value==='object'){
      for(const [k,v]of Object.entries(value))value[k]=sanitizeTrustedConnectorPii(v,trustedTexts,depth+1);
    }
    return value;
  };
  try{
    if(typeof isTrustedIdentifier!=='function'&&typeof readTrustedGitHubShas!=='function'&&typeof readTrustedConnectorOutputs!=='function')return undefined;
    const trustedShas=scope.taskId&&typeof readTrustedGitHubShas==='function'?readTrustedGitHubShas(scope.taskId):undefined;
    const trustedConnectorTexts=scope.taskId&&typeof readTrustedConnectorOutputs==='function'
      ?normalizeTrustedConnectorTexts(readTrustedConnectorOutputs(scope.taskId))
      :undefined;
    const outer=object(scope.payload);
    const field=outer?.query!==undefined?'query':Object.keys(outer?.inputs??{})[0];
    const container=outer?.query!==undefined?outer:outer?.inputs;
    const rawEpoch=object(container?.[field]);
    const isEpochWrapper=rawEpoch&&rawEpoch.executionEpochVersion===1&&Number.isSafeInteger(rawEpoch.executionEpoch)
      &&typeof rawEpoch.query==='string'&&Object.keys(rawEpoch).sort().join(',')==='executionEpoch,executionEpochVersion,query';
    const inner=isEpochWrapper?object(rawEpoch.query):rawEpoch;
    if(!inner)return undefined;
    if(typeof inner.goal==='string'&&typeof isTrustedIdentifier==='function')inner.goal=sanitizeGoal(inner.goal);
    if(typeof inner.continuation?.result?.userRequest==='string'&&typeof isTrustedIdentifier==='function'){
      inner.continuation.result.userRequest=sanitizeGoal(inner.continuation.result.userRequest);
    }
    if(typeof inner.continuation?.result?.catalogRef==='string'&&/^[a-f0-9]{64}$/u.test(inner.continuation.result.catalogRef)){
      inner.continuation.result.catalogRef='sha256';
    }
    if(inner.continuation?.result&&trustedShas?.size)sanitizeGitHubShas(inner.continuation.result,trustedShas);
    if(inner.continuation?.result&&trustedConnectorTexts?.size)sanitizeTrustedConnectorPii(inner.continuation.result,trustedConnectorTexts);
    if(Array.isArray(inner.priorContinuations)){
      for(const prior of inner.priorContinuations){
        if(typeof prior?.result?.userRequest==='string'&&typeof isTrustedIdentifier==='function')prior.result.userRequest=sanitizeGoal(prior.result.userRequest);
        if(typeof prior?.result?.catalogRef==='string'&&/^[a-f0-9]{64}$/u.test(prior.result.catalogRef))prior.result.catalogRef='sha256';
        if(prior?.result&&trustedShas?.size)sanitizeGitHubShas(prior.result,trustedShas);
        if(prior?.result&&trustedConnectorTexts?.size)sanitizeTrustedConnectorPii(prior.result,trustedConnectorTexts);
      }
    }
    if(isEpochWrapper){
      rawEpoch.query=JSON.stringify(inner);
      container[field]=JSON.stringify(rawEpoch);
    }else{
      container[field]=JSON.stringify(inner);
    }
    const sanitizedPayload=JSON.stringify(outer);
    return {sensitivity:classifyEgressSensitivity(sanitizedPayload),sanitizedPayload};
  }catch{return undefined;}
}

/** Main-only callbacks approve the exact content before the transport may send it. */
export function createDesktopEgressHost({classifyLocally,approvePrivate,authorizeTaskEgress,authorizeSecretEgress,authorizePiiEgress,readPendingWorkflowGraph,isTrustedIdentifier,readTrustedGitHubShas,readTrustedConnectorOutputs,readEgressPolicy,now=Date.now}={}) {
  let closed=false;const decisions=new Map();
  const resolvePolicyMode=()=>{
    if(typeof readEgressPolicy!=='function')return 'ask';
    try{
      const raw=readEgressPolicy();
      const mode=typeof raw==='string'?raw:raw?.mode;
      return mode==='full-access'||mode==='auto-standard'||mode==='ask'?mode:'ask';
    }catch{return 'ask';}
  };
  return {
    async prepare(input) {
      const {taskId,requestId,destination,payload,deadline,signal,isCurrent}=input??{};
      let url;try{url=new URL(destination);}catch{fail('INVALID_ARGUMENT');}
      if(typeof requestId!=='string'||!requestId||requestId.length>512||typeof destination!=='string'
        ||taskId!==undefined&&(typeof taskId!=='string'||!taskId.trim()||taskId.length>512)
        ||!['https:','wss:','ssh:'].includes(url.protocol)||url.password||url.hash
        ||(url.protocol==='ssh:'?!url.username||url.pathname!=='/'&&url.pathname!==''||Boolean(url.search):Boolean(url.username))
        ||typeof payload!=='string'||typeof deadline!=='string'||!Number.isFinite(Date.parse(deadline))||!signal
        ||typeof signal.addEventListener!=='function'||typeof isCurrent!=='function')fail('INVALID_ARGUMENT');
      const payloadDigest=digest(payload),current=()=>{
        if(closed||signal.aborted)fail('CANCELLED');
        if(now()>=Date.parse(deadline))fail('TIMEOUT');
        let active;try{active=isCurrent();}catch{fail();}
        if(active&&typeof active.then==='function'){void Promise.resolve(active).catch(()=>{});fail();}
        if(input.taskId!==taskId||input.requestId!==requestId||input.destination!==destination||input.payload!==payload||input.deadline!==deadline
          ||input.signal!==signal||active!==true)fail();
      };
      current();
      const rawSensitivity=classifyEgressSensitivity(payload);
      let effectiveSanitizedPayload=payload;
      const resolveEffectiveSensitivity=()=>{
        effectiveSanitizedPayload=payload;
        if(rawSensitivity==='unknown')return 'unknown';
        let effective=rawSensitivity;
        if(taskId&&readPendingWorkflowGraph){
          const receiptSensitivity=classifyWorkflowReceipts(input,readPendingWorkflowGraph);
          if(receiptSensitivity!==undefined)effective=receiptSensitivity;
        }
        if(effective!=='unknown'&&(isTrustedIdentifier||readTrustedGitHubShas||readTrustedConnectorOutputs)){
          const envelopeResult=classifyTrustedTaskEnvelope(input,isTrustedIdentifier,readTrustedGitHubShas,readTrustedConnectorOutputs);
          if(envelopeResult!==undefined){
            effective=envelopeResult.sensitivity;
            effectiveSanitizedPayload=envelopeResult.sanitizedPayload;
          }
        }
        return effective;
      };
      const assertSensitivityAllowed=({secretApproved=false,piiApproved=false}={})=>{
        const effective=resolveEffectiveSensitivity();
        if(effective==='unknown')return 'unknown';
        if(effective==='secret'){
          if(secretApproved===true)return 'secret';
          if(typeof authorizeSecretEgress!=='function')fail('UNAUTHORIZED','检测到疑似密钥、口令或令牌信息，已阻止出机发送（不会发往云端）');
          return 'secret_needs_approval';
        }
        if(effective==='pii'){
          if(resolvePolicyMode()==='full-access'||piiApproved===true)return 'pii';
          if(typeof authorizePiiEgress==='function')return 'pii_needs_approval';
          fail('UNAUTHORIZED','检测到疑似个人敏感信息（如邮箱、手机号或证件号），已阻止出机发送；如需在完全信任模式下发送，可切换为「完全访问」或先脱敏');
        }
        fail();
      };
      const initialCheck=assertSensitivityAllowed();
      const key=JSON.stringify([requestId,destination,deadline]);
      for(const [id,value] of decisions)if(value.signal.aborted||value.expiresAt<=now())decisions.delete(id);
      const previous=decisions.get(key);
      if(previous&&(previous.taskId!==taskId||previous.signal!==signal||previous.payloadDigest!==payloadDigest))fail();
      if(previous){previous.guards.add(current);for(const guard of previous.guards)guard();return previous.promise;}
      if(decisions.size>=256)fail('UNSUPPORTED_CAPABILITY');
      const guards=new Set([current]),assertCurrent=()=>{for(const guard of guards)guard();};
      const scope=Object.freeze({...(taskId===undefined?{}:{taskId}),requestId,destination,payload,payloadDigest,deadline,signal,
        isCurrent:()=>{assertCurrent();return true;}});
      const wait=async(callback,callScope=scope)=>{
        assertCurrent();if(typeof callback!=='function')fail();
        let timer,onAbort;
        try{return await Promise.race([Promise.resolve().then(()=>{assertCurrent();return callback(callScope);}),new Promise((resolve,reject)=>{
          const rejectWith=code=>reject(Object.assign(new Error('本次本机出机确认已失效'),{code}));
          onAbort=()=>rejectWith('CANCELLED');signal.addEventListener('abort',onAbort,{once:true});
          timer=setTimeout(()=>rejectWith('TIMEOUT'),Math.min(2147483647,Math.max(1,Date.parse(deadline)-now())));
          if(signal.aborted)onAbort();
        })]);}catch(error){
          if(['CANCELLED','TIMEOUT'].includes(error?.code))fail(error.code);
          fail('UNAUTHORIZED',error?.code==='UNAUTHORIZED'&&typeof error.message==='string'?error.message:undefined);
        }
        finally{clearTimeout(timer);if(onAbort)signal.removeEventListener('abort',onAbort);}
      };
      const entry={taskId,signal,payloadDigest,guards,expiresAt:Date.parse(deadline)};decisions.set(key,entry);
      entry.promise=(async()=>{
        try{
          let classification='private',secretApproved=false,piiApproved=false;
          if(initialCheck==='secret_needs_approval'){
            const secretScope=Object.freeze({...scope,sensitivity:'secret',
              secretDetections:extractSecretDetections(payload),
              redactedPreview:redactSecretPreview(payload)});
            if(await wait(authorizeSecretEgress,secretScope)!==true){
              fail('UNAUTHORIZED','检测到疑似密钥、口令或令牌信息，用户已拒绝或未确认出机发送');
            }
            secretApproved=true;
            classification='private';
          } else if(initialCheck==='pii_needs_approval'){
            const piiScope=Object.freeze({...scope,sensitivity:'pii',
              piiDetections:extractPiiDetections(effectiveSanitizedPayload),
              redactedPreview:redactPiiPreview(effectiveSanitizedPayload)});
            if(await wait(authorizePiiEgress,piiScope)!==true){
              fail('UNAUTHORIZED','检测到疑似个人敏感信息（如邮箱、手机号或证件号），用户已拒绝或未确认出机发送');
            }
            piiApproved=true;
            classification='private';
          } else {
            const mode=resolvePolicyMode();
            if(mode==='full-access'||mode==='auto-standard'){
              assertCurrent();
              assertSensitivityAllowed();
              classification='public';
            } else if(taskId!==undefined) {
              if(await wait(authorizeTaskEgress)!==true)fail();
            } else {
              classification=await wait(classifyLocally);assertCurrent();
              if(!['public','private'].includes(classification))fail();
              if(classification==='private'&&await wait(approvePrivate)!==true)fail();
            }
          }
          assertCurrent();
          return Object.freeze({payloadDigest,classification,assertBeforeSend(actual){
            assertCurrent();
            if(actual?.destination!==destination||actual?.payload!==payload)fail();
            const status=assertSensitivityAllowed({secretApproved,piiApproved});
            if(status==='secret_needs_approval')fail('UNAUTHORIZED','检测到疑似密钥、口令或令牌信息，用户已拒绝或未确认出机发送');
            if(status==='pii_needs_approval')fail('UNAUTHORIZED','检测到疑似个人敏感信息（如邮箱、手机号或证件号），用户已拒绝或未确认出机发送');
          }});
        }catch(error){if(decisions.get(key)===entry)decisions.delete(key);throw error;}
      })();
      return entry.promise;
    },
    close(){closed=true;decisions.clear();},
  };
}
