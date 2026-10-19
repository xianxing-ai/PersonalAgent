import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {supportsPanelAcrylic,panelWindowAppearance,bindPanelMaterial} from '../electron/panel-material.js';
const modern={platform:'win32',version:'10.0.22631'},theme=()=>Object.assign(new EventEmitter(),{shouldUseDarkColors:false,prefersReducedTransparency:false,shouldUseHighContrastColors:false});
test('native material is capability gated and unsupported hosts retain an opaque backing',()=>{
 for(const host of [{platform:'win32',version:'10.0.19045'},{platform:'linux',version:'6.8.0'},{platform:'darwin',version:'24.0.0'},{platform:'win32',version:'invalid'}]){
  assert.equal(supportsPanelAcrylic(host),false);const value=panelWindowAppearance(theme(),host);assert.equal(value.transparent,false);assert.equal(value.backgroundMaterial,'none');assert.notEqual(value.backgroundColor,'#00000000');
 }
 assert.equal(panelWindowAppearance(theme(),modern).backgroundMaterial,'acrylic');
});
test('reduced transparency and high contrast disable optional material',()=>{
 for(const flag of ['prefersReducedTransparency','shouldUseHighContrastColors']){const value=panelWindowAppearance({...theme(),[flag]:true,shouldUseDarkColors:true},modern);assert.equal(value.backgroundMaterial,'none');assert.equal(value.backgroundColor,'#181d27');}
});
test('theme updates adapt material once and closing releases the subscription',()=>{
 const emitter=theme(),window=new EventEmitter(),calls=[];Object.assign(window,{isDestroyed:()=>false,setBackgroundMaterial:value=>calls.push(value),setBackgroundColor:value=>calls.push(value)});
 bindPanelMaterial(window,emitter,modern);assert.deepEqual(calls,['acrylic','#00000000']);emitter.emit('updated');assert.equal(calls.length,2);
 emitter.prefersReducedTransparency=true;emitter.emit('updated');assert.deepEqual(calls.slice(-2),['none','#f1f5fc']);window.emit('closed');assert.equal(emitter.listenerCount('updated'),0);
});
test('a compositor failure falls back to an opaque readable color',()=>{
 const emitter=theme(),window=new EventEmitter(),colors=[];Object.assign(window,{isDestroyed:()=>false,setBackgroundMaterial:()=>{throw Error('unavailable');},setBackgroundColor:value=>colors.push(value)});bindPanelMaterial(window,emitter,modern);assert.deepEqual(colors,['#f1f5fc']);window.emit('closed');
});
