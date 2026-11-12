import {errorDisplayText} from '../shared/error-display.js';
const $=id=>document.getElementById(id);
let state,task,busy=false;
const labels={unconfigured:'未配置',unavailable:'安全存储不可用',saved_disconnected:'已保存，默认断开',connected:'本次会话已连接',expired:'凭据已到期',reassembly_required:'配置已变化，请正常退出并重启',identity_conflict:'工具名冲突，请修改配置',revoke_pending:'配置文件清除失败，撤销未完成'};
const stateLabels={unconfigured:'未配置',unavailable:'安全存储不可用',saved_disconnected:'已保存，默认断开',connected:'本次会话已连接',expired:'凭据已到期',reassembly_required:'请重新打开应用（重启）后使用',identity_conflict:'名称冲突，请换一个名称',revoke_pending:'删除未完成'};
function describe(value){
  if(!value||!value.endpoint)return '还没有选择插件文件。';
  const name=value.tool?.descriptor?.name||value.server?.name||'插件';
  return `已选择 ${name}。地址：${value.endpoint}。密钥不会显示在这里。`;
}
function readExpiry(){
  const picked=$('expires-picker')?.value;
  if(picked){const date=new Date(picked);if(Number.isFinite(date.getTime()))return date.toISOString();}
  return $('expires').value.trim();
}
function paint(){
  if(!state)return;
  if(state.services){const items=state.services.map(item=>{const option=document.createElement('option');option.value=item.id;
    option.textContent=`${item.id} · ${stateLabels[item.status]??labels[item.status]??'未连接'}`;return option;});
    if(!state.services.some(item=>item.id===state.activeId)){const option=document.createElement('option');option.value=state.activeId;option.textContent=`${state.activeId} · 新插件`;items.push(option);}
    $('server').replaceChildren(...items);$('server').value=state.activeId;}
  $('server').disabled=busy;$('new-server').disabled=busy;$('migrate-server').disabled=busy;
  $('status').textContent=(stateLabels[state.status]??labels[state.status]??'尚未连接')+(state.runtimeAvailable?'':'；Runtime 未初始化，暂不可调用');
  $('definition').textContent=describe(state.draft??state.definition);
  $('restart-note').textContent=state.requiresReassembly?'新添加的插件要重新打开应用后才能连接。已经在用的插件保存后可以直接连接。':'';
  $('connect').disabled=busy || !state.configured || state.requiresReassembly || ['expired','unavailable','revoke_pending'].includes(state.status);
  $('submit').disabled=busy || !state.connected || !state.runtimeAvailable;
  $('save').disabled=busy || !(state.draft||state.definition);
  $('import').disabled=busy;
  $('review-question').disabled=busy || task?.approval?.state!=='pending' || task?.state!=='waiting_approval' || !state.connected
    || (task?.serverId && task.serverId!==state.activeId);
  $('question-notice').hidden=task?.state!=='waiting_approval';
  $('cancel').disabled=busy || !task || ['succeeded','failed','cancelled'].includes(task.state);
  $('tasks').replaceChildren(...state.tasks.map(item=>{const button=document.createElement('button');button.textContent=`${item.serverId?item.serverId+' · ':''}${stateLabels[item.state]??item.state}`;
    button.addEventListener('click',()=>{void act('task',{taskId:item.taskId});});return button;}));
}
async function invoke(name,payload){const value=await window.remoteMcp.invoke(name,payload);if(!value.ok)throw Error(errorDisplayText(value.error,'ipc'));return value.value;}
async function update(){state=await invoke('state');if(task)task=await invoke('task',{taskId:task.taskId});paint();}
async function act(name,payload){
  if(busy && !['disconnect','revoke'].includes(name))return;
  busy=true;$('error').textContent='';paint();
  try{const result=await invoke(name,payload);if(result?.taskId)task=result;await update();}
  catch(error){$('error').textContent=error.message;try{await update();}catch{}}
  finally{busy=false;paint();}
}
for(const name of ['import','connect','disconnect','revoke'])$(name).addEventListener('click',()=>void act(name));
$('server').addEventListener('change',()=>void act('select',{id:$('server').value}));
$('new-server').addEventListener('click',()=>void act('new',{id:$('server-id').value.trim()}));
$('migrate-server').addEventListener('click',()=>void act('migrate',{id:$('server-id').value.trim()}));
$('save-form').addEventListener('submit',event=>{event.preventDefault();const payload={token:$('token').value,expiresAt:readExpiry()};$('token').value='';void act('save',payload);});
$('run-form').addEventListener('submit',event=>{
  event.preventDefault();
  const raw=$('arguments').value.trim();
  if(!raw){void act('submit',{});return;}
  try{const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('bad');void act('submit',parsed);}
  catch{$('error').textContent='补充条件没能识别。可以留空，或请准备插件的人给你一份条件。';}
});
$('review-question').addEventListener('click',()=>void act('focusQuestion',{taskId:task.taskId}));
$('cancel').addEventListener('click',()=>void act('cancel',{taskId:task.taskId}));
const timer=setInterval(()=>{if(!busy)void update().catch(()=>{});},1000);
window.addEventListener('unload',()=>{clearInterval(timer);$('token').value='';});
void act('state');
