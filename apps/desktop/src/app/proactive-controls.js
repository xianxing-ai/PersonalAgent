const statusNames = {disabled:'未开启',waiting_approval:'等待授权',monitoring:'正在监控',error:'监控异常'};
const analysisNames = {submitting:'正在提交分析',submitted:'分析任务已受理',submission_unknown:'提交结果待核实',pending:'等待分析',running:'正在分析',verifying:'正在核实',waiting_approval:'分析任务等待授权',waiting_external:'等待外部结果',waiting_reconciliation:'等待核实',succeeded:'分析完成',failed:'分析失败',cancelled:'分析已取消',cancelling:'正在取消'};
const escape = str => String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Pure snapshot projection, shared by settings and the compact panel.
export function proactiveSuggestions(snapshot) {
  const unique = new Map();
  for (const item of snapshot?.suggestions ?? []) {
    if (typeof item?.id === 'string' && item.id && typeof item.summary === 'string' && item.summary.trim()) unique.set(item.id, item);
  }
  return [...unique.values()];
}

const blockedCloudExport=item=>item?.cloudExport?.state==='blocked' && item.cloudExport.reason==='goal_text_limit'
  && Number.isSafeInteger(item.cloudExport.chars) && item.cloudExport.chars>16000 && item.cloudExport.maxChars===16000;
const exportLimitMessage=item=>`完整目标投影为 ${item.cloudExport.chars} 字符，当前云端上限为 16000 字符。未截断内容；完整方案保留在本地。`;

export function cognitionReviewFeedback(item = {}) {
  const verified = item.status === 'applied' && item.executionVerified === true && item.graphUpdateVerified === true;
  const state = item.status ?? item.state;
  const pendingReceipt = !item.taskId && state === 'pending';
  const reconciliationReceipt = !item.taskId && state === 'waiting_reconciliation';
  if(!verified && blockedCloudExport(item) && !item.taskId && ['local','selected','review','unavailable'].includes(state)) {
    return {message:exportLimitMessage(item)+' 尚未提交云端编排。',label:'云端内容超出上限',locked:true};
  }
  if(!verified && blockedCloudExport(item) && item.taskId && state==='failed') {
    return {message:'处理任务失败，目标更新尚未核实。'+exportLimitMessage(item)+' 原任务回执保留，请勿重复提交。',
      label:'已交给主智能体',locked:true};
  }

  const labels = {created:'处理任务已建立，等待规划',verifying:'正在核实处理结果',
    submitted:'处理任务已受理，目标更新尚未核实',pending:'等待主智能体处理',
    planning:'正在规划',running:'主智能体正在处理',waiting_approval:'处理任务等待授权',
    waiting_external:'等待外部结果',waiting_reconciliation:'处理结果待核实',
    succeeded:'编排任务已完成，目标更新尚未核实',failed:'处理任务失败，目标更新尚未核实',
    cancelling:'正在取消处理',cancelled:'处理任务已取消，目标更新尚未核实',
    unavailable:'当前无法交给主智能体处理',expired:'方案已过期，请重新分析',
    submission_unknown:'提交结果待核实，请勿重复提交'};
  return {message: verified ? '执行与目标更新已核实'
    : pendingReceipt ? '编排受理结果待核实，请勿重复提交；目标更新尚未核实'
    : reconciliationReceipt ? '处理结果待核实，请勿重复提交；目标更新尚未核实'
    : item.taskId && state === 'unavailable' ? '编排任务已受理，受控修复暂不可用；目标更新尚未核实'
    : item.taskId ? labels[state] ?? '处理状态待核实，目标更新尚未核实'
    : ['unavailable','expired','submission_unknown'].includes(state) ? labels[state] : '方案已记录，尚未交给主智能体处理',
    label: verified ? '更新已核实' : pendingReceipt || reconciliationReceipt ? '受理结果待核实' : item.taskId ? '已交给主智能体' : '交给主智能体处理',
    locked: verified || pendingReceipt || reconciliationReceipt || Boolean(item.taskId) || state === 'submission_unknown'};
}

export function mountProactiveControls(container, invoke, {settings = false} = {}) {
  const section = document.createElement('section');
  section.className = settings ? 'feature-page' : 'proactive-notices';
  section.setAttribute('aria-label', settings ? '主动变化提醒设置' : '主动变化提醒');
  section.innerHTML = `<h2>主动变化提醒</h2>${settings ? '<p class="notice">仅读取 CPU / 内存占用，每 30 秒采样一次。本次应用会话最长 8 小时；关闭监控或退出应用立即撤销，重启后不恢复开关。实际执行仍需经过本地 Policy 校验与必要审批。</p><form class="settings-list"><label class="setting-row"><input type="checkbox" name="enabled">开启电脑状态监控</label><label class="setting-row"><input type="checkbox" name="cloudAnalysis">允许持续 CPU / 内存压力触发 AgentArts 自动分析</label><p class="notice">云端分析默认关闭。启用后，持续 CPU / 内存压力会自动触发 AgentArts 分析，仅发送最小脱敏指标：CPU / 内存占用比例、来源及采样时间；也可手动请求分析。保存设置不表示系统调整已获授权。</p><button class="btn btn-sm" type="submit">保存主动提醒设置</button><p class="notice" data-feedback role="status"></p></form>' : ''}<p class="notice" data-status role="status"></p><div data-suggestions></div><div data-cognition-reviews class="cognition-reviews"></div>`;
  container.append(section);
  const status = section.querySelector('[data-status]');
  const list = section.querySelector('[data-suggestions]');
  const reviewsList = section.querySelector('[data-cognition-reviews]');
  const form = section.querySelector('form');
  const feedback = section.querySelector('[data-feedback]');
  const cognitionStatus=document.createElement('p');
  cognitionStatus.className='notice';cognitionStatus.setAttribute('role','status');
  status.after(cognitionStatus);
  if(form) form.querySelector('button').insertAdjacentHTML('beforebegin',
    '<h3>目标与计划变化</h3><label class="setting-row"><input type="checkbox" name="goalAnalysis">开启本地 Laya 目标变化分析</label><label class="setting-row"><input type="checkbox" name="goalCloudAnalysis">允许把选中的方案交给 AgentArts 规划</label><p class="notice">需要先在本地模型设置中启动 Laya。云端规划将接收受影响的目标、决策和计划描述（包括私人目标描述）及公开事实；标为受限的节点和非公开来源事实不会发送。仅在本次会话生效，关闭后停止新分析和新的出云请求；已执行的动作不会撤回。工具执行仍经过 Policy。</p>');
  const fields=['enabled','cloudAnalysis','goalAnalysis','goalCloudAnalysis'];
  let current, dirty = false, saving = false, localSaving=false, snapshotRevision=0;
  const localFeedback=document.createElement('p');localFeedback.className='notice';localFeedback.setAttribute('data-local-feedback','');localFeedback.setAttribute('role','status');reviewsList.after(localFeedback);
  const rows = new Map(), pending = new Set();
  const cognitionPending = new Set();
  // Keep identified acceptance or uncertainty when a redraw replaces the action's DOM nodes.
  const cognitionOutcomes = new Map();
  const triggerExpansion = new Map();
  let renderedReviewsBinding, renderedReviewsHTML;
  const reviewBinding = value => {
    const seen = new Set();
    const encode = item => {
      if (item === null || typeof item === 'undefined' || typeof item === 'string' || typeof item === 'boolean') return [typeof item, item ?? null];
      if (typeof item === 'number' && Number.isFinite(item)) return ['number', item];
      if (typeof item !== 'object' || seen.has(item)) throw Error('Unserializable review binding');
      seen.add(item);
      if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype) throw Error('Unserializable review binding');
      if (Reflect.ownKeys(item).some(key => typeof key !== 'string' || Object.getOwnPropertyDescriptor(item, key).get)) throw Error('Unserializable review binding');
      if (Array.isArray(item) && Object.keys(item).some(key => !/^(0|[1-9]\d*)$/.test(key))) throw Error('Unserializable review binding');
      const encoded = Array.isArray(item) ? ['array', item.map(encode)] : ['object', Object.keys(item).sort().map(key => [key, encode(item[key])])];
      seen.delete(item);
      return encoded;
    };
    try {return JSON.stringify(encode(value));} catch {return undefined;}
  };
  const handoffPermissionFeedback = () => current?.cognition?.enabled === false
    ? {message:'目标分析已关闭，请先在设置中开启',label:'交给主智能体处理',locked:true}
    : current?.cognition?.cloudAllowed === false
      ? {message:'目标云端规划许可未开启，请先在设置中允许',label:'交给主智能体处理',locked:true} : null;
  const currentReviewFeedback = id => {
    const item = current?.cognition?.reviews?.find(review => review.reviewTaskId === id);
    return item ? cognitionReviewFeedback(item) : null;
  };
  const localKeepFeedback = item => item?.action === 'KEEP' && !item.taskId
    && (item.status ?? item.state) === 'local'
    ? {message:'保持现状，无需交给主智能体处理',label:'保持现状',locked:true} : null;
  const sourceOutdatedFeedback = item => item?.sourceOutdated === true && !item.taskId
    ? {message:'分析所用的图版本已变化，当前方案不能提交。',label:'来源版本已变化',locked:true} : null;
  function reviewFeedback(item) {
    const feedback = cognitionReviewFeedback(item);
    if (feedback.locked) {
      cognitionOutcomes.set(item.reviewTaskId, feedback);
      return feedback;
    }
    const retained = cognitionOutcomes.get(item.reviewTaskId) ?? feedback;
    return retained.locked ? retained : sourceOutdatedFeedback(item) ?? localKeepFeedback(item) ?? handoffPermissionFeedback() ?? retained;
  }
  function syncReview(id, completed) {
    renderedReviewsBinding = undefined;
    const item = current?.cognition?.reviews?.find(review => review.reviewTaskId === id);
    const latest = item ? reviewFeedback(item) : null;
    const feedback = latest?.locked ? latest
      : cognitionOutcomes.get(id) ?? completed;
    if (!feedback) return;
    for (const card of reviewsList.querySelectorAll('.cognition-review-card')) {
      if (card.dataset.reviewId !== id) continue;
      const button = card.querySelector('[data-action="apply-cognition"]');
      button.textContent = feedback.label;
      button.disabled = cognitionPending.has(id) || feedback.locked;
      card.querySelector('.cognition-status').innerHTML = `<strong>处理状态：</strong>${escape(feedback.message)}`;
      card.querySelector('[data-feedback-id]').textContent = feedback.message;
    }
  }
  if (reviewsList) {
    reviewsList.addEventListener('click', async event => {
      const localButton=event.target.closest('button[data-action="retain-local-cognition"]');
      if(localButton) {
        const item=current?.cognition?.reviews?.find(review=>review.reviewTaskId===localButton.dataset.reviewId);
        if(localButton.disabled || localSaving || saving || !blockedCloudExport(item) || current?.cognition?.cloudAllowed!==true
          || typeof current.cognition.enabled!=='boolean') return;
        const enabled=current.cognition.enabled,revision=snapshotRevision;
        localSaving=true;localFeedback.textContent='正在关闭目标云端许可，完整本地方案保留…';render(current);
        try {
          const result=await invoke('proactive.configure',{goalAnalysis:enabled,goalCloudAnalysis:false});
          const observed=snapshotRevision>revision+1?current:result;
          if(observed?.cognition?.cloudAllowed!==false || observed?.cognition?.enabled!==enabled) throw Error('目标云端许可关闭状态尚未核实，请查看当前设置');
          render(observed);localFeedback.textContent='已关闭目标云端许可，完整方案保留在本地。本地分析开关保持原状态；原任务与已执行动作不会撤回。';
        } catch(error) {localFeedback.textContent=error.message;}
        finally {localSaving=false;render(current);}
        return;
      }
      const button = event.target.closest('button[data-action="apply-cognition"]');
      if (!button || button.disabled) return;
      const reviewTaskId = button.dataset.reviewId;
      if (!reviewTaskId || cognitionPending.has(reviewTaskId)) return;
      // A published denial is known before dispatch; it is not an unknown submission.
      if (handoffPermissionFeedback()) {syncReview(reviewTaskId, handoffPermissionFeedback());return;}
      const keep = localKeepFeedback(current?.cognition?.reviews?.find(review => review.reviewTaskId === reviewTaskId));
      if (keep) {syncReview(reviewTaskId, keep);return;}
      const outdated = sourceOutdatedFeedback(current?.cognition?.reviews?.find(review => review.reviewTaskId === reviewTaskId));
      if (outdated) {syncReview(reviewTaskId, outdated);return;}
      const initial = currentReviewFeedback(reviewTaskId);
      cognitionPending.add(reviewTaskId);
      button.disabled = true;
      const card = button.closest('.cognition-review-card');
      const cardNotice = card?.querySelector('[data-feedback-id]');
      if (cardNotice) cardNotice.textContent = '正在交给主智能体处理…';
      let completed;
      try {
        const result = await invoke('proactive.cognition.apply', {reviewTaskId});
        if (result?.reviewTaskId !== reviewTaskId
          || !['applied','unavailable','expired','pending','submitted','succeeded','failed','cancelled',
            'waiting_approval','waiting_reconciliation'].includes(result.status)
          || typeof result.executionVerified !== 'boolean' || typeof result.graphUpdateVerified !== 'boolean') {
          throw Error('处理回执尚未核实');
        }
        const receipt = cognitionReviewFeedback(result);
        const latest = currentReviewFeedback(reviewTaskId);
        const retained = cognitionOutcomes.get(reviewTaskId);
        completed = latest?.locked ? latest : retained?.locked ? retained : receipt.locked ? receipt
          : latest && (latest.message !== initial?.message || latest.label !== initial?.label) ? latest : receipt;
        if (completed.locked) cognitionOutcomes.set(reviewTaskId, completed);
      } catch {
        const latest = currentReviewFeedback(reviewTaskId);
        completed = latest?.locked ? latest : cognitionOutcomes.get(reviewTaskId)
          ?? {...cognitionReviewFeedback({status:'submission_unknown'}), label:'受理结果待核实'};
        cognitionOutcomes.set(reviewTaskId, completed);
      } finally {
        cognitionPending.delete(reviewTaskId);
        syncReview(reviewTaskId, completed);
      }
    });
  }
  if (form) {
    form.addEventListener('change', () => {dirty = true; feedback.textContent = '有未保存的设置';});
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (saving || localSaving || !current) return;
      saving = true; form.querySelector('button').disabled = true;
      const payload = Object.fromEntries(fields.map(name=>[name,form.elements[name].checked]));
      for(const name of fields) form.elements[name].disabled=true;
      feedback.textContent = '正在保存设置…';
      try {
        await invoke('proactive.configure', payload);
        dirty = false;
        feedback.textContent = '设置已保存。监控与授权状态以当前读回为准；实际执行仍需 Policy 校验。';
      } catch (error) {feedback.textContent = error.message;}
      finally {
        saving = false;
        render(current);
      }
    });
  }
  function render(snapshot) {
    current = snapshot;snapshotRevision++;
    const items = proactiveSuggestions(snapshot);
    const cognitionReviews = Array.isArray(snapshot?.cognition?.reviews) ? snapshot.cognition.reviews : [];
    if (!settings) section.hidden = items.length === 0 && !snapshot?.cognition?.enabled && cognitionReviews.length === 0;
    cognitionStatus.hidden=!snapshot?.cognition;
    cognitionStatus.textContent=snapshot?.cognition ? `目标分析：${snapshot.cognition.reason}` : '';
    status.textContent = snapshot ? `${statusNames[snapshot.status] ?? '状态未知'}${snapshot.reason ? ` · ${snapshot.reason}` : ''}` : '主动监控尚未连接';
    if (form) {
      if (!dirty && !saving) {
        form.elements.enabled.checked = snapshot?.enabled === true; form.elements.cloudAnalysis.checked = snapshot?.cloudAnalysis === true;
        form.elements.goalAnalysis.checked=snapshot?.cognition?.enabled===true;
        form.elements.goalCloudAnalysis.checked=snapshot?.cognition?.cloudAllowed===true;
      }
      for(const name of fields) form.elements[name].disabled=!snapshot || saving || localSaving;
      form.querySelector('button').disabled = !snapshot || saving || localSaving;
    }
    const ids = new Set(items.map(item => item.id));
    for (const [id, row] of rows) if (!ids.has(id)) {row.remove(); rows.delete(id);}
    for (const item of items) {
      let row = rows.get(item.id);
      if (!row) {
        row = document.createElement('article'); row.className = 'task';
        row.innerHTML = '<p data-summary></p><p class="notice" data-analysis></p><p class="assistant-message" data-result></p><button class="btn btn-sm" type="button">交给主智能体分析</button><p class="notice" data-action-status role="status"></p>';
        row.querySelector('button').addEventListener('click', async () => {
          if (row.querySelector('button').disabled || pending.has(item.id)) return;
          pending.add(item.id); row.querySelector('button').disabled = true;
          const receipt = row.querySelector('[data-action-status]'); receipt.textContent = '正在请求分析…';
          try {await invoke('proactive.analyze', {id:item.id}); receipt.textContent = '分析请求已返回，结果以任务状态读回为准。';}
          catch (error) {receipt.textContent = error.message;}
          finally {pending.delete(item.id); render(current);}
        });
        rows.set(item.id, row); list.append(row);
      }
      row.querySelector('[data-summary]').textContent = item.summary;
      const details = [analysisNames[item.analysisState] ?? (item.status === 'suggested' ? '本地建议，尚未执行系统调整' : item.status ?? '')];
      if (item.analysisTaskId) details.push(`任务：${item.analysisTaskId}`);
      row.querySelector('[data-analysis]').textContent = details.filter(Boolean).join(' · ');
      const result = typeof item.result === 'string' ? item.result : typeof item.analysisTask?.resultSummary === 'string' ? item.analysisTask.resultSummary : '';
      row.querySelector('[data-result]').textContent = result;
      row.querySelector('[data-result]').hidden = !result;
      const button = row.querySelector('button');
      const allowed = snapshot?.enabled && snapshot?.cloudAnalysis && snapshot?.status === 'monitoring' && item.kind === 'system_pressure';
      button.disabled = !allowed || Boolean(item.analysisTaskId) || pending.has(item.id);
      button.title = item.analysisTaskId ? '分析任务已受理，请查看任务状态' : item.kind !== 'system_pressure' ? '当前云端授权仅覆盖 CPU / 内存采样；此建议尚无已授权投影' : !snapshot?.cloudAnalysis ? '请在设置 → 电脑操控中开启云端分析' : !allowed ? '请先开启监控并完成必要授权' : '仅提交分析；实际执行仍需 Policy 校验';
    }
    if (reviewsList) {
      // Capture the native state before replacing nodes; periodic snapshots must not close a reader's disclosure.
      let focusedTriggerReview;
      const focusedAction=reviewsList.contains(document.activeElement)&&document.activeElement.matches('button[data-action="apply-cognition"],button[data-action="retain-local-cognition"]')?document.activeElement:null;
      const actionIdentity=button=>JSON.stringify(Object.entries(button.dataset).sort(([a],[b])=>a.localeCompare(b)));
      const focusedActionIdentity=focusedAction&&!focusedAction.disabled?actionIdentity(focusedAction):null;
      for(const details of reviewsList.querySelectorAll('details[data-trigger-review]')) {
        triggerExpansion.set(details.dataset.triggerReview,details.open);
        if(details.querySelector('summary')===document.activeElement)focusedTriggerReview=details.dataset.triggerReview;
      }
      const reviewIds=new Set(cognitionReviews.map(item=>item.reviewTaskId));
      for(const id of triggerExpansion.keys()) if(!reviewIds.has(id)) triggerExpansion.delete(id);
      let reviewsHTML = '';
      if (cognitionReviews.length > 0) {
        reviewsHTML = '<h3 class="cognition-review-title">目标与计划决策</h3>' + cognitionReviews.map(r => {
          const feedback = reviewFeedback(r);
          return `
          <article class="task cognition-review-card" data-review-id="${escape(r.reviewTaskId || '')}">
            ${typeof r.trigger==='string' && r.trigger.length>320
              ? `<details data-trigger-review="${escape(r.reviewTaskId || '')}" ${triggerExpansion.get(r.reviewTaskId) ? 'open' : ''}><summary>查看完整触发原因</summary><p class="cognition-trigger assistant-message"><strong>触发原因：</strong>${escape(r.trigger)}</p></details>`
              : `<p class="cognition-trigger assistant-message"><strong>触发原因：</strong>${escape(r.trigger || '事实或目标变更')}</p>`}
            <p class="cognition-choice assistant-message"><strong>Laya 方案：</strong>${escape(r.choice || '本地决策建议')}</p>
            <p class="notice cognition-status"><strong>处理状态：</strong>${escape(feedback.message)}</p>
            <div class="cognition-actions">
              <button class="btn btn-sm" type="button" data-action="apply-cognition" data-review-id="${escape(r.reviewTaskId || '')}" ${feedback.locked || cognitionPending.has(r.reviewTaskId) ? 'disabled' : ''}>
                ${feedback.label}
              </button>
              ${blockedCloudExport(r) && snapshot?.cognition?.cloudAllowed===true ? `<button class="btn btn-sm" type="button" data-action="retain-local-cognition" data-review-id="${escape(r.reviewTaskId || '')}" ${saving || localSaving ? 'disabled' : ''}>保留本地方案，关闭目标云端许可</button>` : ''}
              <span class="notice" data-feedback-id="${escape(r.reviewTaskId || '')}">${cognitionPending.has(r.reviewTaskId) && !feedback.locked ? '正在交给主智能体处理…' : ''}</span>
            </div>
          </article>
        `;
        }).join('');
      }
      const binding = reviewBinding({reviews:cognitionReviews,cognition:snapshot?.cognition,pending:[...cognitionPending],saving,localSaving});
      if (binding === undefined || binding !== renderedReviewsBinding || reviewsHTML !== renderedReviewsHTML) reviewsList.innerHTML = reviewsHTML;
      renderedReviewsBinding = binding;
      renderedReviewsHTML = reviewsHTML;
      if(focusedTriggerReview!==undefined) {
        for(const details of reviewsList.querySelectorAll('details[data-trigger-review]')) {
          if(details.dataset.triggerReview===focusedTriggerReview) {details.querySelector('summary').focus({preventScroll:true});break;}
        }
      }
      if(focusedActionIdentity!==null&&document.activeElement===document.body) {
        const button=[...reviewsList.querySelectorAll('button[data-action]')].find(item=>{const review=cognitionReviews.find(review=>review.reviewTaskId===item.dataset.reviewId);return review&&!item.disabled&&!['expired','succeeded','failed','cancelled','applied'].includes(review.status??review.state)&&actionIdentity(item)===focusedActionIdentity;});
        if(button)button.focus({preventScroll:true});
      }
    }
  }
  return {render, show(visible) {section.hidden = !visible;}};
}
