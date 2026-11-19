import {createHash} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unavailable=()=>{throw new ProtocolError('UNSUPPORTED_CAPABILITY','缺少可信可恢复删除或后续用户回合证明，本轮未删除');};
export function isDeletionOperation({toolName,arguments:args}) {
  return /(?:^|[.:_])(?:delete|remove|erase|purge|trash|unlink|rmdir|uninstall)(?:$|[.:_])/u.test(toolName)
    ||toolName==='calendar.cancel'||args?.permanent===true;
}
export function assertDeletionOperationSupported(source) {if(isDeletionOperation(source))unavailable();}
const waiting=()=>({state:'pending',phase:'deletion_user_turn',
  message:'本轮未删除。对象和版本已记为待决；请在同一对话的后续新用户回合知晓后，再次确认此对象与版本。'});
const unknown=()=>({state:'pending',phase:'deletion_result_unknown',
  message:'原删除结果仍待核实，不会再次执行；请只读核对原对象和原回执。'});

/** Original Runtime host-state only. A second dialog or click is never a new user turn. */
export function createDeletionConfirmationGate({getStore,readUserTurn}={}) {
  return {async run(operation,target,perform,assertCurrent=()=>{}){
    if(typeof getStore!=='function'||typeof readUserTurn!=='function'||typeof perform!=='function'||typeof assertCurrent!=='function')unavailable();
    const turn=readUserTurn(),store=getStore();
    if(!turn||typeof turn.conversationId!=='string'||!turn.conversationId||typeof turn.turnId!=='string'||!turn.turnId
      ||typeof turn.createdAt!=='string'||!Number.isFinite(Date.parse(turn.createdAt))||typeof store?.compareAndSet!=='function'
      ||!['memory.erase','facts.erase','learning.erase'].includes(operation)||typeof target?.id!=='string'||!target.id
      ||!Number.isSafeInteger(target.revision)||target.revision<1||Object.keys(target).some(key=>!['id','revision'].includes(key)))unavailable();
    const key='deletion:'+digest([operation,target.id]),bindingDigest=digest([operation,target]),previous=store.get(key);
    if(!previous||previous.phase==='pending'){
      const checked=assertCurrent();if(checked!==undefined){void Promise.resolve(checked).catch(()=>{});unavailable();}
    }
    const pending={version:1,operation,bindingDigest,conversationId:turn.conversationId,firstTurnId:turn.turnId,firstCreatedAt:turn.createdAt,phase:'pending'};
    const save=(before,next)=>{if(!store.compareAndSet(key,before,next))throw new ProtocolError('REVISION_CONFLICT','原删除决定已变化，请刷新');};
    if(previous===undefined){save(undefined,pending);return waiting();}
    if(previous.version!==1||previous.operation!==operation||previous.conversationId!==turn.conversationId)
      throw new ProtocolError('UNAUTHORIZED','请在发起这次删除的原对话继续确认');
    if(previous.phase==='started'||previous.phase==='unknown')return unknown();
    if(previous.phase==='completed'){
      if(previous.bindingDigest!==bindingDigest)throw new ProtocolError('UNAUTHORIZED','原对象已有删除回执，请先核实，不能重复删除');
      return structuredClone(previous.result);
    }
    if(previous.phase!=='pending')unavailable();
    if(previous.bindingDigest!==bindingDigest){save(previous,pending);return waiting();}
    if(previous.firstTurnId===turn.turnId||Date.parse(turn.createdAt)<=Date.parse(previous.firstCreatedAt))return waiting();
    const started={...previous,phase:'started',confirmedTurnId:turn.turnId,confirmedCreatedAt:turn.createdAt};save(previous,started);
    let result;
    try{result=await perform();}
    catch(error){save(started,{...started,phase:'unknown'});throw error;}
    if(result?.state==='declined'){save(started,previous);return result;}
    if(result?.state==='deleted'||result?.state==='pending'&&result?.phase==='private_copy_erasure'){
      save(started,{...started,phase:'completed',result:structuredClone(result)});return result;
    }
    save(started,{...started,phase:'unknown'});return unknown();
  }};
}
