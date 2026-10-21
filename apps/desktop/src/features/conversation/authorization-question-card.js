export const escapeAuthorizationText=value=>String(value??'').replace(/[&<>"']/g,char=>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const states={pending:'等待你的选择',allowed:'授权决定已记录；操作结果仍由原任务确认',denied:'已拒绝本次请求',
  expired:'授权问题已过期，请重新发起操作',cancelled:'原任务已取消，此问题不再接受选择',stale:'操作或沙箱已变化，请读取新问题'};
const kinds={tool:'执行操作',export:'数据出机',connector_session:'连接器访问'};
const valid=q=>q&&typeof q.questionId==='string'&&q.questionId&&Number.isSafeInteger(q.revision)&&q.revision>=0
  &&Object.hasOwn(states,q.state)&&Array.isArray(q.requirements)&&q.requirements.every(item=>
    item&&Object.hasOwn(kinds,item.kind)&&Array.isArray(item.scopes)&&item.scopes.every(scope=>typeof scope==='string'));
const pending=(q,now)=>valid(q)&&q.state==='pending'&&Number.isFinite(Date.parse(q.expiresAt))&&Date.parse(q.expiresAt)>now;

export function authorizationQuestionResponse(questionId,decision,questions,now=Date.now()) {
  const question=questions.find(item=>item.questionId===questionId);
  if(!pending(question,now)||!['allow_once','allow_always','deny'].includes(decision)
    ||(decision==='allow_always'&&question.canAlways!==true))throw Error('授权问题已变化，请刷新后选择');
  return {questionId,expectedRevision:question.revision,decision};
}

export function authorizationQuestionMarkup(question,{now=Date.now(),busy=false,feedback=''}={}) {
  if(!valid(question))return '';
  const escape=escapeAuthorizationText,active=pending(question,now),expired=question.state==='pending'&&!active;
  const status=expired?'授权期限已失效，请读取最新问题':states[question.state];
  return `<section class="authorization-question-card" data-question-id="${escape(question.questionId)}" role="group" aria-label="操作授权提问">
    <p class="authorization-question-eyebrow">需要你决定</p><h3 class="authorization-question-title" tabindex="-1">${escape(question.title||'允许这次操作吗？')}</h3>
    <p>${escape(question.description)}</p><div class="authorization-question-sandbox"><span>沙箱</span><strong>${escape(question.sandbox?.label||'未提供可信沙箱')}</strong><small>${escape(question.sandbox?.mode)} · 版本 ${escape(question.sandbox?.revision)}</small></div>
    <ul class="authorization-question-requirements">${question.requirements.map(item=>`<li><strong>${escape(kinds[item.kind])}</strong><span>${escape(item.summary)}</span><small>${escape(item.scopes.join(' · '))}</small></li>`).join('')}</ul>
    <p class="authorization-question-hint">工具：${escape(question.toolName)} · ${Number.isFinite(Date.parse(question.expiresAt))?escape(new Date(question.expiresAt).toLocaleString()):'期限不可用'} 前有效</p>
    <div class="authorization-question-actions"><button type="button" class="authorization-question-primary" data-authorization-decision="allow_once" ${!active||busy?'disabled':''}>仅允许本次</button>
      <button type="button" data-authorization-decision="allow_always" ${!active||busy||question.canAlways!==true?'disabled':''}>永久允许此规则</button>
      <button type="button" data-authorization-decision="deny" ${!active||busy?'disabled':''}>拒绝</button></div>
    <p class="authorization-question-hint">永久规则仅适用于当前沙箱和列出的范围，可在安全页查看或撤销。此选择不代表操作已经完成。</p>
    <p class="authorization-question-status" role="status" aria-live="polite">${escape(feedback||status)}</p></section>`;
}

export function ensureAuthorizationStyles(document) {
  if(!document.head||document.querySelector('[data-authorization-question-style]'))return;
  const link=document.createElement('link');link.rel='stylesheet';
  link.href=new URL('./authorization-question-card.css',import.meta.url).href;
  link.setAttribute('data-authorization-question-style','');document.head.append(link);
}

/** Renderer-only view/controller. Decisions carry identity and CAS, never grants or profiles. */
export function mountAuthorizationQuestionCards(root,{invoke,onChanged=()=>{},now=Date.now}={}) {
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
      id:focused.closest('[data-question-id]')?.dataset.questionId,decision:focused.dataset.authorizationDecision}:undefined;
    const html=current.map(question=>authorizationQuestionMarkup(question,{now:now(),
      busy:submissions.has(key(question)),feedback:submissions.get(key(question))?.feedback})).join('');
    if(markup!==html) {
      root.innerHTML=html;markup=html;
      if(identity?.id) {
        const card=[...root.querySelectorAll('[data-question-id]')].find(node=>node.dataset.questionId===identity.id);
        const button=[...(card?.querySelectorAll('[data-authorization-decision]')??[])].find(node=>
          node.dataset.authorizationDecision===identity.decision&&!node.disabled);
        (button??card?.querySelector('.authorization-question-title'))?.focus({preventScroll:true});
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
    const token=key(question),submission={feedback:'正在提交选择…'};
    submissions.set(token,submission);paint();
    try {
      const result=await invoke('authorization.question.respond',body);
      if(closed||!current.some(item=>key(item)===token)||submissions.get(token)!==submission)return;
      submission.feedback=result?.accepted===true&&result.questionId===id
        ?'选择已提交，等待宿主核验和任务状态更新':'宿主未接受此版本，请刷新后读取最新问题';
      paint();await onChanged();
    } catch {
      if(closed||!current.some(item=>key(item)===token))return;
      submissions.delete(token);paint();
      const node=[...root.querySelectorAll('[data-question-id]')].find(item=>item.dataset.questionId===id);
      if(node)node.querySelector('[role="status"]').textContent='选择未提交，请重试或刷新；没有授予权限';
    }
  }
  root.addEventListener('click',choose);
  return {update(questions=[],{conversationId}={}) {
    if(closed)return;
    current=Array.isArray(questions)?questions.filter(q=>valid(q)&&(conversationId===undefined||q.conversationId===conversationId)):[];
    const keys=new Set(current.map(key));for(const token of submissions.keys())if(!keys.has(token))submissions.delete(token);
    paint();
  },dispose(){closed=true;clearTimeout(timer);submissions.clear();root.removeEventListener('click',choose);root.replaceChildren();}};
}
