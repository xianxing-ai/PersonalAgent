import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizationDom} from '../test-support/authorization-dom.mjs';
import {mountTodoControls} from '../src/app/todo-controls.js';
import {mountFeedsControls} from '../src/app/feeds-controls.js';
import {mountMailControls} from '../src/app/mail-controls.js';
import {mountCalendarControls} from '../src/app/calendar-controls.js';

function fixture(t,mount,value={}) {
  const f=authorizationDom(),previous=globalThis.document,calls=[];globalThis.document=f.document;
  t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
  const controls=mount(f.root,async(name,input)=>{calls.push({name,input});return value;});controls.render(value);
  t.after(()=>controls.close?.());return {...f,calls,controls};
}

test('Synthetic Todo and Feeds settings retain configuration and revoke, with no second session allow action',async t=>{
  for(const [mount,prefix,value]of [[mountTodoControls,'todo',{available:true,sessionAllowed:true}],
    [mountFeedsControls,'feeds',{available:true,sessionAllowed:true,subscriptions:[]}]]){
    await t.test(prefix,async t=>{const f=fixture(t,mount,value);
      assert.equal(f.root.querySelector(`[data-${prefix}="enable"]`),null);
      assert.equal(f.root.querySelector(`[data-${prefix}="consent"]`),null);
      await f.root.querySelector(`[data-${prefix}="disable"]`).onclick();
      assert.deepEqual(f.calls,[{name:`${prefix}.revoke`,input:undefined}]);
      assert.ok(f.root.querySelector('form'),'local configuration/CRUD is retained');
    });
  }
});

test('Synthetic mail config saves credentials without a consent field and configured reads can reach their own question path',async t=>{
  const f=fixture(t,mountMailControls,{configured:true,sessionAllowed:false,localModelReady:true,status:'disabled'});
  for(const name of ['enable','consent','cloudEnable','cloudConsent'])assert.equal(f.root.querySelector(`[data-mail="${name}"]`),null);
  const field=name=>f.root.querySelector(`[data-mail="${name}"]`);
  field('user').value='synthetic@example.invalid';field('key').value='synthetic-secret';
  let payload;const original=field('save').onclick;
  await original();payload=f.calls[0].input;
  assert.deepEqual(Object.keys(payload).sort(),['authCode','user']);assert.equal(payload.authCode,'','credential DTO is cleared after the host call');
  assert.equal(field('key').value,'');assert.equal(field('read').disabled,false,'all old consent false does not block starting the exact card challenge');
  await field('read').onclick();assert.equal(f.calls[1].name,'mail.read');
  f.controls.render({configured:false,localModelReady:true,status:'unconfigured'});assert.equal(field('read').disabled,true,'a card cannot replace missing credentials');
});

test('Synthetic calendar retains credentials and read/cancel entry, with no settings approval duplicate',async t=>{
  const f=fixture(t,mountCalendarControls,{configured:true,readAvailable:true});
  const field=name=>f.root.querySelector(`[data-calendar="${name}"]`);
  assert.equal(field('allow'),null);assert.equal(field('deny'),null);
  field('name').value='Synthetic calendar';field('url').value='https://synthetic.invalid/calendar/';
  field('user').value='synthetic';field('password').value='synthetic-password';
  await field('save').onclick();assert.equal(f.calls[0].name,'calendar.configure');
  assert.equal(Object.hasOwn(f.calls[0].input,'readConsent'),false);assert.equal(field('password').value,'');
  field('event').value='synthetic-uid';await field('read').onclick();
  assert.deepEqual(f.calls[1],{name:'calendar.read',input:{externalId:'synthetic-uid'}});
  f.controls.render({configured:true,readAvailable:true,readTask:{taskId:'original',state:'waiting_approval'}});
  assert.equal(field('read').disabled,true);assert.equal(field('cancel').disabled,false);
  await field('cancel').onclick();assert.equal(f.calls[2].name,'calendar.cancel');assert.equal(f.calls[2].input,'original');
});
