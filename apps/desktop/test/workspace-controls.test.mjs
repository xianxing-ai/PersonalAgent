import test from 'node:test';
import assert from 'node:assert/strict';
import {mountWorkspaceControls} from '../src/app/workspace-controls.js';

function elementStub(extra={}) {
  const children=[];
  return {
    isConnected:true,disabled:false,textContent:'',value:'',className:'',type:'',hidden:false,
    listeners:new Map(),children,
    addEventListener(event,handler){this.listeners.set(event,handler);},
    append(...nodes){children.push(...nodes);},
    replaceChildren(...nodes){children.length=0;children.push(...nodes);},
    focus(){globalThis.document.activeElement=this;},
    getClientRects(){return this.hidden?[]:[{}];},
    ...extra,
  };
}

function harness(t,invoke=async()=>undefined) {
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
  const fields={},documentListeners=new Map(),body={};
  const section=elementStub({
    contains:target=>Object.values(fields).includes(target)||target===section,
    setAttribute(){},
    querySelector(selector){return fields[/data-workspace="([^"]+)"/u.exec(selector)?.[1]]??null;},
  });
  Object.defineProperty(section,'innerHTML',{set(markup){
    section.markup=markup;
    for(const [,name]of markup.matchAll(/data-workspace="([^"]+)"/gu)) fields[name]=elementStub();
  },configurable:true});
  globalThis.document={body,activeElement:body,
    createElement:tag=>String(tag).toLowerCase()==='section'?section:elementStub({tagName:String(tag||'').toUpperCase()}),
    addEventListener:(name,handler)=>documentListeners.set(name,handler),
    removeEventListener:(name,handler)=>{if(documentListeners.get(name)===handler)documentListeners.delete(name);}};
  const controls=mountWorkspaceControls({append(){}},invoke);
  const render=(coding={})=>controls.render({coding:{configured:true,displayName:'project',nodeConfigured:true,
    projectScriptsAvailable:true,projectCommands:['build','test'],...coding}});
  return {fields,section,controls,render,click:name=>fields[name].listeners.get('click')(),
    blur:()=>{globalThis.document.activeElement=body;},
    focusElsewhere:()=>{const target={};globalThis.document.activeElement=target;documentListeners.get('focusin')?.({target});}};
}

test('workspace settings retain real configuration and revocation but cannot grant operations',async t=>{
  const calls=[],ui=harness(t,async(action,input)=>{calls.push({action,input});return {coding:{configured:true,displayName:'project'}};});
  ui.render();
  for(const name of ['authorize','cloud','write','command','project-code'])assert.equal(ui.fields[name],undefined);
  assert.match(ui.section.markup,/对话提问卡一次确认/);
  assert.doesNotMatch(ui.section.markup,/data-workspace="authorize"|单独勾选/);
  for(const [name,action]of [['select','coding.select'],['select-node','coding.selectNode'],
    ['select-file','coding.selectCheckFile'],['select-npm','coding.selectNpmCli'],['revoke','coding.revoke']]){
    ui.render();await ui.click(name);assert.deepEqual(calls.at(-1),{action,input:undefined});
  }
  assert.ok(calls.every(item=>item.action!=='coding.authorize'));
  ui.render({configured:false});assert.equal(ui.fields['select-node'].disabled,true);assert.equal(ui.fields['select-npm'].disabled,true);
  assert.equal(ui.fields.select.disabled,false,'missing configuration still has a real picker');
});

test('API document settings invoke native selection with the fixed sample recipe and no paths or authority',async t=>{
  const calls=[],ui=harness(t,async(action,input)=>{calls.push({action,input});return {coding:{configured:true,nodeConfigured:true,f20:{configured:true,inputRef:'api-case'}}};});
  ui.render();ui.fields['f20-ref'].value='api-case';ui.fields['f20-template'].value='Describe only supported parameters';
  await ui.click('f20-configure');
  assert.deepEqual(calls,[{action:'coding.f20.configure',input:{inputRef:'api-case',docTemplate:'Describe only supported parameters',recipeId:'f20-typescript-sample'}}]);
  assert.match(ui.fields['f20-state'].textContent,/api-case/);
  ui.render({nodeConfigured:false});assert.equal(ui.fields['f20-configure'].disabled,true);
});

test('F16/F17 case controls consume host selectionRef and availability without accepting paths or granting execution',async t=>{
  const calls=[],ui=harness(t,async(action,input)=>{calls.push({action,input});return {coding:{configured:true,f16f17:{
    [input.workflowId]:{configured:true,selectionRef:'<case & original>'},unavailable:['原失败回执尚未取得']}}};});
  ui.render();assert.equal(ui.fields['f16-select'].disabled,true);assert.equal(ui.fields['f17-select'].disabled,true);
  for(const workflowId of ['F16','F17']){
    ui.render({f16f17:{[workflowId]:{configured:false},unavailable:[]}});
    await ui.click(workflowId.toLowerCase()+'-select');
    assert.deepEqual(calls.at(-1),{action:'coding.f16f17.select',input:{workflowId}});
    assert.match(ui.fields[workflowId.toLowerCase()+'-state'].textContent,/<case & original>.*宿主报告不可用.*原失败回执/);
  }
  ui.render({f16f17:{F16:{configured:true,selectionRef:'fixed'},unavailable:[]}});
  assert.match(ui.fields['f16-state'].textContent,/执行时核对原失败来源与许可/);
  assert.doesNotMatch(ui.fields['f16-state'].textContent,/已授权|运行成功|可用/);
  ui.render({f16f17:{F16:{configured:true,selectionRef:'ci'},F17:{configured:true,selectionRef:'test'},
    unavailable:['f16_ci_publication_tool_chain_unavailable']}});
  assert.match(ui.fields['f16-state'].textContent,/GitHub CI 的流程尚未就绪/);
  assert.doesNotMatch(ui.fields['f17-state'].textContent,/宿主报告不可用|f16_/);
  ui.render({configured:false,f16f17:{F16:{configured:false},unavailable:[]}});assert.equal(ui.fields['f16-select'].disabled,true);
});

test('case selection keeps the original host snapshot when native selection fails or returns an unconfirmed response',async t=>{
  let reply;const ui=harness(t,()=>reply);
  ui.render({f16f17:{F17:{configured:true,selectionRef:'original'},unavailable:[]}});
  reply=undefined;await ui.click('f17-select');assert.match(ui.fields['f17-state'].textContent,/original/);
  assert.match(ui.fields.status.textContent,/未获确认/);
  reply=Promise.reject(Error('synthetic picker failure'));await ui.click('f17-select');
  assert.match(ui.fields['f17-state'].textContent,/original/);assert.match(ui.fields.status.textContent,/未完成/);
});

test('workspace settled actions restore keyboard position only while origin remains valid and undisturbed',async t=>{
  let resolve,reject;const calls=[],ui=harness(t,action=>{calls.push(action);return new Promise((yes,no)=>{resolve=yes;reject=no;});});
  for(const name of ['select','revoke'])for(const outcome of ['success','failure','invalid']){
    ui.render();ui.fields[name].focus();const pending=ui.click(name);ui.blur();
    if(outcome==='failure')reject(Error('synthetic-only'));else resolve(outcome==='invalid'?{coding:[]}:{coding:{configured:true}});
    await pending;assert.equal(globalThis.document.activeElement,ui.fields[name]);
  }
  for(const departure of ['external-focus','external-then-body','hidden-and-return','removed-origin','removed-section']){
    ui.render();ui.fields.select.focus();const pending=ui.click('select');ui.blur();
    if(departure.startsWith('external')){ui.focusElsewhere();if(departure==='external-then-body')ui.blur();}
    if(departure==='hidden-and-return'){ui.controls.show(false);ui.controls.show(true);}
    if(departure==='removed-origin')ui.fields.select.isConnected=false;
    if(departure==='removed-section')ui.section.isConnected=false;
    const expected=globalThis.document.activeElement;
    resolve({coding:{configured:true}});await pending;assert.equal(globalThis.document.activeElement,expected);
    ui.fields.select.isConnected=true;ui.section.isConnected=true;
  }
  ui.render();ui.fields.revoke.focus();const pending=ui.click('revoke');ui.blur();
  resolve({coding:{configured:false,cloudExportAllowed:false}});await pending;
  assert.equal(globalThis.document.activeElement,globalThis.document.body,'a disabled origin cannot regain focus');
  assert.equal(calls.length,12,'focus changes cannot authorize or invoke other operations');
});

test('workspace operations tolerate synthetic documents without focus APIs',async t=>{
  const ui=harness(t,async()=>({coding:{configured:true}}));delete globalThis.document.activeElement;
  delete globalThis.document.addEventListener;delete globalThis.document.removeEventListener;
  ui.render();await ui.click('select');assert.equal(ui.fields.select.disabled,false);
});

test('project status only describes validated command subset and native readiness, never grants permission',t=>{
  const ui=harness(t);
  for(const [projectCommands,description]of [[['build'],'构建'],[['test'],'测试'],[['build','test'],'构建/测试']]){
    ui.render({projectCommands});assert.match(ui.fields['project-status'].textContent,new RegExp('项目'+description+'：可授权'));
  }
  for(const projectCommands of [[],undefined,['build','build'],['build','unknown'],['build',,],'build']){
    ui.render({projectCommands});assert.match(ui.fields['project-status'].textContent,/项目命令信息待读回/);
    assert.doesNotMatch(ui.fields['project-status'].textContent,/可授权/);
  }
  ui.render({projectScriptsAvailable:false});assert.match(ui.fields['project-status'].textContent,/暂不可用/);
  ui.render({readAvailable:true,writeAvailable:false,commandAvailable:false,cloudExportAllowed:false});
  assert.match(ui.fields.capabilities.textContent,/读取：可用/);assert.match(ui.fields.capabilities.textContent,/写入：不可用/);
  assert.match(ui.fields.capabilities.textContent,/结果发送：未允许/);
  assert.equal(ui.fields.authorize,undefined);
});

test('workspace controls retain pending feedback across snapshots and only confirm real settled readback',async t=>{
  let resolve;const ui=harness(t,()=>new Promise(done=>{resolve=done;}));
  ui.render({reason:'saved host state'});const pending=ui.click('select');
  ui.render({displayName:'new host name',nodeConfigured:true,reason:'background host state'});
  assert.equal(ui.fields.name.textContent,'当前工作区：new host name');
  assert.match(ui.fields.status.textContent,/等待本机宿主/);assert.equal(ui.fields.select.disabled,true);
  assert.equal(ui.fields.revoke.disabled,true);
  resolve({coding:{configured:true,displayName:'confirmed workspace',reason:'confirmed selection'}});await pending;
  assert.equal(ui.fields.status.textContent,'confirmed selection');assert.equal(ui.fields.select.disabled,false);
  ui.render({reason:'fresh host state'});assert.equal(ui.fields.status.textContent,'fresh host state');
});

test('workspace controls preserve unconfirmed feedback until explicit successful retry without leaking raw errors',async t=>{
  let resolve,reject;const ui=harness(t,()=>new Promise((yes,no)=>{resolve=yes;reject=no;}));
  ui.render();const failed=ui.click('select');reject(Error('synthetic private host detail'));await failed;
  const failure=ui.fields.status.textContent;assert.match(failure,/操作未完成/);
  ui.render({displayName:'updated host',reason:'background success claim'});
  assert.equal(ui.fields.status.textContent,failure);assert.doesNotMatch(failure,/private/);
  const retry=ui.click('select');resolve({coding:[]});await retry;assert.match(ui.fields.status.textContent,/结果未获确认/);
  ui.render({reason:'another background success claim'});assert.match(ui.fields.status.textContent,/结果未获确认/);
  const confirmed=ui.click('select');resolve({coding:{configured:true,displayName:'confirmed',reason:'confirmed retry'}});await confirmed;
  assert.equal(ui.fields.status.textContent,'confirmed retry');
});

test('selector cancellation is configuration-only and cannot manufacture a session grant',async t=>{
  const calls=[],coding={configured:true,displayName:'project',readAvailable:false,cloudExportAllowed:false};
  const ui=harness(t,async action=>{calls.push(action);return {coding,codingSelectionCancelled:true};});
  for(const name of ['select','select-node','select-file','select-npm']){ui.render(coding);await ui.click(name);}
  assert.equal(calls.length,4);assert.ok(calls.every(action=>action.startsWith('coding.select')));
  assert.match(ui.fields.capabilities.textContent,/读取：不可用/);assert.match(ui.fields.capabilities.textContent,/结果发送：未允许/);
  assert.equal(ui.fields.authorize,undefined);
});
