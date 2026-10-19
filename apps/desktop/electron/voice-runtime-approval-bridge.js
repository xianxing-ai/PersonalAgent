/** Trusted composition adapter only. Runtime retains parameters, approvals and grants.
 * readPendingApproval must validate the persisted original tool parameters/digest and
 * resolve task ownership through Runtime's original parent/child binding, then return
 * {taskId, conversationId, approvalId, revision, state, taskState, argumentsDigest,
 * expiresAt}. It must never accept a model/Renderer parameter summary as that source.
 * A bound descendant also carries requestTaskId equal to scope.taskId; the trusted
 * reader must resolve that relationship from the original persisted binding.
 */
export function createVoiceRuntimeApprovalBridge({readPendingApproval,prepareApproval,readCurrentQuestion,now=Date.now}) {
  if (![readPendingApproval,prepareApproval,readCurrentQuestion].every(value=>typeof value==='function')) {
    throw Error('语音原审批组合端口不可用');
  }
  return {async prepareTaskApproval(scope) {
    const assertCurrent=()=>{
      if (!scope || typeof scope.taskId!=='string' || !scope.taskId || typeof scope.conversationId!=='string'
        || !scope.conversationId || scope.signal?.aborted || !(Date.parse(scope.deadline)>now())) {
        throw Error('语音原审批范围已失效');
      }
    };
    assertCurrent();
    const approval=await readPendingApproval(scope);
    assertCurrent();
    if (!approval || (approval.taskId!==scope.taskId && approval.requestTaskId!==scope.taskId)
      || approval.conversationId!==scope.conversationId
      || approval.state!=='pending' || approval.taskState!=='waiting_approval'
      || typeof approval.approvalId!=='string' || !approval.approvalId
      || !Number.isSafeInteger(approval.revision) || approval.revision<1
      || !/^[a-f0-9]{64}$/u.test(approval.argumentsDigest) || !(Date.parse(approval.expiresAt)>now())) return null;
    const matches=question=>question?.state==='pending' && question.kind==='approval'
      && question.taskId===approval.taskId && question.approvalId===approval.approvalId
      && question.approvalRevision===approval.revision && question.argumentsDigest===approval.argumentsDigest
      && question.expiresAt===approval.expiresAt;
    const original=readCurrentQuestion({conversationId:scope.conversationId});
    if (matches(original)) return original;
    const question=await prepareApproval({approvalId:approval.approvalId,expectedRevision:approval.revision});
    assertCurrent();
    const current=readCurrentQuestion({conversationId:scope.conversationId});
    if (!matches(question) || !matches(current) || current.questionId!==question.questionId
      || current.revision!==question.revision) throw Error('语音原审批参数已改变');
    return question;
  }};
}
