import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {EventEmitter} from 'node:events';
import {handleSubagentWindowAction,handleSubagentListAction,handleWorkspaceSubagentAction} from '../electron/subagent-window-actions.js';

function fixture(){
  const calls=[],contents={mainFrame:{}};
  const record={binding:{parentTaskId:'original-parent',taskId:'original-child'},window:{webContents:contents,isDestroyed:()=>false,close:()=>calls.push('close')}};
  return {calls,record,event:{sender:contents,senderFrame:contents.mainFrame},readDetail:binding=>{calls.push(binding);return {taskId:binding.taskId};},openMain:()=>calls.push('main')};
}

test('inline workspace threads revalidate the immutable original binding for reads, messages and stops',async()=>{
  const f=fixture(),operations=[],input={binding:{parentTaskId:'parent',taskId:'child'},request:{text:'continue',requestId:'request'}};
  const ports={event:f.event,window:f.record.window,readDetail:async binding=>{operations.push(['read',binding]);return {...binding};},submit:async(binding,message)=>{operations.push(['submit',binding,message]);return {acceptedTaskId:'execution'};},cancel:async(binding,execution)=>{operations.push(['cancel',binding,execution]);return {cancelAccepted:true};}};
  assert.deepEqual(await handleWorkspaceSubagentAction({...ports,name:'workspace.subagent.snapshot',payload:{binding:input.binding}}),input.binding);
  await handleWorkspaceSubagentAction({...ports,name:'workspace.subagent.submit',payload:input});await handleWorkspaceSubagentAction({...ports,name:'workspace.subagent.cancel',payload:{binding:input.binding,request:{taskId:'execution'}}});
  assert.equal(operations.filter(([name])=>name==='read').length,3);assert.deepEqual(operations[2][1],input.binding);assert.equal(Object.isFrozen(operations[2][1]),true);assert.deepEqual(operations.at(-1),['cancel',input.binding,'execution']);
});
test('inline workspace threads refuse spoofed senders, hidden actions, malformed fields and unrelated records',async()=>{
  const f=fixture();let writes=0;
  const ports={event:f.event,window:f.record.window,readDetail:async binding=>{if(binding.taskId!=='child')throw Error('unrelated child');return {...binding};},submit:()=>{writes++;},cancel:()=>{writes++;}};
  const binding={parentTaskId:'parent',taskId:'child'};
  for(const value of [{name:'workspace.subagent.submit',payload:{binding,request:{text:'x',requestId:'r',taskId:'foreign'}}},{name:'workspace.subagent.snapshot',payload:{binding,request:{}}},{name:'workspace.subagent.snapshot',payload:{binding:{...binding,extra:1}}},{name:'workspace.subagent.close',payload:{binding}},{name:'workspace.subagent.submit',payload:{binding:{...binding,taskId:'foreign'},request:{text:'x',requestId:'r'}}}])await assert.rejects(handleWorkspaceSubagentAction({...ports,...value}));
  for(const event of [{sender:{},senderFrame:f.event.senderFrame},{sender:f.event.sender,senderFrame:{}}])await assert.rejects(handleWorkspaceSubagentAction({...ports,event,name:'workspace.subagent.snapshot',payload:{binding}}));
  assert.equal(writes,0);
});
test('inline workspace cannot write after its window closes during readback or after a mismatched read',async()=>{
  const f=fixture(),binding={parentTaskId:'parent',taskId:'child'};let writes=0,release,closed=false;f.record.window.isDestroyed=()=>closed;
  const ports={event:f.event,window:f.record.window,submit:()=>{writes++;},readDetail:()=>new Promise(resolve=>{release=()=>resolve(binding);})};
  const pending=handleWorkspaceSubagentAction({...ports,name:'workspace.subagent.submit',payload:{binding,request:{text:'x',requestId:'r'}}});closed=true;release();await assert.rejects(pending,/不可信/);closed=false;
  await assert.rejects(handleWorkspaceSubagentAction({...ports,name:'workspace.subagent.submit',payload:{binding,request:{text:'x',requestId:'r'}},readDetail:async()=>({...binding,taskId:'other'})}),/绑定不一致/);assert.equal(writes,0);
});
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
