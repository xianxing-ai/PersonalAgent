import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {Conversations} from '../electron/conversations.js';
import {flushConversationDrafts} from '../electron/conversation-draft-close.js';

function fixture(){
  const cache=path.resolve(import.meta.dirname,'../../../.cache/draft-close-tests');mkdirSync(cache,{recursive:true});
  const file=path.join(mkdtempSync(path.join(cache,'run-')),'conversations.json');
  const conversations=new Conversations(file),mainFrame={},panel={webContents:{mainFrame}},workspace={webContents:{mainFrame:{}}};
  return {file,conversations,panel,workspace,event:{sender:panel.webContents,senderFrame:mainFrame}};
}
test('closing persists the latest drafts atomically, including archived late dictation, then survives reopen',()=>{
  const f=fixture(),second=f.conversations.create('panel');f.conversations.archive('panel',second.id);
  flushConversationDrafts(f.event,[{conversationId:'desktop-panel',text:'last edit before close'},{conversationId:second.id,text:'late archived dictation'}],f);
  const reopened=new Conversations(f.file);
  assert.equal(reopened.session('desktop-panel').draft,'last edit before close');
  assert.equal(reopened.session(second.id).draft,'late archived dictation');assert.equal(reopened.session(second.id).archived,true);
});
test('close writes reject another surface, subframe, duplicate and malformed drafts without partial changes',()=>{
  const f=fixture();f.conversations.setDraft('panel','desktop-panel','original');const before=readFileSync(f.file,'utf8');
  for(const entries of [[{conversationId:'desktop-panel',text:'new'},{conversationId:'desktop-workspace',text:'foreign'}],
    [{conversationId:'desktop-panel',text:'a'},{conversationId:'desktop-panel',text:'b'}],
    [{conversationId:'desktop-panel',text:'a',extra:true}], [{conversationId:'desktop-panel',text:'x'.repeat(100001)}]])assert.throws(()=>flushConversationDrafts(f.event,entries,f));
  assert.throws(()=>flushConversationDrafts({...f.event,senderFrame:{}},[],f));
  assert.throws(()=>flushConversationDrafts({sender:{mainFrame:{}},senderFrame:{}},[],f));
  assert.equal(readFileSync(f.file,'utf8'),before);assert.equal(f.conversations.session('desktop-panel').draft,'original');
});
test('failed final persistence preserves old memory and file for an explicit retry',()=>{
  const f=fixture();f.conversations.setDraft('panel','desktop-panel','old');const save=f.conversations.save;
  f.conversations.save=()=>{throw Error('disk unavailable');};
  assert.throws(()=>flushConversationDrafts(f.event,[{conversationId:'desktop-panel',text:'new'}],f),/disk unavailable/);
  assert.equal(f.conversations.session('desktop-panel').draft,'old');assert.equal(new Conversations(f.file).session('desktop-panel').draft,'old');
  f.conversations.save=save;flushConversationDrafts(f.event,[{conversationId:'desktop-panel',text:'new'}],f);
  assert.equal(new Conversations(f.file).session('desktop-panel').draft,'new');
});
