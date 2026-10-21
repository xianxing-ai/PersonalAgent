import {notificationDigest as digest} from '@personal-agent/notifications';

const yes = new Set(['同意','确认','可以','好的','同意本次','确认本次','允许本次','同意这次','确认设置','保存设置']);
const no = new Set(['不同意','不可以','拒绝','拒绝本次','不要','不允许']);
const normalized=text=>text.trim().replace(/[\s。！!，,？?、]/gu,'');

/** Read-only voice guidance for the current formal card. No oral answer issues a grant or writes settings. */
export function createDesktopVoiceCommandHost({readCurrentQuestion=()=>null,focusQuestion=()=>{},now=Date.now,onUpdate=()=>{}}) {
  const observed=new Map(),utterances=new Set();
  function snapshot(conversationId){
    const card=readCurrentQuestion({conversationId});
    if(!card||card.state!=='pending'||!card.questionId||!Number.isSafeInteger(card.revision)
      ||!(Date.parse(card.expiresAt)>now()))return null;
    const key=card.questionId+':'+card.revision;
    if(!observed.has(key))observed.set(key,new Date(now()).toISOString());
    return {...structuredClone(card),kind:'authorization',
      summary:card.summary??card.requirements?.map(item=>item.summary).join('；')??'请在当前对话提问卡核对本次权限',
      guidanceIssuedAt:observed.get(key),guidance:'语音仅解释权限；请在当前同一张提问卡点击允许一次、允许一直或拒绝。'};
  }
  return {
    snapshot,
    prepareSettings(){throw Error('请在原对话设置提问卡核对参数；语音不能另建或口头确认授权');},
    prepareApproval({approvalId}){
      const card=snapshot();
      if(!card||card.sourceApprovalId!==approvalId)
        throw Error('原审批尚无匹配的正式提问卡，请回当前对话');
      focusQuestion(card);return card;
    },
    cancel(){return snapshot();},
    reconcile(){return snapshot();},
    async consumeFinal(receipt){
      const card=snapshot();
      if(!card)return {consumed:false,reason:'no_current_question'};
      if(!receipt||receipt.source!=='live_input_audio'||receipt.phase!=='final'||receipt.origin!=='user'
        ||receipt.echo!==false||receipt.signal?.aborted||typeof receipt.text!=='string'
        ||!receipt.sessionId||!receipt.utteranceId||receipt.questionId!==card.questionId
        ||receipt.questionRevision!==card.revision||receipt.argumentsDigest!==card.argumentsDigest
        ||receipt.transcriptDigest!==digest(receipt.text)
        ||!(Date.parse(receipt.startedAt)>=Date.parse(card.guidanceIssuedAt))
        ||!(Date.parse(receipt.completedAt)>=Date.parse(receipt.startedAt))
        ||Date.parse(receipt.completedAt)>now()||!(Date.parse(receipt.expiresAt)>now())
        ||Date.parse(receipt.expiresAt)>Date.parse(card.expiresAt))
        return {consumed:false,reason:'stale_or_untrusted_final'};
      const id=JSON.stringify([receipt.sessionId,receipt.utteranceId]);if(utterances.has(id))return {consumed:false,reason:'duplicate_final'};
      utterances.add(id);
      const text=normalized(receipt.text);
      if(!yes.has(text)&&!no.has(text))return {consumed:false,reason:'requires_card_selection'};
      const fresh=snapshot();
      if(!fresh||fresh.questionId!==card.questionId||fresh.revision!==card.revision||fresh.argumentsDigest!==card.argumentsDigest)
        return {consumed:false,reason:'current_parameters_changed'};
      focusQuestion(fresh);onUpdate();
      return {consumed:false,state:'awaiting_card',reason:'complete_in_conversation_card',questionId:fresh.questionId,
        questionRevision:fresh.revision,guidance:fresh.guidance};
    },
  };
}
