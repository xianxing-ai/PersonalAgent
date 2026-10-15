import test from 'node:test';
import assert from 'node:assert/strict';
import {bindProfile} from '../src/features/admin/profile.js';

function fixture(t){
  const listeners=new Map(),readers=[],writes=[];let stored=null;
  const windowEvents={addEventListener(name,fn){const group=listeners.get(name)??new Set();group.add(fn);listeners.set(name,group);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);}};
  globalThis.window=windowEvents;
  globalThis.localStorage={getItem:()=>stored,setItem:(name,value)=>{assert.equal(name,'pa-profile');stored=value;writes.push(JSON.parse(value));}};
  globalThis.FileReader=class {readAsDataURL(file){this.file=file;readers.push(this);}};
  t.after(()=>{delete globalThis.window;delete globalThis.localStorage;delete globalThis.FileReader;});
  const controls=new Map();
  const dialog={open:false,isConnected:true,events:{},showModal(){this.open=true;},close(){this.open=false;this.emit('close');},addEventListener(name,fn){this.events[name]=fn;},emit(name){this.events[name]?.();}};
  for(const name of ['profile-edit','profile-cancel','profile-form','profile-name-input','profile-bio-input','profile-image-input','profile-name','profile-bio','profile-avatar','profile-edit-error'])controls.set('#'+name,{value:'',textContent:'',files:[]});
  controls.set('#profile-dialog',dialog);
  bindProfile({querySelector:name=>controls.get(name)},value=>String(value).replaceAll('"','&quot;'));
  const open=()=>controls.get('#profile-edit').onclick();
  const submit=(name,{image=false}={})=>{controls.get('#profile-name-input').value=name;controls.get('#profile-bio-input').value='Explicit Fake bio';controls.get('#profile-image-input').files=image?[{type:'image/png',size:10}]:[];return controls.get('#profile-form').onsubmit({preventDefault(){}});};
  const resolve=index=>{readers[index].result='data:image/png;base64,RmFrZQ==';readers[index].onload();};
  const reject=index=>readers[index].onerror();
  return {controls,dialog,readers,writes,listeners,open,submit,resolve,reject,cancel:()=>controls.get('#profile-cancel').onclick(),stored:()=>stored&&JSON.parse(stored),error:()=>controls.get('#profile-edit-error').textContent,unload:()=>{for(const fn of listeners.get('unload')??[])fn();}};
}

test('cancelled old image success cannot overwrite a newer accepted local profile',async t=>{
  const f=fixture(t);f.open();const old=f.submit('Fake old',{image:true});f.cancel();f.open();await f.submit('Fake newer');assert.equal(f.stored().name,'Fake newer');f.resolve(0);await old;assert.equal(f.stored().name,'Fake newer');assert.equal(f.controls.get('#profile-name').textContent,'Fake newer');assert.equal(f.writes.length,1);
});
test('older submit success or error cannot overwrite the newer pending image intent',async t=>{
  for(const outcome of ['resolve','reject']){const f=fixture(t);f.open();const old=f.submit('Fake old',{image:true});const latest=f.submit('Fake latest',{image:true});f[outcome](0);await old;assert.equal(f.writes.length,0);assert.equal(f.error(),'');assert.equal(f.dialog.open,true);f.resolve(1);await latest;assert.equal(f.stored().name,'Fake latest');assert.equal(f.writes.length,1);}
});
test('cancel, native dialog cancel, direct close and unload all invalidate old readers',async t=>{
  for(const action of ['cancel','native','close','unload'])for(const outcome of ['resolve','reject']){const f=fixture(t);f.open();const old=f.submit('Fake old',{image:true});if(action==='cancel')f.cancel();if(action==='native'){f.dialog.emit('cancel');f.dialog.close();}if(action==='close')f.dialog.close();if(action==='unload')f.unload();f[outcome](0);await old;assert.equal(f.writes.length,0,action);assert.equal(f.error(),'',action);}
});
test('old reader error after cancel and reopen cannot enter the new dialog feedback',async t=>{
  const f=fixture(t);f.open();const old=f.submit('Fake old',{image:true});f.cancel();f.open();f.controls.get('#profile-name-input').value='Fake new draft';f.reject(0);await old;assert.equal(f.error(),'');assert.equal(f.controls.get('#profile-name-input').value,'Fake new draft');assert.equal(f.dialog.open,true);assert.equal(f.writes.length,0);
});
test('current image read failure remains readable and a current retry can save',async t=>{
  const f=fixture(t);f.open();const first=f.submit('Fake first',{image:true});f.reject(0);await first;assert.equal(f.error(),'无法读取图片');assert.equal(f.dialog.open,true);assert.equal(f.writes.length,0);const retry=f.submit('Fake retry',{image:true});f.resolve(1);await retry;assert.equal(f.stored().name,'Fake retry');assert.equal(f.stored().avatar,'data:image/png;base64,RmFrZQ==');assert.equal(f.dialog.open,false);assert.equal(f.listeners.get('unload').size,0);
});
test('detached dialog cannot write and repeated modal open/close releases unload listeners',async t=>{
  const f=fixture(t);f.open();const old=f.submit('Fake detached',{image:true});f.dialog.isConnected=false;f.resolve(0);await old;assert.equal(f.writes.length,0);f.dialog.isConnected=true;f.cancel();for(let n=0;n<3;n++){f.open();assert.equal(f.listeners.get('unload').size,1);f.cancel();assert.equal(f.listeners.get('unload').size,0);}
});
