import {createHash} from 'node:crypto';

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

/** Main-only callbacks classify locally; neither cloud output nor a permission rule classifies data. */
export function createDesktopEgressHost({classifyLocally,approvePrivate,now=Date.now}={}) {
  let closed=false;const decisions=new Map();
  return {
    async prepare(input) {
      const {requestId,destination,payload,deadline,signal,isCurrent}=input??{};
      let url;try{url=new URL(destination);}catch{fail('INVALID_ARGUMENT');}
      if(typeof requestId!=='string'||!requestId||requestId.length>512||typeof destination!=='string'
        ||!['https:','wss:'].includes(url.protocol)||url.username||url.password||url.hash
        ||typeof payload!=='string'||typeof deadline!=='string'||!Number.isFinite(Date.parse(deadline))||!signal
        ||typeof signal.addEventListener!=='function'||typeof isCurrent!=='function')fail('INVALID_ARGUMENT');
      const payloadDigest=digest(payload),current=()=>{
        if(closed||signal.aborted)fail('CANCELLED');
        if(now()>=Date.parse(deadline))fail('TIMEOUT');
        let active;try{active=isCurrent();}catch{fail();}
        if(active&&typeof active.then==='function'){void Promise.resolve(active).catch(()=>{});fail();}
        if(input.requestId!==requestId||input.destination!==destination||input.payload!==payload||input.deadline!==deadline
          ||input.signal!==signal||active!==true)fail();
      };
      current();
      if(classifyKnownEgressContent(payload)==='forbidden')fail();
      const key=JSON.stringify([requestId,destination,deadline]);
      for(const [id,value] of decisions)if(value.signal.aborted||value.expiresAt<=now())decisions.delete(id);
      const previous=decisions.get(key);
      if(previous&&(previous.signal!==signal||previous.payloadDigest!==payloadDigest))fail();
      if(previous){previous.guards.add(current);for(const guard of previous.guards)guard();return previous.promise;}
      if(decisions.size>=256)fail('UNSUPPORTED_CAPABILITY');
      const guards=new Set([current]),assertCurrent=()=>{for(const guard of guards)guard();};
      const scope=Object.freeze({requestId,destination,payload,payloadDigest,deadline,signal,isCurrent:()=>{assertCurrent();return true;}});
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
      const entry={signal,payloadDigest,guards,expiresAt:Date.parse(deadline)};decisions.set(key,entry);
      entry.promise=(async()=>{
        try{
          const classification=await wait(classifyLocally);assertCurrent();
          if(!['public','private'].includes(classification))fail();
          if(classification==='private'&&await wait(approvePrivate)!==true)fail();
          assertCurrent();
          return Object.freeze({payloadDigest,classification,assertBeforeSend(actual){
            assertCurrent();
            if(actual?.destination!==destination||actual?.payload!==payload||classifyKnownEgressContent(actual.payload)==='forbidden')fail();
          }});
        }catch(error){if(decisions.get(key)===entry)decisions.delete(key);throw error;}
      })();
      return entry.promise;
    },
    close(){closed=true;decisions.clear();},
  };
}
