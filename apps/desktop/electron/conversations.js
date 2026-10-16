import {existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {resultText} from '../src/features/conversation/result-text.js';

// Desktop-owned metadata. Runtime still owns task state and results.
export class Conversations {
  constructor(file) {
    this.file = file;
    this.turns = new Map();
    this.messages = new Map();
    this.preferences = new Map();
    if (file && existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      if (![1,2,3].includes(data.version) || !Array.isArray(data.turns) || (data.version >= 2 && !Array.isArray(data.messages))) throw Error('对话记录格式无法读取');
      if (data.version === 3) {
        if (!Array.isArray(data.preferences)) throw Error('对话偏好格式无法读取');
        for (const [conversationId, preference] of data.preferences) {
          this.preferences.set(conversationId, this.validatePreference(conversationId, preference));
        }
      }
      for (const turn of data.turns) {
        if (typeof turn.taskId === 'string' && ['panel','workspace'].includes(turn.surface) && typeof turn.goal === 'string') this.turns.set(turn.taskId, turn);
      }
      for (const message of data.messages ?? []) {
        const valid = this.validateLiveMessage(message);
        if (this.messages.has(valid.id)) throw Error('对话消息标识重复');
        this.messages.set(valid.id, valid);
      }
    }
  }
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
  add(taskId, surface, goal) {
    const turns = new Map(this.turns);
    turns.set(taskId, {taskId, surface, goal, createdAt:new Date().toISOString()});
    this.save(turns, this.messages);
    this.turns = turns;
  }
  validateLiveMessage(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message) ||
      Object.keys(message).some(key => !['id','sessionId','role','text','createdAt','surface'].includes(key)) ||
      !['id','sessionId'].every(key => typeof message[key] === 'string' && message[key].trim() && message[key].length <= 256) ||
      !['user','assistant'].includes(message.role) || typeof message.text !== 'string' || !message.text.trim() || message.text.length > 100000 ||
      typeof message.createdAt !== 'string' || !Number.isFinite(Date.parse(message.createdAt)) ||
      (message.surface !== undefined && message.surface !== 'panel')) throw Error('Live 对话消息格式无效');
    return {id:message.id,sessionId:message.sessionId,role:message.role,text:message.text.trim(),createdAt:new Date(message.createdAt).toISOString(),surface:'panel'};
  }
  addLiveMessage(message) {
    const valid = this.validateLiveMessage(message);
    const prior = this.messages.get(valid.id);
    if (prior) {
      if (prior.sessionId !== valid.sessionId || prior.role !== valid.role || prior.surface !== valid.surface) {
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
  messagesFor(surface) {
    return [...this.messages.values()].filter(message => surface === undefined || message.surface === surface)
      .sort((a,b) => Date.parse(a.createdAt)-Date.parse(b.createdAt)).map(message => ({...message}));
  }
  save(turns, messages, preferences = this.preferences) {
    if (!this.file) return;
    mkdirSync(path.dirname(this.file), {recursive:true});
    const temporary = `${this.file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const content = JSON.stringify({version:3,turns:[...turns.values()],messages:[...messages.values()],preferences:[...preferences]});
    writeFileSync(temporary, content, 'utf8');
    try {
      renameSync(temporary, this.file);
    } catch (err) {
      try {
        writeFileSync(this.file, content, 'utf8');
        try { unlinkSync(temporary); } catch {}
      } catch {
        try { unlinkSync(temporary); } catch {}
        throw err;
      }
    }
  }
  history(tasks, taskId) {
    const surface = this.surface(taskId);
    const entries = [];
    for (const task of tasks) {
      if (task.taskId === taskId) break;
      const goal = this.goal(task.taskId);
      if (!goal || this.surface(task.taskId) !== surface || task.state !== 'succeeded') continue;
      const answer = resultText(task.resultSummary);
      if (answer) entries.push({createdAt:this.turns.get(task.taskId)?.createdAt ?? task.createdAt,messages:[{role:'user',content:goal},{role:'assistant',content:answer}]});
    }
    const cutoff = Date.parse(this.turns.get(taskId)?.createdAt ?? '');
    for (const message of this.messagesFor(surface)) {
      if (Number.isFinite(cutoff) && Date.parse(message.createdAt) <= cutoff) entries.push({createdAt:message.createdAt,messages:[{role:message.role,content:message.text}]});
    }
    return entries.sort((a,b) => (Date.parse(a.createdAt)||0)-(Date.parse(b.createdAt)||0)).flatMap(entry => entry.messages);
  }
}
