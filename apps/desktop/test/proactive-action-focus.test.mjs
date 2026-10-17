import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const source=await readFile(new URL('../src/app/proactive-controls.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('proactive-controls.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const captures=[];let restoration;
function visit(node){
  if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>['focusedAction','actionIdentity','focusedActionIdentity'].includes(d.name.getText(ast))))captures.push(node.getText(ast));
  if(ts.isIfStatement(node)&&node.expression.getText(ast)==='focusedActionIdentity!==null&&document.activeElement===document.body')restoration=node.getText(ast);
  ts.forEachChild(node,visit);
}
visit(ast);assert.equal(captures.length,3);assert.ok(restoration);
function fixture({action='apply-cognition',disabled=false,dataset={}}={}){
  const document={body:{tag:'BODY'}};
  const button=(id,extra={})=>({dataset:{action,reviewId:id,...extra},disabled:false,matches(selector){return selector.includes(`data-action="${this.dataset.action}"`);},focus(options){document.activeElement=this;this.options=options;}});
  const old=button('b',dataset);old.disabled=disabled;document.activeElement=old;
  let nodes=[old];const reviewsList={contains:node=>nodes.includes(node),querySelectorAll:()=>nodes};
  const context=vm.createContext({document,reviewsList,cognitionReviews:[{reviewTaskId:'a',state:'local'},{reviewTaskId:'b',state:'selected'}]});
  vm.runInContext(captures.join('\n'),context);
  return{old,document,context,button,replace(next){nodes=next;document.activeElement=document.body;},restore:()=>vm.runInContext(restoration,context)};
}
test('actual consumer restores the second review action with preventScroll across replacement',()=>{
  for(const action of ['apply-cognition','retain-local-cognition']){const f=fixture({action}),a=f.button('a'),b=f.button('b');f.replace([a,b]);f.restore();assert.equal(f.document.activeElement,b);assert.equal(b.options.preventScroll,true);}
});
test('user focus moved elsewhere is never replaced',()=>{
  const f=fixture(),other={tag:'TEXTAREA'};f.replace([f.button('b')]);f.document.activeElement=other;f.restore();assert.equal(f.document.activeElement,other);
});
test('removed or disabled actions and disabled original buttons do not restore focus',()=>{
  for(const mode of ['removed','disabled','old-disabled']){const f=fixture({disabled:mode==='old-disabled'}),button=f.button('b');button.disabled=mode==='disabled';f.replace(mode==='removed'?[f.button('a')]:[button]);f.restore();assert.equal(f.document.activeElement,f.document.body);}
});
test('terminal or expired reviews do not restore an otherwise enabled action',()=>{
  for(const state of ['expired','succeeded','failed','cancelled','applied']){const f=fixture();f.context.cognitionReviews=[{reviewTaskId:'b',status:state}];f.replace([f.button('b')]);f.restore();assert.equal(f.document.activeElement,f.document.body);}
});
test('changed action or binding scope command attributes do not reuse focus identity',()=>{
  for(const key of ['action','binding','scope','command']){const f=fixture({dataset:{[key]:key==='action'?'apply-cognition':'original'}});f.replace([f.button('b',{[key]:key==='action'?'retain-local-cognition':'changed'})]);f.restore();assert.equal(f.document.activeElement,f.document.body);}
});
test('approval controls are excluded from capture and restoration',()=>{
  const f=fixture({action:'approval.allow'});f.replace([f.button('b')]);f.restore();assert.equal(f.document.activeElement,f.document.body);
});
