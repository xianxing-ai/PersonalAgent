export const escapeAuthorizationText=value=>String(value??'').replace(/[&<>"']/g,char=>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const states={pending:'',allowed:'已同意',denied:'已拒绝',
  expired:'请求已过期',cancelled:'任务已取消',stale:'请求已更新，请查看最新卡片'};
const kinds={tool:'操作',export:'发送内容',connector_session:'数据访问'};
const valid=q=>q&&typeof q.questionId==='string'&&q.questionId&&Number.isSafeInteger(q.revision)&&q.revision>=0
  &&Object.hasOwn(states,q.state)&&Array.isArray(q.requirements)&&q.requirements.every(item=>
    item&&Object.hasOwn(kinds,item.kind)&&Array.isArray(item.scopes)&&item.scopes.every(scope=>typeof scope==='string'));
const pending=(q,now)=>valid(q)&&q.state==='pending'&&Number.isFinite(Date.parse(q.expiresAt))&&Date.parse(q.expiresAt)>now;
export const authorizationQuestionDefaultDecision=question=>question?.canReuseTask===true&&question.suggestedDecision==='allow_task'?'allow_task':'allow_once';
export function approvalsWithoutQuestionCards(approvals=[],questions=[],conversationId) {
  const linked=new Set(questions.filter(question=>conversationId&&question.conversationId===conversationId
    &&typeof question.sourceApprovalId==='string'&&question.sourceApprovalId).map(question=>question.sourceApprovalId));
  return approvals.filter(approval=>!linked.has(approval.approvalId));
}
function nativeMarkup(native,escape) {
  if(native?.required===false)return '<p class="authorization-question-hint">本次使用应用内工具，不启动外部进程；应用内权限不声明外部进程隔离。</p>';
  if(native?.required!==true)return '<p class="authorization-question-hint">未提供外部进程隔离状态；不会据此声明已隔离。</p>';
  return `<p class="authorization-question-hint">本次需要外部进程隔离：${escape(native.backend??'unavailable')} · ${native.available===true?'后端可用':'后端不可用'} · ${native.enforced===true?'执行边界已启用':'执行边界尚未确认'}${native.reason?` · ${escape(native.reason)}`:''}</p>`;
}

export function authorizationQuestionResponse(questionId,decision,questions,now=Date.now()) {
  const question=questions.find(item=>item.questionId===questionId);
  if(!pending(question,now)||!['allow_once','allow_task','allow_always','deny'].includes(decision)
    ||(decision==='allow_always'&&question.canAlways!==true)
    ||(decision==='allow_task'&&authorizationQuestionDefaultDecision(question)!=='allow_task'))throw Error('授权问题已变化，请刷新后选择');
  return {questionId,expectedRevision:question.revision,decision};
}

export function authorizationQuestionMarkup(question,{now=Date.now(),busy=false,feedback='',expanded=false}={}) {
  if(!valid(question))return '';
  const escape=escapeAuthorizationText,active=pending(question,now),expired=question.state==='pending'&&!active;
  const status=expired?'请求已过期':states[question.state];
  const purpose=question.title||'允许这次操作吗？';
  const summary=question.description||question.requirements.find(item=>item.requirementId==='tool')?.summary||'完成这项操作。';
  return `<section class="authorization-question-card" data-question-id="${escape(question.questionId)}" role="group" aria-label="操作授权提问">
    <h3 class="authorization-question-title" tabindex="-1">${escape(purpose)}</h3>
    <p class="authorization-question-summary">${escape(summary)}</p>
    ${authorizationQuestionDefaultDecision(question)==='allow_task'?'<p class="authorization-question-hint">本任务内相同范围不再询问。</p>':''}
    <details class="authorization-question-details" data-authorization-details ${expanded?'open':''}><summary data-authorization-details-toggle>查看详情</summary>
      <p>${escape(question.description)}</p><div class="authorization-question-sandbox"><span>应用内权限</span><strong>${escape(question.sandbox?.label||'未提供权限配置')}</strong><small>${escape(question.sandbox?.mode)} · 版本 ${escape(question.sandbox?.revision)}</small></div>
      ${nativeMarkup(question.sandbox?.native,escape)}
      <ul class="authorization-question-requirements">${question.requirements.map(item=>`<li><strong>${escape(kinds[item.kind])}</strong><span>${escape(item.summary)}</span><small>${escape(item.scopes.join(' · '))}</small></li>`).join('')}</ul>
      <p class="authorization-question-hint">工具：${escape(question.toolName)} · ${Number.isFinite(Date.parse(question.expiresAt))?escape(new Date(question.expiresAt).toLocaleString()):'期限不可用'} 前有效</p>
      <p class="authorization-question-hint">${authorizationQuestionDefaultDecision(question)==='allow_task'?'本任务相同范围不再询问。':'仅用于本次操作。'}</p>
    </details>
    <div class="authorization-question-actions"><button type="button" class="authorization-question-primary" data-authorization-decision="${authorizationQuestionDefaultDecision(question)}" ${!active||busy?'disabled':''}>同意</button>
      <button type="button" data-authorization-decision="deny" ${!active||busy?'disabled':''}>拒绝</button></div>
    <p class="authorization-question-status" role="status" aria-live="polite">${escape(feedback||status)}</p></section>`;
}

export function ensureAuthorizationStyles(document) {
  if(!document.head||document.querySelector('[data-authorization-question-style]'))return;
  const link=document.createElement('link');link.rel='stylesheet';
  link.href=new URL('./authorization-question-card.css',import.meta.url).href;
  link.setAttribute('data-authorization-question-style','');document.head.append(link);
}

/** Renderer-only view/controller. Decisions carry identity and CAS, never grants or profiles. */
export function mountAuthorizationQuestionCards(root,{invoke,onChanged=()=>{},onPending=()=>{},now=Date.now}={}) {
  const document=root.ownerDocument??globalThis.document;
  ensureAuthorizationStyles(document);
  root.classList.add('authorization-question-list');
  let current=[],closed=false,timer,markup='';
  const submissions=new Map();
  const key=q=>`${q.questionId}:${q.revision}`;
  function paint() {
    if(closed)return;
    clearTimeout(timer);timer=undefined;
    const focused=document.activeElement,identity=root.contains(focused)?{
      id:focused.closest('[data-question-id]')?.dataset.questionId,decision:focused.dataset.authorizationDecision,
      details:focused.hasAttribute('data-authorization-details-toggle')}:undefined;
    const expanded=new Set([...root.querySelectorAll('[data-authorization-details]')].filter(node=>node.open)
      .map(node=>node.closest('[data-question-id]')?.dataset.questionId));
    const html=current.map(question=>authorizationQuestionMarkup(question,{now:now(),
      busy:submissions.has(key(question)),feedback:submissions.get(key(question))?.feedback,expanded:expanded.has(question.questionId)})).join('');
    if(markup!==html) {
      root.innerHTML=html;markup=html;
      if(identity?.id) {
        const card=[...root.querySelectorAll('[data-question-id]')].find(node=>node.dataset.questionId===identity.id);
        const button=[...(card?.querySelectorAll('[data-authorization-decision]')??[])].find(node=>
          node.dataset.authorizationDecision===identity.decision&&!node.disabled);
        (button??(identity.details?card?.querySelector('[data-authorization-details-toggle]'):undefined)
          ??card?.querySelector('.authorization-question-title'))?.focus({preventScroll:true});
      }
    }
    root.hidden=current.length===0;
    const next=current.filter(q=>pending(q,now())).map(q=>Date.parse(q.expiresAt)).sort((a,b)=>a-b)[0];
    if(next!==undefined)timer=setTimeout(paint,Math.min(Math.max(next-now()+1,1),2_147_483_647));
  }
  async function choose(event) {
    const button=event.target.closest('[data-authorization-decision]');
    if(closed||!button||!root.contains(button)||button.disabled)return;
    const id=button.closest('[data-question-id]')?.dataset.questionId;
    const question=current.find(item=>item.questionId===id);
    if(!question||submissions.has(key(question)))return;
    let body;
    try {body=authorizationQuestionResponse(id,button.dataset.authorizationDecision,current,now());}
    catch {paint();return;}
    const token=key(question),submission={feedback:'正在提交…'};
    submissions.set(token,submission);paint();
    try {
      const result=await invoke('authorization.question.respond',body);
      if(closed||!current.some(item=>key(item)===token)||submissions.get(token)!==submission)return;
      submission.feedback=result?.accepted===true&&result.questionId===id
        ?(result.state==='allowed'?'已同意':result.state==='denied'?'已拒绝':'已提交'):'请求已更新，请查看最新卡片';
      paint();
      // A failed snapshot refresh cannot undo the host's decision or invite a second answer.
      try {await onChanged();}catch {/* The next ordinary snapshot will refresh this card. */}
    } catch {
      if(closed||!current.some(item=>key(item)===token))return;
      submissions.delete(token);paint();
      const node=[...root.querySelectorAll('[data-question-id]')].find(item=>item.dataset.questionId===id);
      if(node)node.querySelector('[role="status"]').textContent='提交失败，请重试';
    }
  }
  root.addEventListener('click',choose);
  return {update(questions=[],{conversationId}={}) {
    if(closed)return;
    const previous=new Set(current.filter(question=>pending(question,now())).map(question=>question.questionId));
    current=Array.isArray(questions)?questions.filter(q=>valid(q)&&(conversationId===undefined||q.conversationId===conversationId)):[];
    const keys=new Set(current.map(key));for(const token of submissions.keys())if(!keys.has(token))submissions.delete(token);
    paint();
    const added=current.find(question=>pending(question,now())&&!previous.has(question.questionId));
    if(added)onPending({questionId:added.questionId,element:[...root.querySelectorAll('[data-question-id]')]
      .find(node=>node.dataset.questionId===added.questionId)});
  },dispose(){closed=true;clearTimeout(timer);submissions.clear();root.removeEventListener('click',choose);root.replaceChildren();}};
}
