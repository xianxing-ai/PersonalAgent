import test from 'node:test';
import assert from 'node:assert/strict';
import {mountDeveloperControls} from '../src/features/admin/developer-controls.js';

test('actual admin control reads, submits and clears the explicit repairLinks checkbox',async t=>{
  const elements=new Map(),handlers=new Map();
  const element=key=>{if(!elements.has(key))elements.set(key,{value:'',checked:false,addEventListener(name,fn){handlers.set(key+':'+name,fn);}});return elements.get(key);};
  const form=element('form');form.elements={namedItem:element};
  const section={querySelector:element,remove(){}};
  const original=globalThis.document;globalThis.document={createElement:()=>section};
  t.after(()=>{if(original===undefined)delete globalThis.document;else globalThis.document=original;});
  const requests=[],control=mountDeveloperControls({append(){}},async(name,request)=>{
    assert.equal(name,'developer.settings.configure');requests.push(structuredClone(request));return {configuration:request.configuration};
  });
  const configuration={repository:'fixture/repository',github:{executable:'synthetic-gh'},git:{}};
  control.render({configuration});assert.equal(element('repairLinks').checked,false);
  control.render({configuration:{...configuration,github:{...configuration.github,repairLinks:true}}});
  assert.equal(element('repairLinks').checked,true);
  for(const checked of [true,false]){
    element('repairLinks').checked=checked;
    await handlers.get('form:submit')({preventDefault(){}});
    assert.equal(requests.at(-1).configuration.github.repairLinks,checked);
  }
  assert.equal(element('token').value,'');control.close();
});
