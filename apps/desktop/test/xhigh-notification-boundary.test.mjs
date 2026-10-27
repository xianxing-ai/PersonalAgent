import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {createDesktopNotificationPort} from '../electron/desktop-notification-port.js';

const input=id=>({id,title:'Synthetic notification',body:'No OS delivery'});

function fixture(t) {
  const root=resolve('.cache/xhigh-notification-audit-20261026/tests');mkdirSync(root,{recursive:true});
  const directory=mkdtempSync(join(root,'port-')),callbacks=new Map(),shown=[];
  assert.ok(directory.startsWith(root+sep));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const notifier={async isSupported(){return true;},async show(value,events){
    shown.push(value);callbacks.set(value.id,events);return {close(){}};}};
  const open=()=>createDesktopNotificationPort({storageDir:directory,notifier});
  return {open,callbacks,shown,directory};
}

test('a failed native delivery cannot become delivered from a later click callback',async t=>{
  const f=fixture(t),port=f.open();await port.sendAdvisoryNotification(input('failed-click'));
  f.callbacks.get('failed-click').onFailed();
  assert.equal(port.readDeliveryOutcome('failed-click').deliveryState,'failed');
  f.callbacks.get('failed-click').onClick();
  assert.equal(port.readDeliveryOutcome('failed-click').deliveryState,'failed');
  assert.equal(port.readDeliveryOutcome('failed-click').userRead,false);
  assert.equal(f.shown.length,1);
});

test('a trusted failed reconciliation cannot be overwritten by a late native show',async t=>{
  const f=fixture(t),port=f.open();await port.sendAdvisoryNotification(input('failed-reconcile'));
  port.reconcile('failed-reconcile',false);
  assert.equal(port.readDeliveryOutcome('failed-reconcile').deliveryState,'failed');
  f.callbacks.get('failed-reconcile').onShow();
  assert.equal(port.readDeliveryOutcome('failed-reconcile').deliveryState,'failed');
});

test('a callback from a disposed port cannot overwrite a newer instance store',async t=>{
  const f=fixture(t),old=f.open();await old.sendAdvisoryNotification(input('reopened'));
  const oldCallbacks=f.callbacks.get('reopened');old.dispose();
  const current=f.open();current.reconcile('reopened',false);
  assert.equal(current.readDeliveryOutcome('reopened').deliveryState,'failed');
  oldCallbacks.onShow();
  assert.equal(f.open().readDeliveryOutcome('reopened').deliveryState,'failed');
  assert.equal(f.shown.length,1);
});

test('a click before show remains separate from the channel delivery receipt',async t=>{
  const f=fixture(t),port=f.open();await port.sendAdvisoryNotification(input('click-first'));
  f.callbacks.get('click-first').onClick();
  const pending=port.readDeliveryOutcome('click-first');
  assert.equal(pending.deliveryState,'unknown');assert.equal(pending.userRead,false);
  assert.deepEqual(pending.evidenceRefs,[]);
  f.callbacks.get('click-first').onShow();
  const confirmed=port.readDeliveryOutcome('click-first');
  assert.equal(confirmed.deliveryState,'delivered');assert.equal(confirmed.userRead,true);
  assert.deepEqual(confirmed.evidenceRefs,['desktop-notification:click-first:show']);
});

test('disposing during support readback preserves unknown intent without a later OS send',async t=>{
  const f=fixture(t);let release,entered;
  const ready=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const notifier={async isSupported(){entered();return gate;},async show(){f.shown.push('late');return {close(){}};}};
  const port=createDesktopNotificationPort({storageDir:f.directory,notifier});
  const pending=port.sendAdvisoryNotification(input('disposed-before-show'));await ready;
  port.dispose();release(true);await pending;
  assert.equal(f.shown.length,0);
  assert.equal(port.readDeliveryOutcome('disposed-before-show').deliveryState,'unknown');
});
