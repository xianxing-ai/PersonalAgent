import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import test from 'node:test';
import {createMicrophonePermissionGate} from '../electron/microphone-permission.js';

const page = 'file:///C:/PersonalAgent/index.html?mode=panel';
const details = {isMainFrame: true, requestingUrl: page, mediaTypes: ['audio']};

function contents(url = page) {
  const target = new EventEmitter();
  target.url = url;
  target.getURL = () => target.url;
  target.isDestroyed = () => false;
  return target;
}

function requested(gate, target, permission, requestDetails) {
  let granted;
  gate.request(target, permission, value => { granted = value; }, requestDetails);
  return granted;
}

test('microphone lease allows only trusted panel main-frame audio', () => {
  let time = 100;
  const panel = contents();
  const other = contents();
  const gate = createMicrophonePermissionGate({expectedPageUrl: 'file:///C:/PersonalAgent/index.html',
    isTrustedWindow: target => target === panel, now: () => time});

  assert.equal(requested(gate, panel, 'media', details), false);
  assert.equal(gate.check(panel, 'media', 'file://', {...details, mediaType: 'audio'}), false);
  const revoke = gate.grant({webContents: panel, deadlineAtMs: 200});
  assert.equal(requested(gate, panel, 'media', details), true);
  assert.equal(gate.check(panel, 'media', 'file://', {...details, mediaType: 'audio'}), true);
  assert.equal(requested(gate, panel, 'media', {...details, mediaTypes: ['audio', 'video']}), false);
  assert.equal(requested(gate, panel, 'media', {...details, mediaTypes: ['video']}), false);
  assert.equal(gate.check(panel, 'media', 'file://', {...details, mediaType: 'video'}), false);
  assert.equal(requested(gate, other, 'media', details), false);
  assert.equal(requested(gate, panel, 'media', {...details, isMainFrame: false}), false);
  assert.equal(requested(gate, panel, 'media', {...details, requestingUrl: 'file:///C:/other.html'}), false);
  assert.equal(requested(gate, panel, 'display-capture', details), false);
  revoke();
  assert.equal(requested(gate, panel, 'media', details), false);
  time = 201;
});

test('expiry, abort, and navigation revoke the lease without affecting a newer one', () => {
  let time = 100;
  const panel = contents();
  const gate = createMicrophonePermissionGate({expectedPageUrl: 'file:///C:/PersonalAgent/index.html',
    isTrustedWindow: target => target === panel, now: () => time});
  const expiredRevoke = gate.grant({webContents: panel, deadlineAtMs: 150});
  time = 151;
  assert.equal(requested(gate, panel, 'media', details), false);

  const controller = new AbortController();
  const abortRevoke = gate.grant({webContents: panel, deadlineAtMs: 300, signal: controller.signal});
  expiredRevoke();
  assert.equal(requested(gate, panel, 'media', details), true);
  controller.abort();
  assert.equal(requested(gate, panel, 'media', details), false);

  gate.grant({webContents: panel, deadlineAtMs: 300});
  abortRevoke();
  assert.equal(requested(gate, panel, 'media', details), true);
  panel.emit('did-start-navigation');
  assert.equal(requested(gate, panel, 'media', details), false);

  gate.grant({webContents: panel, deadlineAtMs: 300});
  panel.emit('destroyed');
  assert.equal(requested(gate, panel, 'media', details), false);
});

test('a lease cannot be created for another window, page, or expired authorization', () => {
  const panel = contents();
  const gate = createMicrophonePermissionGate({expectedPageUrl: 'file:///C:/PersonalAgent/index.html',
    isTrustedWindow: target => target === panel, now: () => 100});
  assert.throws(() => gate.grant({webContents: contents(), deadlineAtMs: 200}));
  panel.url = 'file:///C:/PersonalAgent/index.html?mode=admin';
  assert.throws(() => gate.grant({webContents: panel, deadlineAtMs: 200}));
  panel.url = page;
  assert.throws(() => gate.grant({webContents: panel, deadlineAtMs: 100}));
  assert.equal(requested(gate, panel, 'media', details), false);
});

test('workspace dictation grants audio only to the originating workspace main frame',()=>{
  const panel=contents(),workspace=contents();
  workspace.url=page.replace('mode=panel','mode=workspace');
  const gate=createMicrophonePermissionGate({expectedPageUrl:page.split('?')[0],now:()=>100,
    isTrustedWindow:(target,mode)=>target===(mode==='workspace'?workspace:panel)});
  const details={isMainFrame:true,mediaTypes:['audio'],requestingUrl:workspace.url};
  const release=gate.grant({webContents:workspace,deadlineAtMs:200});
  assert.equal(requested(gate,workspace,'media',details),true);
  assert.equal(requested(gate,panel,'media',details),false);
  release();
  assert.equal(requested(gate,workspace,'media',details),false);
  panel.url=workspace.url;
  assert.throws(()=>gate.grant({webContents:panel,deadlineAtMs:200}));
});

test('lease revoke callback fires once when navigation invalidates an active capture', () => {
  const panel = contents();
  const gate = createMicrophonePermissionGate({expectedPageUrl: 'file:///C:/PersonalAgent/index.html',
    isTrustedWindow: target => target === panel, now: () => 100});
  let revoked = 0;
  const revoke = gate.grant({webContents: panel, deadlineAtMs: 200, onRevoke: () => { revoked++; }});
  panel.emit('did-start-navigation');
  revoke();
  assert.equal(revoked, 1);
  assert.equal(requested(gate, panel, 'media', details), false);
});
