import {errorDisplayText} from '../shared/error-display.js';
const $=id=>document.getElementById(id);
let state,task,busy=false;
const labels={unconfigured:'未配置',unavailable:'安全存储不可用',saved_disconnected:'已保存，默认断开',connected:'本次会话已连接',expired:'凭据已到期',reassembly_required:'配置已变化，请正常退出并重启',identity_conflict:'工具名冲突，请修改配置',revoke_pending:'配置文件清除失败，撤销未完成'};
function paint(){
  if(!state)return;
  if(state.services){const items=state.services.map(item=>{const option=document.createElement('option');option.value=item.id;
    option.textContent=`${item.id} · ${labels[item.status]??item.status}`;return option;});
    if(!state.services.some(item=>item.id===state.activeId)){const option=document.createElement('option');option.value=state.activeId;option.textContent=`${state.activeId} · 新服务`;items.push(option);}
    $('server').replaceChildren(...items);$('server').value=state.activeId;}
  $('server').disabled=busy;$('new-server').disabled=busy;$('migrate-server').disabled=busy;
  $('status').textContent=(labels[state.status]??'尚未连接')+(state.runtimeAvailable?'':'；Runtime 未初始化，暂不可调用');
  $('definition').textContent=JSON.stringify(state.draft??state.definition??{},null,2);
  $('connect').disabled=busy || !state.configured || state.requiresReassembly || ['expired','unavailable','revoke_pending'].includes(state.status);
  $('submit').disabled=busy || !state.connected || !state.runtimeAvailable;
  $('save').disabled=busy || !(state.draft||state.definition);
  $('import').disabled=busy;
  $('review-question').disabled=busy || task?.approval?.state!=='pending' || task?.state!=='waiting_approval' || !state.connected
    || (task?.serverId && task.serverId!==state.activeId);
  $('question-notice').hidden=task?.state!=='waiting_approval';
  $('cancel').disabled=busy || !task || ['succeeded','failed','cancelled'].includes(task.state);
  $('task-result').textContent=task?JSON.stringify(task,null,2):'尚未选择任务。';
  $('tasks').replaceChildren(...state.tasks.map(item=>{const button=document.createElement('button');button.textContent=`${item.serverId?item.serverId+' · ':''}${item.taskId} · ${item.state}`;
    button.addEventListener('click',()=>{ $('task-id').value=item.taskId;void act('task',{taskId:item.taskId}); });return button;}));
}
async function invoke(name,payload){const value=await window.remoteMcp.invoke(name,payload);if(!value.ok)throw Error(errorDisplayText(value.error,'ipc'));return value.value;}
async function update(){state=await invoke('state');if(task)task=await invoke('task',{taskId:task.taskId});paint();}
async function act(name,payload){
  if(busy && !['disconnect','revoke'].includes(name))return;
  busy=true;$('error').textContent='';paint();
  try{const result=await invoke(name,payload);if(result?.taskId){task=result;$('task-id').value=task.taskId;}await update();}
  catch(error){$('error').textContent=error.message;try{await update();}catch{}}
  finally{busy=false;paint();}
}
for(const name of ['import','connect','disconnect','revoke'])$(name).addEventListener('click',()=>void act(name));
$('server').addEventListener('change',()=>void act('select',{id:$('server').value}));
$('new-server').addEventListener('click',()=>void act('new',{id:$('server-id').value.trim()}));
$('migrate-server').addEventListener('click',()=>void act('migrate',{id:$('server-id').value.trim()}));
$('refresh').addEventListener('click',()=>void act('state'));
$('save-form').addEventListener('submit',event=>{event.preventDefault();const payload={token:$('token').value,expiresAt:$('expires').value};$('token').value='';void act('save',payload);});
$('run-form').addEventListener('submit',event=>{event.preventDefault();try{void act('submit',JSON.parse($('arguments').value));}catch{$('error').textContent='业务参数必须为有效 JSON';}});
$('read-task').addEventListener('click',()=>void act('task',{taskId:$('task-id').value.trim()}));
$('review-question').addEventListener('click',()=>void act('focusQuestion',{taskId:task.taskId}));
$('cancel').addEventListener('click',()=>void act('cancel',{taskId:task.taskId}));
const timer=setInterval(()=>{if(!busy)void update().catch(()=>{});},1000);
window.addEventListener('unload',()=>{clearInterval(timer);$('token').value='';});
void act('state');
