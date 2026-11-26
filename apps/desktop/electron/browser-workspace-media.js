import {randomUUID} from 'node:crypto';

// Runs in an isolated Chromium world on one verified, already-playing element.
// No bindings are installed in the site's world. captureStream preserves the
// browser's origin/DRM restrictions and never captures a screen or microphone.
function recordElement(expected){
  const element=this;
  const current=()=>element.isConnected&&element.ownerDocument===document&&element instanceof HTMLMediaElement
    &&!element.mediaKeys&&!element.srcObject&&element.currentSrc===expected.source&&element.localName===expected.tag
    &&element.getAttribute(expected.attribute)===expected.token;
  if(!current()||element.paused||element.ended||typeof element.captureStream!=='function')return;
  const stream=element.captureStream();
  const video=stream.getVideoTracks().length>0,audio=stream.getAudioTracks().length>0;
  const choices=video?[audio?'video/webm;codecs=vp8,opus':'video/webm;codecs=vp8']:['audio/webm;codecs=opus'];
  const mimeType=choices.find(type=>MediaRecorder.isTypeSupported(type));
  if(!mimeType||expected.tag==='video'&&!video||!video&&!audio){stream.getTracks().forEach(track=>track.stop());return;}
  const recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:1_200_000,audioBitsPerSecond:96_000});
  let state='waiting',bytes=0,chunks=[],stopped=false;
  function stop(){
    if(stopped)return;stopped=true;
    if(recorder.state!=='inactive')recorder.stop();
    stream.getTracks().forEach(track=>track.stop());
    element.removeEventListener('pause',end);element.removeEventListener('ended',end);
  }
  function end(){state='ended';stop();}
  recorder.ondataavailable=event=>{
    if(!current()){chunks=[];bytes=0;state='ended';stop();return;}
    if(!event.data.size||state==='unavailable')return;
    if(event.data.size>786432||bytes+event.data.size>1572864||chunks.length>=12){
      chunks=[];bytes=0;state='unavailable';stop();return;
    }
    chunks.push(event.data);bytes+=event.data.size;
    if(state!=='ended')state='streaming';
  };
  recorder.onerror=()=>{state='unavailable';stop();};
  element.addEventListener('pause',end);element.addEventListener('ended',end);
  try{recorder.start(250);}catch{stop();return;}
  return {stop,async pull(){
    if(!current()){end();return {state:'ended'};}
    if(element.paused||element.ended)end();
    const batch=chunks;chunks=[];bytes=0;
    const encoded=[];
    for(const chunk of batch){
      const data=new Uint8Array(await chunk.arrayBuffer());
      let raw='';for(let i=0;i<data.length;i+=8192)raw+=String.fromCharCode(...data.subarray(i,i+8192));
      encoded.push(btoa(raw));
    }
    return {state,mimeType,chunks:encoded};
  }};
}

export function createWorkspaceMedia(){
  const attribute='data-pa-media-'+randomUUID().replaceAll('-','');
  let selection,session,revision=0,pulling=false,timer;
  async function dispose(owner){
    if(!owner?.driver)return;
    if(owner.objectId)await owner.driver.send('Runtime.callFunctionOn',{objectId:owner.objectId,
      functionDeclaration:'function(){this.stop()}',silent:true}).catch(()=>{});
    await owner.driver.detach().catch(()=>{});
  }
  function stop(){
    ++revision;clearTimeout(timer);const previous=session;session=undefined;
    if(previous)void dispose(previous);
  }
  function clear(){selection=undefined;stop();}
  function select(page,media){
    clear();
    if(page&&!page.isClosed()&&!media.paused&&!media.ended&&media.source&&media.token)
      selection={page,document:page.url(),source:media.source,tag:media.tag,attribute,token:media.token};
  }
  function current(page){return selection?.page===page&&page&&!page.isClosed()&&selection.document===page.url()?selection:undefined;}
  async function connect(target,epoch){
    const driver=await target.page.context().newCDPSession(target.page);
    const owner={driver,id:randomUUID()};
    const check=()=>{if(epoch!==revision||current(target.page)!==target)throw Error('stale media');};
    try{
      check();
      const {frameTree}=await driver.send('Page.getFrameTree');
      const {executionContextId}=await driver.send('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:attribute});
      const {root}=await driver.send('DOM.getDocument',{depth:0});
      const {nodeIds}=await driver.send('DOM.querySelectorAll',{nodeId:root.nodeId,selector:'['+attribute+'="'+target.token+'"]'});
      if(nodeIds.length!==1)throw Error('media changed');
      const {object}=await driver.send('DOM.resolveNode',{nodeId:nodeIds[0],executionContextId});
      check();
      const {result,exceptionDetails}=await driver.send('Runtime.callFunctionOn',{objectId:object.objectId,
        functionDeclaration:recordElement.toString(),arguments:[{value:{source:target.source,tag:target.tag,attribute,token:target.token}}],silent:true});
      owner.objectId=result?.objectId;
      if(exceptionDetails||!owner.objectId)throw Error('capture unavailable');
      check();session=owner;return owner;
    }catch(error){await dispose(owner);throw error;}
  }
  async function pull(page,args,check){
    if(args.stop){stop();return {state:'idle'};}
    if(args.restart)stop();
    const target=current(page);
    if(!target)return {state:'idle'};
    if(pulling)return {state:'waiting'};
    pulling=true;const epoch=revision;
    try{
      check();const owner=session??await connect(target,epoch);check();
      clearTimeout(timer);timer=setTimeout(stop,5000);timer.unref?.();
      const {result,exceptionDetails}=await owner.driver.send('Runtime.callFunctionOn',{objectId:owner.objectId,
        functionDeclaration:'function(){return this.pull()}',awaitPromise:true,returnByValue:true,silent:true});
      check();if(epoch!==revision||current(page)!==target)return {state:'idle'};
      const data=result?.value;
      if(exceptionDetails||!['ended','unavailable','waiting','streaming'].includes(data?.state))throw Error('media unavailable');
      if(data.state==='ended'){clear();return {...data,streamId:owner.id};}
      if(data.state==='unavailable'){stop();return {state:'unavailable'};}
      return {...data,streamId:owner.id};
    }catch{
      if(epoch!==revision)return {state:'idle'};
      stop();return {state:'unavailable'};
    }finally{pulling=false;}
  }
  return {attribute,current,select,clear,stop,pull};
}
