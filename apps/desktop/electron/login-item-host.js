import path from 'node:path';
import {createHash} from 'node:crypto';

/** Native readback is authoritative. Construction only reads and never registers a login item. */
export function createLoginItemHost({app,platform=process.platform,executable=process.execPath}) {
  const supported=platform==='win32'&&app.isPackaged===true&&path.win32.isAbsolute(executable)
    &&path.win32.extname(executable).toLowerCase()==='.exe'
    &&!/^electron\.exe$/i.test(path.win32.basename(executable))
    &&!/[\\/](?:node_modules|\.worktrees|\.cache|temp|tmp|app-\d[^\\/]*)(?:[\\/]|$)/i.test(executable);
  const name='PersonalAgent.Startup.'+createHash('sha256').update(executable.toLowerCase()).digest('hex').slice(0,16);
  const options={path:executable,args:[]};
  let lastWrite='none', requested;
  let current={supported,state:'unavailable',configured:null,enabled:null,verification:'unverified',
    reason:'仅稳定路径的正式 Windows 应用支持登录自启；开发模式不会注册启动项'};
  const snapshot=()=>({...current,lastWrite});
  function read() {
    if(!supported)return snapshot();
    try {
      const native=app.getLoginItemSettings({...options,args:[]});
      if(typeof native.openAtLogin!=='boolean'||!Array.isArray(native.launchItems))throw Error();
      const own=native.launchItems.filter(item=>item.name===name&&item.scope==='user'
        &&typeof item.path==='string'&&item.path.toLowerCase()===executable.toLowerCase()
        &&Array.isArray(item.args)&&item.args.length===0);
      if(native.launchItems.some(item=>item.name===name&&item.scope==='user'&&!own.includes(item)))throw Error();
      if(own.length>1||(own.length===1&&(!native.openAtLogin||typeof own[0].enabled!=='boolean')))throw Error();
      const configured=own.length===1,enabled=configured&&own[0].enabled===true;
      if(requested===configured&&lastWrite==='unknown')lastWrite='read_back';
      current={supported:true,state:enabled?'enabled':configured?'os_disabled':'disabled',configured,enabled,
        executableWillLaunchAtLogin:native.executableWillLaunchAtLogin===true,verification:'unverified',
        reason:configured&&!enabled?'启动项已配置，但 Windows 已禁用；请在系统启动应用中确认':
          !configured&&native.executableWillLaunchAtLogin?'本应用此启动项已关闭；系统另有同一程序的启动项，未更改':
            enabled?'本应用启动项已启用；实际登录启动仍待现场验收':'本应用启动项未配置'};
    } catch {
      current={supported:true,state:'unknown',configured:null,enabled:null,verification:'unverified',reason:'原生启动项状态读取失败，请刷新核实'};
    }
    return snapshot();
  }
  function configure(input) {
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1
      ||typeof input.enabled!=='boolean')throw Error('启动项设置必须为明确的启用或禁用');
    if(!supported)throw Error(current.reason);
    const before=read();if(before.state==='unknown')throw Error(before.reason);
    requested=input.enabled;lastWrite='unknown';
    try {
      // This unique user entry is the only target; other applications/names/arguments are untouched.
      app.setLoginItemSettings({...options,args:[],name,openAtLogin:requested,enabled:requested});
    } catch {read();throw Error('启动项写入未确认，请刷新核实；不会自动重试');}
    const result=read();
    if(result.state==='unknown'||result.configured!==requested)throw Error('启动项读回未确认，请刷新核实；不会自动重试');
    lastWrite='read_back';return snapshot();
  }
  read();
  return {snapshot,read,configure};
}
