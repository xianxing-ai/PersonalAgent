// Ask the existing renderers to persist and freeze drafts before disposing hosts.
// The page event grants no task/tool authority and never carries draft contents back.
const prepareScript=`(()=>{const event=new CustomEvent('pa:prepare-quit',{cancelable:true,detail:{handled:false}});window.dispatchEvent(event);if(event.defaultPrevented||!event.detail.handled)return false;document.documentElement.inert=true;return true;})()`;
const resumeScript=`window.dispatchEvent(new Event('pa:cancel-quit'));document.documentElement.inert=false;`;
export function createDraftQuitPreflight({windows,retry,onFailure,timeoutMs=5000}) {
  let phase='idle',generation=0,waitTimer,bindings=[],listeners=[];
  const pages=()=>windows().filter(win=>win&&!win.isDestroyed()&&!win.webContents.isDestroyed());
  const clearListeners=()=>{for(const [emitter,event,handler] of listeners)emitter.removeListener(event,handler);listeners=[];};
  const current=()=>{
    try{
      const targets=pages();
      return targets.length===bindings.length&&bindings.every(({win,contents,frame})=>
        targets.includes(win)&&win.webContents===contents&&contents.mainFrame===frame&&!contents.isLoadingMainFrame?.());
    }catch{return false;}
  };
  function cancel(){
    clearTimeout(waitTimer);waitTimer=undefined;
    if(phase==='idle'&&!bindings.length)return;
    const retained=[...new Set([...bindings.map(value=>value.win),...pages()])];
    clearListeners();bindings=[];
    generation++;phase='idle';
    for(const win of retained)try{if(!win.isDestroyed()&&!win.webContents.isDestroyed())void Promise.resolve(win.webContents.executeJavaScript(resumeScript)).catch(()=>{});}catch{}
  }
  return {
    allow(){
      if(phase==='committed')return true;
      if(phase!=='idle'&&!current())cancel();
      if(phase==='ready')return true;
      if(phase==='pending')return false;
      const targets=pages();if(!targets.length){phase='ready';bindings=[];return true;}
      if(targets.some(win=>win.webContents.isLoadingMainFrame?.())){
        onFailure(Error('页面正在加载，请等待草稿界面就绪后重试退出'));return false;
      }
      phase='pending';const version=++generation;
      bindings=targets.map(win=>({win,contents:win.webContents,frame:win.webContents.mainFrame}));
      const invalidated=()=>{if(version!==generation)return;cancel();onFailure(Error('草稿页面已变化，请重新确认退出'));};
      const listen=(emitter,event,handler)=>{emitter.on(event,handler);listeners.push([emitter,event,handler]);};
      for(const {win,contents} of bindings){
        listen(contents,'did-start-navigation',(_event,_url,inPlace,mainFrame)=>{if(mainFrame&&!inPlace)invalidated();});
        listen(contents,'did-frame-navigate',(_event,_url,_code,_text,mainFrame)=>{if(mainFrame)invalidated();});
        listen(contents,'render-process-gone',invalidated);listen(contents,'destroyed',invalidated);listen(win,'closed',invalidated);
      }
      let timer;
      const preparation=Promise.all(targets.map(win=>{try{return Promise.resolve(win.webContents.executeJavaScript(prepareScript));}catch(error){return Promise.reject(error);}}));
      const expired=new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('关闭前草稿保存超时，请保持窗口打开并重试')),timeoutMs);waitTimer=timer;timer.unref?.();});
      void Promise.race([preparation,expired]).then(results=>{
        if(version!==generation)return;
        if(!current()){cancel();onFailure(Error('草稿页面已变化，请重新确认退出'));return;}
        if(results.some(value=>value!==true))throw Error('关闭前草稿保存未确认；请保留窗口并重试');
        phase='ready';retry();
      }).catch(error=>{if(version===generation){cancel();onFailure(error);}}).finally(()=>{clearTimeout(timer);if(waitTimer===timer)waitTimer=undefined;});
      return false;
    },
    // Called synchronously immediately before irreversible host cleanup. Normal
    // window destruction must no longer turn a successful shutdown into failure.
    commit(){
      if(phase==='committed')return true;
      if(phase!=='ready'||!current()){cancel();return false;}
      phase='committed';clearTimeout(waitTimer);waitTimer=undefined;clearListeners();return true;
    },
    cancel,
  };
}
