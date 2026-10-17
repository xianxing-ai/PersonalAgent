import {fileURLToPath} from 'node:url';
import {readFileSync,statSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';

const marker='desktop-remote-mcp-v1';
const exact=(value,keys)=>value && typeof value==='object' && !Array.isArray(value)
  && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
function reject(){throw Error('远程 MCP 操作被拒绝；请检查配置、原任务与当前会话');}

/** Dedicated trusted window; the regular admin can only open it. One owner per userData. */
export function createRemoteMcpManagement({BrowserWindow,ipcMain,dialog,owner,config,host,application,client,namespace,onUpdate=()=>{}}){
  const channel='desktop:remote-mcp';
  let current,closed=false,busy=false,configurationEpoch=0;
  function readTask(taskId){
    const app=application();
    if(!app || typeof taskId!=='string')reject();
    const selected=app.runtime.loadCheckpoint(taskId,marker),value=app.readHostToolTask(taskId);
    if(!selected || value.toolName!==selected.toolName || value.toolVersion!==selected.toolVersion)reject();
    const intent=app.runtime.loadCheckpoint(taskId,'host-tool-intent');
    return {taskId,state:value.task.state,toolName:value.toolName,toolVersion:value.toolVersion,
      arguments:intent.arguments.arguments,approval:value.approval,
      ...(value.confirmed?{result:value.confirmed.result,evidenceRefs:value.confirmed.evidenceRefs}:{} )};
  }
  function state(){
    const saved=config.hostConfiguration(),app=application();
    const tasks=app?app.runtime.listTasks({conversationId:`host-tool:${namespace}`,limit:50}).items
      .filter(task=>app.runtime.loadCheckpoint(task.taskId,marker)).map(task=>({taskId:task.taskId,state:task.state})):[];
    return {...host.snapshot(),runtimeAvailable:!!app,tasks,
      ...(saved?{definition:{endpoint:saved.endpoint,server:saved.server,tool:saved.tool,directoryDigest:saved.directoryDigest}}:{}),
      ...(current?.draft?{draft:current.draft}:{})};
  }
  function assertWindow(origin){if(closed || !origin || current!==origin || origin.window.isDestroyed() || origin.signal.aborted)reject();}
  async function confirm(origin,title,message,detail,signal=origin.signal){
    assertWindow(origin);
    const answer=await dialog.showMessageBox(origin.window,{type:'question',title,message,detail,
      buttons:['取消','确认'],defaultId:0,cancelId:0,noLink:true,signal});
    return current===origin && !origin.window.isDestroyed() && !signal.aborted && answer.response===1;
  }
  const request=async(event,name,payload)=>{
    const origin=current;
    if(!origin || event.sender!==origin.window.webContents || event.senderFrame!==event.sender.mainFrame)reject();
    assertWindow(origin);
    if(name==='state'){if(payload!==undefined)reject();return state();}
    if(name==='disconnect' || name==='revoke'){
      if(payload!==undefined)reject();
      if(name==='revoke'){
        if(!await confirm(origin,'撤销远程 MCP','撤销本机配置和当前连接？','停止当前连接并清除本应用加密配置。原任务、执行记录与 Evidence 保留；不撤销服务端 token。'))return state();
        configurationEpoch++;config.revoke();origin.draft=undefined;
      }
      await host.disconnect();onUpdate();return state();
    }
    if(busy)reject();busy=true;
    try{
      if(name==='import'){
        if(payload!==undefined)reject();
        const result=await dialog.showOpenDialog(origin.window,{title:'选择只读 MCP 服务定义（不含密钥）',properties:['openFile'],filters:[{name:'服务定义',extensions:['json']}]});
        assertWindow(origin);if(result.canceled)return state();
        if(result.filePaths.length!==1 || !statSync(result.filePaths[0]).isFile() || statSync(result.filePaths[0]).size>256*1024)reject();
        const raw=readFileSync(result.filePaths[0]);if(raw.length>256*1024)reject();const value=JSON.parse(raw.toString('utf8'));
        if(!exact(value,['endpoint','server','tool','directoryDigest']) || typeof value.endpoint!=='string'
          || !/^mcp\.remote\.[a-z][a-z0-9_.-]*$/.test(value.tool?.descriptor?.name))reject();
        origin.draft=value;return state();
      }
      if(name==='save'){
        if(!exact(payload,['token','expiresAt']) || typeof payload.token!=='string' || payload.token.length>8192 || typeof payload.expiresAt!=='string')reject();
        const definition=origin.draft??state().definition,epoch=configurationEpoch;if(!definition)reject();
        const credential=payload.token?{token:payload.token,expiresAt:payload.expiresAt}:undefined;
        if(!await confirm(origin,'保存 MCP 服务定义','保存加密配置并撤销旧连接？',
          `地址：${definition.endpoint}\n服务：${definition.server?.name} @ ${definition.server?.version}\n工具：${definition.tool?.descriptor?.name} @ ${definition.tool?.descriptor?.version}\n范围：${JSON.stringify(definition.tool?.descriptor?.requiredScopes)}\n目录 SHA256：${definition.directoryDigest}\n保存不联网或授予执行权限；需重启应用重新装配。空 token 表示不使用凭据。`))return state();
        assertWindow(origin);if(epoch!==configurationEpoch)reject();config.configure({...definition,...(credential?{credential}:{})});configurationEpoch++;origin.draft=undefined;onUpdate();return state();
      }
      if(name==='connect'){
        if(payload!==undefined)reject();
        await host.connect({signal:origin.signal,deadline:new Date(Date.now()+30000).toISOString()});onUpdate();return state();
      }
      if(name==='submit'){
        const app=application(),tool=host.tools[0];if(!app || !tool)reject();
        const argumentsValue=host.arguments(payload);
        const result=app.submitHostToolTask({commandId:randomUUID(),toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
          arguments:argumentsValue,deadline:new Date(Date.now()+120000).toISOString()});
        app.runtime.saveCheckpoint(result.task.taskId,marker,{toolName:tool.descriptor.name,toolVersion:tool.descriptor.version});
        return readTask(result.task.taskId);
      }
      if(name==='task'){
        if(!exact(payload,['taskId']))reject();return readTask(payload.taskId);
      }
      if(name==='respond'){
        if(!exact(payload,['taskId','expectedRevision','decision']) || !['allow_once','deny'].includes(payload.decision))reject();
        const app=application(),read=readTask(payload.taskId);
        if(read.state!=='waiting_approval' || read.approval?.state!=='pending' || read.approval.revision!==payload.expectedRevision)reject();
        if(payload.decision==='allow_once'){
          host.arguments(read.arguments);
          if(!await confirm(origin,'批准单次 MCP 调用',`仅批准原任务 ${read.taskId} 的一次只读调用？`,
            `工具：${read.toolName} @ ${read.toolVersion}\n参数：${JSON.stringify(read.arguments)}\n只调用已确认连接，不发送给模型。`))return readTask(read.taskId);
          assertWindow(origin);if(application()!==app)reject();host.arguments(read.arguments);
          const intent=app.runtime.loadCheckpoint(read.taskId,'host-tool-intent');
          if(host.arguments(read.arguments).bindingRef!==intent.arguments.bindingRef)reject();
        }
        await client().call('authorization.respond',{approvalId:read.approval.approvalId,expectedRevision:payload.expectedRevision,decision:payload.decision});
        return readTask(read.taskId);
      }
      if(name==='cancel'){
        if(!exact(payload,['taskId']))reject();readTask(payload.taskId);
        await client().call('task.cancel',{taskId:payload.taskId,reason:'用户停止远程 MCP 任务'});return readTask(payload.taskId);
      }
      reject();
    }finally{busy=false;}
  };
  ipcMain.handle(channel,async(...args)=>{
    try{return {ok:true,value:await request(...args)};}
    catch(error){return {ok:false,error:`远程 MCP 操作未完成${error instanceof ProtocolError?`（${error.code}）`:''}；请核对原任务、配置及会话状态`};}
  });
  return Object.freeze({state,readTask,
    async confirmConnection(request){
      const origin=current;if(!origin)return false;
      return confirm(origin,'连接远程 MCP','仅允许本次应用会话连接这个只读服务？',
        `地址：${request.endpoint}\n服务：${request.server.name} @ ${request.server.version}\n工具：${request.toolName} @ ${request.toolVersion}\n目录 SHA256：${request.directoryDigest}\n本次会话连接不授予工具调用；每个任务仍需单独审批。`,request.signal);
    },
    open(){
      if(closed || !owner() || owner().isDestroyed())reject();
      if(current){current.window.show();current.window.focus();return;}
      const window=new BrowserWindow({parent:owner(),width:760,height:820,title:'远程 MCP 管理',show:false,autoHideMenuBar:true,
        webPreferences:{preload:fileURLToPath(new URL('./remote-mcp-preload.cjs',import.meta.url)),contextIsolation:true,sandbox:true,nodeIntegration:false,partition:'remote-mcp-management'}});
      const controller=new AbortController(),origin={window,signal:controller.signal};current=origin;
      const clear=()=>{if(current===origin){current=undefined;controller.abort();origin.draft=undefined;}};
      window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
      window.webContents.session.setPermissionCheckHandler(()=>false);
      window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      window.webContents.on('will-navigate',event=>event.preventDefault());window.webContents.on('will-redirect',event=>event.preventDefault());
      window.on('closed',clear);window.webContents.on('render-process-gone',()=>{clear();if(!window.isDestroyed())window.destroy();});
      window.once('ready-to-show',()=>{if(!window.isDestroyed())window.show();});
      void window.loadFile(fileURLToPath(new URL('../src/remote-mcp/index.html',import.meta.url))).catch(()=>{clear();if(!window.isDestroyed())window.destroy();});
    },
    close(){closed=true;const window=current?.window;if(window && !window.isDestroyed())window.destroy();ipcMain.removeHandler(channel);},
  });
}
