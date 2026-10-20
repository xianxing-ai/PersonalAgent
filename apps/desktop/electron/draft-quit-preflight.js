// Ask the existing renderers to persist and freeze drafts before disposing hosts.
// The page event grants no task/tool authority and never carries draft contents back.
const prepareScript=`(()=>{const event=new CustomEvent('pa:prepare-quit',{cancelable:true,detail:{handled:false}});window.dispatchEvent(event);if(event.defaultPrevented||!event.detail.handled)return false;document.documentElement.inert=true;return true;})()`;
const resumeScript=`window.dispatchEvent(new Event('pa:cancel-quit'));document.documentElement.inert=false;`;
export function createDraftQuitPreflight({windows,retry,onFailure,timeoutMs=5000}) {
  let phase='idle',generation=0,waitTimer;
  const pages=()=>windows().filter(win=>win&&!win.isDestroyed()&&!win.webContents.isDestroyed());
  function cancel(){
    clearTimeout(waitTimer);waitTimer=undefined;
    generation++;phase='idle';
    for(const win of pages())try{void Promise.resolve(win.webContents.executeJavaScript(resumeScript)).catch(()=>{});}catch{}
  }
  return {
    allow(){
      if(phase==='ready')return true;
      if(phase==='pending')return false;
      const targets=pages();if(!targets.length)return true;
      phase='pending';const version=++generation;
      let timer;
      const preparation=Promise.all(targets.map(win=>{try{return Promise.resolve(win.webContents.executeJavaScript(prepareScript));}catch(error){return Promise.reject(error);}}));
      const expired=new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('关闭前草稿保存超时，请保持窗口打开并重试')),timeoutMs);waitTimer=timer;timer.unref?.();});
      void Promise.race([preparation,expired]).then(results=>{
        if(version!==generation)return;
        if(results.some(value=>value!==true))throw Error('关闭前草稿保存未确认；请保留窗口并重试');
        phase='ready';retry();
      }).catch(error=>{if(version===generation){cancel();onFailure(error);}}).finally(()=>{clearTimeout(timer);if(waitTimer===timer)waitTimer=undefined;});
      return false;
    },
    cancel,
  };
}
