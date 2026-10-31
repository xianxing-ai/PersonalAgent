import {fileURLToPath} from 'node:url';
import {readFileSync,statSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import {errorDisplayText} from '../src/shared/error-display.js';

const marker='desktop-remote-mcp-v1';
const exact=(value,keys)=>value && typeof value==='object' && !Array.isArray(value)
  && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
function reject(){throw Error('远程 MCP 操作被拒绝；请检查配置、原任务与当前会话');}

/** Dedicated trusted window; the regular admin can only open it. One owner per userData. */
export function createRemoteMcpManagement({BrowserWindow,ipcMain,dialog,owner,config,host,services,application,client,namespace,
  confirmAuthorization=async()=>false,focusAuthorizationQuestion=()=>false,onUpdate=()=>{}}){
  const channel='desktop:remote-mcp';
  let current,closed=false,busy=false,configurationEpoch=0,activeId='legacy',newId;
  function select(id){const selected=services.get(id);config=selected.config;host=selected.host;activeId=id;newId=undefined;
    configurationEpoch++;if(current)current.draft=undefined;}
  function readTask(taskId){
    const app=application();
    if(!app || typeof taskId!=='string')reject();
    const selected=app.runtime.loadCheckpoint(taskId,marker),value=app.readHostToolTask(taskId);
    if(!selected || value.toolName!==selected.toolName || value.toolVersion!==selected.toolVersion)reject();
    return {taskId,state:value.task.state,toolName:value.toolName,toolVersion:value.toolVersion,
      ...(selected.serverId?{serverId:selected.serverId}:{}),
      approval:value.approval,
      ...(value.confirmed?{evidenceRefs:value.confirmed.evidenceRefs}:{} )};
  }
  function state(){
    const saved=newId?undefined:config.hostConfiguration(),app=application();
    const display=value=>{if(!value)return value;const {binding,publicExport,...rest}=value;
      return {...rest,...(publicExport?{publicExport:{sensitivity:publicExport.sensitivity,maxBytes:publicExport.maxBytes,
        argumentsDigest:createHash('sha256').update(JSON.stringify(publicExport.arguments)).digest('hex')}}:{})};};
    const tasks=app?app.runtime.listTasks({conversationId:`host-tool:${namespace}`,limit:50}).items
      .filter(task=>app.runtime.loadCheckpoint(task.taskId,marker)).map(task=>({taskId:task.taskId,state:task.state,
        ...(services?{serverId:app.runtime.loadCheckpoint(task.taskId,marker).serverId??'legacy'}:{})})):[];
    const serviceList=services?.list(),selected=serviceList?.find(item=>item.id===activeId);
    const snapshot=newId?{configured:false,status:'unconfigured',connected:false,toolAvailable:false}
      :host?.snapshot()??{...config.snapshot(),status:selected?.status??'reassembly_required',requiresReassembly:true};
    return {...snapshot,runtimeAvailable:!!app,tasks,...(services?{services:serviceList,activeId:newId??activeId}:{}),
      ...(saved?{definition:display(saved)}:{}),
      ...(current?.draft?{draft:display(current.draft)}:{})};
  }
  function assertWindow(origin){if(closed || !origin || current!==origin || origin.window.isDestroyed() || origin.signal.aborted)reject();}
  async function confirm(origin,title,message,detail,signal=origin.signal){
    assertWindow(origin);
    const epoch=configurationEpoch;
    const isCurrent=()=>!closed&&current===origin&&!origin.window.isDestroyed()&&!origin.signal.aborted&&!signal.aborted&&epoch===configurationEpoch;
    const accepted=await confirmAuthorization({payload:{title,message,detail,configurationEpoch:epoch},
      scope:{operation:title,configurationEpoch:epoch},summary:(title+'：'+message+'；'+detail).replace(/[\u0000-\u001f]/gu,' ').slice(0,512),
      signal:AbortSignal.any([signal,origin.signal]),deadline:new Date(Date.now()+180000).toISOString(),isCurrent});
    return accepted===true&&isCurrent();
  }
  const request=async(event,name,payload)=>{
    const origin=current;
    if(!origin || event.sender!==origin.window.webContents || event.senderFrame!==event.sender.mainFrame)reject();
    assertWindow(origin);
    if(name==='state'){if(payload!==undefined)reject();return state();}
    if(name==='select'){
      if(!services || busy || !exact(payload,['id']) || typeof payload.id!=='string')reject();
      select(payload.id);return state();
    }
    if(name==='new'){
      if(!services || busy || !exact(payload,['id']) || typeof payload.id!=='string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(payload.id)
        || payload.id==='legacy' || services.list().some(item=>item.id===payload.id))reject();
      newId=payload.id;configurationEpoch++;origin.draft=undefined;return state();
    }
    if(name==='migrate'){
      if(!services || busy || !exact(payload,['id']) || typeof payload.id!=='string')reject();
      if(!await confirm(origin,'迁移 MCP 配置','复制旧配置到新的服务？','保留旧密文；新服务默认断开，需重启后重新连接和授权。'))return state();
      services.migrate(payload.id);select(payload.id);onUpdate();return state();
    }
    if(name==='disconnect' || name==='revoke'){
      if(payload!==undefined || newId)reject();
      if(name==='revoke'){
        if(!await confirm(origin,'撤销远程 MCP','撤销本机配置和当前连接？','停止当前连接并清除本应用加密配置。原任务、执行记录与 Evidence 保留；不撤销服务端 token。'))return state();
        const targetId=activeId;configurationEpoch++;if(services){await services.revoke(targetId);
          if(targetId!=='legacy' && activeId===targetId && !newId)select('legacy');}
        else config.revoke();origin.draft=undefined;
      }
      if(name==='disconnect' && host){if(services)await services.disconnect(activeId);else await host.disconnect();}onUpdate();return state();
    }
    if(busy)reject();busy=true;
    try{
      if(name==='import'){
        if(payload!==undefined)reject();
        const result=await dialog.showOpenDialog(origin.window,{title:'选择只读 MCP 服务定义（不含密钥）',properties:['openFile'],filters:[{name:'服务定义',extensions:['json']}]});
        assertWindow(origin);if(result.canceled)return state();
        if(result.filePaths.length!==1 || !statSync(result.filePaths[0]).isFile() || statSync(result.filePaths[0]).size>256*1024)reject();
        const raw=readFileSync(result.filePaths[0]);if(raw.length>256*1024)reject();const value=JSON.parse(raw.toString('utf8'));
        if(!value || typeof value!=='object' || Array.isArray(value)
          || Object.keys(value).some(key=>!['endpoint','server','tool','directoryDigest','allowMissingOutputSchema','publicExport'].includes(key))
          || !['endpoint','server','tool','directoryDigest'].every(key=>Object.hasOwn(value,key))
          || (Object.hasOwn(value,'allowMissingOutputSchema') && value.allowMissingOutputSchema!==true) || typeof value.endpoint!=='string'
          || !/^mcp\.remote\.[a-z][a-z0-9_.-]*$/.test(value.tool?.descriptor?.name))reject();
        origin.draft=value;return state();
      }
      if(name==='save'){
        if(!exact(payload,['token','expiresAt']) || typeof payload.token!=='string' || payload.token.length>8192 || typeof payload.expiresAt!=='string')reject();
        const source=origin.draft??(!newId?config.hostConfiguration():undefined),epoch=configurationEpoch;if(!source)reject();
        const {binding,...definition}=source;
        const credential=payload.token?{token:payload.token,expiresAt:payload.expiresAt}:undefined;
        if(!await confirm(origin,'保存 MCP 服务定义','保存加密配置并撤销旧连接？',
          `地址：${definition.endpoint}\n服务：${definition.server?.name} @ ${definition.server?.version}\n工具：${definition.tool?.descriptor?.name} @ ${definition.tool?.descriptor?.version}\n范围：${JSON.stringify(definition.tool?.descriptor?.requiredScopes)}\n目录 SHA256：${definition.directoryDigest}\n${definition.allowMissingOutputSchema===true?'允许服务未声明输出 Schema；使用此配置中的本地 Schema 校验结构化结果。\n':''}${definition.publicExport?`允许固定输入的 PUBLIC text 有界出机；输入 SHA256：${createHash('sha256').update(JSON.stringify(definition.publicExport.arguments)).digest('hex')}，上限 ${definition.publicExport.maxBytes} 字节。仍需原任务审批和出口许可。\n`:''}保存不联网或授予执行权限；需重启应用重新装配。空 token 表示不使用凭据。`))return state();
        assertWindow(origin);if(epoch!==configurationEpoch)reject();
        if(newId){const id=newId;services.add(id,{...definition,...(credential?{credential}:{})});select(id);}
        else {config.configure({...definition,...(credential?{credential}:{})});configurationEpoch++;}
        origin.draft=undefined;onUpdate();return state();
      }
      if(name==='connect'){
        if(payload!==undefined)reject();
        if(!host || newId)reject();
        if(services)await services.connect(activeId,{signal:origin.signal,deadline:new Date(Date.now()+30000).toISOString()});
        else await host.connect({signal:origin.signal,deadline:new Date(Date.now()+30000).toISOString()});onUpdate();return state();
      }
      if(name==='submit'){
        const app=application(),tool=host?.tools[0];if(!app || !tool || newId)reject();
        const argumentsValue=host.arguments(payload);
        const result=app.submitHostToolTask({commandId:randomUUID(),toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,
          arguments:argumentsValue,deadline:new Date(Date.now()+120000).toISOString()});
        app.runtime.saveCheckpoint(result.task.taskId,marker,{toolName:tool.descriptor.name,toolVersion:tool.descriptor.version,...(services?{serverId:activeId}:{})});
        return readTask(result.task.taskId);
      }
      if(name==='task'){
        if(!exact(payload,['taskId']))reject();return readTask(payload.taskId);
      }
      if(name==='respond'){
        // All allow/deny decisions bind the original conversation question and revision.
        throw new ProtocolError('UNAUTHORIZED','请在原任务的对话提问卡处理本次 MCP 调用');
      }
      if(name==='focusQuestion'){
        if(!exact(payload,['taskId']))reject();
        const task=readTask(payload.taskId);
        if(task.state!=='waiting_approval'||task.approval?.state!=='pending'
          ||!await focusAuthorizationQuestion({taskId:task.taskId,approvalId:task.approval.approvalId}))
          throw new ProtocolError('REVISION_CONFLICT','原对话授权卡已失效，请停止原任务后再重新提出');
        assertWindow(origin);return readTask(task.taskId);
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
    catch(error){return {ok:false,error:errorDisplayText(error,'ipc')};}
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
