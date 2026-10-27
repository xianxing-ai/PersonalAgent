import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import {createDraftQuitPreflight} from '../electron/draft-quit-preflight.js';

const source=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let beforeQuit,willQuit;
function visit(node){
  if(ts.isCallExpression(node)&&['app.on','app.once'].includes(node.expression.getText(ast))){
    const event=node.arguments[0]?.text;
    if(event==='before-quit')beforeQuit=node.arguments[1]?.getText(ast);
    if(event==='will-quit'&&node.getText(ast).includes('conversations?.close()'))willQuit=node.arguments[1]?.getText(ast);
  }
  ts.forEachChild(node,visit);
}
visit(ast);
assert.ok(beforeQuit&&willQuit,'actual Main quit handlers must remain present');
assert.match(beforeQuit,/draftQuitPreflight\.commit\(\)/);
assert.ok(beforeQuit.indexOf('draftQuitPreflight.commit()')<beforeQuit.indexOf('runtimeApplication.close()'),
  'draft COMMIT must precede irreversible host cleanup');
assert.doesNotMatch(beforeQuit,/conversations\?\.close\(\)/,
  'Conversations connection must survive rejected draft preflight');
assert.match(willQuit,/conversations\?\.close\(\)/);
const evaluate=new Function('scope',`with(scope){return (${willQuit});}`);

const turn=()=>new Promise(resolve=>setImmediate(resolve));
const browserWindow=readDraft=>{
  const contents=Object.assign(new EventEmitter(),{
    mainFrame:{},isDestroyed:()=>false,isLoadingMainFrame:()=>false,
    executeJavaScript:()=>Promise.resolve(readDraft()),
  });
  return Object.assign(new EventEmitter(),{webContents:contents,isDestroyed:()=>false});
};

test('unknown draft preflight remains cancellable and does not close Conversations',async t=>{
  let saved=false,retries=0,closes=0;
  const failures=[],window=browserWindow(()=>saved);
  const preflight=createDraftQuitPreflight({windows:()=>[window],retry:()=>retries++,onFailure:error=>failures.push(error.message)});
  t.after(()=>preflight.cancel());
  const app=new EventEmitter();
  app.once('will-quit',evaluate({conversations:{close(){closes++;}},weatherCardHost:undefined,console}));
  assert.equal(preflight.allow(),false);
  await turn();
  assert.equal(retries,0);assert.equal(closes,0);
  assert.match(failures.at(-1),/草稿保存未确认/);
  preflight.cancel();
  saved=true;
  assert.equal(preflight.allow(),false);
  await turn();
  assert.equal(retries,1);assert.equal(closes,0);
  assert.equal(preflight.commit(),true);
  app.emit('will-quit');app.emit('will-quit');
  assert.equal(closes,1,'one accepted quit closes the connection once');
});

test('confirmed quit logs a fixed close diagnostic and still releases other resources',()=>{
  const sequence=[],diagnostics=[];
  const app=new EventEmitter();
  app.once('will-quit',evaluate({conversations:{close(){sequence.push('conversations');throw Error('PRIVATE_DB_PATH');}},
    weatherCardHost:{dispose(){sequence.push('weather');}},
    console:{error(value){diagnostics.push(value);}}}));
  assert.doesNotThrow(()=>app.emit('will-quit'));
  assert.deepEqual(sequence,['conversations','weather']);
  assert.deepEqual(diagnostics,['[conversations] close failed after committed quit']);
  assert.equal(diagnostics[0].includes('PRIVATE_DB_PATH'),false);
});
