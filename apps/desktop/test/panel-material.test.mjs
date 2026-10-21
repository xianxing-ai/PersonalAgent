import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {supportsPanelAcrylic,panelWindowAppearance,bindPanelMaterial} from '../electron/panel-material.js';
const modern={platform:'win32',version:'10.0.22631'};
const theme=()=>Object.assign(new EventEmitter(),{shouldUseDarkColors:false,prefersReducedTransparency:false,shouldUseHighContrastColors:false});
function fixture(host=modern,flags={}){
 const colors=[],updates=[],instances=[],emitter=Object.assign(theme(),flags),win=Object.assign(new EventEmitter(),{isDestroyed:()=>false,setBackgroundColor:value=>colors.push(value)});
 win.webContents=Object.assign(new EventEmitter(),{getZoomFactor:()=>1});
 const start=(_win,callbacks)=>{const instance={callbacks,disposed:false,update:(value,radius)=>updates.push([value.shouldUseDarkColors,radius]),dispose(){this.disposed=true;}};instances.push(instance);return instance;};
 const material=bindPanelMaterial(win,emitter,host,start);return {win,emitter,colors,updates,instances,material};
}
test('a transparent shaped HWND never enables the rectangular system backdrop',()=>{
 for(const host of [modern,{platform:'linux',version:'6.8.0'},{platform:'win32',version:'10.0.19045'}]){
  const value=panelWindowAppearance(theme(),host);assert.equal(value.transparent,true);assert.equal(value.backgroundMaterial,'none');assert.notEqual(value.backgroundColor,'#00000000');
 }
});
test('unsupported platforms and accessibility preferences retain an opaque fallback',()=>{
 for(const host of [{platform:'linux',version:'6.8.0'},{platform:'win32',version:'invalid'},{platform:'win32',version:'10.0.19045'}]){assert.equal(supportsPanelAcrylic(host),false);assert.equal(fixture(host).instances.length,0);}
 for(const flag of ['prefersReducedTransparency','shouldUseHighContrastColors']){const f=fixture(modern,{[flag]:true});assert.equal(f.instances.length,0);assert.deepEqual(f.colors,['#f1f5fc']);}
});
test('native readiness, theme and zoom update a single clipped visual; close releases it',()=>{
 const f=fixture();assert.deepEqual(f.colors,['#f1f5fc']);f.instances[0].callbacks.onReady();assert.equal(f.colors.at(-1),'#00000000');
 f.emitter.shouldUseDarkColors=true;f.emitter.emit('updated');assert.equal(f.colors.at(-1),'#00000000');assert.deepEqual(f.updates.at(-1),[true,40]);
 f.win.webContents.getZoomFactor=()=>1.25;f.win.emit('resize');assert.deepEqual(f.updates.at(-1),[true,50]);assert.equal(f.instances.length,1);
 f.win.emit('closed');assert.equal(f.instances[0].disposed,true);assert.equal(f.emitter.listenerCount('updated'),0);assert.equal(f.win.listenerCount('resize'),0);assert.equal(f.win.webContents.listenerCount('zoom-changed'),0);
});
test('reduced transparency disposes the glass; restoring it starts a new visual',()=>{
 const f=fixture();f.instances[0].callbacks.onReady();f.emitter.prefersReducedTransparency=true;f.emitter.emit('updated');assert.equal(f.instances[0].disposed,true);assert.equal(f.colors.at(-1),'#f1f5fc');
 f.emitter.prefersReducedTransparency=false;f.emitter.emit('updated');assert.equal(f.instances.length,2);f.win.emit('closed');
});
test('a host failure keeps input readable and does not respawn in a loop',()=>{
 const f=fixture();f.instances[0].callbacks.onFailure();assert.equal(f.colors.at(-1),'#f1f5fc');f.emitter.shouldUseDarkColors=true;f.emitter.emit('updated');assert.equal(f.colors.at(-1),'#181d27');assert.equal(f.instances.length,1);f.win.emit('closed');
});

test('late callbacks from a disposed visual cannot change accessibility fallback or its replacement',()=>{
 const f=fixture(),old=f.instances[0];f.emitter.prefersReducedTransparency=true;f.emitter.emit('updated');
 old.callbacks.onReady();assert.equal(f.colors.at(-1),'#f1f5fc');
 f.emitter.prefersReducedTransparency=false;f.emitter.emit('updated');const fresh=f.instances[1];fresh.callbacks.onReady();
 old.callbacks.onFailure();assert.equal(f.colors.at(-1),'#00000000');assert.equal(fresh.disposed,false);
 f.win.emit('closed');const count=f.colors.length;fresh.callbacks.onReady();fresh.callbacks.onFailure();assert.equal(f.colors.length,count);
});

test('quit waits for native child release before allowing parent HWND destruction, once',async()=>{
 const f=fixture();let release,retries=0;const pending=new Promise(resolve=>{release=resolve;});
 f.instances[0].dispose=()=>pending;
 assert.equal(f.material.allowQuit(()=>retries++),false);
 assert.equal(f.material.allowQuit(()=>retries++),false);
 assert.equal(retries,0);
 release();await f.material.dispose();await Promise.resolve();
 assert.equal(retries,1);assert.equal(f.material.allowQuit(()=>retries++),true);assert.equal(retries,1);
 f.win.emit('closed');
});
