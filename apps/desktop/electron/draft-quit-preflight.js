// Ask the existing renderers to persist and freeze drafts before disposing hosts.
// The page event grants no task/tool authority and never carries draft contents back.
const prepareScript=`(()=>{const event=new CustomEvent('pa:prepare-quit',{cancelable:true,detail:{handled:false}});window.dispatchEvent(event);if(event.defaultPrevented||!event.detail.handled)return false;document.documentElement.inert=true;return true;})()`;
const resumeScript=`window.dispatchEvent(new Event('pa:cancel-quit'));document.documentElement.inert=false;`;
export function createDraftQuitPreflight({windows,retry,onFailure,readError=()=>''}) {
  let phase='idle',generation=0,preparedError='';
  const pages=()=>windows().filter(win=>win&&!win.isDestroyed()&&!win.webContents.isDestroyed());
  function cancel(){
    generation++;phase='idle';
    for(const win of pages())void win.webContents.executeJavaScript(resumeScript).catch(()=>{});
  }
  return {
    allow(){
      if(phase==='ready')return true;
      if(phase==='pending')return false;
      const targets=pages();if(!targets.length)return true;
      phase='pending';const version=++generation;
      void Promise.all(targets.map(win=>win.webContents.executeJavaScript(prepareScript))).then(results=>{
        if(version!==generation)return;
        if(results.some(value=>value!==true))throw Error('关闭前草稿保存未确认；请保留窗口并重试');
        phase='ready';preparedError=readError();retry();
      }).catch(error=>{if(version===generation){cancel();onFailure(error);}});
      return false;
    },
    // A later resource-release failure must leave the retained windows editable.
    checkFailure(error){if(phase==='ready'&&error!==preparedError)cancel();},
    cancel,
  };
}
