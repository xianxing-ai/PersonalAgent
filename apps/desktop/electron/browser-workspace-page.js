import {randomUUID} from 'node:crypto';
import {ProtocolError,validateToolValue} from '@personal-agent/contracts';

const keys=['Enter','Tab','Escape','ArrowUp','ArrowDown','Space'];
const object=(properties={},required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const viewId={type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'};
const ref={type:'string',pattern:'^r[1-9][0-9]{0,2}$'};
const commands={
  state:object(),preview:object(),frame:object(),back:object(),forward:object(),reload:object(),close:object(),present:object(),
  media:object({restart:{type:'boolean'},stop:{type:'boolean'}},[]),
  open:object({url:{type:'string',minLength:1,maxLength:4096}}),handoff:object({viewId}),
  click:object({viewId,ref}),press:object({viewId,ref,key:{enum:keys}}),
  type:object({viewId,ref,text:{type:'string',maxLength:4096},submit:{type:'boolean'}},['viewId','ref','text']),
  select:object({viewId,ref,values:{type:'array',minItems:1,maxItems:20,items:{type:'string',maxLength:200}}}),
  scroll:object({viewId,direction:{enum:['up','down']},amount:{type:'integer',minimum:1,maximum:2000}},['viewId','direction']),
};
export function validateWorkspaceCommand(action,payload) {
  if(typeof action!=='string'||!Object.hasOwn(commands,action))
    throw new ProtocolError('INVALID_ARGUMENT','浏览器操作无效');
  validateToolValue(commands[action],payload);
}
function visibleUrl(value) {
  try{
    const url=new URL(value);
    if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&url.href.length<=4096)return url;
  }catch{}
}
async function historyOf(page) {
  const driver=await page.context().newCDPSession(page);
  try{
    const {currentIndex,entries}=await driver.send('Page.getNavigationHistory');
    return {back:visibleUrl(entries[currentIndex-1]?.url),forward:visibleUrl(entries[currentIndex+1]?.url)};
  }finally{await driver.detach().catch(()=>{});}
}
// Holds one locally displayed observation; it can never be used as a worker targetRef.
export function createBrowserWorkspacePage({checkUrl,readDocument,findControl,navigateGet,mediaAttribute,onMedia,fail,now}) {
  let view,revision=0;
  const attribute='data-pa-local-'+randomUUID().replaceAll('-','');
  function state(page) {
    const url=visibleUrl(page?.url());
    const current=url&&view?.url===url.href&&view.page===page?view:undefined;
    return {url:url?.href??'',title:current?.title??'',canGoBack:!!current?.back,canGoForward:!!current?.forward,
      ...(current&&current.expires>now()?{viewId:current.id}:{})};
  }
  function requireView(page,id) {
    if(!view||view.id!==id||view.page!==page||view.url!==page?.url()||view.expires<=now())
      fail('REVISION_CONFLICT','网页已变化，请刷新预览后操作');
    return view;
  }
  async function capture(page,check,timeout){
    const documentRevision=revision,url=page.url(),size=page.viewportSize();
    if(!size||size.width<1||size.width>4096||size.height<1||size.height>4096)fail('UNSUPPORTED_CAPABILITY','浏览器没有可预览的视口');
    const image=await page.screenshot({type:'jpeg',quality:72,fullPage:false,scale:'css',timeout:timeout(),
      mask:[page.locator('iframe,frame,input[type="password"],input[type="file"]')]});
    check();
    if(revision!==documentRevision||page.url()!==url)fail('REVISION_CONFLICT','网页在截图期间已变化，请刷新预览');
    if(image.length>2_097_152)fail('INVALID_ARGUMENT','网页预览超过大小上限');
    return {width:size.width,height:size.height,image:'data:image/jpeg;base64,'+image.toString('base64')};
  }
  async function frame(page,check,timeout){
    const original=view,url=visibleUrl(page?.url()),epoch=revision;
    if(!url)return {state:'unavailable'};
    const image=await capture(page,check,timeout);
    const same=original&&original.page===page&&original.url===url.href&&original.expires>now()&&
      await page.evaluate(({attribute,fields})=>{
        const marked=document.querySelectorAll('['+attribute+']');
        if(marked.length!==fields.length)return false;
        return fields.every(field=>{
          const element=document.querySelector('['+attribute+'="'+field.ref+'"]');
          if(!element||element.localName!==field.tag||Boolean(element.disabled)!==field.disabled)return false;
          const box=element.getBoundingClientRect();
          return ['x','y','width','height'].every(key=>Math.abs(box[key]-field.bounds[key])<1);
        });
      },{attribute,fields:original.controls.map(({ref,tag,disabled,bounds})=>({ref,tag,disabled,bounds}))});
    check();if(epoch!==revision||page.url()!==url.href)return {state:'waiting'};
    if(!same&&view===original)view=undefined;
    return {state:'frame',url:url.href,...image,...(same&&view===original?{viewId:original.id}:{})};
  }
  async function preview(page,check,timeout,stage=()=>{}) {
    if(!visibleUrl(page?.url()))return state(page);
    const documentRevision=revision;
    const url=await checkUrl(page.url());
    check();
    stage('preview_controls');
    const doc=await readDocument(page,attribute,true);
    if(!doc||typeof doc.title!=='string'||doc.title.length>300||!Array.isArray(doc.controls)||doc.controls.length>100)
      fail('INVALID_ARGUMENT','网页控件数据无效');
    const fields=[];
    for(const [index,item] of doc.controls.entries()){
      if(!item||item.ref!=='r'+(index+1)||typeof item.name!=='string'||item.name.length>200
        ||typeof item.tag!=='string'||item.tag.length>40||typeof item.inputType!=='string'||item.inputType.length>80
        ||typeof item.role!=='string'||item.role.length>80||typeof item.disabled!=='boolean'||!item.bounds
        ||!['x','y','width','height'].every(key=>Number.isFinite(item.bounds[key])))continue;
      fields.push({ref:item.ref,role:item.role,tag:item.tag,name:item.name,disabled:item.disabled,focused:item.focused===true,
        ...(['video','audio'].includes(item.tag)?{paused:item.paused===true,ended:item.ended===true,mediaPlaying:item.mediaPlaying===true}:{}),
        inputType:item.inputType,editable:item.editable===true,...(item.tag==='select'?{multiple:item.multiple===true}:{}),
        bounds:{x:item.bounds.x,y:item.bounds.y,width:item.bounds.width,height:item.bounds.height},
        ...(typeof item.downloadUrl==='string'&&item.downloadUrl.length<=4096?{downloadUrl:item.downloadUrl}:{}),
        ...(Array.isArray(item.options)?{options:item.options.slice(0,40).filter(o=>typeof o?.value==='string'&&typeof o?.label==='string')
          .map(o=>({value:o.value.slice(0,200),label:o.label.slice(0,200),selected:o.selected===true,disabled:o.disabled===true}))}:{})});
    }
    stage('preview_history');
    const history=await historyOf(page);
    stage('preview_frame');
    const image=await capture(page,check,timeout);
    check();
    if(revision!==documentRevision||page.url()!==url.href)fail('REVISION_CONFLICT','网页在截图期间已变化，请刷新预览');
    const signature=JSON.stringify(fields);
    const id=view?.page===page&&view.url===url.href&&view.signature===signature?view.id:randomUUID();
    view={id,page,url:url.href,title:doc.title,attribute,controls:fields,signature,expires:now()+30_000,...history};
    const controls=fields.map(({downloadUrl,...item})=>item);
    return {...state(page),...image,controls};
  }
  async function operate(page,action,args,operation,check,timeout) {
    const allow=async value=>{
      const url=await checkUrl(value);check();operation.origins.add(url.origin);return url;
    };
    const options=()=>({waitUntil:'domcontentloaded',timeout:timeout()});
    if(action==='open') {
      const url=await allow(args.url);
      if(navigateGet)await navigateGet(page,url,check,timeout);else await page.goto(url.href,options());
      return;
    }
    const current=await allow(page.url());
    if(action==='reload'){await page.reload(options());return;}
    if(action==='back'||action==='forward'){
      const history=await historyOf(page),destination=history[action];
      if(!destination)fail('REVISION_CONFLICT','没有可访问的历史页面');
      await allow(destination.href);
      if(current.href!==page.url())fail('REVISION_CONFLICT','当前网页已变化');
      if(action==='back')await page.goBack(options());else await page.goForward(options());
      return;
    }
    const seen=requireView(page,args.viewId);
    if(action==='handoff'){
      current.search='';current.hash='';return {url:current.href};
    }
    if(action==='scroll'){
      await page.evaluate(amount=>window.scrollBy({top:amount,behavior:'instant'}),(args.direction==='up'?-1:1)*(args.amount??640));
      return;
    }
    const selected=seen.controls.find(item=>item.ref===args.ref);
    const {locator,type}=await findControl(seen,args.ref);
    if(action==='click'&&type.href){
      if(type.href!==selected.downloadUrl)fail('REVISION_CONFLICT','链接目标已变化');
      await allow(type.href);
    }
    check();requireView(page,args.viewId);
    const row={timeout:timeout()};
    if(action==='click'){
      if(type.tag==='input'&&['file','password'].includes(type.type))fail('UNAUTHORIZED','受保护控件不可操作');
      if(type.href&&await locator.getAttribute('target')==='_blank'){
        check();requireView(page,args.viewId);await page.goto(type.href,options());
      }else if(['video','audio'].includes(type.tag)){
        const play=await locator.evaluate(element=>element instanceof HTMLMediaElement&&element.paused);
        check();requireView(page,args.viewId);
        const token=randomUUID();
        const media=await locator.evaluate(async(element,{play,mediaAttribute,token})=>{
          if(!(element instanceof HTMLMediaElement))throw Error('Media unavailable');
          if(play){await element.play();element.setAttribute(mediaAttribute,token);}else element.pause();
          return {source:element.currentSrc,tag:element.localName,paused:element.paused,ended:element.ended,token};
        },{play,mediaAttribute,token});
        check();await onMedia(page,media,check);
      }else await locator.click(row);
    }else if(action==='type'){
      if(!['input','textarea'].includes(type.tag)&&!type.editable||type.tag==='input'&&!['','text','search','email','url','tel','number','date','datetime-local','time','month','week'].includes(type.type))
        fail('UNAUTHORIZED','此控件不能输入文字');
      await locator.fill(args.text,row);
      if(args.submit){
        check();requireView(page,args.viewId);
        const currentControl=await findControl(seen,args.ref);
        const sameInput=await currentControl.locator.evaluate((element,text)=>document.activeElement===element
          &&(element.isContentEditable?element.textContent:element.value)===text,args.text);
        if(!sameInput)fail('REVISION_CONFLICT','输入后焦点或文字已变化，请刷新后再提交');
        check();requireView(page,args.viewId);await currentControl.locator.press('Enter',{timeout:timeout()});
      }
    }else if(action==='select'){
      if(type.tag!=='select'||!selected.multiple&&args.values.length!==1
        ||!args.values.every(value=>selected.options?.some(item=>!item.disabled&&item.value===value)))fail('INVALID_ARGUMENT','选项已变化');
      await locator.selectOption(args.values,row);
    }else if(action==='press')await locator.press(args.key,row);
  }
  return {state,preview,frame,operate,invalidate(){++revision;view=undefined;}};
}
