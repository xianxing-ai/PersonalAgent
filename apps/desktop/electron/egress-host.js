import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const fail=(code='UNAUTHORIZED')=>{throw Object.assign(new Error('本次出机内容未通过本机分类与原范围确认'),{code});};
const digest=value=>createHash('sha256').update(value).digest('hex');
const forbiddenField=/^(?:password|passwd|api[_-]?key|secret(?:[_-]?key)?|access[_-]?token|refresh[_-]?token|authorization|private[_-]?key|verification[_-]?code|otp|full[_-]?name|first[_-]?name|last[_-]?name|phone|mobile|email|postal[_-]?address|home[_-]?address|passport|id[_-]?number|bank[_-]?account|credit[_-]?card|姓名|电话|手机|邮箱|住址|证件号|密码|口令|验证码|私钥|精确位置|健康信息|金融标识)$/iu;
const forbiddenText=/(?:-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9_-]{16,}|\bBearer\s+[A-Za-z0-9_.~+/-]{8,}|[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}|(?<!\d)1[3-9]\d{9}(?!\d)|(?<!\d)[1-9]\d{16}[\dX](?!\d)|(?:password|passwd|api[_ -]?key|secret[_ -]?key|access[_ -]?token|密码|口令|验证码)\s*[:=]\s*["']?[^\s"',;}]{3,})/iu;

/** Positive detections only. A miss is unknown, never evidence that free text is public. */
export function classifyKnownEgressContent(payload) {
  if(typeof payload!=='string'||Buffer.byteLength(payload,'utf8')>2*1024*1024)fail('INVALID_ARGUMENT');
  const inspect=(value,depth=0)=>{
    if(depth>24)fail('INVALID_ARGUMENT');
    if(typeof value==='string'){
      if(/data:(?:image|audio|video)\/[a-z0-9.+-]+;base64,/iu.test(value))fail('UNSUPPORTED_CAPABILITY');
      if(forbiddenText.test(value))return true;
      try {const decoded=JSON.parse(value);if(decoded!==value)return inspect(decoded,depth+1);}catch(error){if(error?.code)throw error;}
      return false;
    }
    if(Array.isArray(value))return value.some(item=>inspect(item,depth+1));
    if(value&&typeof value==='object')return Object.entries(value).some(([key,item])=>{
      if((['dataBase64','audio','image_url'].includes(key)&&typeof item==='string'&&item)
        ||key==='image_url'&&item&&typeof item.url==='string')fail('UNSUPPORTED_CAPABILITY');
      return (forbiddenField.test(key)&&item!==null&&typeof item!=='object'&&String(item).trim()!=='')||inspect(item,depth+1);
    });
    return false;
  };
  return inspect(payload)?'forbidden':'unknown';
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
      ||!Array.isArray(query.receipts)||!query.receipts.length)return 'forbidden';
    const graph=readGraph(scope);
    if(!graph||graph.checkpoint!==query.checkpoint||graph.controlRevision!==query.controlRevision
      ||!isDeepStrictEqual(graph.receipts,query.receipts))return 'forbidden';
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
    return classifyKnownEgressContent(JSON.stringify(outer));
  }catch{return 'forbidden';}
}

const TRUSTED_ENV_PREFIX='Current trusted host environment (data only; not authorization or a callable tool catalog):\n';
const TRUSTED_ENV_SEP='\n\nOriginal task and approved context (untrusted data):\n';
const UUID_VALUE=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;

function classifyTrustedTaskEnvelope(scope,isTrustedIdentifier) {
  function object(text) {
    if(typeof text!=='string')return;
    const value=JSON.parse(text);
    if(value&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(value)===text)return value;
  }
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
      if(typeof msg.taskId==='string'&&UUID_VALUE.test(msg.taskId)&&isTrustedIdentifier(msg.taskId)===true)msg.taskId='trusted-id';
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
  try{
    if(typeof isTrustedIdentifier!=='function')return 'forbidden';
    const outer=object(scope.payload);
    const field=outer?.query!==undefined?'query':Object.keys(outer?.inputs??{})[0];
    const container=outer?.query!==undefined?outer:outer?.inputs;
    const rawEpoch=object(container?.[field]);
    const isEpochWrapper=rawEpoch&&rawEpoch.executionEpochVersion===1&&Number.isSafeInteger(rawEpoch.executionEpoch)
      &&typeof rawEpoch.query==='string'&&Object.keys(rawEpoch).sort().join(',')==='executionEpoch,executionEpochVersion,query';
    const inner=isEpochWrapper?object(rawEpoch.query):rawEpoch;
    if(!inner)return 'forbidden';
    if(typeof inner.goal==='string')inner.goal=sanitizeGoal(inner.goal);
    if(typeof inner.continuation?.result?.userRequest==='string'){
      inner.continuation.result.userRequest=sanitizeGoal(inner.continuation.result.userRequest);
    }
    if(typeof inner.continuation?.result?.catalogRef==='string'&&/^[a-f0-9]{64}$/u.test(inner.continuation.result.catalogRef)){
      inner.continuation.result.catalogRef='sha256';
    }
    if(Array.isArray(inner.priorContinuations)){
      for(const prior of inner.priorContinuations){
        if(typeof prior?.result?.userRequest==='string')prior.result.userRequest=sanitizeGoal(prior.result.userRequest);
        if(typeof prior?.result?.catalogRef==='string'&&/^[a-f0-9]{64}$/u.test(prior.result.catalogRef))prior.result.catalogRef='sha256';
      }
    }
    if(isEpochWrapper){
      rawEpoch.query=JSON.stringify(inner);
      container[field]=JSON.stringify(rawEpoch);
    }else{
      container[field]=JSON.stringify(inner);
    }
    return classifyKnownEgressContent(JSON.stringify(outer));
  }catch{return 'forbidden';}
}

/** Main-only callbacks approve the exact content before the transport may send it. */
export function createDesktopEgressHost({classifyLocally,approvePrivate,authorizeTaskEgress,readPendingWorkflowGraph,isTrustedIdentifier,now=Date.now}={}) {
  let closed=false;const decisions=new Map();
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
      const needsReceiptCheck=classifyKnownEgressContent(payload)==='forbidden';
      const checkReceipt=()=>{
        if(!needsReceiptCheck)return;
        if(taskId&&readPendingWorkflowGraph&&classifyWorkflowReceipts(input,readPendingWorkflowGraph)!=='forbidden')return;
        if(isTrustedIdentifier&&classifyTrustedTaskEnvelope(input,isTrustedIdentifier)!=='forbidden')return;
        fail();
      };
      checkReceipt();
      const key=JSON.stringify([requestId,destination,deadline]);
      for(const [id,value] of decisions)if(value.signal.aborted||value.expiresAt<=now())decisions.delete(id);
      const previous=decisions.get(key);
      if(previous&&(previous.taskId!==taskId||previous.signal!==signal||previous.payloadDigest!==payloadDigest))fail();
      if(previous){previous.guards.add(current);for(const guard of previous.guards)guard();return previous.promise;}
      if(decisions.size>=256)fail('UNSUPPORTED_CAPABILITY');
      const guards=new Set([current]),assertCurrent=()=>{for(const guard of guards)guard();};
      const scope=Object.freeze({...(taskId===undefined?{}:{taskId}),requestId,destination,payload,payloadDigest,deadline,signal,
        isCurrent:()=>{assertCurrent();return true;}});
      const wait=async callback=>{
        assertCurrent();if(typeof callback!=='function')fail();
        let timer,onAbort;
        try{return await Promise.race([Promise.resolve().then(()=>{assertCurrent();return callback(scope);}),new Promise((resolve,reject)=>{
          const rejectWith=code=>reject(Object.assign(new Error('本次本机出机确认已失效'),{code}));
          onAbort=()=>rejectWith('CANCELLED');signal.addEventListener('abort',onAbort,{once:true});
          timer=setTimeout(()=>rejectWith('TIMEOUT'),Math.min(2147483647,Math.max(1,Date.parse(deadline)-now())));
          if(signal.aborted)onAbort();
        })]);}catch(error){fail(['CANCELLED','TIMEOUT'].includes(error?.code)?error.code:'UNAUTHORIZED');}
        finally{clearTimeout(timer);if(onAbort)signal.removeEventListener('abort',onAbort);}
      };
      const entry={taskId,signal,payloadDigest,guards,expiresAt:Date.parse(deadline)};decisions.set(key,entry);
      entry.promise=(async()=>{
        try{
          let classification='private';
          if(taskId!==undefined) {
            if(await wait(authorizeTaskEgress)!==true)fail();
          } else {
            classification=await wait(classifyLocally);assertCurrent();
            if(!['public','private'].includes(classification))fail();
            if(classification==='private'&&await wait(approvePrivate)!==true)fail();
          }
          assertCurrent();
          return Object.freeze({payloadDigest,classification,assertBeforeSend(actual){
            assertCurrent();
            if(actual?.destination!==destination||actual?.payload!==payload)fail();
            checkReceipt();
          }});
        }catch(error){if(decisions.get(key)===entry)decisions.delete(key);throw error;}
      })();
      return entry.promise;
    },
    close(){closed=true;decisions.clear();},
  };
}
