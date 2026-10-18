import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {createProactiveComposition} from './proactive-composition.js';
import {createDesktopGoalCognitionHost} from './goal-cognition-host.js';

// Desktop preferences and notification metadata only. Runtime owns every sample/task/approval.
export function createDesktopProactiveHost({application, client, userData, namespace,
  goalHost, chooser, cognitionReady, createCognitionHost, initialRequestMode,
  onUpdate = () => {}, onAnalysisTask = () => {}, now = Date.now}) {
  const file = path.join(userData, 'proactive-state.json');
  let stored = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {version: 1, cloudAnalysis: false, values: {}};
  if (stored.version !== 1 || typeof stored.values !== 'object' || !stored.values) throw Error('主动提醒状态无法读取');
  const write = next => {
    mkdirSync(userData, {recursive: true});
    const temporary = `${file}.tmp-${process.pid}`;
    writeFileSync(temporary, JSON.stringify(next), 'utf8'); renameSync(temporary, file); stored = next;
  };
  const factHost = application.createCompetitionFactHost({
    memoryPath: path.join(userData, 'proactive-public-memory.sqlite'),
    memoryNamespace: `${namespace}:proactive-public`, graphNamespace: namespace,
    consumerKey: 'desktop-proactive-public-v1',
  });
  let lease, pendingTaskId, busy = false, nextTick = 0, cloudAnalysis = false, status = 'disabled', reason = '请在设置中开启；采集和云分析许可不会跨应用重启恢复';
  const cloudAllowed = () => Boolean(lease && now() < Date.parse(lease.expiresAt) && cloudAnalysis);
  const composition = createProactiveComposition({application, client, factHost, now, conversationId: 'desktop-panel',
    cloudEnabled: cloudAllowed,
    storage: {get: key => structuredClone(stored.values[key]), set: (key, value) => write({...stored, values: {...stored.values, [key]: value}})},
  });
  const publish = () => {try {onUpdate();} catch {}};
  const cognition = createCognitionHost && createDesktopGoalCognitionHost({application,client,
    facts:factHost,namespace,goalHost,chooser,ready:cognitionReady,createHost:createCognitionHost,initialRequestMode,
    onTask:onAnalysisTask,onUpdate:publish,now});
  function observeAnalysis(item) {
    if (item.analysisTaskId) onAnalysisTask({taskId: item.analysisTaskId, goal: item.summary});
    publish();
  }
  async function analyze(id) {
    const item = await composition.analyze(id); observeAnalysis(item); return item;
  }
  const unsubscribe = composition.subscribe(item => {
    observeAnalysis(item);
    if (cloudAllowed() && item.kind === 'system_pressure' && !item.analysisState) {
      queueMicrotask(() => {if (cloudAllowed()) void analyze(item.id).catch(() => {
        reason = '异常已提醒，云端分析未完成；请查看对应任务状态'; publish();
      });});
    }
  });
  async function configure(input) {
    if(input && Object.keys(input).length===2 && Object.hasOwn(input,'goalAnalysis') && Object.hasOwn(input,'goalCloudAnalysis')) {
      if(typeof input.goalAnalysis!=='boolean' || typeof input.goalCloudAnalysis!=='boolean') throw Error('目标分析设置无效');
      if(!cognition) throw Error('目标分析尚未装配');
      cognition.configure({enabled:input.goalAnalysis,cloudAllowed:input.goalCloudAnalysis});
      publish();return snapshot();
    }
    if (!input || Object.keys(input).some(key => !['enabled', 'cloudAnalysis', 'goalAnalysis', 'goalCloudAnalysis'].includes(key))
      || typeof input.enabled !== 'boolean' || typeof input.cloudAnalysis !== 'boolean') throw Error('主动提醒设置无效');
    if ('goalAnalysis' in input || 'goalCloudAnalysis' in input) {
      if (typeof input.goalAnalysis!=='boolean' || typeof input.goalCloudAnalysis!=='boolean') throw Error('目标分析设置无效');
      if (!cognition && (input.goalAnalysis || input.goalCloudAnalysis)) throw Error('目标分析尚未装配');
      const previous=cognition?.snapshot();
      if (previous && (previous.enabled!==input.goalAnalysis || previous.cloudAllowed!==input.goalCloudAnalysis)) {
        cognition.configure({enabled:input.goalAnalysis,cloudAllowed:input.goalCloudAnalysis});
      }
    }
    if (lease && !input.enabled) {
      const old = lease; lease = undefined;
      application.stopSystemObservationSession(old.sessionId); composition.stop(); pendingTaskId = undefined;
    }
    cloudAnalysis = input.cloudAnalysis;
    if (input.enabled && !lease) {
      lease = application.startSystemObservationSession({expiresAt: new Date(now() + 8 * 60 * 60_000).toISOString(), intervalMs: 30_000});
      composition.start(); pendingTaskId = undefined; nextTick = 0;
    }
    status = lease ? 'monitoring' : 'disabled';
    reason = lease ? '仅观察 CPU / 内存；持续异常才提醒，关闭立即撤销。本次许可最长 8 小时。' : '已停止观察';
    publish(); return snapshot();
  }
  const snapshot = () => ({enabled: Boolean(lease), cloudAnalysis,
    status, reason, expiresAt: lease?.expiresAt, suggestions: composition.list(), cognition:cognition?.snapshot()});
  async function tick() {
    await cognition?.tick();
    if (!lease || busy || now() < nextTick) return;
    busy = true; nextTick = now() + 1000;
    try {
      if (Date.parse(lease.expiresAt) <= now()) {await configure({enabled: false, cloudAnalysis: false}); reason = '本次观察许可已到期，请重新开启'; return;}
      if (!pendingTaskId) {
        const result = application.sampleSystemObservationSession(lease.sessionId);
        if (result.sample) pendingTaskId = result.sample.task.taskId;
      }
      if (pendingTaskId) {
        const result = application.readHostToolTask(pendingTaskId);
        if (result.task.state === 'succeeded') {composition.acceptObservation(result); pendingTaskId = undefined; status = 'monitoring';}
        else if (['failed', 'cancelled', 'rejected'].includes(result.task.state)) {pendingTaskId = undefined; throw Error('采样未成功，已停止监控');}
        else if (result.task.state === 'waiting_approval') {status = 'waiting_approval'; reason = '系统观察正在等待有效授权';}
      }
      for (const item of composition.list()) {
        if (item.analysisTaskId && !['succeeded', 'failed', 'cancelled'].includes(item.analysisState)) composition.refresh(item.id);
      }
    } catch {
      const old = lease; lease = undefined; pendingTaskId = undefined;
      if (old) application.stopSystemObservationSession(old.sessionId);
      composition.stop(); status = 'error'; reason = '系统观察或授权已失效，已停止；请重新开启后查看状态';
    } finally {busy = false; publish();}
  }
  function stop() {
    cognition?.configure({enabled:false,cloudAllowed:false});
    const old = lease; lease = undefined; cloudAnalysis = false; pendingTaskId = undefined;
    if (old) application.stopSystemObservationSession(old.sessionId);
    composition.stop(); status = 'disabled'; reason = '已停止观察';
  }
  return {snapshot, configure, analyze, tick, stop,
    /** Host-only fixed public namespace; never exported through Renderer snapshots. */
    get publicMemory() {return factHost.publicMemory;},
    createPublicFactErasureApplication: options=>factHost.createPublicFactErasureApplication(options),
    readRepairBinding: taskId=>cognition?.readRepairBinding(taskId),
    readPreparedRepair: taskId=>cognition?.readPreparedRepair(taskId),
    applyCognitionDecision: id => {
      if (!cognition) throw Error('目标分析尚未装配');
      return cognition.applyDecision(id);
    },
    assertCognitionCloudSend:request=>cognition?.assertCloudSend(request),
    close() {stop(); cognition?.close(); unsubscribe(); factHost.close();},
  };
}
