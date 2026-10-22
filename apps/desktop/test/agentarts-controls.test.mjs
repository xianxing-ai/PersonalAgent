import test from 'node:test';
import assert from 'node:assert/strict';
import {mountAgentArtsControls} from '../src/app/agentarts-controls.js';

function harness(t,invoke) {
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
  t.after(()=>{if(previous) Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
  const node=()=>({value:'',checked:false,disabled:false,textContent:'',listeners:new Map(),attributes:new Map(),
    insertAdjacentHTML(_position,value){this.insertedHtml=(this.insertedHtml??'')+value;},
    isConnected:true,getClientRects:()=>[{}],focus(){globalThis.document.activeElement=this;},
    addEventListener(name,listener){this.listeners.set(name,listener);},
    setAttribute(name,value){this.attributes.set(name,value);}});
  const fields=Object.fromEntries(['gatewayUrl','runtimeName','deploymentVersion','authorization','transport','websocketUrl','appToken','allowHttpsFallback'].map(key=>[key,node()]));
  const submit=node(),revoke=node(),restore=node(),status=node(),form=node(),tokenHint=node(),buttonGroup=node(),transportState=node();
  Object.assign(form,{elements:fields,querySelector:()=>submit,
    querySelectorAll:()=>[...Object.values(fields),submit,revoke,restore],
    reset(){Object.values(fields).forEach(field=>{field.value='';field.checked=false;});fields.transport.value='wss';}});
  const wss=node();
  const section={isConnected:true,hidden:false,getClientRects:()=>section.hidden?[]:[{}],
    querySelector:selector=>({'form':form,'[data-status]':status,'[data-wss]':wss,'[data-token-hint]':tokenHint,
      '[data-revoke]':revoke,'[data-restore-default]':restore,'.btn-group':buttonGroup,'[data-transport-state]':transportState}[selector])};
  form.contains=target=>[...Object.values(fields),submit,revoke,restore].includes(target);
  const body={},documentListeners=new Map();
  globalThis.document={body,activeElement:body,createElement:()=>section,
    addEventListener:(name,listener)=>documentListeners.set(name,listener),
    removeEventListener:(name,listener)=>{if(documentListeners.get(name)===listener)documentListeners.delete(name);}};
  const controls=mountAgentArtsControls({append(){}},invoke);
  controls.render({gatewayUrl:'https://example.huaweicloud-agentarts.com',runtimeName:'synthetic-runtime'});
  return {controls,fields,submit,revoke,restore,status,section,wss,tokenHint,buttonGroup,transportState,save:()=>form.listeners.get('submit')({preventDefault(){}}),
    blur:()=>{globalThis.document.activeElement=body;},
    focusElsewhere:()=>{const target={};globalThis.document.activeElement=target;documentListeners.get('focusin')?.({target});},
    clear:()=>revoke.listeners.get('click')(),
    recover:()=>restore.listeners.get('click')(),
    edit:(key,value)=>{fields[key].value=value;form.listeners.get('input')({target:fields[key]});}};
}

test('AgentArts new UI offers explicit WSS and clears both secrets after save and failed revoke',async t=>{
  let captured,fail=false;
  const ui=harness(t,async(action,input)=>{captured=input?{...input}:undefined;if(fail)throw Error('private');return {configured:true};});
  assert.equal(ui.fields.transport.value,'wss');assert.equal(ui.wss.hidden,false);
  assert.match(ui.section.className,/agentarts-settings/);
  assert.match(ui.section.innerHTML,/本机加密记录为准/);
  assert.equal(ui.fields.allowHttpsFallback.checked,false);
  ui.edit('websocketUrl','wss://example.huaweicloud-agentarts.com/runtimes/synthetic-runtime/invocations/ws');
  ui.edit('authorization','Bearer synthetic-outer');ui.edit('appToken','synthetic-inner-at-least-32-characters');
  await ui.save();
  assert.equal(captured.transport,'wss');assert.equal(captured.allowHttpsFallback,false);
  assert.equal(captured.appToken,'synthetic-inner-at-least-32-characters');
  assert.equal(ui.fields.authorization.value,'');assert.equal(ui.fields.appToken.value,'');
  ui.controls.render({transport:'https',configured:true,reason:'Legacy HTTPS'});
  assert.equal(ui.wss.hidden,true);assert.equal(ui.fields.websocketUrl.required,false);
  await ui.save();assert.equal(captured.transport,'https');assert.equal('appToken' in captured,false);
  ui.edit('authorization','Bearer private');ui.edit('appToken','private');fail=true;await ui.clear();
  assert.equal(ui.fields.authorization.value,'');assert.equal(ui.fields.appToken.value,'');
  assert.match(ui.status.textContent,/撤销结果未获确认/);
});

test('AgentArts settings serialize save/revoke and preserve the pending destination across snapshots',async t=>{
  const calls=[];let resolve;
  const ui=harness(t,(action,input)=>{calls.push({action,input});return new Promise(done=>{resolve=done;});});
  ui.fields.authorization.value='Bearer synthetic-only';
  const pending=ui.save();
  assert.equal(ui.fields.authorization.value,'');
  await ui.save();await ui.clear();
  assert.equal(calls.length,1,'a pending save cannot dispatch another save or revoke');
  ui.controls.render({gatewayUrl:'https://stale.huaweicloud-agentarts.com',runtimeName:'stale'});
  assert.equal(ui.fields.runtimeName.value,'synthetic-runtime');
  assert.equal(ui.revoke.disabled,true);
  assert.ok(Object.values(ui.fields).every(field=>field.disabled));
  resolve({configured:true,reason:'synthetic saved'});await pending;
  assert.equal(calls[0].input.authorization,'','request credential is scrubbed after settlement');
  assert.equal(ui.status.textContent,'synthetic saved');
  assert.equal(ui.revoke.disabled,false);
  const revoking=ui.clear();await ui.save();
  assert.equal(calls.length,2);
  resolve({configured:false});await revoking;
  assert.equal(ui.fields.runtimeName.value,'');
  assert.match(ui.status.textContent,/凭据已清除/);
});

test('AgentArts settled actions restore initiating focus without retries or stealing focus after departure',async t=>{
  const calls=[];let resolve,reject;
  const ui=harness(t,action=>{calls.push(action);return new Promise((done,fail)=>{resolve=done;reject=fail;});});
  for(const result of [{configured:true},undefined,{configured:false}]) {
    ui.fields.runtimeName.focus();const pending=ui.save();ui.blur();resolve(result);await pending;
    assert.equal(globalThis.document.activeElement,ui.fields.runtimeName);
  }
  for(const result of [{configured:false},undefined]) {
    ui.revoke.focus();const revoke=ui.clear();ui.blur();resolve(result);await revoke;
    assert.equal(globalThis.document.activeElement,ui.revoke);
  }
  for(const action of [ui.save,ui.clear]) {
    const origin=action===ui.save?ui.fields.runtimeName:ui.revoke;origin.focus();
    const failed=action();ui.blur();reject(Error('synthetic failure'));await failed;
    assert.equal(globalThis.document.activeElement,origin);
  }
  ui.fields.runtimeName.focus();const departed=ui.save();ui.focusElsewhere();ui.blur();resolve({configured:true});await departed;
  assert.equal(globalThis.document.activeElement,globalThis.document.body);
  ui.fields.runtimeName.focus();const hidden=ui.save();ui.blur();ui.controls.show(false);ui.controls.show(true);
  resolve({configured:true});await hidden;
  assert.equal(globalThis.document.activeElement,globalThis.document.body,'leaving and returning cannot restore stale focus');
  ui.fields.runtimeName.focus();const disconnected=ui.save();ui.blur();ui.section.isConnected=false;
  resolve({configured:true});await disconnected;
  assert.equal(globalThis.document.activeElement,globalThis.document.body);
  assert.equal(calls.length,10,'focus restoration cannot invoke an operation');
});

test('AgentArts settings keep failed writes unconfirmed, redact errors, and allow explicit retry',async t=>{
  let reject;
  const ui=harness(t,()=>new Promise((_,fail)=>{reject=fail;}));
  const pending=ui.clear();reject(Error('private-path synthetic-secret'));await pending;
  assert.match(ui.status.textContent,/撤销结果未获确认/);
  assert.equal(ui.status.attributes.get('role'),'alert');
  assert.doesNotMatch(ui.status.textContent,/private-path|synthetic-secret/);
  assert.equal(ui.submit.disabled,false);
  const retry=ui.save();reject(Error('private-path synthetic-secret'));await retry;
  assert.match(ui.status.textContent,/保存结果未获确认/);
  assert.ok(Object.values(ui.fields).every(field=>!field.disabled));
});

test('AgentArts settings require matching configuration readback before showing success',async t=>{
  let result;
  const ui=harness(t,async()=>result);
  for(result of [undefined,{configured:false,reason:'synthetic success claim'}]) {
    await ui.save();assert.match(ui.status.textContent,/保存结果未获确认/);
  }
  result={configured:true,reason:'synthetic revoked claim'};
  await ui.clear();assert.match(ui.status.textContent,/撤销结果未获确认/);
});

test('AgentArts settings refresh host status while keeping pending and unconfirmed actions explicit',async t=>{
  let resolve,reject;
  const ui=harness(t,()=>new Promise((done,fail)=>{resolve=done;reject=fail;}));
  ui.controls.render({configured:false,reason:'synthetic not configured'});
  assert.equal(ui.status.textContent,'synthetic not configured');
  ui.controls.render({configured:true,reason:'synthetic host configured'});
  assert.equal(ui.status.textContent,'synthetic host configured');
  const pending=ui.save();
  ui.controls.render({configured:false,reason:'synthetic interim host status'});
  assert.match(ui.status.textContent,/正在保存/);
  reject(Error('private diagnostic'));await pending;
  ui.controls.render({configured:true,reason:'synthetic older success claim'});
  assert.match(ui.status.textContent,/保存结果未获确认/);
  assert.equal(ui.status.attributes.get('role'),'alert');
  const retry=ui.save();resolve({configured:true,reason:'synthetic confirmed save'});await retry;
  assert.equal(ui.status.textContent,'synthetic confirmed save');
  assert.equal(ui.status.attributes.get('role'),'status');
  ui.controls.render({configured:false,reason:'synthetic host revoked'});
  assert.equal(ui.status.textContent,'synthetic host revoked','fresh host status supersedes completed success feedback');
  const revoking=ui.clear();
  ui.controls.render({configured:true,reason:'synthetic concurrent publication'});
  assert.match(ui.status.textContent,/正在撤销/);
  reject(Error('private diagnostic'));await revoking;
  ui.controls.render({configured:false,reason:'synthetic apparent revocation'});
  assert.match(ui.status.textContent,/撤销结果未获确认/);
  assert.equal(ui.status.attributes.get('role'),'alert');
});

test('AgentArts settings distinguish unsaved edits from confirmed configuration across host snapshots',async t=>{
  const calls=[];let resolve;
  const ui=harness(t,(action,input)=>{calls.push({action,runtimeName:input?.runtimeName});return new Promise(done=>{resolve=done;});});
  ui.controls.render({gatewayUrl:ui.fields.gatewayUrl.value,runtimeName:'saved-runtime',reason:'synthetic before save'});
  const saving=ui.save();resolve({configured:true,reason:'synthetic confirmed save'});await saving;
  ui.edit('runtimeName','new-unsaved-runtime');
  assert.match(ui.status.textContent,/未保存/,'editing a confirmed destination must show unsaved feedback');
  assert.match(ui.status.textContent,/当前已保存配置状态.*synthetic confirmed save/);
  for(const reason of ['synthetic saved host','synthetic saved host','synthetic fresh host']) {
    ui.controls.render({gatewayUrl:'https://old.huaweicloud-agentarts.com',runtimeName:'saved-runtime',reason});
    assert.equal(ui.fields.runtimeName.value,'new-unsaved-runtime');
    assert.match(ui.status.textContent,/未保存/);
    assert.ok(ui.status.textContent.includes('当前已保存配置状态：'+reason),'fresh host reason remains explicitly scoped to saved configuration');
  }
  assert.equal(calls.length,1,'editing and host snapshots cannot save the draft');
  const resaving=ui.save();assert.match(ui.status.textContent,/正在保存/);assert.doesNotMatch(ui.status.textContent,/未保存/);
  resolve({configured:true,reason:'synthetic second confirmed save'});await resaving;
  assert.equal(calls[1].runtimeName,'new-unsaved-runtime');
  assert.equal(ui.status.textContent,'synthetic second confirmed save');
  ui.controls.render({gatewayUrl:'https://new.huaweicloud-agentarts.com',runtimeName:'new-unsaved-runtime',reason:'synthetic new saved host'});
  assert.equal(ui.fields.gatewayUrl.value,'https://new.huaweicloud-agentarts.com');
  assert.equal(ui.status.textContent,'synthetic new saved host','confirmed save clears draft status');
});

test('AgentArts settings mark authorization-only edits unsaved and clear the draft after confirmed revocation',async t=>{
  let resolve;
  const ui=harness(t,()=>new Promise(done=>{resolve=done;}));
  ui.controls.render({gatewayUrl:ui.fields.gatewayUrl.value,runtimeName:ui.fields.runtimeName.value,reason:'synthetic configured host'});
  ui.edit('authorization','Bearer synthetic-private-draft');
  assert.match(ui.status.textContent,/未保存/);
  assert.doesNotMatch(ui.status.textContent,/synthetic-private-draft/);
  ui.controls.render({gatewayUrl:'https://old.huaweicloud-agentarts.com',runtimeName:'old-runtime',reason:'synthetic fresh host'});
  assert.equal(ui.fields.runtimeName.value,'synthetic-runtime');
  assert.equal(ui.fields.authorization.value,'Bearer synthetic-private-draft');
  assert.match(ui.status.textContent,/未保存.*当前已保存配置状态.*synthetic fresh host/);
  const revoking=ui.clear();assert.equal(ui.fields.authorization.value,'');assert.match(ui.status.textContent,/正在撤销/);assert.doesNotMatch(ui.status.textContent,/未保存/);
  resolve({configured:false,reason:'synthetic confirmed revocation'});await revoking;
  assert.equal(ui.fields.runtimeName.value,'');assert.equal(ui.status.textContent,'synthetic confirmed revocation');
  ui.controls.render({gatewayUrl:'',runtimeName:'',reason:'synthetic revoked host'});
  assert.equal(ui.status.textContent,'synthetic revoked host','confirmed revocation clears draft status');
});

test('AgentArts settings keep unconfirmed errors above draft and host feedback until an explicit successful retry',async t=>{
  let resolve,reject;
  const ui=harness(t,()=>new Promise((done,fail)=>{resolve=done;reject=fail;}));
  ui.edit('runtimeName','first-draft');
  const saving=ui.save();reject(Error('synthetic-private-error'));await saving;
  const failure=ui.status.textContent;
  ui.edit('runtimeName','retry-draft');
  ui.edit('authorization','Bearer synthetic-private-retry');
  ui.controls.render({gatewayUrl:'https://old.huaweicloud-agentarts.com',runtimeName:'old-runtime',reason:'synthetic apparent success'});
  assert.equal(ui.status.textContent,failure);assert.equal(ui.status.attributes.get('role'),'alert');
  assert.equal(ui.fields.runtimeName.value,'retry-draft');
  assert.doesNotMatch(ui.status.textContent,/synthetic-private/);
  const retry=ui.save();assert.match(ui.status.textContent,/正在保存/);assert.equal(ui.fields.authorization.value,'');
  resolve({configured:true,reason:'synthetic confirmed retry'});await retry;
  assert.equal(ui.status.textContent,'synthetic confirmed retry');assert.equal(ui.status.attributes.get('role'),'status');
  ui.controls.render({gatewayUrl:'https://new.huaweicloud-agentarts.com',runtimeName:'retry-draft',reason:'synthetic fresh confirmed host'});
  assert.equal(ui.fields.gatewayUrl.value,'https://new.huaweicloud-agentarts.com');
  assert.equal(ui.status.textContent,'synthetic fresh confirmed host');
});

test('AgentArts fixed deployment version renders and saves without losing edits',async t=>{
  let submitted;
  const ui=harness(t,async(action,input)=>{
    submitted={action,gatewayUrl:input.gatewayUrl,runtimeName:input.runtimeName,
      deploymentVersion:input.deploymentVersion};
    return {configured:true};
  });
  assert.match(ui.section.innerHTML,/name="deploymentVersion"[^>]*maxlength="128"/);
  ui.controls.render({gatewayUrl:'https://example.huaweicloud-agentarts.com',
    runtimeName:'synthetic-runtime',deploymentVersion:'v5.release-1'});
  assert.equal(ui.fields.deploymentVersion.value,'v5.release-1');
  ui.edit('deploymentVersion',' v6.release-2 ');
  ui.controls.render({gatewayUrl:'https://stale.huaweicloud-agentarts.com',
    runtimeName:'stale',deploymentVersion:'stale'});
  assert.equal(ui.fields.deploymentVersion.value,' v6.release-2 ');
  ui.edit('authorization','Bearer synthetic-only');
  await ui.save();
  assert.deepEqual(submitted,{action:'agentarts.configure',
    gatewayUrl:'https://example.huaweicloud-agentarts.com',
    runtimeName:'synthetic-runtime',deploymentVersion:'v6.release-2'});
  assert.equal(ui.fields.authorization.value,'');
  ui.controls.render({deploymentVersion:'v6.release-2'});
  assert.equal(ui.fields.deploymentVersion.value,'v6.release-2');
});

test('a rejected save shows the host reason and keeps the typed credentials',async t=>{
  const ui=harness(t,async()=>{throw Error('首次配置 WSS 主通道必须填写“独立镜像访问令牌”（至少 32 位可见字符）');});
  ui.edit('authorization','Bearer synthetic-outer');
  ui.edit('appToken','too-short');
  await ui.save();
  assert.match(ui.status.textContent,/首次配置 WSS 主通道必须填写/);
  assert.equal(ui.status.attributes.get('role'),'alert');
  assert.equal(ui.fields.authorization.value,'Bearer synthetic-outer','rejected input is not discarded');
  assert.equal(ui.fields.appToken.value,'too-short');
});

test('a pasted pinned WSS address fills an empty fixed deployment version',async t=>{
  let submitted;
  const ui=harness(t,async(action,input)=>{submitted={...input};return {configured:true};});
  ui.edit('websocketUrl','wss://example.huaweicloud-agentarts.com/runtimes/synthetic-runtime/ws?endpoint=arm64-laya-abc123');
  assert.equal(ui.fields.deploymentVersion.value,'arm64-laya-abc123');
  ui.edit('deploymentVersion','arm64-manual');
  assert.equal(ui.fields.deploymentVersion.value,'arm64-manual','an explicit version is never overwritten');
  ui.edit('authorization','Bearer synthetic-outer');
  ui.edit('appToken','synthetic-inner-at-least-32-characters');
  await ui.save();
  assert.equal(submitted.deploymentVersion,'arm64-manual');
  assert.equal(submitted.websocketUrl,'wss://example.huaweicloud-agentarts.com/runtimes/synthetic-runtime/ws?endpoint=arm64-laya-abc123');
});

test('the token hint states whether a credential is already stored',async t=>{
  const ui=harness(t,async()=>({configured:true}));
  ui.controls.render({configured:false,appTokenConfigured:false});
  assert.match(ui.tokenHint.textContent,/必填/);
  ui.controls.render({configured:true,appTokenConfigured:true});
  assert.match(ui.tokenHint.textContent,/已在本机加密保存/);
});

test('default connection recovery is an explicit no-payload action on the saved instance and reads back HTTPS Latest',async t=>{
  const calls=[];let resolve;
  const current={gatewayUrl:'https://example.huaweicloud-agentarts.com',runtimeName:'saved-runtime',configured:true,
    canRestoreDefaultConnection:true,transport:'wss',effectiveTransport:'wss',deploymentVersion:'configured-r3',
    websocketUrl:'wss://example.huaweicloud-agentarts.com/runtimes/saved-runtime/ws?endpoint=configured-r3',allowHttpsFallback:true};
  const ui=harness(t,(action,input)=>{calls.push({action,input});return new Promise(done=>{resolve=done;});});
  ui.controls.render(current);assert.equal(calls.length,0,'render cannot change a route');
  assert.match(ui.buttonGroup.insertedHtml,/恢复默认连接（HTTPS \/ Latest）/);
  assert.match(ui.status.insertedHtml,/Live 实时音频仍需.*WSS，HTTPS 不能代替/);
  assert.match(ui.transportState.textContent,/WSS.*固定部署 configured-r3/);
  ui.edit('runtimeName','UNSAVED_RUNTIME');ui.edit('authorization','PRIVATE_DRAFT');ui.edit('appToken','PRIVATE_TOKEN');
  const pending=ui.recover();await ui.save();await ui.clear();await ui.recover();
  assert.deepEqual(calls,[{action:'agentarts.restoreDefaultConnection',input:undefined}]);
  assert.equal(ui.fields.authorization.value,'');assert.equal(ui.fields.appToken.value,'');
  assert.equal(ui.restore.disabled,true);assert.match(ui.status.textContent,/正在保存默认连接/);
  resolve({...current,transport:'https',effectiveTransport:'https',deploymentVersion:'',websocketUrl:'',allowHttpsFallback:false,
    reason:'请重启应用使用新配置'});await pending;
  assert.equal(ui.fields.runtimeName.value,'saved-runtime');assert.equal(ui.fields.transport.value,'https');
  assert.equal(ui.fields.deploymentVersion.value,'');assert.equal(ui.fields.websocketUrl.value,'');assert.equal(ui.wss.hidden,true);
  assert.match(ui.transportState.textContent,/HTTPS.*默认 Latest（未钉版，实际版本未读回）/);
  assert.match(ui.status.textContent,/已保存默认连接.*请重启应用/);
  assert.doesNotMatch(ui.status.textContent,/PRIVATE_|UNSAVED_|已连接|已执行/);
  assert.equal(ui.restore.disabled,false);
});

test('recovery refuses mismatched readback and never retries or exposes private errors',async t=>{
  let result,throwError=false,calls=0;
  const ui=harness(t,async()=>{calls++;if(throwError)throw Error('PRIVATE_PATH PRIVATE_TOKEN');return result;});
  const current={gatewayUrl:'https://example.huaweicloud-agentarts.com',runtimeName:'saved-runtime',configured:true,
    canRestoreDefaultConnection:true,transport:'wss',deploymentVersion:'old-pin'};
  ui.controls.render(current);
  const expected={...current,transport:'https',effectiveTransport:'https',deploymentVersion:'',websocketUrl:'',allowHttpsFallback:false};
  for(result of [undefined,{...expected,transport:'wss',effectiveTransport:'wss'}, {...expected,deploymentVersion:'old-pin'},
    {...expected,runtimeName:'other'}, {...expected,websocketUrl:'wss://PRIVATE_URL'}, {...expected,configured:false}]){
    await ui.recover();assert.match(ui.status.textContent,/恢复结果未获确认/);assert.equal(ui.status.attributes.get('role'),'alert');
    assert.equal(ui.fields.transport.value,'wss');
  }
  throwError=true;await ui.recover();assert.doesNotMatch(ui.status.textContent,/PRIVATE_/);assert.equal(calls,7);
  ui.controls.render(current);assert.match(ui.status.textContent,/恢复结果未获确认/,'a snapshot cannot confirm a rejected action');
  throwError=false;result=expected;await ui.recover();assert.match(ui.status.textContent,/已保存默认连接/);assert.equal(calls,8);
  ui.controls.render({configured:false,canRestoreDefaultConnection:false});assert.equal(ui.restore.disabled,true);
  await ui.recover();assert.equal(calls,8,'unconfigured state cannot invent a default destination');
});
