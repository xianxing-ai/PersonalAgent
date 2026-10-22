import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {isTerminal} from '../src/features/conversation/state.js';
import {createMessageQueue} from '../src/features/conversation/message-queue.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));

for(const [surface,path,assignment] of [
  ['panel','../src/app/renderer.js',"root.querySelector('#tasks').onclick"],
  ['workspace','../src/features/workspace/view.js','conversation.onclick'],
]){
  const source=await readFile(new URL(path,import.meta.url),'utf8');
  const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const declarations=new Map();let handler,projection,renderSendMode;
  const dependencies=surface==='panel'
    ?['pendingCancelIds','taskStopRequests','syncCancelButtons','restoreTaskActionFocus','truncatedTaskIds','truncatedOutput','activeTasks','setSendMode','stopTask']
    :['pendingCancelIds','syncCancelButtons','restoreTaskActionFocus'];
  function visit(node){
    if(ts.isBinaryExpression(node)&&node.left.getText(ast)===assignment)handler=node.right.getText(ast);
    if(surface==='panel'&&ts.isBinaryExpression(node)&&node.left.getText(ast)==='render'&&ts.isArrowFunction(node.right)&&ts.isBlock(node.right.body)){
      const candidate=node.right.body.statements[0].getText(ast);
      if(candidate.includes('truncatedOutput.get(task.taskId)')){
        assert.equal(projection,undefined,'the actual output-cutoff projection is unique');
        projection=candidate;
        renderSendMode=node.right.body.statements.find(statement=>ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(ast)==='setSendMode')?.getText(ast);
      }
    }
    if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&dependencies.includes(node.name.text))declarations.set(node.name.text,node.getText(ast));
    ts.forEachChild(node,visit);
  }
  visit(ast);assert.ok(handler);assert.equal(declarations.size,dependencies.length,'actual consumer dependencies');
  function fixture(){
    const calls=[],errors=[],timers=new Map(),playbackStops=[],document={body:{},activeElement:null};let timerId=0;document.activeElement=document.body;
    function button(action='cancel',id='task-1'){
      const dataset=surface==='panel'?{[action==='cancel'?'action':'uiAction']:action==='cancel'?'task.cancel':action,id}:{[action]:id};
      return {dataset,disabled:false,focus(options){this.focusOptions=options;document.activeElement=this;}};
    }
    let buttons=[button()];const container={querySelectorAll:()=>buttons};
    const context=vm.createContext({document,conversation:container,tasksNode:container,input:{value:'next draft'},
      sendBtn:{disabled:false,dataset:{},setAttribute(name,value){this[name]=value;}},pending:false,isTerminal,
      current:{tasks:[{taskId:'task-1',state:'running',resultSummary:'partial answer',steps:[{stepId:'step-1',label:'original step'}]}],conversationState:{activeId:'desktop-panel'}},
      stopButton:{setAttribute(){}},stopPlaybackIcon:'playback',deliveryMode:{value:'steer'},deliveryHint:{},
      messageQueue:createMessageQueue(),submitGeneration:0,lastTaskSignature:'',structuredClone,
      window:{speechSynthesis:{cancel(){playbackStops.push(true);}}},wakeClosed:false,errorFeedbackRevision:0,
      setTimeout(callback,ms){const id=++timerId;timers.set(id,{callback,ms});return id;},clearTimeout:id=>timers.delete(id),setFeedback(){context.errorFeedbackRevision++;},
      report:error=>errors.push(typeof error==='string'?error:error.message),invoke:(name,payload)=>new Promise((resolve,reject)=>calls.push({name,payload,resolve,reject}))});
    for(const declaration of declarations.values())vm.runInContext(`const ${declaration};`,context);
    if(surface==='panel'){
      assert.ok(projection?.includes('truncatedOutput.get(task.taskId)'),'actual render projection preserves the output cutoff');
      assert.ok(renderSendMode,'actual render refreshes the composer mode');
      vm.runInContext(`render=data=>{${projection}current=data;${renderSendMode}};`,context);
    }
    const click=vm.runInContext(`(${handler})`,context);
    return {calls,errors,timers,playbackStops,document,context,button,get buttons(){return buttons;},snapshot:data=>context.render(data),replace(next){buttons=next;vm.runInContext('syncCancelButtons()',context);},click:target=>click({target:{closest:()=>target}}),restore:target=>{context.focused=target;vm.runInContext('restoreTaskActionFocus(focused)',context);}};
  }
  if(surface==='workspace')test(`${surface}: pending cancellation survives progress rebuild, rejects duplicate and permits retry`,async()=>{
    const f=fixture(),first=f.click(f.buttons[0]);assert.equal(f.buttons[0].disabled,true);
    f.replace([f.button()]);assert.equal(f.buttons[0].disabled,true);await f.click(f.buttons[0]);assert.equal(f.calls.length,1);
    f.calls[0].reject(Error('current cancel failure'));await first;assert.deepEqual(f.errors,['current cancel failure']);assert.equal(f.buttons[0].disabled,false);
    const retry=f.click(f.buttons[0]);assert.equal(f.calls.length,2);f.calls[1].resolve();await retry;assert.equal(f.buttons[0].disabled,false);
  });
  if(surface==='workspace')test(`${surface}: terminal removal stays removed and cancelling state never unlocks on receipt`,async()=>{
    const f=fixture(),run=f.click(f.buttons[0]);f.replace([]);f.calls[0].resolve();await run;assert.equal(f.buttons.length,0);
    f.context.current.tasks=[{taskId:'task-1',state:'cancelling'}];f.replace([f.button()]);assert.equal(f.buttons[0].disabled,true);await f.click(f.buttons[0]);assert.equal(f.calls.length,1);
  });
  if(surface==='panel'){
    test('panel: task-row stop truncates immediately and keeps the composer available while task cancellation stalls',async()=>{
      const f=fixture(),generation=f.context.submitGeneration;
      const stopped=f.click(f.buttons[0]);
      assert.equal(f.context.pending,false);assert.equal(f.context.submitGeneration,generation);
      assert.equal(f.context.sendBtn.disabled,false);assert.equal(f.context.sendBtn['aria-busy'],'false');
      assert.equal(f.context.sendBtn.dataset.mode,'send');assert.equal(f.context.input.value,'next draft');
      assert.equal(vm.runInContext('activeTasks().length',f.context),0);
      assert.equal(vm.runInContext('pendingCancelIds.size',f.context),1);
      assert.equal(f.context.current.tasks[0].outputTruncated,true);
      assert.equal(f.context.current.tasks[0].state,'running','UI truncation preserves the Runtime state');
      assert.deepEqual(f.calls.map(call=>call.name),['voice.stop','task.cancel']);
      assert.equal(f.calls[1].payload,'task-1');
      await stopped;f.replace([f.button()]);assert.equal(f.buttons[0].disabled,true,'only the original task action awaits its receipt');
      assert.equal(f.context.messageQueue.paused,true);
    });
    test('panel: failed stop is retryable and late receipts or snapshots cannot revive output or lock input',async()=>{
      const f=fixture();f.context.pending=true;await f.click(f.buttons[0]);
      f.calls[0].reject(Error('current cancel failure'));await tick();
      assert.deepEqual(f.errors,['current cancel failure']);f.replace([f.button()]);assert.equal(f.buttons[0].disabled,false);
      await f.click(f.buttons[0]);assert.equal(f.calls.length,2);
      f.calls[1].resolve({cancelAccepted:true});await tick();
      f.snapshot({tasks:[{taskId:'task-1',state:'cancelling',resultSummary:'late answer',steps:[{stepId:'late-step',label:'late step'}]}],conversationState:{activeId:'desktop-panel'}});
      const original=f.context.current.tasks[0];
      assert.equal(original.outputTruncated,true);assert.equal(original.resultSummary,'partial answer');
      assert.deepEqual(structuredClone(original.steps),[{stepId:'step-1',label:'original step'}]);
      assert.equal(original.state,'cancelling','late Runtime state remains visible without restoring output');
      f.replace([f.button()]);assert.equal(f.buttons[0].disabled,false);
      assert.equal(vm.runInContext('activeTasks().length',f.context),0);assert.equal(f.context.sendBtn.disabled,false);
      f.snapshot({tasks:[],conversationState:{activeId:'desktop-panel'}});f.replace([]);
      assert.equal(f.buttons.length,0);assert.equal(f.context.current.tasks.length,0);
    });
    test('panel: stopping historical task A preserves running task B and a pending new submission',async()=>{
      const f=fixture(),historic={taskId:'task-A',state:'waiting_reconciliation',outputTruncated:true,resultSummary:'historical cutoff'},running={taskId:'task-B',state:'running',resultSummary:'current response'};
      f.context.current={tasks:[historic,running],conversationState:{activeId:'desktop-panel'}};
      f.context.pending=true;f.context.submitGeneration=37;
      f.replace([f.button('cancel','task-A'),f.button('cancel','task-B')]);await f.click(f.buttons[0]);
      assert.deepEqual(f.calls.map(call=>[call.name,call.payload]),[['task.cancel','task-A']]);
      assert.equal(f.context.pending,true);assert.equal(f.context.submitGeneration,37);
      assert.deepEqual(structuredClone(f.context.current.tasks[1]),running);
      assert.equal(f.context.current.tasks[0].state,'waiting_reconciliation');
      assert.equal(f.context.current.tasks[0].resultSummary,'historical cutoff');
      assert.equal(vm.runInContext('activeTasks().map(task=>task.taskId)',f.context).join(','),'task-B');
      assert.equal(f.context.messageQueue.paused,false);assert.equal(f.playbackStops.length,0);
      assert.equal(f.context.sendBtn.disabled,false);assert.equal(f.buttons[0].disabled,true);assert.equal(f.buttons[1].disabled,false);
    });
    test('panel: timeout permits retry but an older receipt cannot release the newer task action',async()=>{
      const f=fixture();f.context.pending=true;await f.click(f.buttons[0]);
      const [timerId,timer]=f.timers.entries().next().value;assert.equal(timer.ms,5000);
      f.timers.delete(timerId);timer.callback();assert.equal(f.buttons[0].disabled,false);
      assert.match(f.errors[0],/停止尚未确认/);await f.click(f.buttons[0]);assert.equal(f.calls.length,2);
      const retryRequest=vm.runInContext('taskStopRequests.get("task-1")',f.context);
      f.calls[0].resolve({cancelAccepted:true});await tick();
      assert.equal(vm.runInContext('taskStopRequests.get("task-1")',f.context),retryRequest);
      assert.equal(f.buttons[0].disabled,true);assert.equal(vm.runInContext('pendingCancelIds.has("task-1")',f.context),true);
      f.calls[1].resolve({cancelAccepted:true});await tick();assert.equal(f.buttons[0].disabled,false);
      assert.equal(vm.runInContext('taskStopRequests.size',f.context),0);assert.equal(f.context.pending,true);
    });
  }
  test(`${surface}: only the same available action regains focus without scrolling`,()=>{
    const f=fixture(),old=f.buttons[0],replacement=f.button();f.replace([replacement]);f.restore(old);assert.equal(f.document.activeElement,replacement);assert.equal(replacement.focusOptions.preventScroll,true);
    f.document.activeElement=f.document.body;f.replace([]);f.restore(old);assert.equal(f.document.activeElement,f.document.body);
    const input={};f.document.activeElement=input;f.replace([f.button()]);f.restore(old);assert.equal(f.document.activeElement,input);
    f.document.activeElement=f.document.body;const disabled=f.button();disabled.disabled=true;f.replace([]);f.restore(disabled);assert.equal(f.document.activeElement,f.document.body);
  });
  test(`${surface}: different task or action and approval controls never receive restored focus`,()=>{
    const f=fixture(),old=f.button();f.replace([f.button('copy'),f.button('cancel','task-2')]);f.restore(old);assert.equal(f.document.activeElement,f.document.body);
    if(surface==='panel'){old.dataset.approvalDecision='allow_once';f.replace([f.button()]);f.restore(old);assert.equal(f.document.activeElement,f.document.body);}
  });
  test(`${surface}: explicit reconciliation keeps original id, prevents duplicate and preserves failure`,async()=>{
    const f=fixture();f.context.current.tasks=[{taskId:'task-1',state:'waiting_reconciliation'}];
    const recovery=()=>{const b=f.button();b.dataset=surface==='panel'?{action:'task.reconcile.finish',id:'task-1'}:{reconcile:'task-1'};return b;};
    const first=recovery();f.replace([first]);const pending=f.click(first);assert.equal(f.calls[0].name,'task.reconcile.finish');assert.equal(f.calls[0].payload,'task-1');
    const replacement=recovery();f.replace([replacement]);await f.click(replacement);assert.equal(f.calls.length,1);f.calls[0].reject(Error('原结果仍待核实'));await pending;
    assert.deepEqual(f.errors,['原结果仍待核实']);assert.equal(replacement.disabled,false);assert.equal(f.context.current.tasks[0].state,'waiting_reconciliation');
    const retry=f.click(replacement);assert.equal(f.calls.length,2);f.replace([]);f.calls[1].resolve({taskId:'task-1',state:'cancelled'});await retry;assert.equal(f.buttons.length,0);
  });
  if(surface==='workspace')test('workspace: session switch keeps inspector focus on a persistent control',()=>{
    let panels,prefix;
    function capture(node){
      if(ts.isFunctionDeclaration(node)&&node.name?.text==='syncAuxiliaryPanels')panels=node.getText(ast);
      if(ts.isFunctionDeclaration(node)&&node.name?.text==='update'){
        const statements=[...node.body.statements];
        const cut=statements.findIndex(part=>ts.isExpressionStatement(part)&&ts.isBinaryExpression(part.expression)
          &&part.expression.operatorToken.kind===ts.SyntaxKind.EqualsToken&&part.expression.left.getText(ast)==='current');
        assert.ok(cut>0,'session handling precedes adopting the new snapshot');
        prefix=statements.slice(0,cut).map(part=>part.getText(ast)).join('\n');
      }
      ts.forEachChild(node,capture);
    }
    capture(ast);assert.ok(panels&&prefix,'actual auxiliary panel helper and snapshot prefix');
    for(const connectorsRequested of [false,true]){
      const document={body:{},activeElement:null};
      const control=(dataset={})=>({dataset,focus(options){document.activeElement=this;this.focusOptions=options;}});
      const close=control(),old=control({view:'old-task'}),toggle=control();
      toggle.setAttribute=(name,value)=>{toggle[name]=value;};
      const inspector={hidden:false,dataset:{taskId:'old-task'},contains:node=>node===close},board={hidden:false};
      const nodes={'#conversation-inspector':inspector,'.connector-board':board,'#connectors-toggle':toggle};
      let buttons=[old];
      const context=vm.createContext({document,root:{querySelector:selector=>nodes[selector]},
        conversation:{querySelectorAll:()=>buttons},current:{conversationState:{activeId:'old-session'}},
        inspected:'old-task',connectorsRequested,updateRevision:0,preferenceEditing:null,
        preferenceRequests:{model:0,thinking:0},preferencePending:{model:null,thinking:null},preferenceErrors:{model:null,thinking:null}});
      vm.runInContext(panels,context);
      const update=vm.runInContext('data=>{'+prefix+'}',context);
      document.activeElement=close;
      update({conversationState:{activeId:'old-session'}});
      assert.equal(document.activeElement,close,'unchanged session does not steal focus');
      update({conversationState:{activeId:'new-session'}});
      buttons=[];if(document.activeElement===old)document.activeElement=document.body;
      assert.equal(inspector.hidden,true);
      assert.equal(document.activeElement,toggle);
      assert.equal(toggle.focusOptions.preventScroll,true);
      assert.equal(board.hidden,!connectorsRequested);
      assert.equal(toggle['aria-expanded'],String(connectorsRequested));
    }
  });
  if(surface==='panel')test('panel: failure location actions retain their specific task identity',()=>{
    const f=fixture(),first=f.button('locate'),second=f.button('locate');
    delete first.dataset.id;delete second.dataset.id;first.dataset.locateId='task-1';second.dataset.locateId='task-2';
    f.replace([first,second]);f.restore(second);assert.equal(f.document.activeElement,second);
  });
}
