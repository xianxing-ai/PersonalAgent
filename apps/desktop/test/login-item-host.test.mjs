import test from 'node:test';
import assert from 'node:assert/strict';
import {createLoginItemHost} from '../electron/login-item-host.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function fixture({isPackaged=true,executable='C:\\Program Files\\PersonalAgent\\PersonalAgent.exe',enabled=true,readBackFails=false}={}){
  const writes=[],reads=[],other={name:'OtherApplication',path:'C:\\Other\\other.exe',args:['--stay'],scope:'user',enabled:true};
  let items=[other],readFailure=false,setFailure=false;
  const app={isPackaged,getLoginItemSettings(options){
    reads.push(options);if(readFailure)throw Error('private failure');
    return {openAtLogin:items.some(item=>item.path===executable&&item.args.length===0),
      executableWillLaunchAtLogin:items.some(item=>item.path===executable&&item.enabled),launchItems:items};
  },setLoginItemSettings(value){writes.push(value);if(setFailure)throw Error('private failure');
    items=items.filter(item=>item.name!==value.name);
    if(value.openAtLogin)items.push({name:value.name,path:value.path,args:value.args,scope:'user',enabled});
    if(readBackFails)readFailure=true;
  }};
  const host=createLoginItemHost({app,platform:'win32',executable});
  return {host,writes,reads,other,get items(){return items;},failRead:value=>{readFailure=value;},failSet:()=>{setFailure=true;}};
}

test('construction only reads; explicit enable reads exact app item, disable leaves other entries untouched',()=>{
  const f=fixture();assert.equal(f.writes.length,0);assert.equal(f.host.snapshot().configured,false);
  const result=f.host.configure({enabled:true});assert.equal(result.configured,true);assert.equal(result.enabled,true);
  assert.equal(result.verification,'unverified');assert.equal(result.lastWrite,'read_back');
  assert.equal(f.writes[0].path,f.reads.at(-1).path);assert.deepEqual(f.writes[0].args,[]);
  assert.equal(f.host.configure({enabled:false}).configured,false);assert.deepEqual(f.items,[f.other]);
  assert.equal(f.writes.length,2);
});

test('OS disabled startup is reported separately from an installed app entry',()=>{
  const f=fixture({enabled:false});const result=f.host.configure({enabled:true});
  assert.equal(result.configured,true);assert.equal(result.enabled,false);assert.equal(result.state,'os_disabled');
});

test('unpackaged, versioned Squirrel and transient development paths never register startup',()=>{
  for(const options of [{isPackaged:false},{executable:'D:\\PersonalAgent\\node_modules\\electron\\dist\\electron.exe'},
    {executable:'D:\\PersonalAgent\\.worktrees\\voice\\PersonalAgent.exe'},
    {executable:'C:\\Users\\user\\AppData\\Local\\PersonalAgent\\app-1.0\\PersonalAgent.exe'}]){
    const f=fixture(options);assert.equal(f.host.snapshot().supported,false);
    assert.throws(()=>f.host.configure({enabled:true}),/开发模式/);assert.equal(f.writes.length,0);
  }
});

test('native read failure prevents writes and does not manufacture disabled status',()=>{
  const f=fixture();f.failRead(true);assert.equal(f.host.read().state,'unknown');
  assert.equal(f.host.snapshot().configured,null);assert.throws(()=>f.host.configure({enabled:true}),/读取失败/);
  assert.equal(f.writes.length,0);
});

test('failed or unknown write is not retried or rolled back automatically',()=>{
  const f=fixture();f.failSet();assert.throws(()=>f.host.configure({enabled:true}),/写入未确认/);
  assert.equal(f.writes.length,1);assert.equal(f.host.snapshot().lastWrite,'unknown');
  assert.equal(JSON.stringify(f.host.snapshot()).includes('private'),false);
});

test('arguments or extra fields cannot redirect the native target',()=>{
  const f=fixture();for(const input of [{enabled:'true'},{enabled:true,path:'C:\\other.exe'},{enabled:true,args:[]}]){
    assert.throws(()=>f.host.configure(input),/明确/);
  }assert.equal(f.writes.length,0);
});

test('post-write read failure remains unknown; independent refresh confirms without replay',()=>{
  const f=fixture({readBackFails:true});
  assert.throws(()=>f.host.configure({enabled:true}),/读回未确认/);
  assert.equal(f.host.snapshot().state,'unknown');assert.equal(f.writes.length,1);
  f.failRead(false);const result=f.host.read();
  assert.equal(result.configured,true);assert.equal(result.lastWrite,'read_back');assert.equal(f.writes.length,1);
});

test('actual main login-item action restricts writes to admin and only calls its native host',async()=>{
  const source=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
  const ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  let route;
  function visit(node){if(ts.isIfStatement(node)&&node.expression.getText(ast)==="name==='app.startup.read'||name==='app.startup.configure'")route=node.getText(ast);ts.forEachChild(node,visit);}
  visit(ast);assert.ok(route);
  const f=fixture(),admin={},panel={};
  const context=vm.createContext({admin,desktopHost:{readLoginItem:f.host.read,configureLoginItem:f.host.configure},publish(){},Error});
  const action=vm.runInContext(`(async function(sender,name,payload){${route}})`,context);
  await assert.rejects(action(panel,'app.startup.configure',{enabled:true}),/可信/);
  assert.equal(f.writes.length,0);
  assert.equal((await action(admin,'app.startup.read')).configured,false);
  assert.equal((await action(admin,'app.startup.configure',{enabled:true})).configured,true);
  assert.equal(f.writes.length,1);
});
