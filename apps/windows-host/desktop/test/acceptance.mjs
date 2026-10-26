import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
const directory=path.join(root,'.cache','desktop-native',randomUUID());
await mkdir(directory,{recursive:true});
const exe=path.join(root,'apps/windows-host/desktop/bin/Release/net8.0-windows/WindowsHost.Desktop.exe');
const fixtureExe=path.join(root,'apps/windows-host/desktop/fixture/bin/Release/net8.0-windows/WindowsHost.DesktopFixture.exe');
const fixture=spawn(fixtureExe,['--directory',directory],{windowsHide:false,stdio:'ignore'});
const broker=spawn(exe,[],{windowsHide:true,stdio:['pipe','pipe','pipe']});
let sequence=0,pending='',stderr='';const requests=new Map(),results=[];
broker.stdout.setEncoding('utf8');broker.stderr.setEncoding('utf8');
broker.stderr.on('data',chunk=>{stderr+=chunk;});
broker.stdout.on('data',chunk=>{
  pending+=chunk;
  for(;;){const end=pending.indexOf('\n');if(end<0)break;const line=pending.slice(0,end);pending=pending.slice(end+1);
    try{const frame=JSON.parse(line);const waiter=requests.get(frame.id);if(waiter){requests.delete(frame.id);clearTimeout(waiter.timer);waiter.resolve(frame);}}
    catch(error){for(const waiter of requests.values())waiter.reject(error);}
  }
});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const state=async()=>JSON.parse(await readFile(path.join(directory,'state.json'),'utf8'));
async function waitFor(predicate){const end=Date.now()+8000;while(Date.now()<end){try{const s=await state();if(predicate(s))return s;}catch{}await sleep(50);}throw Error('Synthetic fixture did not reach its expected state');}
function rpc(method,params={},timeout=10000){const id=String(++sequence);return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{requests.delete(id);reject(Error('Native response deadline exceeded'));},timeout+3000);
  requests.set(id,{resolve,reject,timer});broker.stdin.write(JSON.stringify({id,method,params,deadline:new Date(Date.now()+timeout).toISOString()})+'\n');
});}
async function ok(method,params={}){const frame=await rpc(method,params);assert.equal(frame.ok,true,JSON.stringify(frame.error));return frame.result;}
async function command(action){const id=randomUUID();const temporary=path.join(directory,'command.tmp');await writeFile(temporary,JSON.stringify({id,action}));await rename(temporary,path.join(directory,'command.json'));return waitFor(s=>s.commandId===id);}
const editor=snapshot=>snapshot.controls.find(control=>control.name==='Synthetic editor'&&control.patterns.includes('value'));
let snapshot;
try{
  await waitFor(s=>s.hwnd!=='0'&&s.rendered);await sleep(100);
  const initialized=await ok('initialize');assert.equal(initialized.protocol,'personal-agent-desktop/1');
  const listing=await ok('list_windows');const window=listing.windows.find(item=>item.processName==='WindowsHost.DesktopFixture');assert(window);
  const activated=await ok('activate',{windowRef:window.windowRef});assert.equal(activated.verification.kind,'foreground');snapshot=activated.snapshot;
  assert(editor(snapshot));results.push({name:'initialize-list-activate-observe',status:'passed'});
  const original=snapshot.targetRef;
  const set=await ok('action',{targetRef:original,action:'set_value',controlRef:editor(snapshot).ref,text:'synthetic-native-readback'});
  assert.equal(set.verification.state,'verified');assert.equal(set.verification.actual,'synthetic-native-readback');snapshot=set.snapshot;
  await waitFor(s=>s.text==='synthetic-native-readback');
  const reused=await rpc('action',{targetRef:original,action:'set_value',text:'must-not-apply',controlRef:editor(snapshot).ref});assert.equal(reused.ok,false);assert.equal(reused.error.dispatched,false);
  results.push({name:'UIA-value-readback-and-single-use',status:'passed'});
  const button=snapshot.controls.find(c=>c.name==='Synthetic action'&&c.role==='Button');assert(button);
  const clicked=await ok('action',{targetRef:snapshot.targetRef,action:'click',controlRef:button.ref});snapshot=clicked.snapshot;await waitFor(s=>s.actionCount===1);
  assert.equal(clicked.verification.state,'observed');results.push({name:'real-tagged-mouse-input',status:'passed'});
  const typed=await ok('action',{targetRef:snapshot.targetRef,action:'type',controlRef:editor(snapshot).ref,text:'-typed',caret_position:'end'});snapshot=typed.snapshot;
  await waitFor(s=>s.text==='synthetic-native-readback-typed');results.push({name:'real-tagged-keyboard-input',status:'passed'});
  const selectedControl=snapshot.controls.find(c=>c.name==='Synthetic second'&&c.patterns.includes('select'));assert(selectedControl);
  const selected=await ok('action',{targetRef:snapshot.targetRef,action:'select',controlRef:selectedControl.ref});snapshot=selected.snapshot;
  assert.equal(selected.verification.kind,'selection');await waitFor(s=>s.selected===1);
  const focused=await ok('action',{targetRef:snapshot.targetRef,action:'focus',controlRef:editor(snapshot).ref});snapshot=focused.snapshot;assert.equal(focused.verification.kind,'focus');
  const shortcut=await ok('action',{targetRef:snapshot.targetRef,action:'shortcut',shortcut:'CTRL+END'});snapshot=shortcut.snapshot;
  const pressed=await ok('action',{targetRef:snapshot.targetRef,action:'press',key:'LEFT'});snapshot=pressed.snapshot;
  const invoked=await ok('action',{targetRef:snapshot.targetRef,action:'invoke',controlRef:snapshot.controls.find(c=>c.name==='Synthetic action'&&c.role==='Button').ref});snapshot=invoked.snapshot;
  assert.equal(invoked.verification.state,'observed');await waitFor(s=>s.actionCount===2);
  results.push({name:'UIA-selection-focus-invoke-and-key-chords',status:'passed'});
  const scrollArea=snapshot.controls.find(c=>c.name==='Synthetic scroll area');assert(scrollArea);
  const scrolled=await ok('action',{targetRef:snapshot.targetRef,action:'scroll',controlRef:scrollArea.ref,direction:'down',wheel_times:2});snapshot=scrolled.snapshot;
  await waitFor(s=>s.scroll>0);const r=editor(snapshot).rect;
  const moved=await ok('action',{targetRef:snapshot.targetRef,action:'move',loc:[r.x+10,r.y+10],duration:0});snapshot=moved.snapshot;
  results.push({name:'real-scroll-and-pointer-move',status:'passed'});
  const image=await ok('screenshot',{targetRef:snapshot.targetRef});const pixels=Buffer.from(image.data,'base64');assert.equal(pixels.subarray(1,4).toString(),'PNG');
  await writeFile(path.join(directory,'synthetic-window.png'),pixels);results.push({name:'window-only-screenshot',status:'passed',width:image.width,height:image.height,sha256:createHash('sha256').update(pixels).digest('hex')});
  await command('overlay');const occluded=await rpc('screenshot',{targetRef:snapshot.targetRef});assert.equal(occluded.ok,false);assert.equal(occluded.error.dispatched,false);
  await command('close_overlay');snapshot=await ok('observe');results.push({name:'owned-overlay-refuses-window-screenshot',status:'passed'});
  await command('external_input');await sleep(60);const takeover=await rpc('screenshot',{targetRef:snapshot.targetRef});assert.equal(takeover.ok,false);assert.equal(takeover.error.code,'USER_TAKEOVER');
  snapshot=await ok('observe');results.push({name:'unmarked-external-input-invalidates-target',status:'passed'});
  await command('resize');const stale=await rpc('action',{targetRef:snapshot.targetRef,action:'focus',controlRef:editor(snapshot).ref});assert.equal(stale.ok,false);assert.equal(stale.error.dispatched,false);
  results.push({name:'resized-window-refuses-old-target',status:'passed'});
  snapshot=await ok('observe');await command('password');snapshot=await ok('observe');assert(!snapshot.controls.some(c=>c.role==='Password'));
  const secretImage=await rpc('screenshot',{targetRef:snapshot.targetRef});assert.equal(secretImage.ok,false);assert.equal(secretImage.error.dispatched,false);
  results.push({name:'password-window-screenshot-refused',status:'passed'});
  await command('hide_password');snapshot=await ok('observe');
  await ok('stop');const stopped=await rpc('screenshot',{targetRef:snapshot.targetRef});assert.equal(stopped.ok,false);snapshot=await ok('observe');assert(editor(snapshot));
  results.push({name:'stop-invalidates-and-allows-fresh-observation',status:'passed'});
  const bounds=snapshot.window.bounds;const from=[bounds.x+40,bounds.y+60],to=[bounds.x+80,bounds.y+60];
  const dragging=rpc('action',{targetRef:snapshot.targetRef,action:'drag',from_loc:from,to_loc:to,duration:3});await sleep(200);const before=Date.now();await ok('stop');
  const interrupted=await dragging;assert.equal(interrupted.ok,false);assert.equal(interrupted.error.dispatched,true);assert(Date.now()-before<2000);
  results.push({name:'stop-interrupts-real-injected-drag',status:'passed',stopRoundTripMs:Date.now()-before});
  snapshot=await ok('observe');assert(editor(snapshot));
  const receipt={scope:'synthetic-WPF-real-Windows-UIA-and-SendInput',protocol:initialized.protocol,modelCalls:0,accountCalls:0,results,status:'passed'};
  await writeFile(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({status:'passed',directory,tests:results.length}));
}catch(error){await writeFile(path.join(directory,'receipt.json'),JSON.stringify({scope:'synthetic-WPF-real-Windows-UIA-and-SendInput',results,status:'failed',error:String(error),stderr},null,2));throw error;}
finally{try{await command('close');}catch{}broker.stdin.end();await sleep(500);if(broker.exitCode===null)broker.kill();if(fixture.exitCode===null)fixture.kill();}
