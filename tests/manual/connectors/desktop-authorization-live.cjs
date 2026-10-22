/* Shared manual-acceptance driver for the original visible authorization card.
 * It grants nothing itself and never reads credentials or private tool results. */
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
function databaseRead(database,read){const db=new DatabaseSync(database,{readOnly:true});try{return read(db);}finally{db.close();}}
function checkpoint(db,taskId,key){const row=db.prepare('SELECT value_json FROM task_checkpoints WHERE task_id=? AND checkpoint_key=?')
  .get(taskId,key);return row?JSON.parse(row.value_json):undefined;}
function questionBinding(database,question){return databaseRead(database,db=>{
  const runId=question.sourceApprovalId,anchor=checkpoint(db,question.taskId,'authorization-question-binding:'+runId);
  assert.ok(anchor&&anchor.taskId===question.taskId&&anchor.runId===runId&&anchor.toolName===question.toolName,
    'question must bind its exact original Runtime invocation');
  const loop=checkpoint(db,question.taskId,'competition-loop'),invocation=checkpoint(db,question.taskId,'application-tool-invocation:'+runId);
  const argumentsValue=invocation?.arguments??(loop?.pending?.toolName===anchor.toolName
    &&loop.pending.proposalId===anchor.proposalId?loop.pending.arguments:undefined);
  assert.ok(argumentsValue&&typeof argumentsValue==='object','original frozen arguments are required');
  return {anchor,arguments:argumentsValue,parent:checkpoint(db,question.taskId,'subtask-parent'),
    watch:checkpoint(db,question.taskId,'desktop-connector-watch-origin')};
});}
async function approveQuestions({page,database,value,allowed,validate,report,persist=()=>{}}){
  const {toolArgumentsDigest}=await import('@personal-agent/tool-gateway');
  report.questions??=[];
  for(const question of value.authorizationQuestions??[]){
    if(question.state!=='pending')continue;
    assert.ok(allowed.includes(question.toolName),'unrelated operation is outside this acceptance scope');
    assert.ok(Number.isSafeInteger(question.revision)&&Date.parse(question.expiresAt)>Date.now(),'original question must be current');
    if(report.questions.some(item=>item.questionId===question.questionId&&item.revision===question.revision))continue;
    const binding=questionBinding(database,question);
    assert.equal(toolArgumentsDigest(binding.arguments),binding.anchor.argumentsDigest,'original argument digest must match');
    assert.ok(Date.parse(question.expiresAt)<=Date.parse(binding.anchor.deadline),'card cannot extend the operation deadline');
    await validate(question,binding);
    const button=page.locator(`[data-question-id="${question.questionId}"] [data-authorization-decision="allow_once"]`);
    await button.waitFor({state:'visible'});assert.equal(await button.isEnabled(),true);
    await button.evaluate(async(element,expected)=>{
      const response=await window.desktop.invoke('snapshot');
      const current=response.ok&&response.value.authorizationQuestions?.find(item=>item.questionId===expected.questionId);
      if(!current||current.state!=='pending'||current.revision!==expected.revision||current.taskId!==expected.taskId
        ||current.sourceApprovalId!==expected.sourceApprovalId||current.toolName!==expected.toolName
        ||Date.parse(current.expiresAt)<=Date.now()||element.disabled||!element.isConnected
        ||element.dataset.authorizationDecision!=='allow_once'||!element.getClientRects().length
        ||element.closest('[data-question-id]')?.dataset.questionId!==expected.questionId)throw Error('Original visible authorization card changed');
      element.click();
    },{questionId:question.questionId,revision:question.revision,taskId:question.taskId,
      sourceApprovalId:question.sourceApprovalId,toolName:question.toolName});
    report.questions.push({questionId:question.questionId,taskId:question.taskId,runId:question.sourceApprovalId,
      toolName:question.toolName,revision:question.revision,argumentsDigest:binding.anchor.argumentsDigest,
      requirements:question.requirements.map(item=>({requirementId:item.requirementId,kind:item.kind,scopes:item.scopes})),
      decision:'allow_once',physicalHumanClick:false});persist();
  }
}
module.exports={databaseRead,checkpoint,questionBinding,approveQuestions};
