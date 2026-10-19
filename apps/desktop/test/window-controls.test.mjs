import test from 'node:test';
import assert from 'node:assert/strict';
import {mountWindowControls, windowControlsHtml} from '../src/ui/window-controls.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, mode = 'admin') {
  const original = Object.getOwnPropertyDescriptors(globalThis);
  t.after(() => {for (const key of ['window','document','MutationObserver']) {
    if (original[key]) Object.defineProperty(globalThis,key,original[key]); else delete globalThis[key];
  }});
  const calls = [], errors = [], buttons = ['minimize','maximize','close'].map(action => ({
    dataset:{window:action}, disabled:false, attributes:{}, listeners:{}, path:{},
    setAttribute(name,value) {this.attributes[name]=value;},
    querySelector() {return {setAttribute:(name,value)=>{this.path[name]=value;}};},
    addEventListener(name,fn) {this.listeners[name]=fn;}, removeEventListener(name) {delete this.listeners[name];},
  }));
  let initial, publish, language, unload, disconnected = false, unsubscribed = false;
  const read = new Promise(resolve => {initial=resolve;});
  const element = {lang:'zh-CN',dataset:{}};
  globalThis.document = {documentElement:element};
  globalThis.MutationObserver = class {constructor(fn) {language=fn;}observe() {}disconnect() {disconnected=true;}};
  globalThis.window = {desktop:{windowState:()=>read,subscribeWindowState(fn) {publish=fn;return ()=>{unsubscribed=true;};}},
    addEventListener(name,fn) {if(name==='unload')unload=fn;}, removeEventListener() {}};
  const root = {querySelectorAll:()=>buttons,querySelector:()=>({setAttribute() {}})};
  const dispose = mountWindowControls(root,(name)=>new Promise((resolve,reject)=>calls.push({name,resolve,reject})),mode,e=>errors.push(e.message));
  return {buttons,calls,errors,element,dispose,initial:state=>initial(state),publish:state=>publish(state),
    language:()=>language(),unload:()=>unload(),closed:()=>disconnected&&unsubscribed};
}

test('both window surfaces expose minimize, maximize and close controls with stable admin close ID', () => {
  for (const mode of ['admin','workspace']) {
    const html=windowControlsHtml(mode);
    for (const action of ['minimize','maximize','close']) assert.ok(html.includes(`data-window="${action}"`));
    assert.ok(html.includes('type="button"'));
  }
  assert.ok(windowControlsHtml('admin').includes('id="admin-close"'));
  assert.throws(()=>windowControlsHtml('panel'),/Unsupported/);
});

test('native maximize notifications beat a stale initial read and language changes preserve restore state', async t => {
  const f=fixture(t);f.publish({maximized:true});
  f.initial({maximized:false});await settle();
  assert.equal(f.buttons[1].attributes['aria-label'],'还原');
  assert.equal(f.element.dataset.windowMaximized,'true');
  const restore=f.buttons[1].path.d;
  f.element.lang='en';f.language();assert.equal(f.buttons[1].attributes.title,'Restore');
  assert.equal(f.buttons[1].path.d,restore);
  f.publish({maximized:false});assert.equal(f.buttons[1].attributes['aria-label'],'Maximize');
  assert.notEqual(f.buttons[1].path.d,restore);
});

test('current window commands are issued once while pending and failures remain retryable', async t => {
  const f=fixture(t,'workspace'),maximize=f.buttons[1];
  const pending=maximize.listeners.click();await maximize.listeners.click();
  assert.deepEqual(f.calls.map(c=>c.name),['workspace.maximize']);
  f.calls[0].reject(Error('synthetic maximize failure'));await pending;
  assert.deepEqual(f.errors,['synthetic maximize failure']);assert.equal(maximize.disabled,false);
  const retry=maximize.listeners.click();f.calls[1].resolve();await retry;
  assert.equal(maximize.disabled,false);
});

test('unload disposes subscriptions and ignores late state or command failures', async t => {
  const f=fixture(t),pending=f.buttons[0].listeners.click();f.unload();
  f.publish({maximized:true});f.initial({maximized:true});
  f.calls[0].reject(Error('late error'));await pending;await settle();
  assert.equal(f.element.dataset.windowMaximized,'false');assert.deepEqual(f.errors,[]);
  assert.equal(f.closed(),true);assert.equal(f.buttons[0].listeners.click,undefined);
  f.dispose();assert.equal(f.closed(),true);
});
