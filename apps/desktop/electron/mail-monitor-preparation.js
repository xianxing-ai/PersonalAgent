// This owns only a settings action's asynchronous preparation. The existing
// connector watch and Runtime keep all task, approval and subscription state.
export function createMailMonitorPreparation() {
  let generation=0,intent,pending,closed=false,configurationChanges=0;
  const capture=()=>{const expected=generation;return()=>!closed&&generation===expected;};
  function invalidate(next){
    generation++;intent=next;
    const previous=pending;pending=undefined;
    if(previous){previous.controller.abort();previous.release();}
  }
  const cancel=()=>invalidate(undefined);
  function stop(){if(intent!=='stop')invalidate('stop');return capture();}
  function beginConfigurationChange(){
    configurationChanges++;
    if(intent==='start'||pending)cancel();
    let ended=false;return()=>{if(!ended){ended=true;configurationChanges--;}};
  }
  function run(prepare,{isCurrent:sourceCurrent=()=>true}={}) {
    if(closed)throw Error('邮件监测准备已关闭，请重新打开应用');
    if(configurationChanges)throw Error('邮箱配置正在更新，请等待完成后再启动监测');
    if(typeof prepare!=='function'||typeof sourceCurrent!=='function')throw TypeError('Invalid mail preparation');
    if(pending){if(pending.isCurrent())return pending.promise;cancel();}
    // Repeated starts retain the original intent after preparation returns:
    // the Runtime may still be waiting for its original approval at that point.
    if(intent!=='start'){generation++;intent='start';}
    const current=capture(),controller=new AbortController();
    const isCurrent=()=>{try{return current()&&sourceCurrent()===true;}catch{return false;}};
    let release;const cancelled=new Promise(resolve=>{release=resolve;});
    const record={controller,release,isCurrent,promise:undefined};pending=record;
    const work=Promise.resolve().then(()=>isCurrent()?prepare({isCurrent,signal:controller.signal}):undefined);
    record.promise=Promise.race([work,cancelled]).finally(()=>{if(pending===record)pending=undefined;});
    return record.promise;
  }
  return Object.freeze({run,cancel,stop,capture,beginConfigurationChange,configurationPending:()=>configurationChanges>0,hasPending:()=>pending!==undefined,
    close(){if(!closed){cancel();closed=true;}}});
}
