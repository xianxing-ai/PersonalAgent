import test from 'node:test';
import assert from 'node:assert/strict';
import {mountConversationRail} from '../src/features/conversation/rail.js';

function fixture(t) {
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');
  t.after(()=>{if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document;});
  const document={documentElement:{dataset:{}},createElement:tag=>new Element(tag)};
  class Element {
    constructor(tag){this.tag=tag;this.dataset={};this.children=[];this.hidden=false;this.connected=true;this.attributes=new Map();}
    get isConnected(){return this.connected && (!this.parentElement || this.parentElement.isConnected);}
    setAttribute(name,value){this.attributes.set(name,value);}
    append(...children){for(const child of children){child.parentElement=this;child.connected=true;this.children.push(child);}}
    contains(node){return node===this || this.children.some(child=>child.contains(node));}
    replaceChildren(...children){if(this.contains(document.activeElement))document.activeElement=document.body;
      for(const child of this.children)child.connected=false;this.children=[];this.append(...children);this.afterReplace?.();}
    querySelectorAll(selector){if(selector==='button')return this.children.filter(child=>child.tag==='button');return [];}
    getClientRects(){return !this.isConnected || this.hidden || this.parentElement?.hidden?[]:[{}];}
    focus(options){document.activeElement=this;this.focusOptions=options;}
    closest(){return this;}
  }
  document.body=new Element('body');document.activeElement=document.body;globalThis.document=document;
  const container=new Element('main');let articles=[];const listeners=new Map();
  const scroller={querySelectorAll:()=>articles,getBoundingClientRect:()=>({top:0}),addEventListener:(name,listener)=>listeners.set(name,listener)};
  const update=mountConversationRail(container,scroller),rail=container.children[0];
  const turn=(id,text)=>({dataset:{turn:id},summary:text,querySelector(){return {textContent:this.summary};},
    getBoundingClientRect:()=>({top:100}),scrollIntoView(options){this.scrollOptions=options;}});
  const first=turn('first','第一轮'),second=turn('second','第二轮');articles=[first,second];update();
  return {document,container,rail,update,first,second,turn,setTurns(next){articles=next;},buttons:()=>rail.querySelectorAll('button')};
}

test('new or reordered turns preserve the focused navigation identity and activation target',t=>{
  const f=fixture(t);f.buttons()[1].focus();
  const third=f.turn('third','新增轮次');f.setTurns([third,f.first,f.second]);f.update();
  assert.equal(f.document.activeElement,f.buttons()[2]);
  assert.equal(f.document.activeElement.attributes.get('aria-label'),'查看：第二轮');
  assert.deepEqual(f.document.activeElement.focusOptions,{preventScroll:true});
  f.rail.onclick({target:f.document.activeElement});
  assert.deepEqual(f.second.scrollOptions,{behavior:'smooth',block:'start'});
  assert.equal(f.first.scrollOptions,undefined);
  f.second.summary='第二轮更新后的回答';f.update();
  assert.equal(f.document.activeElement,f.buttons()[2]);
  assert.equal(f.document.activeElement.attributes.get('aria-label'),'查看：第二轮更新后的回答');
});

test('updating the rail never moves focus out of the composer or another control',t=>{
  const f=fixture(t),external={};f.document.activeElement=external;
  f.setTurns([f.first,f.second,f.turn('third','新增轮次')]);f.update();
  assert.equal(f.document.activeElement,external);
});

for(const mode of ['removed-turn','single-turn','hidden-panel','removed-panel'])
  test(`${mode} navigation targets cannot regain focus`,t=>{
    const f=fixture(t);f.buttons()[1].focus();
    if(mode==='removed-turn')f.setTurns([f.first,f.turn('third','新增轮次')]);
    if(mode==='single-turn')f.setTurns([f.second]);
    if(mode==='hidden-panel')f.container.hidden=true;
    if(mode==='removed-panel')f.container.connected=false;
    f.second.summary='第二轮更新';f.update();
    assert.equal(f.document.activeElement,f.document.body,mode);
    if(mode==='single-turn')assert.equal(f.rail.hidden,true);
});

test('focus deliberately moved during replacement is preserved',t=>{
  const f=fixture(t),external={};f.buttons()[1].focus();
  f.rail.afterReplace=()=>{f.document.activeElement=external;};
  f.second.summary='第二轮更新';f.update();assert.equal(f.document.activeElement,external);
});
