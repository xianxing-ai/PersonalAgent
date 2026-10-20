import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {EventEmitter} from 'node:events';
import {handleSubagentWindowAction,handleSubagentListAction} from '../electron/subagent-window-actions.js';

function fixture(){
  const calls=[],contents={mainFrame:{}};
  const record={binding:{parentTaskId:'original-parent',taskId:'original-child'},window:{webContents:contents,isDestroyed:()=>false,close:()=>calls.push('close')}};
  return {calls,record,event:{sender:contents,senderFrame:contents.mainFrame},readDetail:binding=>{calls.push(binding);return {taskId:binding.taskId};},openMain:()=>calls.push('main')};
}
test('child reader reads only its original host binding and closes without cancelling work',async()=>{
  const f=fixture();assert.deepEqual(await handleSubagentWindowAction({...f,name:'subagentConversation.snapshot'}),{taskId:'original-child'});
  await handleSubagentWindowAction({...f,name:'subagentConversation.main'});
  await handleSubagentWindowAction({...f,name:'subagentConversation.close'});
  assert.deepEqual(f.calls,[f.record.binding,'main','close']);
});
test('child readers reject task execution, rebinding and non-main-frame senders',async()=>{
  const f=fixture();
  for(const name of ['snapshot','task.submit','approval.respond','task.cancel','modelApi.configure'])await assert.rejects(handleSubagentWindowAction({...f,name}));
  await assert.rejects(handleSubagentWindowAction({...f,name:'subagentConversation.snapshot',payload:{taskId:'another-child'}}));
  await assert.rejects(handleSubagentWindowAction({...f,name:'subagentConversation.snapshot',event:{sender:f.event.sender,senderFrame:{}}}));
  await assert.rejects(handleSubagentWindowAction({...f,name:'subagentConversation.snapshot',event:{sender:{},senderFrame:f.event.senderFrame}}));
  assert.deepEqual(f.calls,[]);
});

test('child conversation submit and stop use only the immutable host binding',async()=>{
  const f=fixture(),calls=[];
  const ports={submit:(binding,payload)=>{calls.push(['submit',binding,payload]);return {acceptedTaskId:'new-execution'};},
    cancel:(binding,taskId)=>{calls.push(['cancel',binding,taskId]);return {accepted:true};}};
  assert.deepEqual(await handleSubagentWindowAction({...f,...ports,name:'subagentConversation.submit',payload:{text:'继续检查',requestId:'request-1'}}),{acceptedTaskId:'new-execution'});
  await handleSubagentWindowAction({...f,...ports,name:'subagentConversation.cancel',payload:{taskId:'new-execution'}});
  assert.equal(calls[0][1],f.record.binding);assert.equal(calls[1][1],f.record.binding);
  for(const payload of [{text:'替换',requestId:'x',taskId:'other'},{text:'',requestId:'x'},{text:'hello'},[]])
    await assert.rejects(handleSubagentWindowAction({...f,...ports,name:'subagentConversation.submit',payload}));
  await assert.rejects(handleSubagentWindowAction({...f,...ports,name:'subagentConversation.cancel',payload:{taskId:'other',parentTaskId:'other'}}));
  assert.equal(calls.length,2,'invalid targets must not reach execution ports');
});

test('all-conversations window pages and opens validated identities but cannot send or cancel work',async()=>{
  const f=fixture(),calls=[];
  const ports={event:f.event,window:f.record.window,list:input=>{calls.push(['list',input]);return {items:[]};},open:input=>{calls.push(['open',input]);return {opened:true};}};
  assert.deepEqual(await handleSubagentListAction({...ports,name:'subagentConversations.list',payload:{cursor:'page-2'}}),{items:[]});
  await handleSubagentListAction({...ports,name:'subagentConversations.open',payload:{parentTaskId:'parent',taskId:'child'}});
  assert.deepEqual(calls,[['list',{cursor:'page-2'}],['open',{parentTaskId:'parent',taskId:'child'}]]);
  for(const name of ['task.submit','subagentConversation.submit','subagentConversation.cancel','authorization.respond'])await assert.rejects(handleSubagentListAction({...ports,name}));
  await assert.rejects(handleSubagentListAction({...ports,name:'subagentConversations.list',payload:{cursor:'page',query:'unexpected'}}));
  await assert.rejects(handleSubagentListAction({...ports,name:'subagentConversations.open',payload:{parentTaskId:'parent',taskId:'child',text:'unexpected'}}));
  await assert.rejects(handleSubagentListAction({...ports,name:'subagentConversations.close',payload:{}}));
  assert.equal(calls.length,2);
});

test('all-conversations window can collapse every child without payload or rebinding',async()=>{
  const f=fixture(),calls=[];
  const ports={event:f.event,window:f.record.window,list:()=>({items:[]}),open:()=>({opened:true}),
    collapse:()=>{calls.push('collapse');return {closed:2};}};
  assert.deepEqual(await handleSubagentListAction({...ports,name:'subagentConversations.collapseAll'}),{closed:2});
  assert.deepEqual(calls,['collapse']);
  await assert.rejects(handleSubagentListAction({...ports,name:'subagentConversations.collapseAll',payload:{}}));
  await assert.rejects(handleSubagentListAction({...ports,name:'subagentConversations.collapseAll',event:{sender:{},senderFrame:f.event.senderFrame}}));
  assert.deepEqual(calls,['collapse'],'rejected senders and payloads never reach the collapse port');
});

const source=await readFile(new URL('../electron/main.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const recyclingFunctions=['canRecycleSubagentWindow','closeSubagentWindow','recycleSubagentWindows','collapseAllSubagentConversations'];
const recyclingSource=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&recyclingFunctions.includes(node.name?.text)).map(node=>node.getText(ast)).join('\n');
function recycleFixture(states){
  const closed=[],subagentWindows=new Map();
  for(const [index,state] of states.entries()){
    const window=new EventEmitter(),contents=new EventEmitter();let destroyed=false;
    window.isDestroyed=()=>destroyed;window.webContents=contents;
    window.close=()=>{if(state==='late-draft'){contents.emit('will-prevent-unload');return;}destroyed=true;closed.push(index);window.emit('closed');};
    window.on('closed',()=>subagentWindows.delete(String(index)));
    contents.executeJavaScript=async script=>{
      assert.match(script,/document\.querySelector\('textarea'\)/);
      if(state==='unknown')throw Error('renderer unavailable');return state==='empty'||state==='late-draft';
    };
    subagentWindows.set(String(index),{lastUsedAt:index,window});
  }
  const context=vm.createContext({subagentWindows,SUBAGENT_WINDOW_LIMIT:states.length,subagentListWindow:undefined,setTimeout,clearTimeout});
  vm.runInContext(recyclingSource,context);return {closed,subagentWindows,context};
}
test('LRU recycling preserves draft and unknown windows and closes the oldest verified empty one',async()=>{
  const f=recycleFixture(['draft','unknown','empty','empty']);await f.context.recycleSubagentWindows();
  assert.deepEqual(f.closed,[2]);assert.equal(f.subagentWindows.has('0'),true);assert.equal(f.subagentWindows.has('1'),true);
});
test('opening beyond the limit is refused when every child has draft or unknown state',async()=>{
  const f=recycleFixture(['draft','unknown']);await assert.rejects(f.context.recycleSubagentWindows(),/保留输入/);
  assert.equal(f.subagentWindows.size,2);assert.deepEqual(f.closed,[]);
});
test('collapse keeps unsent child input and reports the partially closed result',async()=>{
  const f=recycleFixture(['draft','empty','unknown']);await assert.rejects(f.context.collapseAllSubagentConversations(),/已收起 1.*2 个.*已保留/);
  assert.deepEqual(f.closed,[1]);assert.equal(f.subagentWindows.size,2);
});
test('a draft typed after inspection blocks close and retains the registered child window',async()=>{
  const f=recycleFixture(['late-draft']);await assert.rejects(f.context.recycleSubagentWindows(),/保留输入/);
  assert.equal(f.subagentWindows.size,1);assert.deepEqual(f.closed,[]);
});
