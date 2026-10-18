const $=id=>document.getElementById(id);
let state,task,busy=false;
const labels={unconfigured:'未配置',unavailable:'安全存储不可用',saved_disconnected:'已保存，默认断开',connected:'本次会话已连接',expired:'凭据已到期',reassembly_required:'配置已变化，请正常退出并重启',revoke_pending:'配置文件清除失败，撤销未完成'};
function paint(){
  if(!state)return;
  $('status').textContent=(labels[state.status]??'尚未连接')+(state.runtimeAvailable?'':'；Runtime 未初始化，暂不可调用');
  $('definition').textContent=JSON.stringify(state.draft??state.definition??{},null,2);
  $('connect').disabled=busy || !state.configured || state.requiresReassembly || ['expired','unavailable','revoke_pending'].includes(state.status);
  $('submit').disabled=busy || !state.connected || !state.runtimeAvailable;
  $('save').disabled=busy || !(state.draft||state.definition);
  $('import').disabled=busy;
  $('approve').disabled=busy || task?.approval?.state!=='pending' || task?.state!=='waiting_approval' || !state.connected;
  $('deny').disabled=busy || task?.approval?.state!=='pending' || task?.state!=='waiting_approval';
  $('cancel').disabled=busy || !task || ['succeeded','failed','cancelled'].includes(task.state);
  $('task-result').textContent=task?JSON.stringify(task,null,2):'尚未选择任务。';
  $('tasks').replaceChildren(...state.tasks.map(item=>{const button=document.createElement('button');button.textContent=`${item.taskId} · ${item.state}`;
    button.addEventListener('click',()=>{ $('task-id').value=item.taskId;void act('task',{taskId:item.taskId}); });return button;}));
}
async function invoke(name,payload){const value=await window.remoteMcp.invoke(name,payload);if(!value.ok)throw Error(value.error);return value.value;}
async function update(){state=await invoke('state');if(task)task=await invoke('task',{taskId:task.taskId});paint();}
async function act(name,payload){
  if(busy && !['disconnect','revoke'].includes(name))return;
  busy=true;$('error').textContent='';paint();
  try{const result=await invoke(name,payload);if(result?.taskId){task=result;$('task-id').value=task.taskId;}await update();}
  catch(error){$('error').textContent=error.message;try{await update();}catch{}}
  finally{busy=false;paint();}
}
for(const name of ['import','connect','disconnect','revoke'])$(name).addEventListener('click',()=>void act(name));
$('refresh').addEventListener('click',()=>void act('state'));
$('save-form').addEventListener('submit',event=>{event.preventDefault();const payload={token:$('token').value,expiresAt:$('expires').value};$('token').value='';void act('save',payload);});
$('run-form').addEventListener('submit',event=>{event.preventDefault();try{void act('submit',JSON.parse($('arguments').value));}catch{$('error').textContent='业务参数必须为有效 JSON';}});
$('read-task').addEventListener('click',()=>void act('task',{taskId:$('task-id').value.trim()}));
for(const [id,decision] of [['approve','allow_once'],['deny','deny']])$(id).addEventListener('click',()=>void act('respond',{taskId:task.taskId,expectedRevision:task.approval.revision,decision}));
$('cancel').addEventListener('click',()=>void act('cancel',{taskId:task.taskId}));
const timer=setInterval(()=>{if(!busy)void update().catch(()=>{});},1000);
window.addEventListener('unload',()=>{clearInterval(timer);$('token').value='';});
void act('state');
