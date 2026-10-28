import {defaultNotificationSettings} from '../../../shared/notification-defaults.js';
/** Current notification policy/feed consumer. No credentials or final-voice claims enter IPC. */
export function mountNotificationSettings(root, invoke) {
  const section=document.createElement('section');section.className='sheet notification-settings';
  section.innerHTML=`<h2>通知与打扰</h2><p>静默仍接收变化并继续已授权工作。投递、已读和归来摘要分别保存。</p>
    <form data-notifications="form" class="settings-form">
    <label>通知范围<select name="scope"><option value="global">所有应用</option><option value="connector">指定应用</option><option value="responsibility">指定任务（高级）</option></select></label>
    <label data-notifications="connector-field" hidden>选择应用<select name="connector"><option value="mail">邮件</option><option value="calendar">日历</option><option value="productivity">待办</option><option value="feeds">订阅</option><option value="weather">天气</option></select></label>
    <label data-notifications="responsibility-field" hidden>任务标识<input name="responsibility" maxlength="256"></label>
    <label>提醒方式<select name="mode" required><option value="normal">正常提醒</option><option value="silent">静默收集</option></select></label>
    <label>提醒通道<select name="channel" required><option value="banner">系统横幅</option><option value="auto">自动选择</option><option value="voice">语音（待设备接线）</option></select></label>
    <p class="notice">默认启用系统横幅，不限制提醒次数。高级参数已填好，可直接保存。</p>
    <details style="grid-column:1/-1"><summary>高级设置：频率、摘要与安静时段</summary><div class="settings-form">
    <button type="button" data-notifications="load">重新读取当前设置</button>
    <label>窗口分钟数<input name="window" type="number" min="0.001" step="any" required></label>
    <label>窗口最多打扰次数<input name="maximum" type="number" min="0" step="1"></label><label class="notification-check"><input name="unlimited" type="checkbox">不设数值上限</label>
    <label>静默至（留空表示持续静默或不设截止）<input name="until" type="datetime-local"></label>
    <label class="notification-check"><input name="urgent" type="checkbox">允许可信紧急事项突破静默，仍遵守额度</label>
    <label>摘要方式<select name="digest" required><option value="on_demand">主动查看时</option><option value="on_return">归来时</option><option value="scheduled">原调度触发时</option></select></label>
    <label>安静时段开始<input name="quietStart" type="time"></label><label>安静时段结束<input name="quietEnd" type="time"></label>
    <label>时区（留空自动使用本机时区）<input name="timezone" maxlength="100" placeholder="自动识别"></label>
    </div></details><button class="btn" type="submit">保存设置</button></form>
    <p data-notifications="status" role="status"></p><p data-notifications="question" role="status"></p>
    <h3>当前待审批</h3><ul data-notifications="approvals"></ul>
    <h3>通知中心</h3><button class="btn" type="button" data-notifications="digest">查看未读摘要</button>
    <button class="btn" type="button" data-notifications="return">查看归来摘要</button>
    <p data-notifications="digest-result" role="status"></p><ul data-notifications="feed"></ul>`;
  root.append(section);
  const field=name=>section.querySelector(`[data-notifications="${name}"]`),form=field('form');
  let state={},question=null,approvals=[],busy=false,dirty=false,scopeLoaded=true;
  let selectedPolicy;
  const scopeKey=value=>JSON.stringify([value?.kind,value?.connectorId??'',value?.responsibilityId??'']);
  const element=name=>form.elements.namedItem(name);
  function scope() {
    const kind=element('scope').value,connectorId=element('connector').value.trim(),responsibilityId=element('responsibility').value.trim();
    if (kind==='global') return {kind};
    if(kind==='connector' && !connectorId || kind==='responsibility' && !responsibilityId)throw Error('请填写当前作用域的标识');
    return kind==='connector'?{kind,connectorId}:{kind,responsibilityId,...(connectorId?{connectorId}:{})};
  }
  function settings() {
    if(!form.reportValidity() || !scopeLoaded || scopeKey(selectedPolicy?.scope)!==scopeKey(scope()))throw Error('请先读取当前范围并完整填写参数');
    const maximum=element('maximum').value;
    if(!element('unlimited').checked && maximum==='')throw Error('请明确次数，或选择不设数值上限');
    const quietStart=element('quietStart').value,quietEnd=element('quietEnd').value,
      timeZone=element('timezone').value.trim()||(quietStart&&quietEnd?Intl.DateTimeFormat().resolvedOptions().timeZone:'');
    if((quietStart||quietEnd||timeZone) && !(quietStart&&quietEnd&&timeZone))throw Error('安静时段需要开始、结束和时区');
    return {operationId:crypto.randomUUID(),expectedRevision:selectedPolicy.revision,scope:scope(),patch:{
      mode:element('mode').value,windowMinutes:Number(element('window').value),maxInterruptions:element('unlimited').checked?null:Number(maximum),
      silentUntilUtc:element('until').value?new Date(element('until').value).toISOString():null,preferredChannel:element('channel').value,
      allowUrgentBreakthrough:element('urgent').checked,digestMode:element('digest').value,
      quietHours:quietStart?{startLocal:quietStart,endLocal:quietEnd,timeZone}:null}};
  }
  async function run(action, payload) {
    if(busy)return;
    busy=true;render(state,question,approvals);field('status').textContent='正在读取原 Runtime 回执…';
    try {
      const result=await invoke(action,payload);
      if(action==='notifications.get'){state=result;selectedPolicy=result.policy;scopeLoaded=scopeKey(selectedPolicy?.scope)===scopeKey(scope());dirty=false;}
      if(action==='notifications.configure') {
        state=result.notificationCenter??state;selectedPolicy=state.policy;dirty=false;
        field('status').textContent=result.state==='confirmed'?'设置已生效；原任务 '+result.taskId:'设置结果待原任务核实：'+result.taskId;
      } else if(action==='notifications.digest') field('digest-result').textContent=`仍有效未读变化 ${result.items.length} 条；未发送通知，也未标记已读。`;
      else if(action.includes('confirmation')) question=result;
      else field('status').textContent='已读取原回执';
    } catch(error) {field('status').textContent=error.message;}
    finally {busy=false;render(state,question,approvals);}
  }
  form.oninput=event=>{
    dirty=true;
    if(event.target.name==='maximum'&&element('maximum').value!=='')element('unlimited').checked=false;
    if(['scope','connector','responsibility'].includes(event.target.name))scopeLoaded=false;
  };
  form.onchange=event=>{
    if(['scope','connector'].includes(event.target.name)){
      if(element('scope').value==='connector'&&!element('connector').value)element('connector').value='mail';
      try{void run('notifications.get',{scope:scope()});}catch(error){field('status').textContent=error.message;}
    }
  };
  form.onsubmit=event=>{event.preventDefault();try{void run('notifications.configure',settings());}catch(error){field('status').textContent=error.message;}};
  field('load').onclick=()=>{try{void run('notifications.get',{scope:scope()});}catch(error){field('status').textContent=error.message;}};
  field('digest').onclick=()=>run('notifications.digest',{trigger:'on_demand'});field('return').onclick=()=>run('notifications.digest',{trigger:'on_return'});
  function render(value={},currentQuestion=null,pendingApprovals=[]) {
    state=value??{};question=currentQuestion;approvals=pendingApprovals;
    // Global feed broadcasts must not replace another scope's loaded policy/revision.
    let requestedScope;try{requestedScope=scope();}catch{}
    if(!dirty&&!busy&&requestedScope&&scopeKey(state.policy?.scope)===scopeKey(requestedScope))selectedPolicy=state.policy;
    for(const control of section.querySelectorAll('button,input,select'))control.disabled=busy||!state.available;
    const connectorField=field('connector-field'),responsibilityField=field('responsibility-field');
    if(connectorField)connectorField.hidden=element('scope').value==='global';
    if(responsibilityField)responsibilityField.hidden=element('scope').value!=='responsibility';
    if(!dirty&&!busy) {
      const p=selectedPolicy?.effective??defaultNotificationSettings;
      if(p) {
        element('mode').value=p.mode;element('window').value=String(p.windowMinutes);element('maximum').value=p.maxInterruptions===null?'':String(p.maxInterruptions);
        element('unlimited').checked=p.maxInterruptions===null;element('channel').value=p.preferredChannel;element('urgent').checked=p.allowUrgentBreakthrough;
        element('digest').value=p.digestMode;element('quietStart').value=p.quietHours?.startLocal??'';element('quietEnd').value=p.quietHours?.endLocal??'';
        element('timezone').value=p.quietHours?.timeZone??'';
        element('until').value=p.silentUntilUtc?new Date(Date.parse(p.silentUntilUtc)-new Date(p.silentUntilUtc).getTimezoneOffset()*60000).toISOString().slice(0,16):'';
      }
    }
    field('question').textContent='需要确认的操作会显示在原对话授权卡，点击同意或拒绝即可。';
    field('approvals').replaceChildren();
    for(const approval of approvals.filter(value=>value.state===undefined||value.state==='pending')) {
      const li=document.createElement('li'),button=document.createElement('button');button.className='btn btn-sm';button.type='button';button.disabled=busy||!state.available;
      li.textContent=`${approval.action??approval.toolName??approval.approvalId} `;button.textContent='查看授权卡';button.disabled||=!approval.taskId;
      button.onclick=()=>run('task.openConversation',{taskId:approval.taskId});li.append(button);field('approvals').append(li);
    }
    field('feed').replaceChildren();
    for(const item of state.feed?.items??[]) {
      const row=document.createElement('li'),button=document.createElement('button');button.className='btn btn-sm';button.type='button';button.textContent='标为已读';button.disabled=busy||!item.unread;
      row.textContent=`${item.source} · ${item.contentRef} · ${item.validity} · ${item.deliveredAt?'已投递':'未确认投递'} · ${item.unread?'未读':'已读'} `;
      button.onclick=()=>run('notifications.read',{operationId:crypto.randomUUID(),itemIds:[item.id]});row.append(button);field('feed').append(row);
    }
  }
  return {render,show(visible){section.hidden=!visible;}};
}
