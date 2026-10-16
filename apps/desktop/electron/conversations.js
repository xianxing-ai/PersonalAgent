import {createHash,randomUUID} from 'node:crypto';
import {constants,copyFileSync,existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {resultText} from '../src/features/conversation/result-text.js';

// Desktop-owned metadata. Runtime still owns task state and results.
export class Conversations {
  constructor(file) {
    this.file = file;
    this.loadedVersion=4;
    this.turns = new Map();
    this.messages = new Map();
    this.preferences = new Map();
    this.sessions=new Map(['panel','workspace'].map(surface=>['desktop-'+surface,{id:'desktop-'+surface,surface,title:surface==='panel'?'原面板对话':'原工作区对话',archived:false,createdAt:new Date(0).toISOString(),draft:''}]));
    this.activeSessions={panel:'desktop-panel',workspace:'desktop-workspace'};
    if (file && existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      this.loadedVersion=data.version;
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
    }
  }
  validateSession(value){
    if(!value||typeof value!=='object'||Object.keys(value).some(k=>!['id','surface','title','archived','createdAt','draft'].includes(k))||!['panel','workspace'].includes(value.surface)||typeof value.id!=='string'||!(value.id==='desktop-'+value.surface||new RegExp('^desktop-'+value.surface+':[a-f0-9-]{36}$').test(value.id))||typeof value.title!=='string'||!value.title.trim()||value.title.length>100||/[\u0000-\u001f\u007f]/.test(value.title)||typeof value.archived!=='boolean'||!Number.isFinite(Date.parse(value.createdAt))||typeof value.draft!=='string'||value.draft.length>100000)throw Error('对话元数据无效');
    return value;
  }
  activeConversationId(surface){if(!['panel','workspace'].includes(surface))throw Error('对话窗口无效');return this.activeSessions[surface];}
  session(id,surface){const value=this.sessions.get(id);if(!value||surface&&value.surface!==surface)throw Error('对话不存在或不属于当前窗口');return {...value};}
  conversationIdForTask(task){return this.turns.get(task.taskId)?.conversationId??(this.sessions.has(task.conversationId)?task.conversationId:taskSurfaceId(this.surface(task.taskId)));}
  containsConversation(id){return this.sessions.has(id);}
  snapshot(surface){return {activeId:this.activeConversationId(surface),sessions:[...this.sessions.values()].filter(s=>s.surface===surface).map(({draft,...session})=>({...session})),draft:this.session(this.activeConversationId(surface)).draft};}
  saveSessions(sessions,activeSessions=this.activeSessions){this.save(this.turns,this.messages,this.preferences,sessions,activeSessions);this.sessions=sessions;this.activeSessions=activeSessions;}
  create(surface,title='新对话'){
    this.activeConversationId(surface);const value=this.validateSession({id:'desktop-'+surface+':'+randomUUID(),surface,title,archived:false,createdAt:new Date().toISOString(),draft:''});
    const sessions=new Map(this.sessions);sessions.set(value.id,value);this.saveSessions(sessions,{...this.activeSessions,[surface]:value.id});return {...value};
  }
  switch(surface,id){const value=this.session(id,surface);if(value.archived)throw Error('请先恢复已归档对话');this.saveSessions(new Map(this.sessions),{...this.activeSessions,[surface]:id});return value;}
  rename(surface,id,title){const value=this.validateSession({...this.session(id,surface),title});const sessions=new Map(this.sessions);sessions.set(id,value);this.saveSessions(sessions);return {...value};}
  archive(surface,id,archived=true){
    const value={...this.session(id,surface),archived};const sessions=new Map(this.sessions);sessions.set(id,value);let active={...this.activeSessions};
    if(archived&&active[surface]===id){let next=[...sessions.values()].find(s=>s.surface===surface&&!s.archived);if(!next){next=this.validateSession({id:'desktop-'+surface+':'+randomUUID(),surface,title:'新对话',archived:false,createdAt:new Date().toISOString(),draft:''});sessions.set(next.id,next);}active[surface]=next.id;}
    this.saveSessions(sessions,active);return {...value};
  }
  setDraft(surface,id,draft){const value=this.validateSession({...this.session(id,surface),draft});if(this.sessions.get(id).draft===draft)return;const sessions=new Map(this.sessions);sessions.set(id,value);this.saveSessions(sessions);}
  surface(taskId) { return this.turns.get(taskId)?.surface ?? 'panel'; }
  goal(taskId) { return this.turns.get(taskId)?.goal; }
  validatePreference(conversationId, input) {
    if (typeof conversationId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(conversationId)
      || !input || Object.keys(input).some(key => !['modelId','depth','fast','executionModel'].includes(key))
      || !Number.isInteger(input.depth) || input.depth < 0 || input.depth > 5 || typeof input.fast !== 'boolean'
      || (input.modelId !== undefined && (typeof input.modelId !== 'string' || input.modelId.length > 100
        || /[\u0000-\u001f\u007f]/.test(input.modelId)))) throw Error('对话模型或思考偏好无效');
    if(input.executionModel!==undefined && (!input.executionModel||typeof input.executionModel!=='object'||Array.isArray(input.executionModel)||!/^[a-f0-9]{64}$/.test(input.executionModel.catalogRevision)||typeof input.executionModel.modelId!=='string'||!input.executionModel.modelId||input.executionModel.modelId.length>200||Object.keys(input.executionModel).some(k=>!['catalogRevision','modelId','reasoningEffort'].includes(k))||input.executionModel.reasoningEffort!==undefined&&typeof input.executionModel.reasoningEffort!=='string'))throw Error('对话模型选择无效');
    return {...(input.executionModel?{executionModel:structuredClone(input.executionModel)}:{}),depth:input.depth,fast:input.fast,...(input.modelId ? {modelId:input.modelId} : {})};
  }
  preference(conversationId, fallback = {depth:1,fast:false}) {
    return {...(this.preferences.get(conversationId) ?? fallback)};
  }
  setPreference(conversationId, input) {
    const value = this.validatePreference(conversationId, input);
    const next = new Map(this.preferences);next.set(conversationId,value);
    this.save(this.turns,this.messages,next);this.preferences=next;
    return {...value};
  }
  add(taskId, surface, goal, conversationId=this.activeConversationId(surface)) {
    this.session(conversationId,surface);
    const turns = new Map(this.turns);
    turns.set(taskId, {taskId, surface, goal, conversationId, createdAt:new Date().toISOString()});
    this.save(turns, this.messages);
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
      this.save(this.turns, messages);
      this.messages = messages;
      return {...updated};
    }
    const messages = new Map(this.messages);
    messages.set(valid.id, valid);
    this.save(this.turns, messages);
    this.messages = messages;
    return {...valid};
  }
  messagesFor(surface,conversationId) {
    return [...this.messages.values()].filter(message => (surface === undefined || message.surface === surface)&&(!conversationId||message.conversationId===conversationId))
      .sort((a,b) => Date.parse(a.createdAt)-Date.parse(b.createdAt)).map(message => ({...message}));
  }
  save(turns, messages, preferences = this.preferences,sessions=this.sessions,activeSessions=this.activeSessions) {
    if (!this.file) return;
    mkdirSync(path.dirname(this.file), {recursive:true});
    const temporary = `${this.file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const content = JSON.stringify({version:4,sessions:[...sessions.values()],activeSessions,turns:[...turns.values()],messages:[...messages.values()],preferences:[...preferences]});
    if(this.loadedVersion<4&&existsSync(this.file)){
      const original=readFileSync(this.file,'utf8');const digest=createHash('sha256').update(original).digest('hex').slice(0,16);const backup=this.file+'.v'+this.loadedVersion+'-'+digest+'.bak';
      if(!existsSync(backup))copyFileSync(this.file,backup,constants.COPYFILE_EXCL);
      if(readFileSync(backup,'utf8')!==original)throw Error('原对话迁移备份未获确认，未覆盖历史');
    }
    writeFileSync(temporary, content, 'utf8');
    try {
      for(let attempt=0;;attempt++){
        try{renameSync(temporary,this.file);break;}catch(error){
          if(!existsSync(temporary)&&existsSync(this.file)&&readFileSync(this.file,'utf8')===content)break;
          if(!['EPERM','EBUSY'].includes(error.code)||attempt>=4)throw error;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
        }
      }
    } catch (err) {try{unlinkSync(temporary);}catch{}throw err;}
    this.loadedVersion=4;
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
