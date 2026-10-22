import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const main=readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
const source=main.slice(main.indexOf('function readConnectorSourceAuthorization('),main.indexOf('\nasync function refreshMail()'));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture({batch=true,requestable=true,legacy=false}={}) {
  let generation='first',configured=true,restart=false;
  const config={user:'public-fixture@example.invalid',revision:'revision-1'};
  const namespace='public-fixture-namespace';
  const read=vm.runInNewContext('('+source+')',{createHash,desktopHost:{userNamespace:namespace},mailHost:{},
    mailConfig:{snapshot:()=>({sessionAllowed:legacy,requiresRestart:restart}),current:()=>configured?config:undefined,
      ...(batch?{batchAuthorization:{canRequest:()=>requestable}}:{})},
    authorizationQuestionPort:{readResourceGeneration:resource=>{
      assert.equal(resource,digest({namespace,kind:'mail-local-batch',user:config.user,revision:config.revision}));
      if(generation===undefined)throw Error('question unavailable');return generation;
    }}});
  return {read:()=>read('mail'),rotate:()=>{generation='second';},unavailable:()=>{generation=undefined;},
    clear:()=>{configured=false;},restart:()=>{restart=true;}};
}
test('Main mail readiness uses the batch question capability without granting execution',()=>{
  const current=fixture();assert.equal(current.read().available,true);
  assert.equal(fixture({requestable:false,legacy:true}).read().available,false);
  const old=fixture({batch:false,legacy:true});assert.equal(old.read().available,true);
  assert.equal(fixture({batch:false,legacy:false}).read().available,false);
});
test('Main mail watch origin changes when the original authorization resource rotates',()=>{
  const current=fixture(),before=current.read();current.rotate();
  assert.equal(current.read().available,true);assert.notEqual(current.read().configurationRef,before.configurationRef);
  current.unavailable();assert.equal(current.read().available,false);
});
test('Main rejects a removed or restart-pending mailbox before creating a watch origin',()=>{
  const missing=fixture();missing.clear();assert.equal(missing.read().available,false);
  const pending=fixture();pending.restart();assert.equal(pending.read().available,false);
});
