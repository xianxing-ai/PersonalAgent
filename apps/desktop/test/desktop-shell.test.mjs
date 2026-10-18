import test from 'node:test';
import assert from 'node:assert/strict';
import {mountDesktopShell} from '../src/ui/desktop-shell.js';

const preference=language=>({settings:{language},locale:'zh-CN'});
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(t,mode='workspace') {
  const keys=['window','document','location','MutationObserver','matchMedia'];
  const originals=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  t.after(()=>{for(const key of keys){const value=originals.get(key);if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}});
  const attributes=new Map([['title','关闭工作区'],['aria-label','关闭工作区']]);
  const button={childElementCount:0,textContent:'关闭工作区',getAttribute:name=>attributes.get(name)??null,
    setAttribute:(name,value)=>attributes.set(name,value)};
  let resolveRead,rejectRead,publish,observing=true,subscribed=true,themeListener,unload;
  const read=new Promise((resolve,reject)=>{resolveRead=resolve;rejectRead=reject;});
  let reads=0;
  globalThis.location={search:`?mode=${mode}`};
  globalThis.document={body:{},documentElement:{lang:'zh-CN'},querySelectorAll:()=>[button]};
  globalThis.window={desktop:{preferences:()=>{reads++;return read;},subscribePreferences:listener=>{publish=listener;return ()=>{subscribed=false;};}},
    addEventListener:(type,listener)=>{if(type==='unload')unload=listener;}};
  let mutation;
  globalThis.MutationObserver=class {constructor(listener){mutation=listener;}observe(){}disconnect(){observing=false;}};
  globalThis.matchMedia=()=>({addEventListener:(_type,listener)=>{themeListener=listener;},removeEventListener:()=>{themeListener=undefined;}});
  mountDesktopShell();
  return {button,attributes,resolveRead,rejectRead,publish:value=>publish(value),mutate:()=>mutation(),unload:()=>unload(),
    lang:()=>document.documentElement.lang,reads:()=>reads,observing:()=>observing,subscribed:()=>subscribed,theme:()=>themeListener};
}

test('a newer preference event wins over a late initial read',async t=>{
  const f=fixture(t);f.publish(preference('en'));
  assert.equal(f.button.textContent,'Close workspace');
  f.resolveRead(preference('zh-CN'));await settle();
  assert.equal(f.lang(),'en');assert.equal(f.button.textContent,'Close workspace');
  assert.equal(f.attributes.get('aria-label'),'Close workspace');
});

test('normal initial preferences and later language switches preserve original labels',async t=>{
  const f=fixture(t);f.resolveRead(preference('en'));await settle();
  assert.equal(f.button.textContent,'Close workspace');assert.equal(f.attributes.get('title'),'Close workspace');
  f.publish(preference('zh-CN'));assert.equal(f.button.textContent,'关闭工作区');
  f.publish(preference('en'));assert.equal(f.attributes.get('aria-label'),'Close workspace');
  f.publish(preference('system'));assert.equal(f.lang(),'zh-CN');assert.equal(f.button.textContent,'关闭工作区');
});

test('unload disconnects observers and ignores late reads, queued events and mutations',async t=>{
  const f=fixture(t);f.unload();f.resolveRead(preference('en'));f.publish(preference('en'));f.mutate();await settle();
  assert.equal(f.lang(),'zh-CN');assert.equal(f.button.textContent,'关闭工作区');
  assert.equal(f.observing(),false);assert.equal(f.subscribed(),false);assert.equal(f.theme(),undefined);
});

test('a failed initial read still accepts later preference events',async t=>{
  const f=fixture(t);f.rejectRead(Error('synthetic unavailable'));await settle();
  f.publish(preference('en'));assert.equal(f.lang(),'en');assert.equal(f.button.textContent,'Close workspace');
});

test('floating panel does not mount the settings translation subscription',t=>{
  const f=fixture(t,'panel');assert.equal(f.reads(),0);
});
