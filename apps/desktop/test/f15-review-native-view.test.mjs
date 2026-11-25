import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createHash} from 'node:crypto';
import {createF15NativeReviewViewer} from '../electron/f15-review-native-view.js';

// Synthetic child process: these tests do not establish an actual Windows window.
function fixture({verified=true}={}){
  let child,spawnArguments,pipe='';const executable='C:\\Program Files\\PowerShell\\7\\pwsh.exe';
  const stat={isFile:()=>true,isSymbolicLink:()=>false,dev:1n,ino:2n,size:3n,mtimeNs:4n};
  const dependencies={platform:'win32',systemRoot:'C:\\Windows',lstatSync:()=>stat,realpathSync:{native:value=>value},readFileSync:()=>Buffer.from('synthetic binary'),
    spawn:(...args)=>{spawnArguments=args;child=new EventEmitter();child.stdout=new PassThrough();child.stdin=new PassThrough();
      child.stdin.on('data',chunk=>{pipe+=chunk.toString();});child.kill=()=>{child.killed=true;setImmediate(()=>child.emit('close',null));return true;};return child;}};
  const viewer=createF15NativeReviewViewer({powerShellPath:executable,verifyExecutable:()=>verified,dependencies});
  const source='private-source-keep-off-command-line';
  const patches=[{path:'app.js',expectedSha256:createHash('sha256').update(source).digest('hex'),edits:[{oldText:'first',newText:'second'}]}];
  const input={taskId:'task-1',sessionId:'session-1',snapshotId:'snapshot-1',patchDigest:createHash('sha256').update(JSON.stringify(patches)).digest('hex'),
    reviewerId:'reviewer',authorId:'author',policyId:'policy',deadline:new Date(Date.now()+5000).toISOString(),patches,sources:[{path:'app.js',source}]};
  return {viewer,input,getChild:()=>child,getArgs:()=>spawnArguments,getPipe:()=>pipe};
}
test('only stdin carries source; fixed native window events report shown, never review approval',async()=>{
  const f=fixture(),controller=new AbortController();assert.deepEqual(f.viewer.snapshot(),{available:true});
  const result=f.viewer.show(f.input,{signal:controller.signal,assertCurrent:()=>true}),child=f.getChild();
  assert.ok(child);const [binary,args,options]=f.getArgs();assert.equal(binary,'C:\\Program Files\\PowerShell\\7\\pwsh.exe');
  assert.equal(options.shell,false);assert.equal(options.windowsHide,true);assert.equal(options.stdio[2],'ignore');
  assert.equal(JSON.stringify(args).includes('private-source-keep-off-command-line'),false);
  assert.equal(JSON.stringify(options.env).includes('private-source-keep-off-command-line'),false);
  assert.match(f.getPipe(),/private-source-keep-off-command-line/);
  child.stdout.write('SHOWN\r\n');child.stdout.write('CLOSED\r\n');child.emit('close',0);
  assert.deepEqual(await result,{state:'shown'});
});
test('untrusted binary or invalid native protocol never reports a shown window',async()=>{
  const f=fixture({verified:false});assert.equal(f.viewer.snapshot().available,false);
  assert.deepEqual(await f.viewer.show(f.input,{signal:new AbortController().signal,assertCurrent:()=>true}),
    {state:'unavailable',reason:'trusted_native_viewer_unavailable'});assert.equal(f.getChild(),undefined);
  const g=fixture(),pending=g.viewer.show(g.input,{signal:new AbortController().signal,assertCurrent:()=>true});
  g.getChild().stdout.write('not-a-native-receipt');assert.deepEqual(await pending,{state:'unavailable',reason:'invalid_native_protocol'});
});
test('cancellation and revoked original authorization terminate the original child',async()=>{
  const f=fixture(),controller=new AbortController(),pending=f.viewer.show(f.input,{signal:controller.signal,assertCurrent:()=>true});
  controller.abort();assert.deepEqual(await pending,{state:'cancelled',reason:'cancelled'});assert.equal(f.getChild().killed,true);
  const g=fixture();let current=true;const second=g.viewer.show(g.input,{signal:new AbortController().signal,assertCurrent:()=>current});
  current=false;assert.deepEqual(await second,{state:'unavailable',reason:'original_authorization_changed'});assert.equal(g.getChild().killed,true);
});
test('expired or unapproved requests do not launch the child',async()=>{
  const f=fixture();assert.deepEqual(await f.viewer.show({...f.input,deadline:'2000-01-01T00:00:00Z'},
    {signal:new AbortController().signal,assertCurrent:()=>true}),{state:'unavailable',reason:'deadline_expired'});
  assert.deepEqual(await f.viewer.show(f.input,{signal:new AbortController().signal,assertCurrent:()=>false}),
    {state:'unavailable',reason:'original_authorization_unavailable'});assert.equal(f.getChild(),undefined);
  assert.deepEqual(await f.viewer.show({...f.input,sources:[{path:'app.js',source:'replaced'}]},
    {signal:new AbortController().signal,assertCurrent:()=>true}),{state:'unavailable',reason:'invalid_or_oversized_review'});
});
test('deadline during a visible window stops the original child without claiming a review',async()=>{
  const f=fixture(),pending=f.viewer.show({...f.input,deadline:new Date(Date.now()+100).toISOString()},
    {signal:new AbortController().signal,assertCurrent:()=>true});
  f.getChild().stdout.write('SHOWN\n');assert.deepEqual(await pending,{state:'unavailable',reason:'deadline_expired'});
  assert.equal(f.getChild().killed,true);
});
test('closing the viewer requests stop and prevents further windows',async()=>{
  const f=fixture(),pending=f.viewer.show(f.input,{signal:new AbortController().signal,assertCurrent:()=>true});
  f.viewer.close();assert.deepEqual(await pending,{state:'cancelled',reason:'cancelled'});assert.equal(f.getChild().killed,true);
  assert.deepEqual(f.viewer.snapshot(),{available:false,reason:'native_viewer_closed'});
  assert.deepEqual(await f.viewer.show(f.input,{signal:new AbortController().signal,assertCurrent:()=>true}),
    {state:'unavailable',reason:'native_viewer_closed'});
});
