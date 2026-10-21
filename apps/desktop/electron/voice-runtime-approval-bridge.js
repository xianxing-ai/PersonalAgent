/** Read-only mapping from a persisted original approval to its existing conversation card.
 * The trusted reader resolves parent/child ownership and exact original argument/revision identity.
 * This bridge neither creates a second question nor calls authorization.respond.
 */
export function createVoiceRuntimeApprovalBridge({readPendingApproval,readCurrentQuestion,focusQuestion=()=>{},now=Date.now}) {
  if([readPendingApproval,readCurrentQuestion].some(value=>typeof value!=='function'))throw Error('语音原审批组合端口不可用');
  return {async prepareTaskApproval(scope){
    const current=()=>scope&&typeof scope.taskId==='string'&&typeof scope.conversationId==='string'
      &&!scope.signal?.aborted&&Date.parse(scope.deadline)>now();
    if(!current())throw Error('语音原审批范围已失效');
    const approval=await readPendingApproval(scope);
    if(!current())throw Error('语音原审批范围已失效');
    if(!approval||(approval.taskId!==scope.taskId&&approval.requestTaskId!==scope.taskId)
      ||approval.conversationId!==scope.conversationId||approval.state!=='pending'||approval.taskState!=='waiting_approval'
      ||!Number.isSafeInteger(approval.revision)||!/^[a-f0-9]{64}$/u.test(approval.argumentsDigest)
      ||!(Date.parse(approval.expiresAt)>now()))return null;
    const card=readCurrentQuestion({conversationId:scope.conversationId});
    if(card?.state!=='pending'||card.sourceApprovalId!==approval.approvalId
      ||![approval.taskId,scope.taskId].includes(card.taskId)
      ||!(Date.parse(card.expiresAt)>now())||Date.parse(card.expiresAt)>Date.parse(approval.expiresAt))return null;
    focusQuestion(card);
    return {...card,guidance:'请在当前同一张提问卡完成授权；语音回答不会签发许可。'};
  }};
}
