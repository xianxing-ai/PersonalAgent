import {escapeAuthorizationText as escape,ensureAuthorizationStyles} from './authorization-question-card.js';

const fields=new Map([['weather.location','workflow.f11.location.respond'],['plan.decision','workflow.f11.decision.respond'],
  ['mail.decision','workflow.f08.decision.respond']]);
const active=(q,now)=>q&&fields.has(q.field)&&q.state==='pending'&&q.revision===1
  &&['questionId','taskId','sourceTaskId','conversationId'].every(key=>typeof q[key]==='string'&&q[key])
  &&Number.isFinite(Date.parse(q.deadline))&&Date.parse(q.deadline)>now;
const answerField=q=>q.field==='weather.location'?'location':'decision';
const planMarkup=plan=>{
  const labels={externalId:'日历条目',uid:'日历标识',summary:'标题',startUtc:'开始时间',endUtc:'结束时间',location:'地点',notes:'备注'};
  return `<dl>${Object.entries(plan?.update??{}).map(([key,value])=>`<dt>${escape(labels[key]??key)}</dt><dd>${escape(value)}</dd>`).join('')}</dl>
    ${plan?.reminder?'<p>原日历条目对应的旧提醒将失效。</p>':''}`;
};
const mailMarkup=question=>`<dl>${[['发件账号',question.draft?.account],['收件人',question.draft?.to],['主题',question.draft?.subject]]
  .filter(([,value])=>value!==undefined).map(([label,value])=>`<dt>${label}</dt><dd>${escape(value)}</dd>`).join('')}</dl>
  <pre class="workflow-question-draft">${escape(question.draft?.text)}</pre>
  ${question.references?.length?`<details><summary>草稿引用的资料</summary><ul>${question.references.map(source=>
    `<li>${escape(source.path)} · 第 ${escape(source.line)} 行</li>`).join('')}</ul></details>`:''}`;

export function workflowQuestionReply(question,answer,commandId,now=Date.now()) {
  if(!active(question,now)||typeof commandId!=='string'||!commandId)throw Error('问题已变化，请查看最新状态');
  const field=answerField(question),value=field==='location'?String(answer??'').trim():answer;
  if(field==='location'? !value||value.length>512||/[\u0000-\u001f\u007f]/u.test(value):!['accept','decline'].includes(value))
    throw Error(field==='location'?'请输入明确的城市或地点':'请选择是否采用原方案');
  return {taskId:question.taskId,sourceTaskId:question.sourceTaskId,questionId:question.questionId,
    expectedRevision:question.revision,commandId,[field]:value};
}

export function workflowQuestionMarkup(question,{now=Date.now(),draft='',submission}={}) {
  if(!fields.has(question?.field)||question.state!=='pending')return '';
  const location=question.field==='weather.location',disabled=!active(question,now)||!!submission;
  const field=location?`<label>城市或地点<input name="location" maxlength="512" autocomplete="off" value="${escape(draft)}" ${disabled?'disabled':''}></label>
    <button type="submit" ${disabled?'disabled':''}>提交地点</button>`
    :`${question.field==='mail.decision'?mailMarkup(question):planMarkup(question.plan)}
      <button type="button" data-workflow-answer="accept" ${disabled?'disabled':''}>${question.field==='mail.decision'?'采用这封草稿':'采用原方案'}</button>
      <button type="button" data-workflow-answer="decline" ${disabled?'disabled':''}>不采用</button>`;
  return `<section class="authorization-question-card workflow-question-card" data-workflow-question-id="${escape(question.questionId)}" role="group" aria-label="补充任务信息">
    <h3 class="workflow-question-title" tabindex="-1">${escape(question.prompt)}</h3>
    <form data-workflow-form>${field}</form>
    <p class="authorization-question-hint">回答用于继续原任务。后续操作仍按各自的权限要求确认。</p>
    ${submission&&!submission.inFlight&&active(question,now)?'<button type="button" data-workflow-retry>重试同一条回答</button>':''}
    <p role="status" aria-live="polite">${escape(submission?.feedback??(active(question,now)?'':'问题已过期'))}</p></section>`;
}

/** Parameter clarification only: no authorization decision, grant or new task is sent. */
export function mountWorkflowQuestionCards(root,{invoke,onChanged=()=>{},now=Date.now,commandId=()=>crypto.randomUUID()}={}) {
  const document=root.ownerDocument??globalThis.document;
  ensureAuthorizationStyles(document);root.classList.add('authorization-question-list');
  let current=[],closed=false,html='',timer,renderedAt=now();
  const drafts=new Map(),submissions=new Map(),settled=new Map();
  const markup=at=>current.map(q=>workflowQuestionMarkup(q,{now:at,draft:drafts.get(q.questionId),submission:submissions.get(q.questionId)})).join('');
  function paint(){
    if(closed)return;clearTimeout(timer);
    const focus=document.activeElement,card=root.contains(focus)?focus.closest('[data-workflow-question-id]'):undefined;
    const identity=card?{id:card.dataset.workflowQuestionId,input:focus.name==='location'||focus.hasAttribute('name'),
      start:focus.selectionStart,end:focus.selectionEnd,answer:focus.dataset.workflowAnswer}:undefined;
    renderedAt=now();const next=markup(renderedAt);
    if(next!==html){root.innerHTML=next;html=next;
      if(identity){const target=[...root.querySelectorAll('[data-workflow-question-id]')].find(node=>node.dataset.workflowQuestionId===identity.id);
        const input=target?.querySelector('[name="location"]'),button=[...(target?.querySelectorAll('[data-workflow-answer]')??[])].find(node=>node.dataset.workflowAnswer===identity.answer);
        const restored=identity.input&&input&&!input.disabled?input:button&&!button.disabled?button:target?.querySelector('.workflow-question-title');
        restored?.focus({preventScroll:true});if(restored===input&&Number.isInteger(identity.start))input.setSelectionRange?.(identity.start,identity.end);
      }}
    root.hidden=current.length===0;
    const deadline=Math.min(...current.filter(q=>active(q,now())).map(q=>Date.parse(q.deadline)));
    if(Number.isFinite(deadline))timer=setTimeout(paint,Math.min(Math.max(deadline-now()+1,1),2_147_483_647));
  }
  function input(event){
    if(event.target.name!=='location'&&!event.target.hasAttribute('name'))return;
    const id=event.target.closest('[data-workflow-question-id]')?.dataset.workflowQuestionId;
    if(id&&!submissions.has(id)){drafts.set(id,event.target.value);html=markup(renderedAt);}
  }
  async function submit(event){
    const control=event.type==='submit'?event.target:event.target.closest('[data-workflow-answer],[data-workflow-retry]');
    if(closed||!control||!root.contains(control)||control.disabled)return;
    event.preventDefault?.();
    const id=control.closest('[data-workflow-question-id]')?.dataset.workflowQuestionId,q=current.find(item=>item.questionId===id);
    if(!q||!active(q,now())||submissions.get(id)?.inFlight)return;
    let submission=submissions.get(id);
    if(!submission){
      try{submission={body:workflowQuestionReply(q,q.field==='weather.location'?control.querySelector('[name="location"]')?.value:control.dataset.workflowAnswer,commandId(),now())};}
      catch(error){control.closest('[data-workflow-question-id]').querySelector('[role="status"]').textContent=error.message;return;}
      submissions.set(id,submission);
    }
    submission.inFlight=true;submission.feedback='正在提交…';paint();
    try{
      const result=await invoke(fields.get(q.field),submission.body);
      const field=answerField(q);
      if(result?.state==='answered'&&result.questionId===id&&result.taskId===q.taskId&&result.sourceTaskId===q.sourceTaskId
        &&result.revision===q.revision+1&&result[field]===submission.body[field]){
        settled.set(id,result.revision);current=current.filter(item=>item.questionId!==id);drafts.delete(id);
      }else submission.feedback='尚未确认是否收到。重试会使用同一条回答。';
    }catch{submission.feedback='尚未确认是否收到。重试会使用同一条回答。';}
    finally{submission.inFlight=false;paint();try{await onChanged();}catch{}}
  }
  root.addEventListener('input',input);root.addEventListener('submit',submit);root.addEventListener('click',submit);
  return {update(questions=[],{conversationId}={}){
    current=conversationId&&Array.isArray(questions)?questions.filter(q=>q?.conversationId===conversationId&&fields.has(q.field)
      &&q.state==='pending'&&q.revision>(settled.get(q.questionId)??0)):[];paint();
  },dispose(){closed=true;clearTimeout(timer);root.removeEventListener('input',input);root.removeEventListener('submit',submit);root.removeEventListener('click',submit);}};
}
