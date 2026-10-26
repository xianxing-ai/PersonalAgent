import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {createSnapshotPublisher} from '../electron/snapshot-publisher.js';
import {createHistoryPages,compareHistoryKeys} from '../electron/history-pages.js';
import {TaskProjectionCache,readSafeTaskProjection} from '../electron/task-projection-cache.js';

// Executes the production projection with synthetic host readbacks. This deliberately does not
// claim to measure SQLite, Electron IPC, DPAPI, a user mailbox, or a real provider.
export function projectionFixture({size, sourceRoot = new URL('../', import.meta.url), send = () => {}}) {
  const source = readFileSync(new URL('electron/main.js', sourceRoot), 'utf8');
  const optimized=source.includes('createSnapshotPublisher');
  const authoritative = new Map(), turns = new Map();
  for (let index = 0; index < size; index++) {
    const taskId = `synthetic-task-${index}`, surface = index % 4 === 0 ? 'workspace' : 'panel';
    const createdAt = new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString();
    authoritative.set(taskId, {taskId, conversationId: `desktop-${surface}`, state: index === size - 1 ? 'running' : 'succeeded',
      revision: 3, createdAt, updatedAt: createdAt, goal: 'Synthetic public benchmark input',
      steps: [{stepId: `step-${index}`, status: 'succeeded', label: 'Synthetic step'}], evidenceRefs: [],
      resultSummary: 'Synthetic response. '.repeat(40)});
    turns.set(taskId, {taskId, surface, conversationId: `desktop-${surface}`, createdAt, goal: 'Synthetic public benchmark input'});
  }
  const conversations = {turns, messages:new Map(), messageRevision:0, activeConversationId: surface => `desktop-${surface}`,
    conversationIdForTask: task => task.conversationId, goal: id => turns.get(id)?.goal,
    messagesFor: () => [], snapshot: surface => ({activeId: `desktop-${surface}`, sessions: [], draft: ''}),
    preference: () => ({depth: 1, fast: false})};
  let historyPages;
  const tasks=optimized?new TaskProjectionCache({pinned:()=>historyPages?.pinned()??new Set()}):authoritative;
  if(optimized)for(const [id,task] of authoritative)tasks.set(id,task);
  const sorted=[...authoritative.values()];
  historyPages=createHistoryPages({conversationId:surface=>surface?`desktop-${surface}`:undefined,
    readMessages:()=>conversations.messages,readRevision:()=>tasks.version,
    readTasks:({conversationId,limit,before,after})=>{
      const key=task=>({createdAt:task.createdAt,key:`task:${task.taskId}`});
      const selected=sorted.filter(task=>(!conversationId||task.conversationId===conversationId)&&(!before||compareHistoryKeys(key(task),before)<0)&&(!after||compareHistoryKeys(key(task),after)>0));
      return {items:after?selected.slice(0,limit):selected.slice(-limit),snapshotSequence:size,hasMore:selected.length>limit};
    },onTasks:items=>items.forEach(task=>tasks.set(task.taskId,task))});
  const globals = {console, structuredClone, tasks, historyPages, conversations, readSafeTaskProjection,taskGoals: new Map(),
    resourcePolicy:{snapshot:()=>({mode:'normal',fps:30,maxDpr:2,publishIntervalMs:16,maintenanceIntervalMs:120,revision:0})},
    conversationDelivery: {project: task => task}, taskSurface: task => turns.get(task.taskId)?.surface ?? 'panel',
    agentArtsSnapshot: () => undefined, taskResultMetadata: () => undefined, readReconciliationStatus: () => undefined,
    terminalTaskStates: new Set(['succeeded', 'failed', 'cancelled']), connectionLabel: 'ready',
    runtimeError: '', cloudRequestFailureNotice: '', cloudTransportNotice: '', fakeMode: true, fakeModelMode: true,
    pinned: false, adminNavigation: {}, audioLevel: 0, orbStateOverride: undefined,
    capabilities: [], health: [], capabilityDirectory: {}, approvals: new Map(), notifications: new Map(),
    competitionMode: true, model: {status: 'ready'}, thinking: {depth: 1, fast: false},
    featuredModelChoices: () => [], agentArtsModelSnapshot: model => model,
    readDesktopModelApiState: () => ({}), startupRecoveryStatus: {}, liveShortcut: {}, wakeQuitUnknown: false,
    proactiveSnapshot: () => ({}), p5StatusSnapshot: () => ({}), mailSnapshot: () => ({}),
    knowledgeStatus: {}, todoFailure: '', voiceQuestionForConversation: () => undefined,
    runtimeClosed: false, subagentWindows: new Map(), setImmediate, clearImmediate, setTimeout, clearTimeout};
  for (const name of ['authorizationQuestionHost', 'runtimeApplication', 'privateMemory', 'obsidianPairing',
    'memoryLearningHost', 'installedSkillsHost', 'remoteMcpHost', 'desktopHost', 'notificationApplicationHost',
    'voiceCommandHost', 'proactiveWorkflowApplication', 'agentArtsModels', 'harnessContextHost', 'harnessContextFailure',
    'harnessEventsHost', 'liveVoice', 'liveConfig', 'voiceStartupHost', 'wakeVoice', 'voiceInitializationFailure',
    'knowledgeWatchHost', 'calendarMeetingHost', 'calendarConfig', 'feedsHost', 'weatherCardHost', 'todoHost',
    'goalCloudHost', 'notepadHost', 'codingWorkspace', 'referenceHost', 'localLaya', 'knowledgeSourceConfig',
    'wikiSourceMonitor', 'voiceInput', 'sisConfigHost', 'microphoneCaptureHost', 'connectorChangeHost']) globals[name] = undefined;
  let publisher;
  const windows = ['orb', 'panel', 'admin', 'workspace'].map((mode, index) => {
    const win=new EventEmitter();Object.assign(win,{mode,isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false,webContents:new EventEmitter()});
    Object.assign(win.webContents,{id:index+1,isDestroyed:()=>false,send:(channel,value)=>{
      send(mode,channel,structuredClone(value));if(value.delivery)publisher.ack(win,value.delivery);
    }});return win;
  });
  for (const win of windows) globals[win.mode] = win;
  const context = vm.createContext(globals);
  if(optimized){publisher=createSnapshotPublisher({project:(surface,topics)=>context.projectWindowSnapshot(surface,topics),schedule:()=>1,cancel:()=>{},onError:error=>{throw error;}});
    globals.snapshotPublisher=publisher;
    for(const win of windows)publisher.attach(win,win.mode==='admin'?undefined:win.mode);}
  const extract = (start, end) => {
    const begin = source.indexOf(start), finish = source.indexOf(end, begin + start.length);
    if (begin < 0 || finish < 0) throw Error(`Production source boundary not found: ${start}`);
    return source.slice(begin, finish);
  };
  vm.runInContext(extract('function orderedTasks()', 'function privateMemoryController()'), context);
  vm.runInContext(extract('function visibleConversationTask(', 'function smoothAudioLevel('), context);
  vm.runInContext(extract('function publish(', 'function windowFor('), context);
  return {tasks,authoritative,turns,context,windows,snapshot:surface=>context.snapshot(surface),
    publish:()=>{context.publish(['tasks']);publisher?.flush();}};
}
