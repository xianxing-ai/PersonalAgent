import test from 'node:test';
import assert from 'node:assert/strict';
import {createObsidianPairingUI} from '../electron/obsidian-pairing-ui.js';

test('application pairing rejects denial, replaced owner, changed peer and closure after the same card',async()=>{
  for(const mode of ['deny','owner','peer','close','allow']){
    const original={isDestroyed:()=>false};let owner=original,ui,request;
    const peer={folder:'Synthetic',sessionId:'local-session'},signal=new AbortController().signal;
    ui=createObsidianPairingUI({BrowserWindow:class{},ipcMain:{handle(){},removeHandler(){}},owner:()=>owner,
      confirmAuthorization:async value=>{request=value;
        if(mode==='owner')owner={isDestroyed:()=>false};if(mode==='peer')peer.folder='changed';if(mode==='close')ui.close();
        return mode!=='deny';}});
    assert.equal(await ui.confirm({peer,signal,displayName:'Synthetic Vault'}),mode==='allow');
    assert.equal(request.signal,signal);assert.equal(request.scope.folder,'Synthetic');ui.close();
  }
});
