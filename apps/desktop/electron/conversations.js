import {createHash,randomUUID} from 'node:crypto';
import {closeSync,existsSync,fsyncSync,openSync,readFileSync,writeFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {resultText} from '../src/features/conversation/result-text.js';
import {canRetryConversationMigration,inspectPendingConversationMigration,openConversationSqliteStore,prepareConversationSqliteStore,readConversationMarker} from './conversation-sqlite-store.js';

// Desktop-owned metadata. Runtime still owns task state and results.
export class Conversations {
  constructor(file) {
    this.file = file;
    this.loadedVersion=4;
    this.store=undefined;
    this.legacyBytes=undefined;
    this.closed=false;
    this.migrationUncertain=false;
    this.turns = new Map();
    this.messages = new Map();
    this.messageRevision = 0;
    this.displayMessageIndex = undefined;
    this.preferences = new Map();
    this.sessions=new Map(['panel','workspace'].map(surface=>['desktop-'+surface,{id:'desktop-'+surface,surface,title:surface==='panel'?'原面板对话':'原工作区对话',archived:false,createdAt:new Date(0).toISOString(),draft:''}]));
    this.activeSessions={panel:'desktop-panel',workspace:'desktop-workspace'};
    if (file && existsSync(file)) {
      const bytes=readFileSync(file),parsed=JSON.parse(bytes.toString('utf8'));
      const marker=parsed?.version===5?readConversationMarker(bytes):null;
      const opened=marker?openConversationSqliteStore(file,bytes,this.stateSnapshot()):null;
      if(opened)this.store=opened.store;else this.legacyBytes=bytes;
      const data=opened?{version:4,...opened.state}:parsed;
      this.loadedVersion=opened?5:data.version;
      try{
      if (![1,2,3,4].includes(data.version) || !Array.isArray(data.turns) || (data.version >= 2 && !Array.isArray(data.messages))) throw Error('对话记录格式无法读取');
      if (data.version >= 3) {
        if (!Array.isArray(data.preferences)) throw Error('对话偏好格式无法读取');
        for (const [conversationId, preference] of data.preferences) {
          this.preferences.set(conversationId, this.validatePreference(conversationId, preference));
        }
      }
      if(data.version===4){
        if(!Array.isArray(data.sessions)||!data.activeSessions||typeof data.activeSessions!=='object')throw Error('对话列表格式无法读取');
        const sessions=new Map();for(const session of data.sessions){this.validateSession(session);if(sessions.has(session.id))throw Error('对话标识重复');sessions.set(session.id,structuredClone(session));}
        for(const surface of ['panel','workspace']){const active=sessions.get(data.activeSessions[surface]);if(!active||active.surface!==surface||active.archived||!sessions.has('desktop-'+surface))throw Error('当前对话归属无效');}
        this.sessions=sessions;this.activeSessions={panel:data.activeSessions.panel,workspace:data.activeSessions.workspace};
      }
      for (const turn of data.turns) {
        if (typeof turn.taskId === 'string' && ['panel','workspace'].includes(turn.surface) && typeof turn.goal === 'string') {if(turn.conversationId!==undefined&&this.sessions.get(turn.conversationId)?.surface!==turn.surface)throw Error('历史任务对话归属无效');this.turns.set(turn.taskId, turn);}
      }
      for (const message of data.messages ?? []) {
        const valid = this.validateLiveMessage(message);
        if (this.messages.has(valid.id)) throw Error('对话消息标识重复');
        this.messages.set(valid.id, valid);
      }
      if(opened&&!isDeepStrictEqual(this.stateSnapshot(),opened.state))
        throw Error('对话数据库内容不能按原语义无损读取');
      if(this.legacyBytes&&existsSync(`${file}.sqlite`))
        inspectPendingConversationMigration(file,this.stateSnapshot(),this.legacyBytes);
      }catch(error){this.store?.close();throw error;}
    }else if(file&&existsSync(`${file}.sqlite`))throw Error('对话标记缺失，不能从孤立数据库恢复');
  }
  stateSnapshot(){return {sessions:[...this.sessions.values()],activeSessions:{...this.activeSessions},
    turns:[...this.turns.values()],messages:[...this.messages.values()],preferences:[...this.preferences]};}
  close(){if(this.closed)return;this.store?.close();this.closed=true;}
  validateSession(value){
    if(!value||typeof value!=='object'||Object.keys(value).some(k=>!['id','surface','title','archived','createdAt','draft'].includes(k))||!['panel','workspace'].includes(value.surface)||typeof value.id!=='string'||!(value.id==='desktop-'+value.surface||new RegExp('^desktop-'+value.surface+':[a-f0-9-]{36}$').test(value.id))||typeof value.title!=='string'||!value.title.trim()||value.title.length>100||/[\u0000-\u001f\u007f]/.test(value.title)||typeof value.archived!=='boolean'||!Number.isFinite(Date.parse(value.createdAt))||typeof value.draft!=='string'||value.draft.length>100000)throw Error('对话元数据无效');
    return value;
  }
  activeConversationId(surface){if(!['panel','workspace'].includes(surface))throw Error('对话窗口无效');return this.activeSessions[surface];}
  session(id,surface){const value=this.sessions.get(id);if(!value||surface&&value.surface!==surface)throw Error('对话不存在或不属于当前窗口');return {...value};}
  conversationIdForTask(task){return this.turns.get(task.taskId)?.conversationId??(this.sessions.has(task.conversationId)?task.conversationId:taskSurfaceId(this.surface(task.taskId)));}
  containsConversation(id){return this.sessions.has(id);}
  snapshot(surface){return {activeId:this.activeConversationId(surface),sessions:[...this.sessions.values()].filter(s=>s.surface===surface).map(({draft,...session})=>({...session})),draft:this.session(this.activeConversationId(surface)).draft};}
  saveSessions(sessions,activeSessions=this.activeSessions,changes){this.save(this.turns,this.messages,this.preferences,sessions,activeSessions,changes);this.sessions=sessions;this.activeSessions=activeSessions;}
  create(surface,title='新对话'){
    this.activeConversationId(surface);const value=this.validateSession({id:'desktop-'+surface+':'+randomUUID(),surface,title,archived:false,createdAt:new Date().toISOString(),draft:''});
    const sessions=new Map(this.sessions);sessions.set(value.id,value);this.saveSessions(sessions,{...this.activeSessions,[surface]:value.id},
      [{kind:'sessions',id:value.id,value},{kind:'active',id:surface,value:value.id}]);return {...value};
  }
  switch(surface,id){const value=this.session(id,surface);if(value.archived)throw Error('请先恢复已归档对话');this.saveSessions(new Map(this.sessions),{...this.activeSessions,[surface]:id},
    [{kind:'active',id:surface,value:id}]);return value;}
  rename(surface,id,title){const value=this.validateSession({...this.session(id,surface),title});const sessions=new Map(this.sessions);sessions.set(id,value);this.saveSessions(sessions,this.activeSessions,
    [{kind:'sessions',id,value}]);return {...value};}
  archive(surface,id,archived=true){
    const value={...this.session(id,surface),archived};const sessions=new Map(this.sessions);sessions.set(id,value);let active={...this.activeSessions};
    if(archived&&active[surface]===id){let next=[...sessions.values()].find(s=>s.surface===surface&&!s.archived);if(!next){next=this.validateSession({id:'desktop-'+surface+':'+randomUUID(),surface,title:'新对话',archived:false,createdAt:new Date().toISOString(),draft:''});sessions.set(next.id,next);}active[surface]=next.id;}
    const changes=[{kind:'sessions',id,value}];
    for(const [newId,newValue] of sessions)if(!this.sessions.has(newId))changes.push({kind:'sessions',id:newId,value:newValue});
    if(active[surface]!==this.activeSessions[surface])changes.push({kind:'active',id:surface,value:active[surface]});
    this.saveSessions(sessions,active,changes);return {...value};
  }
  setDraft(surface,id,draft){const value=this.validateSession({...this.session(id,surface),draft});if(this.sessions.get(id).draft===draft)return;const sessions=new Map(this.sessions);sessions.set(id,value);this.saveSessions(sessions,this.activeSessions,
    [{kind:'sessions',id,value}]);}
  flushDrafts(surface,entries){
    this.activeConversationId(surface);
    if(!Array.isArray(entries)||entries.length>this.sessions.size)throw Error('关闭草稿格式无效');
    const sessions=new Map(this.sessions),ids=new Set(),changes=[];
    for(const entry of entries){
      if(!entry||Object.keys(entry).length!==2||!Object.hasOwn(entry,'conversationId')||!Object.hasOwn(entry,'text')||ids.has(entry.conversationId))throw Error('关闭草稿格式无效');
      const prior=this.session(entry.conversationId,surface),value=this.validateSession({...prior,draft:entry.text});
      ids.add(entry.conversationId);sessions.set(value.id,value);
      if(prior.draft!==value.draft)changes.push({kind:'sessions',id:value.id,value});
    }
    if(changes.length)this.saveSessions(sessions,this.activeSessions,changes);
  }
  surface(taskId) { return this.turns.get(taskId)?.surface ?? 'panel'; }
  goal(taskId) { return this.turns.get(taskId)?.goal; }
  validatePreference(conversationId, input) {
    if (typeof conversationId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(conversationId)
      || !input || Object.keys(input).some(key => !['modelId','depth','fast','executionModel','modelSelection'].includes(key))
      || input.modelSelection!==undefined&&(input.modelSelection!=='default'||Boolean(input.modelId||input.executionModel))
      || !Number.isInteger(input.depth) || input.depth < 0 || input.depth > 5 || typeof input.fast !== 'boolean'
      || (input.modelId !== undefined && (typeof input.modelId !== 'string' || input.modelId.length > 100
        || /[\u0000-\u001f\u007f]/.test(input.modelId)))) throw Error('对话模型或思考偏好无效');
    if(input.executionModel!==undefined && (!input.executionModel||typeof input.executionModel!=='object'||Array.isArray(input.executionModel)||!/^[a-f0-9]{64}$/.test(input.executionModel.catalogRevision)||typeof input.executionModel.modelId!=='string'||!input.executionModel.modelId||input.executionModel.modelId.length>200||Object.keys(input.executionModel).some(k=>!['catalogRevision','modelId','reasoningEffort'].includes(k))||input.executionModel.reasoningEffort!==undefined&&typeof input.executionModel.reasoningEffort!=='string'))throw Error('对话模型选择无效');
    return {...(input.executionModel?{executionModel:structuredClone(input.executionModel)}:{}),depth:input.depth,fast:input.fast,...(input.modelId ? {modelId:input.modelId} : {}),...(input.modelSelection?{modelSelection:input.modelSelection}:{})};
  }
  preference(conversationId, fallback = {depth:1,fast:false}) {
    return {...(this.preferences.get(conversationId) ?? fallback)};
  }
  setPreference(conversationId, input) {
    const value = this.validatePreference(conversationId, input);
    const next = new Map(this.preferences);next.set(conversationId,value);
    this.save(this.turns,this.messages,next,this.sessions,this.activeSessions,
      [{kind:'preferences',id:conversationId,value}]);this.preferences=next;
    return {...value};
  }
  add(taskId, surface, goal, conversationId=this.turns.get(taskId)?.conversationId??taskSurfaceId(surface)) {
    const previous=this.turns.get(taskId);
    if(previous&&(previous.surface!==surface||(previous.conversationId??taskSurfaceId(previous.surface))!==conversationId))throw Error('任务对话归属不可更改');
    this.session(conversationId,surface);
    const turns = new Map(this.turns);
    turns.set(taskId, {taskId, surface, goal, conversationId, createdAt:new Date().toISOString()});
    this.save(turns,this.messages,this.preferences,this.sessions,this.activeSessions,
      [{kind:'turns',id:taskId,value:turns.get(taskId)}]);
    this.turns = turns;
  }
  validateLiveMessage(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message) ||
      Object.keys(message).some(key => !['id','sessionId','role','text','createdAt','surface','conversationId'].includes(key)) ||
      !['id','sessionId'].every(key => typeof message[key] === 'string' && message[key].trim() && message[key].length <= 256) ||
      !['user','assistant'].includes(message.role) || typeof message.text !== 'string' || !message.text.trim() || message.text.length > 100000 ||
      typeof message.createdAt !== 'string' || !Number.isFinite(Date.parse(message.createdAt)) ||
      (message.surface !== undefined && message.surface !== 'panel')) throw Error('Live 对话消息格式无效');
    const conversationId=message.conversationId??'desktop-panel';this.session(conversationId,'panel');
    return {conversationId,id:message.id,sessionId:message.sessionId,role:message.role,text:message.text.trim(),createdAt:new Date(message.createdAt).toISOString(),surface:'panel'};
  }
  addLiveMessage(message) {
    const valid = this.validateLiveMessage(message);
    const prior = this.messages.get(valid.id);
    if (prior) {
      if (prior.conversationId !== valid.conversationId || prior.sessionId !== valid.sessionId || prior.role !== valid.role || prior.surface !== valid.surface) {
        throw Error('Live 对话消息标识冲突');
      }
      if (prior.text === valid.text) return {...prior};
      const updated = {...prior, text: valid.text};
      const messages = new Map(this.messages);
      messages.set(valid.id, updated);
      this.save(this.turns,messages,this.preferences,this.sessions,this.activeSessions,
        [{kind:'messages',id:valid.id,value:updated}]);
      const previousMessages=this.messages;
      this.messages = messages;
      this.advanceMessageDisplayIndex(updated,previousMessages);
      this.messageRevision++;
      return {...updated};
    }
    const messages = new Map(this.messages);
    messages.set(valid.id, valid);
    this.save(this.turns,messages,this.preferences,this.sessions,this.activeSessions,
      [{kind:'messages',id:valid.id,value:valid}]);
    const previousMessages=this.messages;
    this.messages = messages;
    this.advanceMessageDisplayIndex(valid,previousMessages);
    this.messageRevision++;
    return {...valid};
  }
  advanceMessageDisplayIndex(message,previousMessages) {
    const index=this.displayMessageIndex;
    if(!index)return;
    if(index.source!==previousMessages||index.size!==previousMessages.size){this.displayMessageIndex=undefined;return;}
    if(!previousMessages.has(message.id)){
      const entry=messageDisplayKey(message);
      insertMessageDisplayKey(index.all,entry);
      let entries=index.conversations.get(message.conversationId);
      if(!entries){entries=[];index.conversations.set(message.conversationId,entries);}
      insertMessageDisplayKey(entries,entry);
    }
    // Body revisions keep their original timestamp and conversation. Do not keep
    // the replaced Map (and its previous body) alive through the metadata index.
    index.source=this.messages;index.size=this.messages.size;
  }
  readMessageDisplayPage({conversationId,limit=41,before,after,messageThrough}={}) {
    if(!Number.isInteger(limit)||limit<1||limit>128)throw Error('历史消息页大小无效');
    let index=this.displayMessageIndex;
    if(!index||index.source!==this.messages||index.size!==this.messages.size){
      const all=[],conversations=new Map();
      for(const message of this.messages.values()){
        const entry=messageDisplayKey(message);all.push(entry);
        let entries=conversations.get(message.conversationId);
        if(!entries){entries=[];conversations.set(message.conversationId,entries);}
        entries.push(entry);
      }
      all.sort(compareMessageDisplayKeys);for(const entries of conversations.values())entries.sort(compareMessageDisplayKeys);
      this.displayMessageIndex=index={source:this.messages,size:this.messages.size,all,conversations};
    }
    const entries=conversationId===undefined?index.all:index.conversations.get(conversationId)??[];
    const first=after?messageDisplayBoundary(entries,after,true):0;
    let end=before?messageDisplayBoundary(entries,before):entries.length;
    // Every message key starts with "message:", so this includes all tie keys
    // at the original watermark while excluding later messages.
    if(messageThrough!==undefined)end=Math.min(end,messageDisplayBoundary(entries,{createdAt:messageThrough,key:'\uffff'}));
    const selected=after?entries.slice(first,Math.max(first,Math.min(end,first+limit)))
      :entries.slice(Math.max(first,end-limit),Math.max(first,end));
    return selected.map(({id,createdAt})=>({id,createdAt}));
  }
  messagesFor(surface,conversationId) {
    return [...this.messages.values()].filter(message => (surface === undefined || message.surface === surface)&&(!conversationId||message.conversationId===conversationId))
      .sort((a,b) => Date.parse(a.createdAt)-Date.parse(b.createdAt)).map(message => ({...message}));
  }
  deriveChanges(turns,messages,preferences,sessions,activeSessions){
    const changes=[];
    for(const [kind,old,next] of [['turns',this.turns,turns],['messages',this.messages,messages],
      ['preferences',this.preferences,preferences],['sessions',this.sessions,sessions]]){
      for(const [id,value] of next)if(!old.has(id)||!isDeepStrictEqual(old.get(id),value))
        changes.push({kind,id,value});
      for(const id of old.keys())if(!next.has(id))throw Error('对话记录不能在未定义迁移中删除');
    }
    for(const surface of ['panel','workspace'])if(activeSessions[surface]!==this.activeSessions[surface])
      changes.push({kind:'active',id:surface,value:activeSessions[surface]});
    return changes;
  }
  saveDefaultThinkingBackup(){
    if(!this.file||!existsSync(this.file))return;
    const bytes=this.legacyBytes??Buffer.from(JSON.stringify({version:4,...this.stateSnapshot()}));
    const digest=createHash('sha256').update(bytes).digest('hex').slice(0,16);
    const backup=`${this.file}.before-default-thinking-${digest}.bak`;
    if(!existsSync(backup))writeFileSync(backup,bytes,{flag:'wx'});
    if(!readFileSync(backup).equals(bytes))throw Error('默认思考设置备份未获确认，未覆盖对话记录');
    const handle=openSync(backup,'r+');try{fsyncSync(handle);}finally{closeSync(handle);}
  }
  save(turns,messages,preferences=this.preferences,sessions=this.sessions,activeSessions=this.activeSessions,changes){
    if(this.closed)throw Error('对话存储已关闭');
    if(!this.file)return;
    if(this.migrationUncertain)throw Error('对话迁移未确认，需重开核实');
    if(this.store&&this.file!==this.store.file)throw Error('对话存储路径已改变，拒绝写入');
    const delta=changes??this.deriveChanges(turns,messages,preferences,sessions,activeSessions);
    if(!delta.length)return;
    if([...preferences.values()].some(value=>value.modelSelection==='default')
      &&![...this.preferences.values()].some(value=>value.modelSelection==='default'))
      this.saveDefaultThinkingBackup();
    if(!this.store){
      try{this.store=prepareConversationSqliteStore(this.file,this.stateSnapshot(),this.legacyBytes);}
      catch(error){
        this.migrationUncertain=!canRetryConversationMigration(this.file,this.stateSnapshot(),this.legacyBytes);
        throw error;
      }
      this.legacyBytes=undefined;this.loadedVersion=5;
    }
    this.store.commit(delta);
  }
  history(tasks, taskId) {
    const surface = this.surface(taskId);
    const conversationId=this.conversationIdForTask({taskId});
    const entries = [];
    for (const task of tasks) {
      if (task.taskId === taskId) break;
      const goal = this.goal(task.taskId);
      if (!goal || this.conversationIdForTask(task)!==conversationId || task.state !== 'succeeded') continue;
      const answer = resultText(task.resultSummary);
      if (answer) entries.push({createdAt:this.turns.get(task.taskId)?.createdAt ?? task.createdAt,messages:[{role:'user',content:goal},{role:'assistant',content:answer}]});
    }
    const cutoff = Date.parse(this.turns.get(taskId)?.createdAt ?? '');
    for (const message of this.messagesFor(surface,conversationId)) {
      if (Number.isFinite(cutoff) && Date.parse(message.createdAt) <= cutoff) entries.push({createdAt:message.createdAt,messages:[{role:message.role,content:message.text}]});
    }
    return entries.sort((a,b) => (Date.parse(a.createdAt)||0)-(Date.parse(b.createdAt)||0)).flatMap(entry => entry.messages);
  }
}

function taskSurfaceId(surface){return 'desktop-'+surface;}
const messageDisplayKey=message=>({id:message.id,createdAt:message.createdAt,key:'message:'+message.id});
const compareMessageDisplayKeys=(a,b)=>a.createdAt<b.createdAt?-1:a.createdAt>b.createdAt?1:a.key<b.key?-1:a.key>b.key?1:0;
function messageDisplayBoundary(entries,key,after=false){
  let low=0,high=entries.length;
  while(low<high){const middle=(low+high)>>>1,comparison=compareMessageDisplayKeys(entries[middle],key);
    if(comparison<0||after&&comparison===0)low=middle+1;else high=middle;}
  return low;
}
function insertMessageDisplayKey(entries,entry){
  if(!entries.length||compareMessageDisplayKeys(entries.at(-1),entry)<0)entries.push(entry);
  else entries.splice(messageDisplayBoundary(entries,entry),0,entry);
}
