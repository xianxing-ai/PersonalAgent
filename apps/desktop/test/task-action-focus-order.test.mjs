import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {isTerminal} from '../src/features/conversation/state.js';

for(const [surface,path,assignment] of [
  ['panel','../src/app/renderer.js',"root.querySelector('#tasks').onclick"],
  ['workspace','../src/features/workspace/view.js','conversation.onclick'],
]){
  const source=await readFile(new URL(path,import.meta.url),'utf8');
  const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const declarations=new Map();let handler;
  const dependencies=surface==='panel'
    ?['pendingCancelIds','syncCancelButtons','restoreTaskActionFocus','truncatedTaskIds','activeTasks','setSendMode']
    :['pendingCancelIds','syncCancelButtons','restoreTaskActionFocus'];
  function visit(node){
    if(ts.isBinaryExpression(node)&&node.left.getText(ast)===assignment)handler=node.right.getText(ast);
    if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&dependencies.includes(node.name.text))declarations.set(node.name.text,node.getText(ast));
    ts.forEachChild(node,visit);
  }
  visit(ast);assert.ok(handler);assert.equal(declarations.size,dependencies.length,'actual consumer dependencies');
  function fixture(){
    const calls=[],errors=[],document={body:{},activeElement:null};document.activeElement=document.body;
    function button(action='cancel',id='task-1'){
      const dataset=surface==='panel'?{[action==='cancel'?'action':'uiAction']:action==='cancel'?'task.cancel':action,id}:{[action]:id};
      return {dataset,disabled:false,focus(options){this.focusOptions=options;document.activeElement=this;}};
    }
    let buttons=[button()];const container={querySelectorAll:()=>buttons};
    const context=vm.createContext({document,conversation:container,tasksNode:container,input:{value:'next draft'},
      sendBtn:{dataset:{},setAttribute(){}},pending:false,isTerminal,current:{tasks:[{taskId:'task-1',state:'running'}]},
      report:error=>errors.push(error.message),invoke:(name,payload)=>new Promise((resolve,reject)=>calls.push({name,payload,resolve,reject}))});
    for(const declaration of declarations.values())vm.runInContext(`const ${declaration};`,context);
    const click=vm.runInContext(`(${handler})`,context);
    return {calls,errors,document,context,button,get buttons(){return buttons;},replace(next){buttons=next;vm.runInContext('syncCancelButtons()',context);},click:target=>click({target:{closest:()=>target}}),restore:target=>{context.focused=target;vm.runInContext('restoreTaskActionFocus(focused)',context);}};
  }
  test(`${surface}: pending cancellation survives progress rebuild, rejects duplicate and permits retry`,async()=>{
    const f=fixture(),first=f.click(f.buttons[0]);assert.equal(f.buttons[0].disabled,true);
    f.replace([f.button()]);assert.equal(f.buttons[0].disabled,true);await f.click(f.buttons[0]);assert.equal(f.calls.length,1);
    f.calls[0].reject(Error('current cancel failure'));await first;assert.deepEqual(f.errors,['current cancel failure']);assert.equal(f.buttons[0].disabled,false);
    const retry=f.click(f.buttons[0]);assert.equal(f.calls.length,2);f.calls[1].resolve();await retry;assert.equal(f.buttons[0].disabled,false);
  });
  test(`${surface}: terminal removal stays removed and cancelling state never unlocks on receipt`,async()=>{
    const f=fixture(),run=f.click(f.buttons[0]);f.replace([]);f.calls[0].resolve();await run;assert.equal(f.buttons.length,0);
    f.context.current.tasks=[{taskId:'task-1',state:'cancelling'}];f.replace([f.button()]);assert.equal(f.buttons[0].disabled,true);await f.click(f.buttons[0]);assert.equal(f.calls.length,1);
  });
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
