// Explicit synthetic child ports for real Electron/main/preload/renderer interaction tests.
// This fixture is never imported by production. It makes no model/network requests.
import {app,BrowserWindow,ipcMain} from 'electron';
import {handleWorkspaceSubagentAction} from '../electron/subagent-window-actions.js';
const records=new Map(['a','b','c'].map(id=>{const goal=({a:'梳理界面参考 · 演示',b:'核对改动结果 · 演示',c:'执行界面检查 · 演示'})[id];return [id,{parentTaskId:'synthetic-parent',taskId:id,role:'子智能体',state:id==='c'?'running':'succeeded',goal,resultSummary:'已保存回答 '+id+'（本地演示，无真实模型调用）',modelId:'本地演示',messages:[],canSubmit:id!=='c',transcriptAvailable:false,steps:[]}];}));
const children=()=>[...records.values()].map(({parentTaskId,taskId,role,state,modelId,goal})=>({parentTaskId,taskId,role,state,modelId,goal}));
records.get('c').activeTaskId='c';
globalThis.inlineSubagentFixture={calls:[],held:[],holdA:false,release(){for(const resolve of this.held.splice(0))resolve();}};
const state=globalThis.inlineSubagentFixture;
const read=async binding=>{const record=records.get(binding.taskId);if(!record||binding.parentTaskId!==record.parentTaskId)throw Error('Synthetic unrelated child');if(binding.taskId==='a'&&state.holdA)await new Promise(resolve=>state.held.push(resolve));return structuredClone(record);};
const decorate=(data,contents)=>contents.getURL().includes('mode=workspace')?{...data,subagentTasks:children()}:data;
app.on('web-contents-created',(_event,contents)=>{const send=contents.send.bind(contents);contents.send=(channel,...args)=>send(channel,...(channel==='desktop:update'?[decorate(args[0],contents),...args.slice(1)]:args));});
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,listener)=>handle(channel,channel==='desktop:action'?async(event,name,payload)=>{
  if(name.startsWith('workspace.subagent.')){
    const workspace=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=workspace'));
    try{return {ok:true,value:await handleWorkspaceSubagentAction({event,name,payload,window:workspace,readDetail:read,
      submit:async(binding,request)=>{state.calls.push({operation:'submit',binding,request});const record=records.get(binding.taskId);record.activeTaskId='execution-'+binding.taskId;record.canSubmit=false;record.messages.push({taskId:record.activeTaskId,userText:request.text,replyText:'这是一条本地演示回复，没有调用真实模型。',state:'running'});return structuredClone(record);},
      cancel:async(binding,executionTaskId)=>{if(executionTaskId!==records.get(binding.taskId).activeTaskId)throw Error('Synthetic foreign execution');state.calls.push({operation:'cancel',binding,executionTaskId});const record=records.get(binding.taskId);delete record.activeTaskId;record.canSubmit=true;if(record.messages.length)record.messages.at(-1).state='cancelled';else record.state='cancelled';return structuredClone(record);}})};}catch(error){return {ok:false,error:error.message};}
  }
  const result=await listener(event,name,payload);return name==='snapshot'&&result?.ok?{...result,value:decorate(result.value,event.sender)}:result;
}:listener);
await import('../electron/main.js');
