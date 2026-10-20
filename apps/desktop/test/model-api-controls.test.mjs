import test from 'node:test';
import assert from 'node:assert/strict';
import {mountModelApiControls,describeModelRequestBudget} from '../src/app/model-api-controls.js';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

// A scoped form DOM for the composed model settings surface. Sibling controls are mounted
// normally; they cannot alias the independent API fields or its save/remove lock.
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.attributes=new Map();this.listeners=new Map();
    this.value='';this.checked=false;this.disabled=false;this.textContent='';this.dataset={};}
  setAttribute(name,value){this.attributes.set(name,String(value));
    if(name==='value')this.value=String(value);
    if(name==='checked'||name==='disabled')this[name]=true;
    if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/gu,(_,letter)=>letter.toUpperCase())]=String(value);}
  append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  replaceChildren(...children){for(const child of this.children)child.parentElement=undefined;this.children=[];this.value='';this.append(...children);}
  set innerHTML(value){
    this.replaceChildren();const stack=[this];
    for(const token of value.match(/<[^>]+>|[^<]+/gu)??[]){
      if(token.startsWith('</')){stack.pop();continue;}
      if(!token.startsWith('<')){stack.at(-1).textContent+=token;continue;}
      const tag=token.match(/^<([\w-]+)/u)?.[1];if(!tag)continue;
      const node=new Element(tag);
      for(const match of token.slice(tag.length+1,-1).matchAll(/([\w-]+)(?:="([^"]*)")?/gu))node.setAttribute(match[1],match[2]??'');
      stack.at(-1).append(node);if(!['input','br','hr','img','link'].includes(tag))stack.push(node);
    }
  }
  matches(selector){return selector.split(',').some(part=>{
    const match=part.trim().match(/^([\w-]+)?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/u);
    return Boolean(match)&&(!match[1]||this.tag===match[1])
      &&(!match[2]||this.attributes.has(match[2])&&(match[3]===undefined||this.attributes.get(match[2])===match[3]));
  });}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
  get elements(){return {namedItem:name=>this.querySelectorAll('input,select,textarea,button').find(node=>node.attributes.get('name')===name)??null};}
  addEventListener(type,listener,options={}){this.listeners.set(type,listener);
    options.signal?.addEventListener('abort',()=>{if(this.listeners.get(type)===listener)this.listeners.delete(type);},{once:true});}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  remove(){this.removed=true;if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=undefined;}
}

function fixture(t,invoke){
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');
  t.after(()=>{if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document;});
  globalThis.document={createElement:tag=>new Element(tag)};
  const root=new Element('main'),siblingCalls=[];
  const ui=mountModelApiControls(root,(operation,payload)=>{
    if(operation==='harness.experience.list'){
      siblingCalls.push({operation,payload});return {available:false,entries:[],reason:'Explicit synthetic unavailable experience host'};
    }
    assert.ok(operation.startsWith('modelApi.'),'Only model API writes belong to this fixture');return invoke(operation,payload);
  });
  t.after(()=>ui.close());
  assert.equal(siblingCalls.length,1,'The composed experience control performs its original read-only initial refresh');
  const settings=root.children[0],fields=Object.fromEntries(settings.querySelectorAll('[data-model-api]')
    .map(node=>[node.dataset.modelApi,node]));
  const efforts=settings.querySelectorAll('[data-model-effort]'),controls=settings.querySelectorAll('input,select,button');
  return {fields,efforts,controls,settings,ui,save:()=>fields.save.onclick(),remove:()=>fields.remove.onclick()};
}

function model(){return {id:'synthetic',provider:'openai-compatible',displayName:'Synthetic',baseUrl:'https://synthetic.invalid/v1',
  model:'synthetic-model',configurationRef:'synthetic-ref',enabled:true,available:true,reasoningEfforts:['low']};}

test('budget-only refresh preserves configuration drafts and hides results after destination edits', t=>{
  const f=fixture(t,()=>{});
  f.ui.render({models:[model()]});f.fields.saved.value='synthetic';f.fields.saved.onchange();
  assert.match(f.fields.requestBudget.textContent,/尚未计量/);
  f.fields.displayName.value='正在编辑';f.fields.key.value='private draft';
  const measured={...model(),requestBudget:{state:'measured',scope:'provider-body',hiddenContext:'unknown',
    configurationRef:'synthetic-ref',inputTokens:80,contextTokens:100,reservedOutputTokens:20}};
  f.ui.updateBudget({models:[measured]});
  assert.match(f.fields.requestBudget.textContent,/80 Token/);assert.match(f.fields.requestBudget.textContent,/输出预留 20 Token/);
  assert.equal(f.fields.displayName.value,'正在编辑');assert.equal(f.fields.key.value,'private draft');
  for (const requestBudget of [{...measured.requestBudget,configurationRef:'old'},
    {...measured.requestBudget,inputTokens:81},{...measured.requestBudget,inputTokens:'80'},
    {...measured.requestBudget,hiddenContext:'verified'}]) {
    assert.match(describeModelRequestBudget({...measured,requestBudget}),/尚未计量/);
  }
  f.fields.baseUrl.listeners.get('input')();f.ui.updateBudget({models:[measured]});
  assert.match(f.fields.requestBudget.textContent,/已更改/);assert.doesNotMatch(f.fields.requestBudget.textContent,/80 Token/);
  f.ui.close();f.ui.updateBudget({models:[measured]});assert.equal(f.fields.key.value,'');
});

test('native controls restore and submit the exact configuration, then invalidate it on destination edits',async t=>{
  const calls=[];
  const f=fixture(t,(operation,payload)=>{calls.push({operation,payload:structuredClone(payload)});return {models:[]};});
  const nativeReasoning={thinking:'enabled',effort:'max',supportedEfforts:['low','max'],outputTokenParameter:'max_completion_tokens'};
  f.ui.render({models:[{...model(),reasoningEfforts:[],nativeReasoning}]});
  f.fields.saved.value='synthetic';f.fields.saved.onchange();
  assert.equal(f.fields.nativeThinking.value,'enabled');assert.equal(f.fields.nativeEffort.value,'max');
  assert.equal(f.fields.outputTokenParameter.value,'max_completion_tokens');
  assert.equal(f.fields.reasoningConfirmed.checked,true);
  await f.save();
  assert.deepEqual(calls[0].payload.nativeReasoning,nativeReasoning);
  assert.deepEqual(calls[0].payload.reasoningEfforts,[]);
  f.ui.render({models:[{...model(),reasoningEfforts:[],nativeReasoning}]});
  f.fields.saved.value='synthetic';f.fields.saved.onchange();
  f.fields.nativeEffort.listeners.get('input')();assert.equal(f.fields.reasoningConfirmed.checked,false);
  f.fields.baseUrl.listeners.get('input')();
  assert.equal(f.fields.nativeThinking.value,'');assert.equal(f.fields.nativeEffort.value,'');
  assert.equal(f.fields.outputTokenParameter.value,'max_tokens');
  assert.ok(f.efforts.every(input=>!input.checked));
});

test('pending model save disables every parameter and repeated save/remove callbacks cannot submit another request',async t=>{
  const pending=deferred(),calls=[];
  const f=fixture(t,(operation,payload)=>{calls.push({operation,payload});return pending.promise;});
  f.ui.render({models:[model()],defaultId:'synthetic'});f.fields.saved.value='synthetic';f.fields.saved.onchange();
  f.fields.key.value='synthetic-secret';const saving=f.save();
  assert.equal(f.fields.key.value,'');
  for(const control of f.controls)assert.equal(control.disabled,true);
  assert.equal(f.settings.attributes.get('aria-busy'),'true');
  const repeated=f.save(),removing=f.remove();assert.equal(calls.length,1);
  assert.equal(calls[0].payload.expectedConfigurationRef,'synthetic-ref');
  assert.equal(calls[0].payload.apiKey,'synthetic-secret');
  pending.resolve({models:[model()],defaultId:'synthetic'});await Promise.all([saving,repeated,removing]);
  for(const control of f.controls)assert.equal(control.disabled,false);
  assert.equal(f.settings.attributes.get('aria-busy'),'false');
  assert.equal(calls[0].payload.apiKey,'');
});

test('save failure preserves non-secret draft fields and restores input without retrying',async t=>{
  const pending=deferred();let calls=0;
  const f=fixture(t,()=>{calls++;return pending.promise;});
  f.fields.displayName.value='Draft';f.fields.baseUrl.value='https://synthetic.invalid/v1';f.fields.model.value='draft-model';
  f.fields.key.value='synthetic-secret';const saving=f.save();pending.reject(Error('synthetic storage error'));await saving;
  assert.equal(f.fields.displayName.value,'Draft');assert.equal(f.fields.model.value,'draft-model');
  assert.equal(f.fields.baseUrl.value,'https://synthetic.invalid/v1');assert.equal(f.fields.key.value,'');
  assert.equal(f.fields.save.disabled,false);assert.equal(f.fields.key.disabled,false);
  assert.equal(f.fields.remove.disabled,true,'an unsaved model cannot be removed');
  assert.match(f.fields.status.textContent,/配置操作未完成/);assert.equal(calls,1);
});

test('model removal shares the same form lock and restores the add-model state',async t=>{
  const pending=deferred(),calls=[];
  const f=fixture(t,(operation,payload)=>{calls.push({operation,payload});return pending.promise;});
  f.ui.render({models:[model()]});f.fields.saved.value='synthetic';f.fields.saved.onchange();const removing=f.remove();
  for(const control of f.controls)assert.equal(control.disabled,true);
  const saving=f.save();assert.deepEqual(calls,[{operation:'modelApi.remove',payload:{id:'synthetic'}}]);
  pending.resolve({models:[]});await Promise.all([removing,saving]);
  assert.equal(f.fields.saved.value,'');assert.equal(f.fields.remove.disabled,true);assert.equal(f.fields.save.disabled,false);
});

test('closed model controls ignore queued actions and late readback while clearing submitted secrets',async t=>{
  const pending=deferred();let calls=0,payload;
  const f=fixture(t,(_operation,input)=>{calls++;payload=input;return pending.promise;});
  f.fields.key.value='synthetic-secret';const saving=f.save();f.ui.close();
  const queuedSaving=f.save(),queuedRemoving=f.remove();assert.equal(calls,1);
  pending.resolve({models:[model()]});await Promise.all([saving,queuedSaving,queuedRemoving]);
  assert.equal(f.settings.removed,true);assert.equal(f.fields.saved.value,'');assert.equal(payload.apiKey,'');
});
