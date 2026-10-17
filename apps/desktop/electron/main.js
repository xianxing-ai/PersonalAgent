import {handleConversationAction} from './conversation-actions.js';
import {featuredModelChoices} from './featured-model-choices.js';
import {reconcileTaskFromSurface} from './reconcile-task-action.js';
import {projectSubagentResult} from './subagent-result-projection.js';
import {app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, Notification, safeStorage, screen, session, Tray} from 'electron';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync} from 'node:fs';
import {EventCursor} from '@personal-agent/client';
import {register, requestTaskCancellation, submitConversationTask} from './runtime.js';
import {panelBounds, clampOrb, draggedGroupBounds} from './placement.js';
import {Conversations} from './conversations.js';
import {createDesktopHost} from './desktop-host.js';
import {desktopDataPaths} from './data-paths.js';
import {restoreSyntheticRepairSubmission} from './competition-repair-submission.js';
import {readCapabilityDirectory} from './capability-directory.js';
import {createMicrophonePermissionGate} from './microphone-permission.js';
import {readApprovalPage} from './approval-history.js';
import {createPrivateMemoryController} from './private-memory.js';
import {createPrivateMemoryConsumptionHost} from './private-memory-consumption-host.js';
import {createPrivateMemoryErasureHost} from './private-memory-erasure-host.js';
import {createPrivateMemoryBackupHost} from './private-memory-backups.js';
import {createLiveHistoryFileStore} from './live-history-file-store.js';
import {createMemoryLearningHost} from './memory-learning-host.js';
import {createKnowledgeSourceConfig} from './knowledge-source-config.js';
import {createDesktopObsidianPairing} from './obsidian-pairing-host.js';
import {createObsidianPairingUI} from './obsidian-pairing-ui.js';
import {createMicrophoneCaptureHost} from './microphone-capture-host.js';
import {createDesktopEvidenceHost, ownsDesktopReferenceSkillTask} from './evidence-host.js';
import {createDesktopCompetitionFactBridge} from './competition-fact-bridge.js';
import {createDesktopSisPlaybackHost} from './huawei-sis-playback.js';
import {createDesktopSisConfigHost} from './huawei-sis-config.js';
import {acquireHuaweiSisToken} from './huawei-iam-login.js';
import {createLiveVoiceConfig} from './live-voice-config.js';
import {createLiveVoiceHost} from './live-voice-host.js';
import {createDesktopWakeVoiceHost} from './wake-voice-host.js';
import {createDesktopProactiveHost} from './proactive-host.js';
import {createP5SystemObservationSource} from './p5-system-observation-source.js';
import {createP5DeviceReceiptStore} from './p5-device-receipt-store.js';
import {createP5DeviceNotificationHost} from './p5-device-notification-host.js';
import {createDesktopNotificationPort} from './desktop-notification-port.js';
import {createDesktopNotificationApplicationHost} from './notification-application-host.js';
import {createDesktopVoiceCommandHost} from './voice-command-host.js';
import {createDesktopProactiveWorkflowApplication} from './proactive-workflow-host.js';
import {createDesktopProactiveContextPorts} from './proactive-context-ports.js';
import {createKnowledgeWatchHost, createProductionKnowledgeReevaluator} from './knowledge-watch-host.js';
import {createPublicConnectorHost} from './public-connector-host.js';
import {createWorkspaceConfigHost} from './workspace-config-host.js';
import {createWorkspacePatchRecoveryHost} from './workspace-patch-recovery-host.js';
import {createDesktopReferenceHost} from './reference-tools-host.js';
import {createInstalledSkillsHost} from './installed-skills-host.js';
import {createRemoteMcpConfig} from './remote-mcp-config.js';
import {createDesktopRemoteMcpHost} from './remote-mcp-host.js';
import {createRemoteMcpManagement} from './remote-mcp-management.js';
import {createNativePublicReferenceConsent} from './public-reference-consent.js';
import {createWorkspaceCommandRecipeTool} from './workspace-command-recipes.js';
import {createAgentArtsModelSettings,refreshAgentArtsModelsOnStartup} from './agentarts-model-settings.js';
import {createAgentArtsConfig} from './agentarts-config.js';
import {createAgentArtsTransportConfig,agentArtsTransportNotice} from './agentarts-transport-config.js';
import {agentArtsModelSnapshot} from './agentarts-model-state.js';
import {agentArtsFailureNotice} from './agentarts-failure-notice.js';
import {createDeferredRuntimeStartup} from './runtime-startup.js';
import {createMailConfig} from './mail-config.js';
import {createCalendarConfig} from './calendar-config.js';
import {createModelApiConfig} from './model-api-config.js';
import {resolveRuntimeProfile} from './runtime-profile.js';
import {createDesktopCalendarMeetingHost,calendarConfigurationId,calendarApprovalResponse} from './calendar-meeting-host.js';
import {createDesktopMailAnalysisHost} from './mail-analysis-host.js';
import {createDesktopFeedsHost} from './feeds-host.js';
import {createDesktopNotepadHost} from './notepad-host.js';
import {createDesktopTodoHost} from './todo-host.js';
import {createDesktopGoalCloudHost} from './goal-cloud-host.js';
import {createMailMetadataStorage} from './mail-metadata-storage.js';
import {createLocalLayaHost} from './laya-local-host.js';
import {resultText,resultMetadata} from '../src/features/conversation/result-text.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(dir, '../src/app/index.html');
const fakeMode = process.argv.includes('--fake-runtime');
const fakeModelMode = process.argv.includes('--fake-model') || process.env.PA_DESKTOP_MODEL_MODE === 'fake';
const runtimeProfile = resolveRuntimeProfile({profile:process.env.PA_RUNTIME_PROFILE,fakeRuntime:fakeMode,fakeModel:fakeModelMode});
const agentArtsInvokeMode = process.env.PA_AGENTARTS_INVOKE_MODE === undefined
  ? 'published'
  : process.env.PA_AGENTARTS_INVOKE_MODE;
const competitionMode = !fakeMode && runtimeProfile === 'huawei_ict_agentarts';
const syntheticMvp = process.env.PA_DESKTOP_SYNTHETIC_MVP === '1';
const syntheticFactSource = process.env.PA_DESKTOP_SYNTHETIC_FACT_SOURCE === '1';
const agentArtsResponseMode = process.env.PA_AGENTARTS_RESPONSE_MODE;
const repairCandidateVersion = process.env.PA_AGENTARTS_REPAIR_CANDIDATE_VERSION;
const layaPort = process.env.PA_DESKTOP_LAYA_PORT;
const layaKey = process.env.PA_DESKTOP_LAYA_API_KEY;
if (fakeMode || fakeModelMode) app.setPath('userData', app.isPackaged
  ? path.join(app.getPath('temp'), `personal-agent-fake-${process.pid}`)
  : path.resolve(dir, '../.cache/user-data'));
if (process.env.PA_DESKTOP_EPHEMERAL_MODEL === '1') app.setPath('userData', app.isPackaged
  ? path.join(app.getPath('temp'), `personal-agent-test-${process.pid}`)
  : path.resolve(dir, `../.cache/test-user-data-${process.pid}`));
const userDataDirectory = process.env.PA_USER_DATA_DIR;
if (userDataDirectory !== undefined) {
  if (!userDataDirectory.trim() || !path.isAbsolute(userDataDirectory)) {
    throw Error('PA_USER_DATA_DIR 必须是明确的绝对目录');
  }
  app.setPath('userData', userDataDirectory);
} else if (process.env.PA_DESKTOP_TEST_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.PA_DESKTOP_TEST_USER_DATA));
}
const dataPaths = desktopDataPaths({electronDir: dir, userData: app.getPath('userData'),
  packaged: app.isPackaged, fakeRuntime: fakeMode, fakeModel: fakeModelMode,
  ephemeral: process.env.PA_DESKTOP_EPHEMERAL_MODEL === '1',
  userDataOverride: userDataDirectory !== undefined,
  testUserData: Boolean(process.env.PA_DESKTOP_TEST_USER_DATA)});

const ownsDesktopInstance = app.requestSingleInstanceLock();
if (!ownsDesktopInstance) app.quit();

let runtime;
let runtimeClosed = false;
let desktopHost;
let runtimeConnection;
let client;
let voiceConfigurationPending = false;
let eventCursor;
let eventPoll;
let eventBusy = false;
let orb;
let panel;
let admin;
let workspace;
let adminNavigation = {page: 'settings', revision: 0};
let tray;
let poll;
let pinned = false;
let dragging = false;
let orbDragRevision = 0;
let dragOffset;
let panelDragOrigin;
let away = 0;
let audioLevel = 0;
let levelDecay;
let lastVoiceLevelPublish = 0;
let orbStateOverride = null;
let connectionLabel = '未连接 Runtime';
let runtimeError = '';
let cloudRequestFailureNotice = '';
let cloudTransportNotice = '';
let capabilities = [];
let health = [];
let capabilityDirectory = {state: 'loading', reason: '正在读取 Runtime 能力目录'};
let capabilityReadRevision = 0;
const modelConfig = {
  baseUrl: process.env.PANGU_BASE_URL ?? '',
  model: process.env.PANGU_MODEL ?? 'pangu-nlp-n1-32k',
  deployment: process.env.PANGU_DEPLOYMENT ?? process.env.PANGU_MODEL ?? 'pangu-nlp-n1-32k',
  apiKey: process.env.PANGU_API_KEY ?? '',
};
const modelStorage = {persisted: false};
let model = {
  provider: 'pangu', label: '盘古大模型 2.0', status: 'unavailable', verification: 'conditional',
  baseUrl: modelConfig.baseUrl, model: modelConfig.model, deployment: modelConfig.deployment,
  configured: false, keyConfigured: Boolean(modelConfig.apiKey),
  capabilities: {text: true, streaming: false, toolCalling: false, structuredOutput: false, vision: false},
  persisted: false, enabled: false,
  reason: '盘古 Provider 已接入；请在“模型”页配置 Endpoint、模型和 API Key', lastTestAt: null, latencyMs: null,
};
if (competitionMode) {
  model = {
    ...model,
    provider: 'agentarts', label: 'AgentArts · Competition Profile', verification: 'unverified',
    baseUrl: '', model: 'AgentArts Runtime', deployment: process.env.PA_AGENTARTS_RUNTIME_NAME ?? '',
    keyConfigured: false,
    reason: 'Competition Runtime 尚未完成初始化；请检查可信主进程配置',
  };
}
let thinking = {depth: 1, fast: false, applied: false, reason: 'Runtime 尚未公开思考参数契约'};
const tasks = new Map();
const taskGoals = new Map();
let conversations;
const submitting = new Set();
const terminalTaskStates = new Set(['succeeded', 'failed', 'cancelled']);
const approvals = new Map();
const notifications = new Map();
let runtimeApplication;
let syntheticRepairHost;
const repairPrompts = new Set();
let microphonePermissionGate;
let privateMemory;
let privateConsumption, privateErasure, privateBackups;
const coordinationWatchInputs = new Map();
let memoryLearningHost,learningApplication,learningStore;
let installedSkillsHost;
let remoteMcpConfig,remoteMcpHost,remoteMcpManagement,remoteMcpClosing,remoteMcpClosed=false;
let microphoneCaptureHost;
let voicePcmSource;
let voiceInput;
let sisPlaybackHost;
let sisConfigHost;
let liveConfig;
let agentArtsConfig;
let agentArtsModels;
let activeCloudBinding;
let activeCloudTransportSignature;
const runtimeStartup = createDeferredRuntimeStartup({
  isConfigured: () => !competitionMode || agentArtsConfig?.snapshot().runtimeReady === true,
  initialize: initializeProductServices,
});
let liveVoice;
let wakeVoice;
let wakeQuitHandled = false;
let wakeQuitUnknown = false;
let wakeDisposal;
let panelHiding;
let liveShortcut = {key: 'F8', registered: false, reason: ''};
let lastLiveShortcutAt = 0;
let liveToggleRevision = 0;
let liveShortcutError;
let voiceInitializationFailure = null;
let voiceDisposed = false;
let voiceDisposal;
let voiceDisposalFailed = false;
let goalHost;
let goalCloudHost;
let competitionCatalog;
let competitionFactBridge;
let proactiveHost;
let p5Cognition;
let p5SystemObservationSource;
let p5DeviceReceiptStore;
let p5DeviceNotificationHost;
let notificationApplicationHost, voiceCommandHost, proactiveWorkflowApplication;
let p5DeviceTelemetrySubscription;
let p5UnavailableReason = '';
let p5RuntimeFailure = '';
let p5ReceiptFailure = '';
let p5DeviceFeedback = {state: 'unread', items: []};
let p5FeedbackReading = false;
let knowledgeWatchHost;
let admitNativeFeedInterest;
let modelApiHost;
let reviewedRepairLock = Promise.resolve();
function withReviewedRepairLock(work) {
  const result = reviewedRepairLock.then(work);
  reviewedRepairLock = result.catch(() => {});
  return result;
}
let productTools;
let codingWorkspace;
let referenceHost;
let referenceClosing;
let referenceClosed=false;
let knowledgeSourceConfig,knowledgeTools,wikiSourceMonitor,obsidianPairing;
let competitionToolAvailabilityList = [];
let mailConfig;
let calendarConfig;
let calendarMeetingHost;
let feedsHost;
let todoHost;
let todoFailure = '';
let todoClosing;
let todoClosed = false;
let notepadHost;
let publicReferenceConsent;
const publicSkillSources=new Map();
let notepadClosing;
let notepadClosed = false;
let mailHost;
let mailAnalysisHost;
let mailFailure = '';
let localLaya;
let knowledgeStatus = {configured: false, available: false, reason: '知识库尚未装配'};
let localServicesStopping = false;
let localServicesStopped = false;
let nextMailRefresh = 0;

function mailSnapshot() {
  const config = mailConfig?.snapshot() ?? {configured:false, status:'unconfigured', sessionAllowed:false};
  const host = mailHost?.snapshot();
  return {...host, ...config, status:host?.status === 'stop_unconfirmed' ? 'stop_unconfirmed'
    : mailFailure ? 'unavailable' : config.sessionAllowed ? host?.status ?? config.status : config.status,
    counts:host?.counts, analyses:mailAnalysisHost?.snapshot(), localModelReady:localLaya?.snapshot().ready === true,
    reason:host?.status === 'stop_unconfirmed' ? '已撤销新读取；现有邮箱连接退出尚未确认'
      : mailFailure || (config.sessionAllowed ? host?.reason ?? config.reason : config.reason)};
}

async function refreshMail() {
  if (!mailHost || Date.now() < nextMailRefresh) return;
  nextMailRefresh = Date.now() + 1000;
  const before = JSON.stringify(mailSnapshot());
  try {await mailHost.refresh();}
  catch {await mailHost.cancel(); mailFailure = '邮箱处理未完成，已停止读取；请重新配置或重启后恢复';}
  await mailAnalysisHost?.tick();
  if (JSON.stringify(mailSnapshot()) !== before) publish();
}

function taskSurface(task) {
  const registered = conversations?.turns.get(task.taskId)?.surface;
  if (registered) return registered;
  const owner=conversations?.sessions.get(task.conversationId);if(owner)return owner.surface;
  if (task.conversationId === 'desktop-panel') return 'panel';
  if (task.conversationId === 'desktop-workspace') return 'workspace';
  return undefined;
}

function voiceQuestionForConversation(conversationId){
  const question=voiceCommandHost?.snapshot();if(!question?.taskId)return question;
  const task=tasks.get(question.taskId);return task&&conversations?.conversationIdForTask(task)===conversationId?question:null;
}
function p5DevicePanelSuggestions() {
  if (!p5DeviceReceiptStore) return [];
  try {
    return p5DeviceReceiptStore.list().map(receipt => ({
      id: `p5-device-${receipt.id}`,
      kind: 'p5_device_anomaly',
      status: 'suggested',
      source: receipt.source,
      capturedAt: receipt.timestamp,
      summary: `${receipt.title}：${receipt.message}`,
      result: `Laya 建议：${receipt.advice}。本次 Runtime 已确认采样并保存 Evidence；${receipt.deliveryState === 'delivered'
        ? '桌面通知已展示' : receipt.deliveryState === 'failed' ? '桌面通知未投递'
          : receipt.deliveryState === 'pending' ? '桌面通知待确认' : '桌面通知结果未知，需核实'}，未执行系统调整。`,
    }));
  } catch {
    p5ReceiptFailure = 'P5 提醒记录无法读取';
    return [];
  }
}

async function refreshP5DeviceFeedback() {
  if (runtimeClosed || !p5Cognition || p5FeedbackReading) return;
  p5FeedbackReading = true;
  try {
    const records = await p5Cognition.readDeviceFeedback();
    if (runtimeClosed) return;
    p5DeviceFeedback = {state: 'available', items: records.map(({source, pendingDeliveryId, receipt}) => ({
      source, status: receipt?.status ?? 'unobserved', receiptId: receipt?.receiptId ?? null,
      deliveryNeedsReconciliation: Boolean(pendingDeliveryId), notificationDelivered: receipt?.notificationDelivered === true,
    }))};
  } catch {p5DeviceFeedback = {...p5DeviceFeedback, state: 'unavailable'};}
  finally {p5FeedbackReading = false; publish();}
}

async function reconcileDeviceDeliveries() {
  const service = p5Cognition?.deviceAnomalyService;
  if (!service || !p5DeviceReceiptStore) return;
  try {
    for (const pending of await service.readFeedback()) {
      if (!pending.pendingDeliveryId) continue;
      const receipt = p5DeviceReceiptStore.read(pending.pendingDeliveryId);
      if (receipt?.source === pending.source && ['delivered', 'failed'].includes(receipt.deliveryState)) {
        await service.reconcileDelivery(pending.source, pending.pendingDeliveryId, receipt.deliveryState === 'delivered');
      }
    }
    p5ReceiptFailure = '';
  } catch {p5ReceiptFailure = 'P5 通知回执核实未完成，保持待核实状态';}
  publish();
}

function p5StatusSnapshot() {
  const laya = localLaya?.snapshot() ?? {state: 'unavailable', reason: '本地 Laya 宿主尚未装配'};
  if (!p5Cognition) return {state: 'unavailable', ready: false,
    reason: p5UnavailableReason || 'P5 认知组合尚未装配'};
  const composition = p5Cognition.snapshot();
  let reason = [p5UnavailableReason, p5RuntimeFailure].filter(Boolean).join('；');
  if (p5ReceiptFailure) reason = [reason, p5ReceiptFailure].filter(Boolean).join('；');
  if (!composition.hasDeviceAnomalyService) reason = [reason, '设备异常决策端口不可用'].filter(Boolean).join('；');
  else if (!composition.hasNotificationPort || !p5DeviceReceiptStore) reason = [reason, '提醒回执存储不可用，设备通知未启用'].filter(Boolean).join('；');
  else if (!proactiveHost?.snapshot().enabled) reason = [reason, '请先在设置中开启本会话电脑状态监控'].filter(Boolean).join('；');
  else if (laya.state !== 'ready') reason = [reason, laya.reason || '请先启动本地 Laya'].filter(Boolean).join('；');
  else if (composition.state !== 'running' || !p5DeviceTelemetrySubscription) reason = [reason, 'P5 设备采样订阅尚未运行'].filter(Boolean).join('；');
  else reason = '已复用当前本地 Laya，正在处理已确认的本机采样；通知展示后才确认投递';
  const pendingDelivery = p5DeviceFeedback.items.some(item => item.deliveryNeedsReconciliation);
  if (composition.failures?.device) reason = `${reason}；设备分析未完成（${composition.failures.device}），未确认新提醒`;
  if (p5DeviceFeedback.state === 'unavailable') reason = `${reason}；设备持久反馈无法读回`;
  if (pendingDelivery) reason = `${reason}；设备通知结果待核实，不会重复发送`;
  const ready = Boolean(!p5UnavailableReason && !p5RuntimeFailure && !p5ReceiptFailure && !composition.failures?.device
    && p5DeviceFeedback.state === 'available' && !pendingDelivery && composition.state === 'running' && composition.hasDeviceAnomalyService
    && composition.hasNotificationPort && p5DeviceTelemetrySubscription && laya.state === 'ready');
  return {state: composition.state, ready, activeSubscriptionCount: composition.activeSubscriptionCount,
    hasDeviceAnomalyService: composition.hasDeviceAnomalyService,
    hasNotificationPort: composition.hasNotificationPort, deliveryNeedsReconciliation: pendingDelivery,
    feedback: structuredClone(p5DeviceFeedback), reason};
}

function proactiveSnapshot() {
  const base = proactiveHost?.snapshot() ?? {enabled: false, cloudAnalysis: false, status: 'disabled',
    reason: '主动观察尚未装配', suggestions: []};
  const deviceSuggestions = p5DevicePanelSuggestions();
  const p5 = p5StatusSnapshot();
  const p5DeviceStatus = {id: 'p5-device-status', kind: 'p5_status', status: p5.ready ? 'ready' : 'unavailable',
    summary: p5.ready ? 'P5 设备提醒已接入当前观察会话' : `P5 设备提醒不可用：${p5.reason}`};
  const suggestions = [...(base.suggestions ?? []), ...deviceSuggestions];
  if (proactiveHost && !p5.ready && base.enabled) suggestions.push(p5DeviceStatus);
  return {...base, p5, suggestions};
}

async function startP5DeviceTelemetry() {
  if (p5UnavailableReason || !p5Cognition || !p5SystemObservationSource || !p5DeviceReceiptStore
    || !proactiveHost?.snapshot().enabled || localLaya?.snapshot().state !== 'ready') return false;
  try {
    if (p5Cognition.snapshot().state !== 'running') await p5Cognition.start();
    await reconcileDeviceDeliveries();
    await refreshP5DeviceFeedback();
    if (!proactiveHost?.snapshot().enabled || localLaya?.snapshot().state !== 'ready') {
      await p5Cognition.stop();
      return false;
    }
    if (!p5DeviceTelemetrySubscription) {
      if (typeof p5Cognition.bindDeviceTelemetrySource !== 'function') {
        throw new Error('P5 telemetry subscription unavailable');
      }
      p5DeviceTelemetrySubscription = p5Cognition.bindDeviceTelemetrySource(p5SystemObservationSource);
    }
    p5RuntimeFailure = '';
    publish();
    return true;
  } catch {
    p5RuntimeFailure = 'P5 设备采样订阅启动失败';
    try { p5DeviceTelemetrySubscription?.unsubscribe?.(); } catch {}
    p5DeviceTelemetrySubscription = undefined;
    try { await p5Cognition.stop(); } catch {}
    publish();
    return false;
  }
}

async function stopP5DeviceTelemetry() {
  const subscription = p5DeviceTelemetrySubscription;
  p5DeviceTelemetrySubscription = undefined;
  p5DeviceNotificationHost?.stop?.();
  try {
    if (typeof subscription === 'function') subscription();
    else subscription?.unsubscribe?.();
  } catch { p5RuntimeFailure = 'P5 设备采样订阅释放未确认'; }
  try { await p5Cognition?.stop(); }
  catch { p5RuntimeFailure = 'P5 设备分析取消未确认'; }
}

async function tickProactiveP5() {
  await proactiveHost?.tick();
  if (proactiveHost?.snapshot().enabled && localLaya?.snapshot().state === 'ready') {
    if (!p5DeviceTelemetrySubscription) await startP5DeviceTelemetry();
  } else if (p5DeviceTelemetrySubscription || p5Cognition?.snapshot().state === 'running') {
    await stopP5DeviceTelemetry();
  }
}

function orderedTasks() {
  return [...tasks.values()].sort((a, b) => String(conversations?.turns.get(a.taskId)?.createdAt ?? a.createdAt ?? a.updatedAt ?? '')
    .localeCompare(String(conversations?.turns.get(b.taskId)?.createdAt ?? b.createdAt ?? b.updatedAt ?? '')));
}
function privateMemoryController() {
  if (!privateMemory) {
    mkdirSync(path.dirname(dataPaths.privateMemory), {recursive: true});
    privateMemory = createPrivateMemoryController(dataPaths.privateMemory, async details => {
      const originAdmin=admin;if(!originAdmin || originAdmin.isDestroyed())return false;
      const answer = await dialog.showMessageBox(originAdmin, {
        type: 'question', title: '确认私人记忆',
        message: details.previous ? '确认更正这条私人记忆？' : '确认保存这条私人记忆？',
        detail: `来源：${details.source.path}:${details.source.line}\n来源版本：${details.source.revision}\n摘录：${details.citation}\n\n拟保存：${details.summary}`,
        signal: details.signal,
        buttons: ['确认保存', '取消'], defaultId: 1, cancelId: 1, noLink: true,
      });
      return answer.response === 0 && admin===originAdmin && !originAdmin.isDestroyed();
    }, async current => {
      const originAdmin=admin;if(!originAdmin || originAdmin.isDestroyed())return false;
      const answer = await dialog.showMessageBox(originAdmin, {
        type: 'warning', title: '删除私人记忆', message: '删除这条私人记忆的全部版本？',
        detail: `当前摘要：${current.summary}\n来源：${current.sourceRef}\n同时清理应用管理的记忆数据库备份。整篇笔记写回备份保留；存在可能相关副本时，删除仍显示未完成。`,
        buttons: ['删除所有版本', '取消'], defaultId: 1, cancelId: 1, noLink: true,
      });
      return answer.response === 0 && admin===originAdmin && !originAdmin.isDestroyed();
    }, {knowledgeSource:()=>obsidianPairing?.memorySource, confirmWithdraw:async current=>{
      const originAdmin=admin;if(!originAdmin || originAdmin.isDestroyed())return false;
      const answer=await dialog.showMessageBox(originAdmin,{type:'question',title:'撤回私人记忆',
        message:'停止后续任务消费这条私人记忆？',detail:`版本 ${current.ref?.revision??current.revision}`,
        buttons:['撤回','取消'],defaultId:1,cancelId:1,noLink:true});
      return answer.response===0 && admin===originAdmin && !originAdmin.isDestroyed();
    },authorizeConsumption:async scope=>{
      if(!admin || admin.isDestroyed() || !runtimeApplication || !scope.taskId) return false;
      const originAdmin=admin,originApplication=runtimeApplication;
      const task=runtimeApplication.runtime.getTask(scope.taskId);
      if(task.cancelRequested || ['succeeded','failed','cancelled'].includes(task.state)) return false;
      const answer=await dialog.showMessageBox(originAdmin,{type:'question',title:'本次任务使用私人记忆',
        message:scope.destination==='agentarts'?'允许本次任务把所选记忆摘要发送给 AgentArts？':'允许本次任务使用所选记忆摘要？',
        detail:`任务：${scope.taskId}\n${scope.facts.map(f=>`版本 ${f.ref.revision}：${f.summary}`).join('\n')}`,
        buttons:['仅本次允许','取消'],defaultId:1,cancelId:1,noLink:true});
      if(answer.response!==0 || admin!==originAdmin || originAdmin.isDestroyed() || runtimeApplication!==originApplication)return false;
      const current=originApplication.runtime.getTask(scope.taskId);
      return !current.cancelRequested && !['succeeded','failed','cancelled'].includes(current.state);
    }});
  }
  return privateMemory;
}

function taskResultMetadata(task) {
  if (runtimeClosed || task.state!=='succeeded' || !runtimeApplication) return undefined;
  const source=runtimeApplication.runtime;
  return source.loadCheckpoint(task.taskId,'application-profile')==='huawei_ict_agentarts'
    ? resultMetadata(task.resultSummary,{profile:'huawei_ict_agentarts'}) : undefined;
}

function agentArtsSnapshot() {
  const value = agentArtsConfig?.snapshot();
  return value && {...value,effectiveTransport:process.env.PA_AGENTARTS_TRANSPORT??value.transport,transportSource:process.env.PA_AGENTARTS_TRANSPORT!==undefined?'environment':'saved', reason: cloudRequestFailureNotice || cloudTransportNotice || value.reason};
}

function visibleConversationTask(task,surface){return !surface||taskSurface(task)===surface&&conversations?.conversationIdForTask(task)===conversations?.activeConversationId(surface);}
function snapshot(surface) {
  const cloudSettings=agentArtsSnapshot();
  return {
    connection: connectionLabel,
    connectionError: runtimeError || cloudRequestFailureNotice || cloudTransportNotice,
    fakeModel: fakeModelMode,
    fake: fakeMode,
    pinned,
    adminNavigation: {...adminNavigation},
    audioLevel,
    orbStateOverride,
    subagentTasks:orderedTasks().filter(task=>visibleConversationTask(task,surface)).flatMap(task=>runtimeApplication?.readSubagentTasks?.(task.taskId)??[]),
    tasks: orderedTasks().filter(task=>visibleConversationTask(task,surface)).map(task => ({...structuredClone(task),
      resultMetadata:taskResultMetadata(task),
      createdAt: conversations?.turns.get(task.taskId)?.createdAt ?? task.createdAt ?? task.updatedAt,
      userMessage: taskGoals.get(task.taskId) ?? conversations?.goal(task.taskId),
      // UI summary is derived from trusted readback; TaskRuntime still owns state.
      ...(notepadHost?.projectTask(task) ?? {})})),
    messages: conversations?.messagesFor(surface,surface?conversations.activeConversationId(surface):undefined) ?? [],
    conversationState:surface?conversations?.snapshot(surface):undefined,
    surfaceBusy:surface?[...tasks.values()].some(task=>visibleConversationTask(task,surface)&&!terminalTaskStates.has(task.state)):false,
    conversation: surface ?? 'all',
    capabilities: structuredClone(capabilities),
    health: structuredClone(health),
    capabilityDirectory: {...capabilityDirectory},
    privateMemory: {available: competitionMode && Boolean(runtimeApplication),
      vaultSelected: obsidianPairing?.memorySource.snapshot().available===true, writeEnabled: memoryLearningHost?.snapshot().writeEnabled===true},
    memoryLearning:surface ? undefined : memoryLearningHost?.snapshot(),
    installedSkills:surface ? undefined : installedSkillsHost?.snapshot(),
    remoteMcp:surface ? undefined : remoteMcpHost?.snapshot(),
    approvals: [...approvals.values()].filter(approval=>!surface||tasks.has(approval.taskId)&&visibleConversationTask(tasks.get(approval.taskId),surface)),
    notifications: [...notifications.values(),...(todoHost?.snapshot().notifications ?? [])],
    notificationCenter: surface ? undefined : notificationApplicationHost?.snapshot(),
    voiceQuestion: surface?voiceQuestionForConversation(conversations?.activeConversationId(surface)):voiceCommandHost?.snapshot(),
    proactiveWorkflow: proactiveWorkflowApplication?.snapshot(),
    model: structuredClone(competitionMode?agentArtsModelSnapshot(model,cloudSettings):model),
    agentArtsModels:agentArtsModels?.snapshot(),
    modelApi: surface ? undefined : modelApiHost?.snapshot(),
    modelChoices: featuredModelChoices(agentArtsModels?.snapshot().catalog?.models,{selectedId:conversations?.preference(conversations?.activeConversationId(surface==='workspace'?'workspace':'panel'),thinking)?.modelId??''}),
    conversationPreference: conversations?.preference(conversations?.activeConversationId(surface==='workspace'?'workspace':'panel'),thinking),
    thinking: {...thinking,...(conversations?.preference(conversations?.activeConversationId(surface==='workspace'?'workspace':'panel'),thinking) ?? {}),
      reason:'本对话的步骤预算在提交时固定；AgentArts 负责主编排，辅助任务使用当前对话的模型选择。原生思考能力以模型设置和实际参数回执为准。'},
    live: {...(liveVoice?.snapshot() ?? liveConfig?.snapshot()), shortcut: {...liveShortcut}},
    wake: wakeQuitUnknown ? {...wakeVoice?.snapshot(),phase:'release_unconfirmed',verification:'unverified',
      reason:'唤醒音频释放未确认；本进程不能重新启用'} : wakeVoice?.snapshot()
      ?? {state:'disabled', phase:'unavailable', verification:'unverified',
        reason:voiceInitializationFailure?.message ?? '请先连接华为 SIS 语音；唤醒尚未开启'},
    proactive: proactiveSnapshot(),
    p5: p5StatusSnapshot(),
    knowledgeWatch: knowledgeWatchHost?.snapshot() ?? null,
    mail: mailSnapshot(),
    calendar: calendarMeetingHost?.snapshot() ?? calendarConfig?.snapshot(),
    feeds: feedsHost?.snapshot(),
    todo: todoHost?.snapshot() ?? {available:false,items:[],notifications:[],reason:todoFailure || '待办将在 Runtime 连接后可用'},
    goalCloud:goalCloudHost?.snapshot() ?? {available:false,sessionAllowed:false,reason:'目标工具将在 Runtime 连接后可用'},
    notepad: notepadHost?.snapshot() ?? {available:false,busy:false,state:'unavailable',
      reason:'本机执行组件尚未就绪，记事本操作暂不可用。'},
    coding: codingWorkspace?.snapshot() ?? {configured:false,reason:'编程工作区尚未装配'},
    reference:surface ? undefined : referenceHost?.snapshot(),
    agentArts: cloudSettings,
    laya: localLaya?.snapshot() ?? {state:'unavailable', ready:false, reason:'本地模型尚未装配'},
    knowledge: (obsidianPairing?.source ?? knowledgeSourceConfig)?.snapshot()??structuredClone(knowledgeStatus),
    knowledgeSource:surface ? undefined : knowledgeSourceConfig ? {...knowledgeSourceConfig.snapshot(),
      monitor:wikiSourceMonitor?.snapshot(),pairing:obsidianPairing?.snapshot()} : undefined,
    voice: voiceInput ? {...voiceInput.snapshot(), hostReady:true, experimental: sisConfigHost?.snapshot().configured,
      configuration: sisConfigHost?.snapshot()} : {available: false, status: voiceInitializationFailure ? 'error' : 'unconfigured',
      hostReady:false,
      reason: voiceInitializationFailure?.message ?? sisConfigHost?.snapshot().reason ?? 'SIS 尚未配置',
      failure: voiceInitializationFailure, configuration: sisConfigHost?.snapshot(),
      capture: microphoneCaptureHost?.snapshot() ?? {authorized: false, active: false, busy: false,
        subscriberCount: 0, lastRelease: {stopped: true, verified: false, reason: 'never_started'}}},
  };
}

function smoothAudioLevel(raw) {
  const numeric=Number(raw);const next=Number.isFinite(numeric)?Math.max(0,Math.min(1,numeric)):0;
  audioLevel = next > audioLevel ? audioLevel + (next - audioLevel) * 0.75 : audioLevel * 0.55 + next * 0.45;
}
function armLevelDecay() {
  clearTimeout(levelDecay);
  levelDecay = setTimeout(function decay() {
    audioLevel *= 0.75;
    if (audioLevel < 0.02) { audioLevel = 0; publishAudioLevel(); return; }
    publishAudioLevel();
    levelDecay = setTimeout(decay, 120);
  }, 180);
  levelDecay?.unref?.();
}
function noteMicLevel(value) { smoothAudioLevel(value); armLevelDecay(); publishAudioLevel(); }
function noteVoiceLevel(value) {
  smoothAudioLevel(value);
  armLevelDecay();
  publishAudioLevel();
}

function publishAudioLevel(){
  if(runtimeClosed)return;const nowMs=Date.now();if(nowMs-lastVoiceLevelPublish<40)return;lastVoiceLevelPublish=nowMs;
  const level=Number.isFinite(audioLevel)?Math.max(0,Math.min(1,audioLevel)):0;
  for(const win of [orb,panel,admin,workspace])if(win&&!win.isDestroyed())win.webContents.send('desktop:audio-level',level);
}
function publish() {
  if (runtimeClosed) return;
  for (const win of [orb, panel, admin, workspace]) {
    if (win && !win.isDestroyed()) win.webContents.send('desktop:update', snapshot(win === workspace ? 'workspace' : win === admin ? undefined : 'panel'));
  }
}

function windowFor(mode, bounds, options = {}) {
  const win = new BrowserWindow({...desktopHost.restore(mode, bounds), show: false, backgroundColor: '#00000000',
    webPreferences: {preload: path.join(dir, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      ...(mode === 'panel' ? {autoplayPolicy: 'no-user-gesture-required'} : {})}, ...options});
  win.setMenuBarVisibility(false);
  desktopHost.attach(win, mode);
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  win.webContents.on('will-navigate', event => {
    event.preventDefault();
    if (mode === 'panel') void stopPanelVoice().catch(reportPanelVoiceFailure);
  });
  if (mode === 'panel') {
    win.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
      if (mainFrame) void stopPanelVoice().catch(reportPanelVoiceFailure);
    });
    win.webContents.on('render-process-gone', () => {void stopPanelVoice().catch(reportPanelVoiceFailure);});
    win.webContents.on('destroyed', () => {void stopPanelVoice().catch(reportPanelVoiceFailure);});
  }
  if (mode === 'orb') {
    const invalidateDrag = () => {
      if (win !== orb) return;
      orbDragRevision++;
      if (dragging === true) dragging = false;
    };
    win.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {if (mainFrame) invalidateDrag();});
    win.webContents.on('render-process-gone', invalidateDrag);
    win.webContents.on('destroyed', invalidateDrag);
    win.on('closed', invalidateDrag);
  }
  let presented = false;
  const present = () => {
    if (presented || win.isDestroyed()) return;
    presented = true;
    if (['panel','admin','workspace'].includes(mode)) applyShape(win, mode === 'panel' ? 20 : 12);
    if (mode !== 'panel') win.show();
    publish();
  };
  // Applying a restored zoom during did-finish-load can prevent Electron from
  // emitting ready-to-show.  Loaded local pages are already safe to present,
  // so either lifecycle event may complete the one-shot presentation.
  win.webContents.once('did-finish-load', present);
  win.once('ready-to-show', present);
  win.loadFile(entry, {query: {mode}});
  return win;
}

/* roundedCorners 不会裁切透明窗口的实际区域，用窗口区域把整窗裁成圆角。 */
function roundedRects(width, height, radius) {
  const r = Math.min(radius, Math.floor(width / 2), Math.floor(height / 2));
  if (r <= 0) return [{x:0,y:0,width,height}];
  const rects = [
    {x: 0, y: r, width, height: height - 2 * r},
    {x: r, y: 0, width: width - 2 * r, height: r},
    {x: r, y: height - r, width: width - 2 * r, height: r},
  ];
  for (let y = 0; y < r; y += 1) {
    const dx = Math.round(r - Math.sqrt(Math.max(0, r * r - (y - r) * (y - r))));
    const bottom = height - y - 1;
    rects.push({x: dx, y, width: r - dx, height: 1}, {x: width - r, y, width: r - dx, height: 1});
    rects.push({x: dx, y: bottom, width: r - dx, height: 1}, {x: width - r, y: bottom, width: r - dx, height: 1});
  }
  return rects;
}

function applyShape(win, radius) {
  const bounds = win.getBounds();
  win.setShape(roundedRects(bounds.width, bounds.height, radius));
}

function placePanel(bounds) {
  const current = panel.getBounds();
  if (current.width === bounds.width && current.height === bounds.height) {
    panel.setPosition(bounds.x, bounds.y);
  } else {
    panel.setBounds(bounds);
  }
}

function openPanel(focus = false) {
  if (!orb || !panel || orb.isDestroyed() || panel.isDestroyed()) return;
  if (!focus && workspace && !workspace.isDestroyed() && workspace.isVisible()) return;
  placePanel(panelBounds(orb.getBounds(), screen.getDisplayMatching(orb.getBounds()).workArea));
  applyShape(panel, 20);
  if (focus) panel.show(); else panel.showInactive();
  away = 0;
}

function movePanelGroup(point) {
  if (!panelDragOrigin || !orb || !panel) return;
  const area = screen.getDisplayNearestPoint(point).workArea;
  const next = draggedGroupBounds(panelDragOrigin.orb, panelDragOrigin.pointer, point, area);
  // On Windows, setBounds() can expand a frameless non-resizable window to the
  // native minimum tracking size, leaving an invisible click-blocking area.
  // Dragging the orb must only change its position and preserve 112x112.
  orb.setPosition(next.orb.x, next.orb.y);
  placePanel(next.panel);
  applyShape(panel, 20);
}

function openAdmin(page) {
  if (page && ['settings','profile','models','tasks','capabilities','authorizations','git','connections','memory'].includes(page)) {
    adminNavigation = {page, revision:adminNavigation.revision + 1};
  }
  if (admin && !admin.isDestroyed()) { admin.show(); admin.focus(); publish(); return; }
  const area = screen.getDisplayMatching(orb.getBounds()).workArea;
  admin = windowFor('admin', {width: Math.min(1120, area.width), height: Math.min(760, area.height)},
    {title: 'PersonalAgent · 管理后台', frame: false, transparent: true, backgroundMaterial: 'none', roundedCorners: true, minWidth: 600, minHeight: 400});
  admin.once('ready-to-show', () => applyShape(admin, 12));
  admin.on('resize', () => applyShape(admin, 12));
  admin.on('closed', () => { admin = undefined; });
}

async function stopWakeVoice(dispose = false) {
  if (wakeQuitUnknown) throw Error('唤醒音频资源释放未确认');
  if (!wakeVoice) return;
  await (dispose ? wakeVoice.dispose() : wakeVoice.disable());
  if (wakeVoice.hasActive()) throw Error('唤醒音频资源释放未确认');
}

async function disposeWakeForQuit() {
  let timer;
  try {
    await Promise.race([stopWakeVoice(true), new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(Error('唤醒音频释放未确认')), 5000);
    })]);
  } catch {wakeQuitUnknown = true; reportPanelVoiceFailure();}
  finally {clearTimeout(timer);}
  // This marks only the quit attempt as handled, never physical release verified.
  wakeQuitHandled = true;
  app.quit();
}

function reportPanelVoiceFailure() {
  runtimeError = '语音资源释放未确认；请勿重新开启麦克风';
  publish();
}

async function stopPanelVoice() {
  const results = await Promise.allSettled([stopWakeVoice()]);
  if (voiceInput?.hasActive()) {
    results.push(...await Promise.allSettled([voiceInput.cancelCapture(panel?.webContents.id)]));
  }
  results.push(...await Promise.allSettled([
    liveVoice?.stop(), sisPlaybackHost?.stop(), microphoneCaptureHost?.revoke(),
  ]));
  if (results.some(result => result.status === 'rejected') || liveVoice?.hasActive()) throw Error('语音资源释放未确认');
  publish();
}

function hidePanel() {
  if (panelHiding) return panelHiding;
  panelHiding = (async () => {
    await stopWakeVoice();
    pinned = false;
    panel?.hide();
    publish();
  })().finally(() => {panelHiding = undefined;});
  return panelHiding;
}

function createTray() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="#090c10" stroke="#52c7bd" stroke-width="2"/><circle cx="16" cy="16" r="3" fill="#fff"/><circle cx="9" cy="11" r="1" fill="#fff"/><circle cx="23" cy="11" r="1" fill="#fff"/><circle cx="9" cy="21" r="1" fill="#fff"/><circle cx="23" cy="21" r="1" fill="#fff"/></svg>';
  try {
    tray = new Tray(nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`));
    tray.setToolTip('PersonalAgent');
    tray.setContextMenu(Menu.buildFromTemplate([
      {label: '打开悬浮面板', click: () => { pinned = true; openPanel(true); publish(); }},
      {label: '打开管理后台', click: () => openAdmin()},
      {label: '桌面设置与恢复', click: () => desktopHost.openSettings()},
      {type: 'separator'},
      {label: '退出 PersonalAgent', click: () => app.quit()},
    ]));
    tray.on('click', () => {
      if (panel?.isVisible()) { void hidePanel().catch(reportPanelVoiceFailure); }
      else { pinned = true; openPanel(true); publish(); }
    });
  } catch (error) {
    runtimeError = `托盘初始化失败：${error instanceof Error ? error.message : '未知错误'}`;
  }
}

function requiredModelText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw Error(`${name} 不能为空`);
  return value.trim();
}

function modelEndpoint(value) {
  const baseUrl = requiredModelText(value, '模型 Endpoint');
  let parsed;
  try { parsed = new URL(baseUrl); } catch { throw Error('模型 Endpoint 必须是有效的 http(s) 地址'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw Error('模型 Endpoint 只允许使用 http 或 https');
  return baseUrl.replace(/\/+$/, '');
}

function modelConfigPath() {
  return path.join(app.getPath('userData'), 'pangu-config.json');
}

function persistModelConfig() {
  if (process.env.PA_DESKTOP_EPHEMERAL_MODEL === '1') return {saved: false, reason: '联调测试模式不写入模型配置'};
  if (!safeStorage.isEncryptionAvailable()) {
    throw Error('系统加密存储不可用，无法安全保存 API Key；本次配置未写入磁盘');
  }
  const target = modelConfigPath();
  mkdirSync(path.dirname(target), {recursive: true});
  const temporary = `${target}.tmp-${process.pid}`;
  const payload = {
    version: 2,
    baseUrl: modelConfig.baseUrl,
    model: modelConfig.model,
    deployment: modelConfig.deployment,
    enabled: model.enabled,
    apiKey: safeStorage.encryptString(modelConfig.apiKey).toString('base64'),
  };
  writeFileSync(temporary, JSON.stringify(payload), {encoding: 'utf8'});
  renameSync(temporary, target);
  modelStorage.persisted = true;
  return {saved: true, reason: '配置已保存到本机加密存储'};
}

function restoreModelConfig() {
  if (process.env.PA_DESKTOP_EPHEMERAL_MODEL === '1') return;
  const target = modelConfigPath();
  if (!existsSync(target) || !safeStorage.isEncryptionAvailable()) return;
  try {
    const payload = JSON.parse(readFileSync(target, 'utf8'));
    if (![1, 2].includes(payload?.version) || typeof payload.apiKey !== 'string') return;
    const restoredKey = safeStorage.decryptString(Buffer.from(payload.apiKey, 'base64'));
    if (!modelConfig.baseUrl && typeof payload.baseUrl === 'string') modelConfig.baseUrl = payload.baseUrl;
    if (!process.env.PANGU_MODEL && typeof payload.model === 'string') modelConfig.model = payload.model;
    if (!process.env.PANGU_DEPLOYMENT && typeof payload.deployment === 'string') modelConfig.deployment = payload.deployment;
    if (!modelConfig.apiKey) modelConfig.apiKey = restoredKey;
    model.enabled = payload.enabled !== false;
    modelStorage.persisted = true;
  } catch {
    model = {...model, reason: '已找到保存的模型配置，但无法解密；请重新输入 API Key'};
  }
}

function runtimeTextOptions(state = model, config = modelConfig) {
  if (state.enabled === false) return {mode: 'unavailable', model: config.model};
  if (state.provider === 'fake') return {mode: 'fake'};
  if (state.configured && config.baseUrl && config.apiKey) {
    return {
      mode: 'pangu', baseUrl: config.baseUrl, model: config.model,
      deployment: config.deployment, apiKey: () => modelConfig.apiKey,
    };
  }
  return {mode: 'unavailable', model: config.model};
}

async function configurePangu(input, {publishState = true, persist = true} = {}) {
  const baseUrl = modelEndpoint(input?.baseUrl);
  const modelName = requiredModelText(input?.model, '模型名称');
  const deployment = requiredModelText(input?.deployment || modelName, '部署名称');
  const apiKey = typeof input?.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : modelConfig.apiKey;
  if (!apiKey) throw Error('API Key 未配置；密钥只会保留在主进程内存中');
  const previousConfig = {...modelConfig};
  const previousModel = model;
  modelConfig.baseUrl = baseUrl;
  modelConfig.model = modelName;
  modelConfig.deployment = deployment;
  modelConfig.apiKey = apiKey;
  let storage = {saved: modelStorage.persisted, reason: modelStorage.persisted ? '配置已从本机加密存储恢复' : '配置仅保留在本次运行'};
  try {
    const configuredDeployment = runtimeApplication.configureText(runtimeTextOptions({provider: 'pangu', configured: true, enabled: true}, modelConfig));
    model = {
      ...model,
      provider: 'pangu', label: '盘古大模型 2.0', status: 'configured', verification: configuredDeployment.verification,
      baseUrl, model: modelName, deployment, configured: true, keyConfigured: true, enabled: true,
      capabilities: structuredClone(configuredDeployment.capabilities),
    };
    if (persist) storage = persistModelConfig();
  } catch (error) {
    Object.assign(modelConfig, previousConfig);
    model = previousModel;
    try { runtimeApplication.configureText(runtimeTextOptions(previousModel, previousConfig)); } catch {}
    throw error;
  }
  model = {
    ...model,
    persisted: storage.saved,
    reason: `${storage.reason}，尚未发起真实连接测试`, lastTestAt: null, latencyMs: null,
  };
  if (publishState) publish();
  return structuredClone(model);
}

async function testPangu() {
  if (!runtimeApplication || runtimeApplication.deployment.provider !== 'pangu') throw Error('请先保存盘古模型配置');
  if (model.enabled === false) throw Error('模型已停用，请先启用');
  const controller = new AbortController();
  const started = Date.now();
  try {
    const result = await runtimeApplication.testTextConnection({signal: controller.signal});
    const latencyMs = Number.isFinite(result.latencyMs) ? result.latencyMs : Date.now() - started;
    model = {...model, status: 'ready', reason: `连接测试通过 · ${latencyMs}ms`, lastTestAt: new Date().toISOString(), latencyMs};
    publish();
    return structuredClone(model);
  } catch (error) {
    model = {...model, status: 'error', reason: error instanceof Error ? error.message : '盘古连接测试失败', lastTestAt: new Date().toISOString(), latencyMs: null};
    publish();
    throw error;
  }
}

async function openWorkspace() {
  await hidePanel();
  if (workspace && !workspace.isDestroyed()) { workspace.show(); workspace.focus(); publish(); return; }
  const area = screen.getDisplayMatching(orb.getBounds()).workArea;
  const width = Math.min(1280, area.width - 32), height = Math.min(820, area.height - 32);
  workspace = windowFor('workspace', {width, height, x: area.x + Math.round((area.width-width)/2), y: area.y + Math.round((area.height-height)/2)},
    {title: 'PersonalAgent · 工作区', frame: false, transparent: true, backgroundMaterial: 'none', roundedCorners: true, minWidth: Math.min(760,width), minHeight: Math.min(540,height)});
  workspace.once('ready-to-show', () => { applyShape(workspace, 12); workspace.focus(); });
  workspace.on('resize', () => applyShape(workspace, workspace.isMaximized() ? 0 : 12));
  workspace.on('closed', () => { workspace = undefined; });
}

function toggleModel(input) {
  if (!model.configured) throw Error('请先保存模型配置');
  const enabled = Boolean(input?.enabled);
  if (enabled === (model.enabled !== false)) return structuredClone(model);
  const previous = model;
  const next = {...model, enabled, status: enabled ? 'configured' : 'disabled', reason: enabled ? '模型已启用，请重新测试真实连接' : '模型已停用，不会用于新任务'};
  try {
    runtimeApplication.configureText(runtimeTextOptions(next));
    model = next;
    if (model.provider !== 'fake') persistModelConfig();
  } catch (error) {
    model = previous;
    try { runtimeApplication.configureText(runtimeTextOptions(previous)); } catch {}
    throw error;
  }
  publish();
  return structuredClone(model);
}

function updateThinking(input) {
  const depth = Number(input?.depth);
  if (!Number.isInteger(depth) || depth < 0 || depth > 5) throw Error('思考深度必须是 0 到 5');
  const fast = Boolean(input?.fast);
  if (runtimeApplication?.configureThinking) {
    const state = runtimeApplication.configureThinking({depth, fast});
    thinking = {depth: state.depth, fast: state.fast, applied: true, maxSteps: state.maxSteps, reason: state.reason};
  } else {
    thinking = {depth, fast, applied: false, reason: '已保存桌面测试设置，等待 Runtime 思考参数契约'};
  }
  publish();
  return structuredClone(thinking);
}

async function initializeModelFromEnvironment() {
  if (competitionMode) {
    model=agentArtsModelSnapshot(model,agentArtsConfig.snapshot());
    return;
  }
  if (fakeModelMode) {
    runtimeApplication.configureText({mode: 'fake'});
    model = {
      ...model,
      provider: 'fake', label: 'Fake Model · 离线测试', status: 'ready', verification: 'mock',
      configured: true, keyConfigured: false, persisted: false, enabled: true,
      capabilities: {text: true, streaming: false, toolCalling: false, structuredOutput: false, vision: false},
      reason: '显式 Fake Model 模式；不会调用真实 AI 或网络服务', lastTestAt: null, latencyMs: 0,
    };
    return;
  }
  if (!modelConfig.baseUrl || !modelConfig.apiKey) return;
  const shouldEnable = !modelStorage.persisted || model.enabled !== false;
  try {
    await configurePangu(modelConfig, {publishState: false, persist: false});
    if (!shouldEnable) {
      model = {...model, enabled: false, status: 'disabled', reason: '模型已停用，不会用于新任务'};
      runtimeApplication.configureText(runtimeTextOptions(model));
    }
  } catch (error) {
    model = {...model, status: 'error', reason: error instanceof Error ? error.message : '盘古配置无效'};
  }
}

async function refresh(taskId) {
  const task = await client.call('task.get', {taskId});
  const current = tasks.get(taskId);
  if (current?.taskId === task.taskId && current.revision > task.revision) return current;
  tasks.set(taskId, task);
  clearInactiveTaskExitWarning();
  publish();
  return task;
}

function clearInactiveTaskExitWarning() {
  if (runtimeError === 'Runtime 仍有活动任务；请先等待完成或停止任务后再退出'
    && [...tasks.values()].every(task => terminalTaskStates.has(task.state))) {
    runtimeError = '';
  }
}

const inFlightRechecks = new Set();
function dispatchKnowledgeFeedCheckTask(task) {
  if (!knowledgeWatchHost || !runtimeApplication || task?.state !== 'created') return;
  return runtimeApplication.dispatchKnowledgeFeedCheckTask(task.taskId,{namespace:desktopHost.userNamespace,
    readBinding:()=>knowledgeWatchHost.getFeedCheckContext(task.taskId),
    consume:signal=>knowledgeWatchHost.consumeFeedCheck(task.taskId,{signal})});
}
let lastKnowledgeScheduleTick=0;
function tickKnowledgeSchedules() {
  if (!knowledgeWatchHost || !runtimeApplication || Date.now()-lastKnowledgeScheduleTick<1000) return;
  lastKnowledgeScheduleTick=Date.now();
  for (const fired of runtimeApplication.runtime.dispatchDueSchedules(`knowledge-watch:${desktopHost.userNamespace}`)) {
    if (fired.task) void dispatchKnowledgeFeedCheckTask(fired.task);
  }
}
async function dispatchKnowledgeRecheckTask(task) {
  if (!task || inFlightRechecks.has(task.taskId) || task.state !== 'created') return;
  const conversationId = task.conversationId;
  const goal = task.goal;
  if (!conversationId?.startsWith('knowledge-watch:') || !goal?.startsWith('RECHECK ')) return;
  inFlightRechecks.add(task.taskId);
  try {
    const workKey = task.idempotencyKey;
    const recheck = typeof knowledgeWatchHost?.getRecheckContext === 'function'
      ? knowledgeWatchHost.getRecheckContext(workKey)
      : null;
    if (!recheck || !recheck.sourceId || !recheck.observedRevision) return;
    await runtimeApplication.dispatchKnowledgeRecheckTask(task.taskId, {
      workKey,
      namespace: recheck.namespace,
      topicId: recheck.topicId,
      consumerRevision: recheck.consumerRevision,
      sourceId: recheck.sourceId,
      boundRevision: recheck.boundRevision,
      boundContentSha256: recheck.boundContentSha256,
      boundCacheVersion: recheck.boundCacheVersion,
      boundLastSuccessfulCheck: recheck.boundLastSuccessfulCheck,
      boundValidUntil: recheck.boundValidUntil,
      observedRevision: recheck.observedRevision,
      observedContentSha256: recheck.observedContentSha256,
      observedAt: recheck.observedAt,
      citation: recheck.citation,
      sourceReadTaskId: recheck.sourceReadTaskId,
      sourceReadReceiptId: recheck.sourceReadReceiptId,
      summary: recheck.summary,
      revalidateCurrent: () => knowledgeWatchHost?.getRecheckContext(workKey) ?? null,
      reevaluator: createProductionKnowledgeReevaluator({layaChooser: localLaya}),
    });
  } catch (error) {
    console.error('dispatchKnowledgeRecheckTask failed:', error);
  } finally {
    inFlightRechecks.delete(task.taskId);
  }
}

function applyEvent(event) {
  if (event.type === 'notification.created' && event.payload) notifications.set(event.payload.notificationId, {...event.payload,occurredAt:event.occurredAt});
  if (event.taskId && event.payload && ['task.created', 'task.state_changed', 'task.completed', 'task.failed', 'task.cancelled'].includes(event.type)) {
    const current = tasks.get(event.taskId);
    if (!(current?.taskId === event.payload.taskId && current.revision > event.payload.revision)) {
      tasks.set(event.taskId, structuredClone(event.payload));
      clearInactiveTaskExitWarning();
    }
    if (event.type === 'task.created' && event.payload.conversationId?.startsWith('knowledge-watch:')
      && event.payload.goal?.startsWith('RECHECK ')) {
      void dispatchKnowledgeRecheckTask(event.payload);
    }
    if (event.type === 'task.created') void dispatchKnowledgeFeedCheckTask(event.payload);
  }
  if (event.type === 'approval.requested' && event.payload) approvals.set(event.payload.approvalId, structuredClone(event.payload));
  if (event.type === 'task.cancelled' && event.payload?.taskId) {
    for (const [id, approval] of approvals) if (approval.taskId === event.payload.taskId) approvals.delete(id);
  }
}

async function pumpEvents() {
  if (eventBusy || !client || !runtimeConnection?.readEvents || !eventCursor) return;
  eventBusy = true;
  try {
    const afterSequence = eventCursor.afterSequence;
    await client.call('event.subscribe', {streamId: 'tasks', afterSequence});
    const events = await runtimeConnection.readEvents(afterSequence);
    const accepted = eventCursor.accept(events);
    for (const event of accepted) {
      applyEvent(event);
      if (event.type === 'task.completed' && p5DeviceTelemetrySubscription
        && p5Cognition?.snapshot().state === 'running' && proactiveHost?.snapshot().enabled) {
        p5SystemObservationSource?.publishCompletedTask(event.taskId);
      }
      if (event.type === 'task.completed' && syntheticRepairHost && repairCandidateVersion === '1.0') {
        void promptSyntheticRepairCandidate(event.taskId).catch(() => {
          runtimeError = '本地修复预览未能显示；计划未被自动修改'; publish();
        });
      }
      if (event.type === 'approval.requested') {
        const result = await client.call('approval.list', {approvalId: event.payload.approvalId, limit: 1});
        if (result.items[0]) approvals.set(event.payload.approvalId, structuredClone(result.items[0]));
      }
    }
    const progressTaskIds = new Set(accepted.filter(event => event.type === 'task.progress' && event.taskId).map(event => event.taskId));
    const progressReadbacks = await Promise.allSettled([...progressTaskIds].map(taskId => refresh(taskId)));
    const failedProgressReadback = progressReadbacks.find(result => result.status === 'rejected');
    if (failedProgressReadback) throw failedProgressReadback.reason;
    if (accepted.length) publish();
  } catch (error) {
    runtimeError = error instanceof Error ? error.message : '事件流读取失败';
    publish();
  } finally {
    eventBusy = false;
  }
}

async function syncCapabilities() {
  const revision = ++capabilityReadRevision;
  capabilityDirectory = {state: 'loading', reason: '正在读取 Runtime 能力目录'};
  capabilities = [];
  health = [];
  publish();
  const result = await readCapabilityDirectory(client);
  if (revision !== capabilityReadRevision) return;
  capabilities = result.manifests;
  health = result.health;
  capabilityDirectory = result.status;
}

async function syncRuntimeSnapshots() {
  tasks.clear(); approvals.clear();
  let beforeSequence;
  let snapshotSequence;
  do {
    const page = await client.call('task.list', {limit: 100, ...(beforeSequence ? {beforeSequence} : {}), ...(snapshotSequence === undefined ? {} : {snapshotSequence})});
    snapshotSequence = page.snapshotSequence;
    for (const task of page.items) { tasks.set(task.taskId, structuredClone(task)); if (task.goal) taskGoals.set(task.taskId, task.goal); }
    beforeSequence = page.nextBeforeSequence;
  } while (beforeSequence);
  const pending = await client.call('approval.list', {state: 'pending', limit: 100});
  for (const approval of pending.items) approvals.set(approval.approvalId, structuredClone(approval));
  eventCursor.reset(snapshotSequence ?? 0);
  for (const task of tasks.values()) {
    if (task.state === 'created') void dispatchKnowledgeFeedCheckTask(task);
    if (task.state === 'created' && task.conversationId?.startsWith('knowledge-watch:') && task.goal?.startsWith('RECHECK ')) {
      void dispatchKnowledgeRecheckTask(task);
    }
  }
}

async function promptSyntheticRepairCandidate(taskId) {
  if (!syntheticRepairHost || !runtimeApplication || repairPrompts.has(taskId)) return;
  repairPrompts.add(taskId);
  try {
    if (runtimeApplication.runtime.loadCheckpoint(taskId, 'mvp-repair-submitted')) return;
    const candidate = runtimeApplication.readRepairCandidate(taskId);
    if (!candidate) return;
    const source = syntheticRepairHost.readBinding(taskId);
    if (!source || source.binding.graphRevision !== candidate.candidate.expectedGraphRevision) return;
    const idempotencyKey = createHash('sha256').update(taskId + ':' + source.evidenceId).digest('hex');
    const prior = restoreSyntheticRepairSubmission(runtimeApplication, syntheticRepairHost,
      taskId, source, candidate, idempotencyKey);
    if (prior) { await refresh(prior.taskId); return; }
    const lines = candidate.candidate.changes.map(item =>
      `${item.node.id}#${item.node.revision} → ${item.summary}\n原因：${item.reason}\n依赖：${item.dependencies.map(dep => `${dep.id}#${dep.revision}`).join(', ')}`);
    const options = {
      type: 'question', title: '合成会议计划修复预览',
      message: 'AgentArts 提供了未验证的计划修复候选',
      detail: `当前图版本 ${source.binding.graphRevision}；候选涉及：\n${lines.join('\n')}\n\n确认后仅创建独立的本地审批任务，写入仍需通过 Policy 的一次性批准。`,
      buttons: ['创建本地审批任务', '暂不执行'], defaultId: 1, cancelId: 1, noLink: true,
    };
    const answer = panel && !panel.isDestroyed()
      ? await dialog.showMessageBox(panel, options) : await dialog.showMessageBox(options);
    if (answer.response !== 0) return;
    if (runtimeApplication.runtime.loadCheckpoint(taskId, 'mvp-repair-submitted')) return;
    const concurrent = restoreSyntheticRepairSubmission(runtimeApplication, syntheticRepairHost,
      taskId, source, candidate, idempotencyKey);
    if (concurrent) { await refresh(concurrent.taskId); return; }
    const repair = runtimeApplication.submitLocalRepair({sourceTaskId: taskId,
      evidenceId: source.evidenceId, idempotencyKey,
      deadline: new Date(Date.now() + 10 * 60_000).toISOString()});
    runtimeApplication.runtime.saveCheckpoint(taskId, 'mvp-repair-submitted', {taskId: repair.taskId});
    await refresh(repair.taskId);
  } finally { repairPrompts.delete(taskId); }
}

async function readDesktopConversationContext(scope) {
  if (!conversations?.containsConversation(scope.conversationId)) {
    if(scope.taskId)coordinationWatchInputs.set(scope.taskId,'[]');return [];
  }
  const task=scope.taskId ? runtimeApplication.runtime.getTask(scope.taskId) : undefined;
  const cutoff=conversations.turns.get(scope.taskId)?.createdAt ?? task?.createdAt ?? task?.updatedAt ?? new Date().toISOString();
  const surface=conversations.session(scope.conversationId).surface;
  const messages=[...conversations.messagesFor(surface,scope.conversationId),...(liveVoice?.historyMessages({...scope,cutoff}) ?? [])]
    .filter(message=>Date.parse(message.createdAt)<=Date.parse(cutoff))
    .map(message=>({id:message.id,role:message.role,content:message.text}));
  let context=runtimeApplication.readConversationContext({...scope,historyMessages:messages});
  if(installedSkillsHost)context=installedSkillsHost.filterContext(context);
  const current=(knowledgeWatchHost?.dialogueProjection?.()?.items ?? [])
    .filter(item=>item.usableAsCurrentFact === true && item.answer?.kind === 'current_fact');
  if(scope.taskId)coordinationWatchInputs.set(scope.taskId,JSON.stringify(current));
  if(current.length)context.push({id:'knowledge-watch-current',role:'assistant',
    content:JSON.stringify({treatment:'untrusted_public_facts',items:current})});
  return context.slice(-20);
}

async function initializeInstalledSkills() {
  if(competitionMode && !installedSkillsHost) {
    const {openLocalSkillStore}=await import('@personal-agent/skills');
    installedSkillsHost=createInstalledSkillsHost({
      store:openLocalSkillStore(path.join(app.getPath('userData'),'installed-skills.json')),onUpdate:publish,
      readParentTaskId:taskId=>runtimeApplication?.runtime.loadCheckpoint(taskId,'subtask-parent')?.parentTaskId,
      validateRunInput:async publicGoal=>{
        const {compileCoordinationGoal}=await import('@personal-agent/runtime/application');
        const context=await readDesktopConversationContext({conversationId:conversations.activeConversationId('workspace'),
          deadline:new Date(Date.now()+180000).toISOString(),signal:new AbortController().signal});
        compileCoordinationGoal(publicGoal,publicGoal,context);
      },
      selectDirectory:async()=>{
        const result=await dialog.showOpenDialog(admin,{title:'选择包含 SKILL.md 的 Skill 文件夹',properties:['openDirectory']});
        return result.canceled?undefined:result.filePaths[0];
      },
      confirm:async request=>{
        const origin=admin,application=runtimeApplication;
        if(!origin || origin.isDestroyed()) return false;
        const actions={install:'安装 Skill',enable:'启用 Skill',uninstall:'卸载 Skill',run:'仅本任务使用 Skill'};
        const answer=await dialog.showMessageBox(origin,{type:request.action==='uninstall'?'warning':'question',
          title:actions[request.action],message:`${actions[request.action]}：${request.name}`,
          detail:`SHA256：${request.digest}\n${request.detail}`,buttons:['取消','确认'],defaultId:0,cancelId:0,noLink:true});
        return answer.response===1 && origin===admin && !origin.isDestroyed() && application===runtimeApplication;
      }});
  }
}

async function initializeRuntime() {
  const runtimeModule = await import('@personal-agent/runtime/application');
  const {createRuntimeApplication} = runtimeModule;
  let readEvents;
  if (!['local', 'huawei_ict_agentarts'].includes(runtimeProfile)) {
    throw Error('PA_RUNTIME_PROFILE 只允许 local 或 huawei_ict_agentarts');
  }
  if (!fakeMode && fakeModelMode && runtimeProfile === 'huawei_ict_agentarts') {
    throw Error('Competition Profile 不能与 fake-model 同时启用；不会静默切换到 Local 或真实云端');
  }
  if (syntheticMvp && (!competitionMode || app.isPackaged)) {
    throw Error('合成 MVP 工具只允许显式 Competition 开发验收，不适用于 Local/Fake 或安装包');
  }
  if (agentArtsResponseMode !== undefined && !['text', 'tool-proposal-json'].includes(agentArtsResponseMode)) {
    throw Error('PA_AGENTARTS_RESPONSE_MODE 只允许 text 或 tool-proposal-json');
  }
  if (repairCandidateVersion !== undefined && (repairCandidateVersion !== '1.0'
    || !competitionMode || (agentArtsResponseMode ?? 'tool-proposal-json') !== 'tool-proposal-json')) {
    throw Error('版本化修复候选需要 Competition JSON 模式');
  }
  if ((layaPort !== undefined || layaKey !== undefined)
    && (!syntheticMvp || !layaPort || !layaKey || !/^\d+$/.test(layaPort))) {
    throw Error('本地 Laya 判断只允许显式合成 MVP 配置并要求回环端口及密钥');
  }
  if (fakeMode) {
    const {FakeRuntime} = await import('@personal-agent/testkit');
    runtime = new FakeRuntime({mode: 'test', scenario: 'success'});
    runtimeApplication = createRuntimeApplication({
      path: dataPaths.runtime,
      text: {mode: 'unavailable', model: modelConfig.model},
    });
    if (runtimeApplication?.configureThinking) {
      const state = runtimeApplication.configureThinking({depth: thinking.depth, fast: thinking.fast});
      thinking = {depth: state.depth, fast: state.fast, applied: true, maxSteps: state.maxSteps, reason: state.reason};
    }
    readEvents = after => runtime.readEvents('tasks', after);
  } else {
    const dbPath = dataPaths.runtime;
    mkdirSync(path.dirname(dbPath), {recursive: true});
    if (competitionMode) {
      const cloudBinding=agentArtsConfig.runtimeBinding();
      if (!cloudBinding) throw Error(agentArtsConfig.snapshot().reason);
      activeCloudBinding = cloudBinding;
      feedsHost?.prepare();
      const syntheticTools = syntheticMvp
        ? (await import('./competition-synthetic-workspace.js')).createSyntheticMeetingToolset(
          path.resolve(dir, '../../../tests/manual/agentarts/fixtures/mvp-meeting'),
          (...args) => syntheticRepairHost.projectConfirmed(...args))
        : {};
      if (syntheticMvp) {
        const cognitionModule = layaPort ? await import('@personal-agent/cognition') : undefined;
        const decision = layaPort ? (() => {
          const {ProactiveDecisionService, LayaDecisionModel, LocalLayaHttpTransport} = cognitionModule;
          return new ProactiveDecisionService(new LayaDecisionModel(
            new LocalLayaHttpTransport(Number(layaPort), () => layaKey)));
        })() : undefined;
        syntheticRepairHost = (await import('./competition-repair-host.js')).createSyntheticRepairHost(
          path.join(path.dirname(dbPath), 'mvp-synthetic-memory.sqlite'), {decision});
      }
      const {createGoalHost} = await import('./goal-host.js');
      const {createWorkspaceReadTool,createWorkspaceCommandTool} = await import('@personal-agent/coding-tools');
      const {createDesktopCompetitionToolCatalog} = await import('./competition-tool-catalog.js');
      const namespace = desktopHost.userNamespace;
      if (!syntheticMvp) {
        const channel = createDesktopNotificationPort({storageDir: app.getPath('userData'),
          onOutcome: outcome => notificationApplicationHost?.receipt(outcome)});
        notificationApplicationHost = createDesktopNotificationApplicationHost({namespace, channel, onUpdate: publish});
      }
      goalHost = createGoalHost(namespace);
      if (!syntheticMvp && calendarConfig) {
        const calendarReadTool = runtimeModule.createCalendarEventReadTool({
          getBinding: () => {
            const binding = calendarConfig.binding();
            return binding ? {configurationId: calendarConfigurationId(binding), accountRef: binding.accountRef,
              calendarUrl: binding.calendarUrl, calendarName: binding.calendarName} : undefined;
          },
          readAuthorization: request => {
            const binding = calendarConfig.binding();
            if (!binding || calendarConfigurationId(binding) !== request.configurationId) throw Error('日历配置已变更或撤销');
            return calendarConfig.readAuthorization(binding);
          },
        });
        calendarMeetingHost = createDesktopCalendarMeetingHost({config: calendarConfig, namespace,
          readTool: calendarReadTool, readArguments: (binding,externalId) => ({configurationId:calendarConfigurationId(binding),externalId}),
          onUpdate: publish});
      }
      if (!syntheticMvp) goalCloudHost = createDesktopGoalCloudHost({goalHost, namespace,
        readProactiveBinding: taskId => proactiveHost?.readRepairBinding?.(taskId)});
      if (!syntheticMvp) {
        try {todoHost = createDesktopTodoHost({userData:app.getPath('userData'),safeStorage,namespace,
          notificationHost:notificationApplicationHost,
          createDeliveryHost:runtimeModule.createReminderDeliveryHost,onUpdate:publish,
          onNotification:async item=>{
            if (!item.batchId) return;
            return notificationApplicationHost.deliverBatch({batchId:item.batchId,
              scope:{kind:'connector',connectorId:'productivity'},expiresAt:new Date(Date.now()+30_000).toISOString(),
              title:'PersonalAgent 待办提醒',body:item.summary.slice(0,2000),source:'productivity'});
          }});}
        catch {todoFailure = '待办存储无法读取，原数据已保留，请恢复本机安全存储';}
      }
      const hostPath = path.resolve(dir, '../../windows-host/host/bin/Release/net8.0-windows/WindowsHost.Host.exe');
      const bridgePath = path.resolve(dir, '../../windows-host/host/bridge/bin/Release/net8.0-windows/WindowsHost.PipeBridge.exe');
      if (!syntheticMvp && process.platform === 'win32' && existsSync(hostPath) && existsSync(bridgePath)) {
        notepadHost = createDesktopNotepadHost({
          createAdapter:runtimeModule.createWindowsHostNotepadAdapter,
          createAttempts:runtimeModule.createRuntimeWindowsHostAttemptStore,
          transport:runtimeModule.createWindowsHostBridgeTransport({hostPath,bridgePath}),
          registerConfirmation:handler => globalShortcut.register('F9',handler)
            ? () => globalShortcut.unregister('F9') : undefined,
          openNotepad:() => new Promise((resolve,reject) => {
            const child=spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows','System32','notepad.exe'),[],
              {windowsHide:false,stdio:'ignore'});
            child.once('spawn',()=>{child.unref();resolve();});child.once('error',reject);
          }),
          respond:payload => client.call('authorization.respond',payload),
          cancelTask:taskId => client.call('task.cancel',{taskId,reason:'用户停止记事本操作'}),
          reconcileTask:taskId=>runtimeApplication.reconcileWindowsHostTask(taskId,
            {deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal}),
          onUpdate:publish,
          onTask:({taskId,goal}) => {
            conversations.add(taskId,'panel',goal); taskGoals.set(taskId,goal);
          },
        });
      }
      if (syntheticFactSource) competitionCatalog = createDesktopCompetitionToolCatalog({
        rootPath: path.resolve(dir, '../fixtures/agentarts'), createWorkspaceReadTool,
      });
      productTools = createPublicConnectorHost({systemObservationFactory:runtimeModule.createSystemObservationTool});
      const publicReferenceModule=await import('@personal-agent/mcp');
      publicReferenceConsent?.close();
      publicReferenceConsent=createNativePublicReferenceConsent({
        readPreflightCandidate:query=>codingWorkspace?.readWorkspaceExportPreflightCandidate?.(query)
          ?? referenceHost?.readPublicReferencePreflightCandidate?.(query),
        readConfirmedCandidate:query=>codingWorkspace?.readWorkspaceExportCandidate?.(query)
          ?? referenceHost?.readPublicReferenceCandidate?.(query),
        isTaskCurrent:taskId=>{
          try {
            const task=runtimeApplication.runtime.getTask(taskId);
            return task.state === 'running' && task.cancelRequested !== true;
          } catch {return false;}
        },
        isCatalogCurrent:input=>{
          try {return referenceHost?.bindTask(input.taskId) === input.configurationRef;} catch {return false;}
        },
        confirmNative:async (request,context)=>{
          if (context.signal.aborted || Date.now() >= Date.parse(context.deadline)) return false;
          openAdmin('computer');const originAdmin=admin,originApplication=runtimeApplication;
          if (!originAdmin || originAdmin.isDestroyed()) return false;
          const purpose=request.purpose === 'coding-reference' ? '编程参考' : '参考资料摘要';
          if (request.phase === 'catalog') {
            const answer=await dialog.showMessageBox(originAdmin,{type:'question',title:'公开参考能力目录',
              message:request.catalogKind === 'skill' ? '允许本任务向 AgentArts 公布参考摘要 Skill 的公开版本参数？' : '允许本任务向 AgentArts 公布只读参考工具的公开能力目录？',
              detail:`原任务：${request.query.taskId}\n到期：${request.expiresAt}`
                + (request.publicParameters ? `\n公开版本：${JSON.stringify(request.publicParameters)}` : '')
                + '\n能力目录不含文件路径或正文。具体资料读取和内容出机会分别确认。',
              buttons:['取消','仅允许本任务'],defaultId:0,cancelId:0,noLink:true});
            return answer.response === 1 && admin === originAdmin && !originAdmin.isDestroyed()
              && runtimeApplication === originApplication && !context.signal.aborted && Date.now() < Date.parse(context.deadline);
          }
          const answer=await dialog.showMessageBox(originAdmin,{type:'question',title:'本任务公开资料许可',
            message:request.phase === 'preflight' ? `允许读取此公开资料用于${purpose}？` : `允许向 AgentArts 发送这份已读回的公开内容用于${purpose}？`,
            detail:`原任务：${request.query.taskId}\n资料：${request.query.path}\n内容上限：${request.maxExportBytes} 字节\n到期：${request.expiresAt}`
              + (request.phase === 'confirmed' ? `\n实际大小：${request.byteLength} 字节\nSHA256：${request.contentDigest}` : '\n仅选择公开资料；此步骤尚未发送文件内容。'),
            buttons:['取消','确认仅本任务使用此公开资料'],defaultId:0,cancelId:0,noLink:true});
          return answer.response === 1 && admin === originAdmin && !originAdmin.isDestroyed()
            && runtimeApplication === originApplication && !context.signal.aborted && Date.now() < Date.parse(context.deadline);
        },
      });
      const commandHelper=path.join(app.getPath('userData'),'native-tools','workspace-command','WindowsJobProcessHost.exe');
      codingWorkspace = createWorkspaceConfigHost({userData:app.getPath('userData'),safeStorage,
        patchHelperScriptPath:process.env.PA_CODING_PATCH_HELPER_SCRIPT,
        createWorkspaceReferenceExport:publicReferenceModule.createWorkspaceReferenceExport,
        readWorkspaceExportPreflight:query=>publicReferenceConsent?.readPreflight(query),
        readWorkspaceExportAuthorization:query=>publicReferenceConsent?.readAuthorization(query),
        requestWorkspaceExportPreflight:(query,context)=>publicReferenceConsent?.requestPreflight(query,context),
        requestWorkspaceExportExact:(query,context)=>publicReferenceConsent?.requestExact(query,context),
        jobHelperExecutable:existsSync(commandHelper)?commandHelper:undefined,
        selectDirectory:async () => {
          const result = await dialog.showOpenDialog(admin, {title:'选择允许 PersonalAgent 使用的编程工作区',
            properties:['openDirectory']});
          return result.canceled ? undefined : result.filePaths[0];
        },
        selectNodeExecutable:async () => {
          const result=await dialog.showOpenDialog(admin,{title:'选择可信安装目录中的 Node 可执行文件',
            properties:['openFile'],filters:[{name:'Node executable',extensions:['exe']}]});
          return result.canceled?undefined:result.filePaths[0];
        },
        selectNpmCli:async () => {
          const result=await dialog.showOpenDialog(admin,{title:'选择可信 Node 安装目录中的 npm-cli.js',
            properties:['openFile'],filters:[{name:'npm CLI',extensions:['js']}]});
          return result.canceled?undefined:result.filePaths[0];
        },
        selectCheckFile:async workspaceRoot => {
          const result=await dialog.showOpenDialog(admin,{title:'选择此工作区内需要语法检查的文件',
            defaultPath:workspaceRoot,properties:['openFile'],filters:[{name:'JavaScript',extensions:['js','mjs','cjs']}]});
          return result.canceled?undefined:result.filePaths[0];
        },
        createCommandRecipeTool:options=>createWorkspaceCommandRecipeTool({...options,createWorkspaceCommandTool})});
      referenceHost=createDesktopReferenceHost({workspace:codingWorkspace,createMcp:runtimeModule.createReadonlyMcpHost,onUpdate:publish,
        hostUserNamespace:namespace,
        publicReferenceExport:{
          readPreflight:query=>publicReferenceConsent?.readPreflight(query),
          readAuthorization:query=>publicReferenceConsent?.readAuthorization(query),
          readConfirmed:query=>referenceHost?.readConfirmedPublicReference?.(query),
        },
        publicReferenceAvailability:input=>publicReferenceConsent.requestCatalog(input,'mcp'),
        publicSkillAvailability:async input=>{
          const manifest=runtimeApplication.referenceSkillSnapshot().manifest;
          if (!manifest || !(await publicReferenceConsent.requestCatalog(input,'skill',
            {skillId:manifest.id,version:manifest.version,digest:manifest.digest}))) return false;
          return Boolean(await chooseNativePublicSkillSource(input));
        },
        resolvePublicSkillPath:input=>readNativePublicSkillSource(input)?.path,
        readPublicSkillSourceRefs:input=>readNativePublicSkillSource({...input,sourceRef:'public-reference'})
          ? ['public-reference'] : [],
        resolvePublicSkillSource:input=>{
          const selected=readNativePublicSkillSource(input);
          if (!selected) return undefined;
          const scope=publicReferenceConsent.readPreflight({taskId:input.taskId,proposalId:input.proposalId,
            path:selected.path,configurationRef:input.configurationRef,arguments:{path:selected.path}});
          return scope ? {...scope,path:selected.path,sourceRef:input.sourceRef,
            configurationRef:input.configurationRef,revision:input.revision} : undefined;
        },
        assertDispatchBinding:taskId=>{
          const saved=runtimeApplication.runtime.loadCheckpoint(taskId,'learning:binding:v1');
          if(saved!==undefined) {
            if(!learningApplication) throw Error('流程学习宿主尚未装配');
            learningApplication.assertDispatchBinding(saved);
          }
        }});
      const {LayaActionChoiceService, LocalLayaHttpTransport} = await import('@personal-agent/cognition');
      localLaya = createLocalLayaHost({projectRoot:path.resolve(dir, '../../..'),
        createService:runtimeModule.createLocalInboxClassifier,
        createChooser:({port,getApiKey}) => new LayaActionChoiceService(new LocalLayaHttpTransport(port,getApiKey)),
        onUpdate:publish});
      mailConfig = createMailConfig({userData:app.getPath('userData'), safeStorage,
        onRevoke:async () => {await mailHost?.cancel();},
        onCloudRevoke:async () => {await mailAnalysisHost?.revoke();}});
      const configuredMail = mailConfig.current();
      if (configuredMail) {
        try {
          const {user, authCode, revision} = configuredMail;
          mailHost = runtimeModule.createQQMailTriageHost({user, authCode, accountRef:'desktop-qq-inbox',
            storage:createMailMetadataStorage({userData:app.getPath('userData'), safeStorage}),
            namespace:`${namespace}:qq-inbox:${user.toLowerCase()}`, triage:localLaya,
            getClassifierFingerprint:() => {
              const identity=localLaya?.readClassifierIdentity?.();
              const policy=runtimeModule.LOCAL_INBOX_CLASSIFIER_FINGERPRINT;
              return typeof identity==='string' && /^[a-f0-9]{64}$/.test(identity)
                && typeof policy==='string' && /^[a-f0-9]{64}$/.test(policy)
                ? createHash('sha256').update(JSON.stringify(['inbox-classifier-v2',identity,policy])).digest('hex')
                : undefined;
            },
            labels:{meeting:'Meeting invitations, rescheduling and appointment notices',
              work:'Work, project, technical discussions and documents',
              subscription:'Subscribed newsletters, news digests and product updates',
              transaction:'Receipts, invoices, order and delivery notices',
              personal:'Personal conversations and social notifications',
              other:'Other or unclear subject; review manually'}, meetingLabels:['meeting'],
            isSessionAllowed:() => mailConfig.isSessionAllowed(revision)});
        } catch {mailFailure = '邮箱本地分类状态无法装配；其他功能可继续使用';}
      }
      const {
        createDesktopSubagentDispatchTool,
        SUBAGENT_DISPATCH_TOOL_NAME,
        SUBAGENT_DISPATCH_TOOL_VERSION,
      } = runtimeModule;
      const subagentTool = createDesktopSubagentDispatchTool({
        competitionOnly:true,
        getRuntime: () => runtimeApplication.runtime,
        getTools: () => runtimeApplication.tools,
        runDefaultWorker:(subtask,worker,tools)=>runtimeApplication.runDefaultSubagentWorker(subtask,worker,tools),
        fakeModelMode,
      });
      subagentTool.execute = (input, context) => {
        const taskThinking = runtimeApplication.runtime.loadCheckpoint(context.taskId,'task-thinking');
        const boundTool=createDesktopSubagentDispatchTool({competitionOnly:true,getRuntime:()=>runtimeApplication.runtime,
          getTools:()=>runtimeApplication.tools,fakeModelMode,
          runDefaultWorker:(subtask,worker,tools)=>runtimeApplication.runDefaultSubagentWorker(subtask,worker,tools)});
        return boundTool.execute({...input,subtasks:input.subtasks.map(subtask=>({...subtask,
          ...(subtask.thinkingDepth===undefined && taskThinking ? {thinkingDepth:taskThinking.depth} : {}),
        }))},context);
      };
      const subagentAvailability = {
        toolName: SUBAGENT_DISPATCH_TOOL_NAME,
        toolVersion: SUBAGENT_DISPATCH_TOOL_VERSION,
        publicEnumPaths:['/subtasks/*/role','/subtasks/*/reasoningEffort'],
        available: async ({taskId}) => runtimeApplication.isDefaultSubagentAvailable()
          && !runtimeApplication.runtime.getTask(taskId).conversationId?.startsWith('desktop-subtask:'),
      };
      const subagentExport = {
        toolName: SUBAGENT_DISPATCH_TOOL_NAME,
        toolVersion: SUBAGENT_DISPATCH_TOOL_VERSION,
        exportPolicyVersion: '1.0.0',
        accepts: ({arguments: args}) => Array.isArray(args?.subtasks) && args.subtasks.length > 0 && args.subtasks.length <= 10,
        project: projectSubagentResult,
      };

      const powerShell=path.join(process.env.ProgramFiles??'C:\\Program Files','PowerShell','7','pwsh.exe');
      knowledgeSourceConfig=await createKnowledgeSourceConfig({userData:app.getPath('userData'),safeStorage,namespace,
        hostIdentity:createHash('sha256').update(app.getPath('userData')).digest('hex'),
        powerShellPath:existsSync(powerShell)?powerShell:undefined,
        selectDirectory:async()=>{
          const choice=await dialog.showOpenDialog(admin,{title:'选择本机知识库',properties:['openDirectory']});
          return choice.canceled?undefined:choice.filePaths[0];
        },selectNoteFiles:async root=>{
          const choice=await dialog.showOpenDialog(admin,{title:'选择允许整理的知识笔记',defaultPath:root,
            properties:['openFile','multiSelections'],filters:[{name:'Markdown',extensions:['md']}]});
          return choice.canceled?undefined:choice.filePaths;
        },confirmPermissions:async details=>{
          const choice=await dialog.showMessageBox(admin,{type:'question',title:'知识源本会话许可',
            message:'确认所选知识源的本会话范围？',
            detail:details.displayName+'\n所选笔记：'+details.noteCount+'\n允许整理：'+details.writeAllowed+
              '\n允许向 AgentArts 发送公开结果：'+details.cloudExportAllowed+'\n公开查询：'+details.publicQueries.join('、'),
            buttons:['确认本会话范围','取消'],defaultId:1,cancelId:1,noLink:true});
          return choice.response===0 && admin && !admin.isDestroyed();
        }});
      obsidianPairing=createDesktopObsidianPairing({source:knowledgeSourceConfig,
        userData:app.getPath('userData'),
        createPairingHost:runtimeModule.createObsidianPairingHost,
        ui:createObsidianPairingUI({BrowserWindow,ipcMain,dialog,owner:()=>admin}),
        changed:()=>{cancelKnowledgeTasks();publish();}});
      knowledgeTools=runtimeModule.createTrustedKnowledgeTools(obsidianPairing.source, {
        revalidate:(input,context)=>privateMemoryController().revalidateSource(input,context),
      });
      const agentArtsTransportConfig = createAgentArtsTransportConfig({binding:cloudBinding,transportPreferences:agentArtsConfig.readTransportPreferences(),
        configurationProvider:{read:()=>agentArtsConfig.readTransportOptions(cloudBinding)}});
      void refreshAgentArtsModelsOnStartup({configuration:agentArtsConfig,models:agentArtsModels,onUpdate:publish});
      activeCloudTransportSignature=JSON.stringify([agentArtsConfig.readTransportPreferences(),agentArtsConfig.snapshot().deploymentVersion]);
      cloudTransportNotice = '';
      // 平台观测读回（MOD-32）默认装配为显式 unavailable：真实 ShowOpsTrace /
      // ListOpsAgentRunLog 需要 AK/SK 签名宿主与平台 applicationId（resource_id），
      // 当前桌面进程不持有观测凭据，也不把 invoke 用的 Bearer 降级复用为观测签名。
      runtimeApplication = runtimeModule.createAgentArtsRuntimeApplication({
        path: dbPath,
        proactiveWorkflows: true,
        proactiveDecision: {localChooser:localLaya},
        hostUserNamespace: namespace,
        ...(notepadHost ? {windowsHostRecovery:{recover:(taskId,runId)=>{
          const intent=runtimeApplication.runtime.loadCheckpoint(taskId,'host-tool-intent');
          return notepadHost.recoverOriginalRun({taskId,runId,argumentsDigest:intent?.argumentsDigest},
            {deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal});
        }}} : {}),
        coordinationInput:{
          prepareCoordinationGoal:async scope=>{
            if (!conversations?.containsConversation(scope.conversationId)) return scope.publicGoal;
            installedSkillsHost?.prepareTask(scope);
            if (!privateConsumption) throw Error('私人记忆消费宿主尚未装配');
            return (await privateConsumption.prepare({...scope,goal:scope.publicGoal})).goal;
          },
          readConversationContext:readDesktopConversationContext,
          beforeCoordinationSend:(request,scope)=>{
            cloudRequestFailureNotice = '';
            installedSkillsHost?.assertTask(request.taskId);
            const conversationId=runtimeApplication.runtime.getTask(request.taskId).conversationId;
            if (!conversations?.containsConversation(conversationId)) return;
            if (!privateConsumption) throw Error('私人记忆发送门禁尚未装配');
            privateConsumption.assertCloudSend({...request,goal:scope.preparedGoal});
            const current=(knowledgeWatchHost?.dialogueProjection?.()?.items ?? [])
              .filter(item=>item.usableAsCurrentFact === true && item.answer?.kind === 'current_fact');
            if (coordinationWatchInputs.get(request.taskId)!==JSON.stringify(current)) throw Error('公开事实来源已变化，请重新核实');
          },
          releaseTask:taskId=>{privateConsumption?.releaseTask(taskId);coordinationWatchInputs.delete(taskId);},
        },
        knowledgeWriteReconciliation:{
          reconcile: (original,context)=>{
            const current=knowledgeSourceConfig.snapshot();
            return knowledgeTools.reconcileWrite({...original,sourceId:current.sourceId,configRevision:current.configRevision},context);
          },
          finalize: (acceptedOriginal,context)=>{
            const current=knowledgeSourceConfig.snapshot();
            return knowledgeTools.finalizeWrite({sourceId:current.sourceId,configRevision:current.configRevision,acceptedOriginal},context);
          },
        },
        // Match the existing text tool workflow budget; preserve room for the final answer.
        competitionMaxSteps: 8,
        // Module availability/consent, input validation and ToolGateway still run.
        // Explicit names prevent future destructive tools inheriting this policy.
        automaticTools: [...[...productTools.tools,...codingWorkspace.tools,...(goalCloudHost?.tools??[]),...(subagentTool?[subagentTool]:[]),...(knowledgeTools?.tools??[]),...(referenceHost?.tools??[]),
          ...(todoHost?.tools??[]),...(feedsHost?.tools??[])].filter(tool=>[
            'weather.forecast','research.search','feeds.collect','feeds.subscriptions',
            'todo.list','todo.create','todo.update','notifications.status',
            'goals.list','goals.get','goals.create','goals.revise',
            'workspace.read_text','workspace.list_entries','workspace.preview_text_patch',
            'workspace.stage_text_patch','workspace.apply_text_patch','workspace.git_diff_check',
            'workspace.node_check','workspace.npm_build','workspace.npm_test',SUBAGENT_DISPATCH_TOOL_NAME,'knowledge.search','mcp.workspace.read_text',
          ].includes(tool.descriptor.name))
          .map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version})),
          ...(!syntheticMvp ? [{toolName:runtimeModule.LOCAL_REPAIR_TOOL,toolVersion:'1.0.0'}] : [])],
        readDefaultExecutionModel:role=>agentArtsModels.readExecutionModel(role),
        resolveExecutionModel:selection=>agentArtsModels.resolveExecutionModel(selection),
        readConversationPreference: conversationId => {
          if (!conversations?.containsConversation(conversationId)) return undefined;
          const preference = conversations.preference(conversationId,{depth:thinking.depth,fast:thinking.fast});
          const models=modelApiHost?.snapshot();
          const modelId=preference.modelId || undefined;
          const selected=models?.models.find(item=>item.id===modelId);
          return {...preference,modelId,executionModel:preference.executionModel?agentArtsModels.resolveExecutionModel(preference.executionModel):modelId?agentArtsModels.resolveExecutionModel({modelId}):agentArtsModels.readExecutionModel(),configurationRef:selected?.configurationRef};
        },
        beforeCompetitionSend:request=> {
          if (!proactiveHost && runtimeApplication.runtime.getTask(request.taskId).conversationId?.startsWith('desktop-proactive-goals:')) {
            throw Error('目标主动分析宿主尚未就绪');
          }
          proactiveHost?.assertCognitionCloudSend(request);
          goalCloudHost?.assertCloudSend(request);
          if (!mailAnalysisHost && runtimeApplication.runtime.getTask(request.taskId).conversationId?.startsWith('desktop-mail-analysis:')) {
            throw Error('邮件分析宿主尚未就绪');
          }
          mailAnalysisHost?.assertCloudSend(request);
        },
        tools: [...(syntheticMvp ? syntheticTools.tools : codingWorkspace.tools.length ? codingWorkspace.tools : competitionCatalog ? [competitionCatalog.tool] : []), ...(goalCloudHost?.tools ?? goalHost.tools), ...productTools.tools, ...(mailHost?.tools ?? []), ...(calendarMeetingHost?.tools ?? []), ...(feedsHost?.tools ?? []), ...(notepadHost?.tools ?? []), ...(todoHost?.tools ?? []), ...(notificationApplicationHost?.tools ?? []), ...(subagentTool ? [subagentTool] : []), ...(knowledgeTools?.tools??[]),...(referenceHost?.tools??[]),...(remoteMcpHost?.tools??[])],
        prepareCompetitionToolExport:async ({phase,taskId,proposal,deadline,signal})=>{
          if (!['workspace.read_text','mcp.workspace.read_text','skill.workspace_reference_summary'].includes(proposal?.toolName)) return;
          if (!publicReferenceConsent || !['preflight','projection'].includes(phase)) throw Error('原生公开资料许可入口不可用');
          const configurationRef=proposal.toolName === 'workspace.read_text'
            ? codingWorkspace?.readWorkspaceExportConfigurationRef?.() : referenceHost?.bindTask(taskId);
          const selected=proposal.toolName === 'skill.workspace_reference_summary'
            ? readNativePublicSkillSource({taskId,sourceRef:proposal.arguments.sourceRef,configurationRef}) : undefined;
          const query={taskId,proposalId:proposal.proposalId,path:selected?.path ?? proposal.arguments.path,
            configurationRef,arguments:selected ? {path:selected.path} : proposal.arguments};
          if (phase === 'preflight') await publicReferenceConsent.requestPreflight(query,{deadline,signal});
          else await publicReferenceConsent.requestExact(query,{deadline,signal});
        },
        ...(codingWorkspace.patchReconciliation ? {workspacePatchReconciliation: codingWorkspace.patchReconciliation} : {}),
        localRepair: syntheticMvp ? syntheticRepairHost.localRepair : {
          graphNamespace: namespace, bindingVersion:'desktop-reviewed-execution-v1',
          withSourceLock:withReviewedRepairLock,
          reviewedSource:{resolve({sourceTaskId,reviewTaskId}) {
            const value = proactiveHost?.readPreparedRepair?.(sourceTaskId);
            return value?.kind === 'prepared' && value.binding.reviewTaskId === reviewTaskId ? value : undefined;
          }},
        },
        repairCandidateVersion: repairCandidateVersion ?? '1.0',
        ...(process.env.PA_AGENTARTS_WORKFLOW_GOAL_INPUT === undefined ? {} : {workflowGoalInput: process.env.PA_AGENTARTS_WORKFLOW_GOAL_INPUT}),
        responseMode: agentArtsResponseMode ?? 'tool-proposal-json',
        ...(syntheticMvp ? {competitionToolExports: syntheticTools.competitionToolExports} : {
          initialRequestMode: 'goal-with-tools-json',
          competitionToolAvailability: (competitionToolAvailabilityList = [...(codingWorkspace.tools.length ? codingWorkspace.competitionToolAvailability : competitionCatalog ? [competitionCatalog.availability] : []), ...productTools.competitionToolAvailability, ...feedsHost.competitionToolAvailability, ...(todoHost?.competitionToolAvailability ?? []), ...(goalCloudHost?.competitionToolAvailability ?? []), ...(subagentAvailability ? [subagentAvailability] : []), ...(knowledgeTools?.competitionToolAvailability??[]),...(referenceHost?.competitionToolAvailability??[])]),
          competitionToolExports: [...(codingWorkspace.tools.length ? codingWorkspace.competitionToolExports : competitionCatalog ? [competitionCatalog.export] : []), ...productTools.competitionToolExports, ...feedsHost.competitionToolExports, ...(todoHost?.competitionToolExports ?? []), ...(goalCloudHost?.competitionToolExports ?? []), ...(subagentExport ? [subagentExport] : []), ...(knowledgeTools?.competitionToolExports??[]),...(referenceHost?.competitionToolExports??[])],
        }),
        ...cloudBinding,
        ...agentArtsTransportConfig,
        invokeMode: agentArtsInvokeMode,
        ...(agentArtsTransportConfig.transport === 'wss' ? {onTransportState: state => {
          if (state.state === 'closed') return;
          cloudTransportNotice = agentArtsTransportNotice(state);
          publish();
        }} : {}),
        onDiagnostic: receipt => {
          if (process.env.PA_AGENTARTS_SAFE_DIAGNOSTICS === '1') desktopHost.logAgentArtsFailure(receipt);
          cloudRequestFailureNotice = agentArtsFailureNotice(receipt);
          publish();
        },
        authorizationProvider: {
          read: async () => {
            return agentArtsConfig.readAuthorization(cloudBinding);
          },
        },
      });
      if (runtimeApplication?.configureThinking) {
        const state = runtimeApplication.configureThinking({depth: thinking.depth, fast: thinking.fast});
        thinking = {depth: state.depth, fast: state.fast, applied: true, maxSteps: state.maxSteps, reason: state.reason};
      }
      if (syntheticRepairHost) await syntheticRepairHost.initialize(runtimeApplication.runtime);
      if (mailHost) {mailHost.bindApplication(runtimeApplication); mailConfig.markBound(configuredMail.revision);}
      codingWorkspace.bindApplication(runtimeApplication);
      installedSkillsHost.bindRuntime(runtimeApplication.runtime);
      referenceHost.bindApplication(runtimeApplication);
      const cloudSkillSelector=referenceHost.configureCloudSkillWorker(runtimeApplication.referenceSkillWorker());
      runtimeApplication.configureCloudSkillSelection({
        cloudSkillCatalog:input=>referenceHost.cloudSkillCatalog(input),
        dispatchCloudSkillProposal:(proposal,context)=>referenceHost.dispatchCloudSkillProposal(proposal,context),
        assertReceiptAllowed:(selection,receipt,context)=>cloudSkillSelector.assertReceiptAllowed(selection,receipt,context),
      });
      knowledgeTools.bindApplication(runtimeApplication);
      const {openSqliteLearningHost}=await import('@personal-agent/learning');
      learningStore=openSqliteLearningHost(path.join(app.getPath('userData'),'workflow-learning.sqlite'));
      learningStore.resumeErasureMaintenance(namespace);
      learningApplication=runtimeModule.createWorkflowLearningApplication({profile:'huawei_ict_agentarts',namespace,
        learning:learningStore,runtime:runtimeApplication.runtime,
        skillManifest:()=>runtimeApplication.referenceSkillSnapshot().manifest,
        submitSkillTask:(binding,context)=>runtimeApplication.submitReferenceSkillTask({
          skillId:binding.skillId,version:binding.version,digest:binding.digest,path:binding.path,
          idempotencyKey:binding.operationId,deadline:context.deadline,conversationId:`learning:${namespace}`,
          hostBinding:{key:runtimeModule.LEARNING_BINDING_CHECKPOINT,value:binding}}).taskId,
        confirmActivation:async binding=>{
          const answer=await dialog.showMessageBox(admin,{type:'question',title:'启用已验证流程',
            message:`启用流程 ${binding.workflowId} 的版本 ${binding.revision}？`,
            detail:'此版本已有本地 Runtime 读取证据；后续读取仍受工作区许可与原工具策略限制。',
            buttons:['启用此版本','取消'],defaultId:1,cancelId:1,noLink:true});
          return answer.response===0 && admin && !admin.isDestroyed();
        },confirmDeletion:async version=>{
          const answer=await dialog.showMessageBox(admin,{type:'warning',title:'删除学习流程',
            message:`删除流程 ${version.workflowId} 的全部版本？`,detail:'同时停止此流程尚未完成的任务，保留工作区原文件。',
            buttons:['删除全部版本','取消'],defaultId:1,cancelId:1,noLink:true});
          return answer.response===0 && admin && !admin.isDestroyed();
        }});
      privateConsumption?.close();
      privateBackups=createPrivateMemoryBackupHost({userData:app.getPath('userData'),privateMemory:privateMemoryController()});
      privateConsumption=createPrivateMemoryConsumptionHost({profile:'huawei_ict_agentarts',privateMemory:privateMemoryController(),
        readTask:taskId=>runtimeApplication.runtime.getTask(taskId),
        readTaskBinding:taskId=>runtimeApplication.readPrivateTaskBinding(taskId),
        writeTaskBinding:(taskId,binding)=>runtimeApplication.writePrivateTaskBinding(taskId,binding),
        readConfigurationRef:()=>runtimeApplication.coordinationConfigurationRef,
        assertCopyManagement:()=>privateErasure.assertReady(privateBackups.inventory())});
      privateErasure=createPrivateMemoryErasureHost({privateMemory:privateMemoryController(),consumptionHost:privateConsumption,
        listBindings:input=>runtimeApplication.listBindings(input),
        cancelTask:taskId=>runtimeApplication.runtime.requestCancel(taskId,'私人记忆使用已撤回'),
        eraseTaskCopies:scope=>runtimeApplication.eraseTaskCopies(scope),
        readCopyErasureReceipt:taskId=>runtimeApplication.readCopyErasureReceipt(taskId),backups:privateBackups});
      memoryLearningHost=createMemoryLearningHost({profile:'huawei_ict_agentarts',privateMemory:privateMemoryController(),
        learningApplication,privateErasure,managedPrivateCopies:()=>privateBackups.inventory()});
      await memoryLearningHost.recover();
      wikiSourceMonitor?.close();
      wikiSourceMonitor=runtimeModule.createWikiSourceMonitor({source:{
        snapshot:()=>({...knowledgeSourceConfig.snapshot(),available:obsidianPairing.snapshot().mode!=='plugin'
          && knowledgeSourceConfig.snapshot().available}),
        acquireWiki:(expected,context)=>obsidianPairing.memorySource.acquireWiki(expected,context)},
        revalidate:(input,context)=>privateMemoryController().revalidateSources(input,context)});
      // Original source writes are never retried. Only known receipts resume local projection checks.
      let projectionBefore,projectionSnapshot;
      do {
        const page=runtimeApplication.runtime.listTasks({limit:100,
          ...(projectionBefore===undefined?{}:{beforeSequence:projectionBefore}),
          ...(projectionSnapshot===undefined?{}:{snapshotSequence:projectionSnapshot})});
        projectionBefore=page.nextBeforeSequence;projectionSnapshot=page.snapshotSequence;
        for (const task of page.items) await knowledgeTools.recoverProjection(task.taskId,
          {deadline:new Date(Date.now()+30000).toISOString(),signal:new AbortController().signal});
      } while (projectionBefore!==undefined);
      feedsHost?.bindApplication(runtimeApplication, namespace);
      todoHost?.bindApplication(runtimeApplication);
      goalHost.bind(runtimeApplication);
      calendarMeetingHost?.bindApplication(runtimeApplication);
      goalCloudHost?.bindApplication(runtimeApplication);
      notepadHost?.bind(runtimeApplication);
      goalHost.resumeApproved();
      if (!syntheticMvp && competitionCatalog && !codingWorkspace.tools.length) competitionFactBridge = createDesktopCompetitionFactBridge({
        application: runtimeApplication, catalog: competitionCatalog,
        runtimePath: dbPath, userNamespace: namespace,
      });
      await competitionFactBridge?.recover();
    } else {
      const createApplication = process.argv.includes('--weather-tools')
        ? (await import('@personal-agent/runtime/weather')).createOpenMeteoApplication
        : createRuntimeApplication;
      runtimeApplication = createApplication({
        path: dbPath,
        text: {mode: 'unavailable', model: modelConfig.model},
      });
      if (runtimeApplication?.configureThinking) {
        const state = runtimeApplication.configureThinking({depth: thinking.depth, fast: thinking.fast});
        thinking = {depth: state.depth, fast: state.fast, applied: true, maxSteps: state.maxSteps, reason: state.reason};
      }
    }
    runtime = runtimeApplication.runtime;
    readEvents = after => runtimeApplication.readEvents(after);
  }
  runtimeConnection = await register({
    transport: fakeMode ? runtime : runtimeApplication,
    now: () => fakeMode ? runtime.clock.now() : Date.now(),
    readEvents,
    attachClient: value => { client = value; return () => { client = undefined; }; },
  });
  client = runtimeConnection.client;
  if (notificationApplicationHost) {
    notificationApplicationHost.bindApplication(runtimeApplication, client);
    voiceCommandHost = createDesktopVoiceCommandHost({notifications:notificationApplicationHost,onUpdate:publish,
      readApproval:approvalId=>{
        const value=runtimeApplication.runtime.getApproval(approvalId), task=runtimeApplication.runtime.getTask(value.taskId);
        return {...value,taskState:task.state,summary:task.goal};
      },respondApproval:async payload=>{
        const result=await client.call('authorization.respond',payload);
        approvals.delete(payload.approvalId);await pumpEvents();publish();return result;
      }});
  }
  if (competitionMode && runtimeApplication?.startProactiveTask) {
    proactiveWorkflowApplication=createDesktopProactiveWorkflowApplication({application:runtimeApplication,
      notificationHost:notificationApplicationHost?.runtimeHost,localDeviceAvailable:()=>!app.isQuitting,onUpdate:publish,
      bindings:[{kind:'local_decision_batch',toolName:'proactive.local_decision_batch',toolVersion:'1.0.0',location:'local_device',effect:'read'},
        {kind:'teacher_decision',toolName:'proactive.teacher_decision',toolVersion:'1.0.0',location:'local_device',effect:'read'}],
      context:()=>createDesktopProactiveContextPorts({readMemory:()=>proactiveHost?.publicMemory,
        readGoals:()=>runtimeApplication.runtime.provisionCoordinationStore(namespace),
        readKnowledgeSource:()=>obsidianPairing?.source??knowledgeSourceConfig,limit:20}),
      readConfiguration:()=>{
        const binding=agentArtsConfig?.runtimeBinding(),receiptSecret=process.env.PA_WORKFLOW_RECEIPT_SECRET,
          contractRef=process.env.PA_PROACTIVE_CONTRACT_REF,hostToken=process.env.PA_AGENT_WSS_AUTH_TOKEN;
        if(!binding||!receiptSecret||!contractRef||!hostToken)return undefined;
        return {contractRef,adapter:{config:binding,receiptSecret,
          authorizationProvider:{read:async()=>agentArtsConfig.readAuthorization(binding)},
          hostAuthorizationProvider:{read:async()=>'Bearer '+hostToken},invokeMode:agentArtsInvokeMode}};
      }});
  }
  connectionLabel = fakeMode
    ? 'Fake Runtime · 联调模式'
    : competitionMode ? '本地 Runtime · AgentArts Competition' : '本地 Runtime · 已连接';
  eventCursor = new EventCursor('tasks');
  if (competitionMode && mailHost) mailAnalysisHost = createDesktopMailAnalysisHost({
    application:runtimeApplication,client,mail:mailHost,config:mailConfig,namespace:desktopHost.userNamespace,
    onUpdate:publish,onTask:({taskId,goal})=>{
      if (!conversations.turns.has(taskId)) conversations.add(taskId,'panel',goal);
      taskGoals.set(taskId,goal);
    },
  });
  await syncCapabilities();
  await syncRuntimeSnapshots();
  if (competitionMode) proactiveHost = createDesktopProactiveHost({application: runtimeApplication,
    initialRequestMode: syntheticMvp ? 'goal' : 'goal-with-tools-json',
    client, userData: app.getPath('userData'), namespace: desktopHost.userNamespace, onUpdate: publish,
    goalHost,chooser:localLaya,cognitionReady:()=>localLaya.snapshot().state==='ready',
    createCognitionHost:runtimeModule.createProactiveCognitionHost,
    onAnalysisTask: ({taskId, goal}) => {
      if (!conversations.turns.has(taskId)) conversations.add(taskId, 'panel', goal);
      taskGoals.set(taskId, goal);
    },
  });
  if(competitionMode && memoryLearningHost && proactiveHost) {
    const publicErasure=proactiveHost.createPublicFactErasureApplication({confirm:async ref=>{
      const answer=await dialog.showMessageBox(admin,{type:'warning',title:'删除公共事实及关联记录',
        message:`删除事实 ${ref.id} 的全部版本及绑定投影？`,detail:`当前事实版本：${ref.revision}；已有图谱依赖或未核实状态会拒绝删除。`,
        buttons:['删除所有绑定版本','取消'],defaultId:1,cancelId:1,noLink:true});
      return answer.response===0 && admin && !admin.isDestroyed();
    }});
    memoryLearningHost=createMemoryLearningHost({profile:'huawei_ict_agentarts',privateMemory:privateMemoryController(),
      learningApplication,publicErasure,privateErasure,managedPrivateCopies:()=>privateBackups.inventory()});
    await memoryLearningHost.recover();
  }
  if (competitionMode) {
    try {
      try {
        p5DeviceReceiptStore = createP5DeviceReceiptStore({
          filePath: path.join(app.getPath('userData'), 'p5-device-receipts.json'),
          storage:runtimeApplication.createHostStateStore('device-notifications'),
        });
      } catch {
        p5UnavailableReason = 'P5 本地提醒回执文件损坏或不可用，设备提醒不会启用';
      }
      p5SystemObservationSource = createP5SystemObservationSource({application: runtimeApplication});
      const {createCognitionP5Composition} = await import('./cognition-p5-composition.js');
      p5DeviceNotificationHost = p5DeviceReceiptStore ? createP5DeviceNotificationHost({
        Notification, store: p5DeviceReceiptStore,
        isActive: () => Boolean(p5DeviceTelemetrySubscription && p5Cognition?.snapshot().state === 'running'),
        readProvenance: notification => p5SystemObservationSource?.readCurrentProvenance(notification),
        readDeliveryPolicy:()=>{
          const status=todoHost?.snapshot().notificationStatus;
          if(!status || !['pausedUntil','quietUntil'].every(key=>status[key]===null
            || (typeof status[key]==='string' && Number.isFinite(Date.parse(status[key]))))) {
            return {allowed:false,reason:'unavailable'};
          }
          if(status.pausedUntil && Date.parse(status.pausedUntil)>Date.now())return {allowed:false,reason:'paused'};
          if(status.quietUntil && Date.parse(status.quietUntil)>Date.now())return {allowed:false,reason:'quiet_hours'};
          return {allowed:true,reason:null};
        },
        onUpdate: publish, onLateOutcome: reconcileDeviceDeliveries,
      }) : undefined;
      const notificationPort = p5DeviceNotificationHost;
      p5Cognition = createCognitionP5Composition({
        application: runtimeApplication,
        client,
        userData: app.getPath('userData'),
        namespace: desktopHost.userNamespace,
        layaHost: Object.freeze({
          snapshot: () => localLaya.snapshot(),
          start: () => localLaya.start(),
          stop: () => localLaya.stop(),
          choose: request => localLaya.choose(request),
          classify: request => localLaya.classify(request),
        }),
        ...(notificationPort ? {notificationPort} : {}),
        ...(calendarMeetingHost?.tools.length
          ? {calendarReadPort: calendarMeetingHost.calendarReadPort} : {}),
        autoStart: false,
        onUpdate: () => {publish(); void refreshP5DeviceFeedback();},
      });
      await reconcileDeviceDeliveries();
      await refreshP5DeviceFeedback();
      if (!p5Cognition.snapshot().hasDeviceAnomalyService) {
        p5UnavailableReason = [p5UnavailableReason, 'P5 设备异常决策端口不可用'].filter(Boolean).join('；');
      } else if (!p5DeviceReceiptStore || !p5Cognition.snapshot().hasNotificationPort
        || typeof p5Cognition.bindDeviceTelemetrySource !== 'function') {
        p5UnavailableReason = [p5UnavailableReason, 'P5 设备提醒的持久通知或采样订阅端口不可用'].filter(Boolean).join('；');
      }
    } catch {
      p5UnavailableReason = 'P5 组合装配失败，设备提醒保持不可用';
      try { p5Cognition?.dispose(); } catch {}
      p5Cognition = undefined;
      p5SystemObservationSource?.dispose();
      p5SystemObservationSource = undefined;
    }

    try {
      const namespace = desktopHost.userNamespace;
      const knowledgeWatchIdempotency = `knowledge-watch-root:${namespace}`;
      let knowledgeWatchTask = runtimeApplication.runtime.findTaskByIdempotencyKey(knowledgeWatchIdempotency);
      if (!knowledgeWatchTask) {
        knowledgeWatchTask = runtimeApplication.runtime.submitTask({
          goal: `Knowledge Watch Root Task (${namespace})`,
          conversationId: `knowledge-watch:${namespace}`,
          idempotencyKey: knowledgeWatchIdempotency,
        });
      }
      const feedProofStore=runtimeApplication.createHostStateStore('knowledge-tracking');
      const feedProvenance=await import('@personal-agent/feeds');
      const intakeKey=taskId=>'feed-interest-intake:'+createHash('sha256').update(taskId).digest('hex');
      const sourceKey=sourceId=>'feed-confirmed-source:'+sourceId;
      const proofKey=receiptId=>'feed-confirmed-read:'+receiptId;
      const rebuildFeedReceipt=binding=>{
        if (!binding || binding.namespace !== namespace || binding.containerTaskId !== knowledgeWatchTask.taskId
          || typeof runtimeModule.createKnowledgeFeedReceiptFromConfirmedExecution !== 'function') return undefined;
        const intent=runtimeApplication.runtime.loadCheckpoint(binding.sourceReadTaskId,'host-tool-intent');
        if (!intent || intent.namespace !== namespace || intent.toolName !== 'feeds.collect'
          || intent.toolVersion !== binding.toolVersion || intent.arguments?.subscriptionId !== binding.sourceId) return undefined;
        return runtimeModule.createKnowledgeFeedReceiptFromConfirmedExecution({namespace,sourceId:binding.sourceId,
          taskId:binding.sourceReadTaskId,runId:binding.runId,toolVersion:binding.toolVersion,
          query:intent.arguments,scopeRef:binding.runId,runtime:runtimeApplication.runtime});
      };
      const readFeedReceiptEvidence=query=>{
        if (query?.namespace !== namespace || query.sourceReadTaskId !== knowledgeWatchTask.taskId
          || typeof query.receiptId !== 'string' || !/^[a-f0-9]{64}$/.test(query.receiptId)) return undefined;
        const binding=feedProofStore.get(proofKey(query.receiptId));
        if (!binding || binding.sourceId !== query.sourceId || binding.receiptId !== query.receiptId) return undefined;
        const receipt=rebuildFeedReceipt(binding);
        return receipt?.receiptId === query.receiptId ? receipt : undefined;
      };
      const feedCollect = async (query, signal) => {
        const collectTool = feedsHost?.tools?.find(tool => tool.descriptor?.name === 'feeds.collect');
        const availability = feedsHost?.competitionToolAvailability?.find(item => item.toolName === 'feeds.collect');
        if (!collectTool || !availability) {
          const error = new Error('订阅收集工具未注册');
          error.code = 'TOOL_UNAVAILABLE';
          throw error;
        }
        const deadline = new Date(Date.now()+60_000).toISOString();
        const commandId=`knowledge-feed-read:${randomUUID()}`;
        const prepared = runtimeApplication.prepareHostToolTask({commandId,
          toolName:collectTool.descriptor.name,toolVersion:collectTool.descriptor.version,
          deadline});
        const isAvailable = await availability.available({taskId: prepared.taskId,revision:prepared.revision,deadline,signal});
        if (!isAvailable) {
          runtimeApplication.runtime.requestCancel(prepared.taskId,'Subscription scope unavailable');
          const error = new Error('订阅收集工具未获用户会话授权');
          error.code = 'UNAUTHORIZED';
          throw error;
        }
        runtimeApplication.finalizeHostToolTask({taskId:prepared.taskId,commandId,expectedTaskRevision:prepared.revision,arguments:query});
        const cancel=()=>runtimeApplication.runtime.requestCancel(prepared.taskId,'Knowledge feed check cancelled');
        signal.addEventListener('abort',cancel,{once:true});
        try {
          for (;;) {
            if (signal.aborted) {cancel();throw Object.assign(Error('订阅检查已取消'),{code:'CANCELLED'});}
            const read=runtimeApplication.readHostToolTask(prepared.taskId);
            if (read.task.state==='succeeded' && read.confirmed) {
              const binding={version:1,namespace,sourceId:query.subscriptionId,containerTaskId:knowledgeWatchTask.taskId,
                sourceReadTaskId:prepared.taskId,runId:read.confirmed.runId,toolVersion:collectTool.descriptor.version};
              const receipt=rebuildFeedReceipt(binding);
              if (receipt) {
                const key=proofKey(receipt.receiptId),previous=feedProofStore.get(key);
                // One receipt retains its original actual execution; a later read cannot replace it.
                if (!previous) feedProofStore.set(key,{...binding,receiptId:receipt.receiptId});
                const saved=readFeedReceiptEvidence({namespace,sourceId:query.subscriptionId,
                  sourceReadTaskId:knowledgeWatchTask.taskId,receiptId:receipt.receiptId});
                if (!saved) throw Object.assign(Error('订阅原始执行证据绑定未获确认'),{code:'RESULT_UNKNOWN'});
                runtimeApplication.runtime.saveCheckpoint(knowledgeWatchTask.taskId,
                  'knowledge-watch-source-read:'+receipt.receiptId,receipt);
                feedProofStore.set(sourceKey(query.subscriptionId),{...binding,receiptId:receipt.receiptId});
              }
              return read.confirmed.result;
            }
            if (['failed','cancelled','waiting_reconciliation','waiting_approval'].includes(read.task.state)) {
              throw Object.assign(Error('订阅工具读取未确认'),{code:read.task.error?.code??'RESULT_UNKNOWN'});
            }
            await new Promise(resolve=>setTimeout(resolve,10));
          }
        } finally {signal.removeEventListener('abort',cancel);}
      };
      knowledgeWatchHost = createKnowledgeWatchHost({
        profile: 'huawei_ict_agentarts',
        namespace,
        checkpointTaskId: knowledgeWatchTask.taskId,
        checkpoints: runtimeApplication.runtime,
        now: () => Date.now(),
        layaChooser: localLaya,
        runtime: runtimeApplication.runtime,
        feedCollect,
        readTrackingGrant:query=>feedsHost.readTrackingGrant(query),
        readTrackingGrantSnapshot:query=>feedsHost.readTrackingGrant(query),
        readInterestSignal:async query=>{
          if (query.namespace!==namespace) return undefined;
          const intake=feedProofStore.get(intakeKey(query.taskId));
          if (!intake || intake.taskId!==query.taskId) return undefined;
          const task=runtimeApplication.runtime.getTask(query.taskId);
          const grant=feedsHost.readTrackingGrant({namespace,sourceId:intake.subscriptionId,taskId:query.taskId});
          const current=feedsHost.readSourceBinding(intake.subscriptionId);
          const binding=feedProofStore.get(sourceKey(intake.subscriptionId));
          const receipt=rebuildFeedReceipt(binding);
          if (!current?.available || current.sensitivity!=='public' || current.containsCredentials
            || grant.state!=='granted' || !receipt || task.cancelRequested
            || createHash('sha256').update(JSON.stringify(task.goal)).digest('hex')!==intake.purposeDigest) return undefined;
          const original=runtimeApplication.runtime.loadCheckpoint(binding.sourceReadTaskId,'tool-result-'+binding.runId)?.result;
          const provenance=original?.sourceReceipt;
          if (!provenance?.publicFetch || provenance.sensitivity!=='public'
            || provenance.transport?.nativeFetch!==true || provenance.transport?.credentialFree!==true
            || original.items.some(item=>item.record.sensitivity!=='public')) return undefined;
          feedProvenance.assertFeedSourceReceiptMatches(provenance,original,
            {subscriptionId:intake.subscriptionId,configBinding:current.configurationRef});
          const topicId='feed:'+intake.subscriptionId;
          const validUntil=new Date(Math.min(Date.parse(receipt.observedAt)+600_000,Date.parse(grant.expiresAt))).toISOString();
          return {namespace,topicId,at:intake.classifiedAt,evidenceMaxAgeMs:600_000,
            watchDurationMs:Math.max(1,Date.parse(grant.expiresAt)-Date.parse(intake.classifiedAt)),scope:grant,
            evidence:[{id:query.taskId,topicId,sourceId:'conversation',sourceRevision:intake.purposeDigest,
              occurredAt:intake.classifiedAt,interactionId:query.taskId,kind:'question',match:'exact'}],
            explicitEnable:{id:grant.id,topicId,occurredAt:intake.classifiedAt},
            source:{id:intake.subscriptionId,revision:receipt.revision,visibility:'public',risk:'low',
              transportVerified:true,verificationExpiresAt:validUntil},
            sourceContent:{contentSha256:receipt.contentSha256,cacheVersion:receipt.revision,
              lastSuccessfulCheck:receipt.observedAt,validUntil}};
        },
        readFeedReceiptEvidence,
        knowledgeFeedReceipts:runtimeModule,
      });
      await knowledgeWatchHost.start();
      admitNativeFeedInterest=async()=>{
        for (const taskId of feedProofStore.get('feed-interest-intake-index') ?? []) {
          const intake=feedProofStore.get(intakeKey(taskId));
          if (!intake || feedsHost.readTrackingGrant({namespace,sourceId:intake.subscriptionId,taskId}).state!=='granted') continue;
          const task=runtimeApplication.runtime.getTask(taskId);
          const deadline=runtimeApplication.runtime.loadCheckpoint(taskId,'application-deadline')
            ?? runtimeApplication.runtime.loadCheckpoint(taskId,'host-tool-intent')?.deadline;
          if (!deadline || Date.now()>=Date.parse(deadline) || task.cancelRequested) continue;
          const signal=new AbortController().signal;
          await feedCollect({subscriptionId:intake.subscriptionId,limit:20},signal);
          await knowledgeWatchHost.consumeInterestTask(taskId,{deadline,signal});
        }
      };
      for (const fired of runtimeApplication.runtime.recoverMissedSchedules(`knowledge-watch:${namespace}`)) {
        if (fired.task) void dispatchKnowledgeFeedCheckTask(fired.task);
      }
      for (const task of runtimeApplication.runtime.listTasks({conversationId:`knowledge-watch:${namespace}`,states:['created'],limit:100}).items) {
        void dispatchKnowledgeFeedCheckTask(task);
      }
    } catch {
      try { knowledgeWatchHost?.dispose(); } catch {}
      knowledgeWatchHost = undefined;
    }
  }
  await pumpEvents();
  if (syntheticRepairHost && repairCandidateVersion === '1.0') {
    for (const task of tasks.values()) {
      if (task.state === 'succeeded') void promptSyntheticRepairCandidate(task.taskId).catch(() => {});
    }
  }
  eventPoll = setInterval(() => {void pumpEvents(); void tickProactiveP5(); void refreshMail(); void notepadHost?.refresh(); void todoHost?.tick();tickKnowledgeSchedules();
    void wikiSourceMonitor?.tick().then(changed=>{if(changed)publish();});}, 120);
}

async function initializeProductServices() {
  try {
    runtimeError = '';
    await initializeRuntime();
    await initializeModelFromEnvironment();
    if (competitionMode) {
      try {await initializeSisVoice();}
      catch {
        voiceInput = undefined;
        voiceInitializationFailure = {stage:'initialization',code:'EXTERNAL_FAILURE',message:'语音适配器启动失败'};
      }
      try {await initializeLiveVoice();}
      catch {runtimeError = 'Live 适配器启动失败；文字与听写仍可使用';}
    }
  } catch (error) {
    runtimeError = error instanceof Error ? error.message : 'Runtime 初始化失败';
    connectionLabel = 'Runtime 未连接';
    throw error;
  }
}

function repoRootForLocate() {
  try { return realpathSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')); }
  catch { return process.cwd(); }
}

function cancelKnowledgeTasks() {
  if(!runtimeApplication) return;
  for(const task of runtimeApplication.runtime.listTasks({limit:100}).items) {
    if(!['succeeded','failed','cancelled'].includes(task.state)
      && runtimeApplication.runtime.loadCheckpoint(task.taskId,'knowledge-source-binding-v1')!==undefined) {
      runtimeApplication.runtime.requestCancel(task.taskId,'知识源配置已变更或撤销');
    }
  }
}

async function action(event, name, payload) {
  const sender = [orb, panel, admin, workspace].find(win => win && !win.isDestroyed() && win.webContents === event.sender);
  if (!sender || event.senderFrame !== sender.webContents.mainFrame) throw Error('Untrusted sender');
  if (competitionMode && ['model.configure', 'model.test', 'model.toggle'].includes(name)) {
    throw Error('Competition Profile 的 AgentArts 配置只允许由可信主进程提供；盘古配置操作不可用');
  }
  if (name === 'snapshot') return snapshot(sender === workspace ? 'workspace' : sender === admin ? undefined : 'panel');
  if(name==='remoteMcp.open') {
    if(sender!==admin || !competitionMode || !remoteMcpManagement || payload!==undefined)throw Error('请从正式管理后台打开远程 MCP 管理');
    remoteMcpManagement.open();return;
  }
  if (['agentartsModels.state','agentartsModels.refresh','agentartsModels.configure'].includes(name)) {
    if(sender!==admin || !competitionMode || !agentArtsModels)throw Error('请从模型设置管理 AgentArts 模型');
    const result=name==='agentartsModels.state'?agentArtsModels.snapshot():name==='agentartsModels.refresh'?await agentArtsModels.refresh():agentArtsModels.configure(payload);publish();return result;
  }
  if (['modelApi.state','modelApi.configure','modelApi.remove'].includes(name)) {
    if (sender !== admin || !competitionMode || !modelApiHost) throw Error('请从模型设置管理辅助模型');
    const result = name === 'modelApi.state' ? modelApiHost.snapshot()
      : name === 'modelApi.configure' ? modelApiHost.configure(payload) : modelApiHost.remove(payload);
    publish();return result;
  }
  if (name === 'notepad.start' || name === 'notepad.cancel') {
    if ((sender !== admin && sender !== workspace) || !notepadHost || notepadClosing) throw Error('请从电脑操控设置操作记事本');
    return name === 'notepad.start' ? notepadHost.start(payload) : notepadHost.cancel();
  }
  if (name === 'notepad.reconcile') {
    if (sender !== admin || !notepadHost || notepadClosing) throw Error('请从可信后台核实原始记事本任务');
    return notepadHost.recover(payload);
  }
  if (name === 'task.locate') {
    // MOD-35：对失败任务的错误输出做确定性定位（纯解析，无模型、无副作用）。
    if (sender !== panel && sender !== admin && sender !== workspace) throw Error('Untrusted sender for task.locate');
    const text = typeof payload?.text === 'string' ? payload.text : '';
    if (!text.trim() || text.length > 2 * 1024 * 1024) throw Error('无可定位的错误输出');
    const {locateTestFailures} = await import('@personal-agent/coding-tools');
    const report = locateTestFailures(text, {root: repoRootForLocate(), contextLines: 2});
    return {failures: report.failures.map(f => ({name: f.name, error: f.error, timedOut: f.timedOut,
      frames: f.frames.map(fr => ({file: fr.file, line: fr.line, column: fr.column, confidence: fr.confidence,
        snippet: fr.snippet === undefined ? null : fr.snippet}))})),
      totalFailures: report.totalFailures};
  }
  if (name === 'admin.open') { openAdmin(payload?.page); return; }
  if (name === 'workspace.open' && sender === panel) { await openWorkspace(); return; }
  if (name === 'workspace.close' && sender === workspace) { workspace.close(); return; }
  if (name === 'workspace.minimize' && sender === workspace) { workspace.minimize(); return; }
  if (name === 'workspace.maximize' && sender === workspace) { if(workspace.isMaximized()) workspace.unmaximize(); else workspace.maximize(); return; }
  if (name === 'admin.close') {
    if (sender !== admin) throw Error('Untrusted sender');
    admin.close(); return;
  }
  if (name === 'panel.pin' && sender === panel) { const next=Boolean(payload);if(next===pinned)return;pinned=next;publish();return; }
  if (name === 'panel.hide' && sender === panel) { await hidePanel(); return; }
  if (name === 'orb.open' && sender === orb) { pinned = true; openPanel(true); publish(); return; }
  if (name === 'orb.dragStart' && sender === orb) {
    const revision = ++orbDragRevision, dragWindow = orb;
    await hidePanel();
    if (revision !== orbDragRevision || orb !== dragWindow || dragWindow.isDestroyed()) return;
    dragging = true; const point = screen.getCursorScreenPoint(); const bounds = orb.getBounds();
    dragOffset = {x: point.x - bounds.x, y: point.y - bounds.y}; return;
  }
  if (name === 'orb.dragEnd' && sender === orb) { orbDragRevision++; if (dragging === 'panel') return; dragging = false; desktopHost.snap(orb); away = Date.now() + 400; return; }
  if (name === 'panel.dragStart' && sender === panel) {
    if (!payload || !Number.isFinite(payload.x) || !Number.isFinite(payload.y)) throw Error('拖动坐标无效');
    orbDragRevision++;
    dragging = 'panel';
    panelDragOrigin = {pointer: {x: payload.x, y: payload.y}, orb: orb.getBounds()};
    return;
  }
  if (name === 'panel.dragMove' && sender === panel && dragging === 'panel') {
    if (!payload || !Number.isFinite(payload.x) || !Number.isFinite(payload.y)) throw Error('拖动坐标无效');
    movePanelGroup(payload);
    return;
  }
  if (name === 'panel.dragEnd' && sender === panel) { orbDragRevision++; dragging = false; panelDragOrigin = undefined; away = Date.now() + 400; return; }
  if (name === 'app.quit') { app.quit(); return; }
  if (name === 'agentarts.configure') {
    if (sender!==admin || !competitionMode || runtimeApplication?.activeTaskCount || liveVoice?.hasActive()
      || runtimeStartup.snapshot().state==='starting') throw Error('请在任务、通话及启动结束后从设置配置 AgentArts');
    const result=agentArtsConfig.configure(payload);
    cloudRequestFailureNotice = '';
    try {
      const startup = await runtimeStartup.start();
      if (liveVoice && !liveShortcut.registered) registerLiveShortcut();
      const requiresRestart = startup.state !== 'ready' || result.gatewayUrl !== activeCloudBinding?.gatewayUrl
        || result.runtimeName !== activeCloudBinding?.runtimeName
        || activeCloudTransportSignature!==JSON.stringify([agentArtsConfig.readTransportPreferences(),result.deploymentVersion]);
      if (!requiresRestart) await initializeModelFromEnvironment();
      return {...result, requiresRestart, reason: requiresRestart
        ? '配置已加密保存，请重启应用完成连接。'
        : '配置已加密保存，Runtime 已连接；云端可用性以实际任务结果为准。'};
    } finally {publish();}
  }
  if (name === 'agentarts.revoke') {
    if (sender !== admin || !competitionMode || runtimeApplication?.activeTaskCount || liveVoice?.hasActive()
      || runtimeStartup.snapshot().state === 'starting') throw Error('请在任务、通话及启动结束后从设置撤销 AgentArts');
    cloudRequestFailureNotice = '';
    try {
      const result = agentArtsConfig.revoke();
      return {...result, reason: '已清除保存在本机的 AgentArts 凭据与绑定配置。'};
    } finally {publish();}
  }
  if (['todo.authorize','todo.revoke','todo.configureNotifications','todo.dismiss','todo.create','todo.update'].includes(name)) {
    if ((sender !== admin && sender !== workspace && sender !== panel) || !competitionMode || syntheticMvp || !todoHost) throw Error('请从正式应用待办设置操作');
    const result = await todoHost[name.slice(5)](payload); publish(); return result;
  }
  if (['notifications.get','notifications.configure','notifications.confirmation.prepare','notifications.read','notifications.digest'].includes(name)) {
    if (sender!==admin || !competitionMode || syntheticMvp || !notificationApplicationHost) throw Error('请从通知设置页操作');
    if (name==='notifications.get') return notificationApplicationHost.snapshot(payload?.scope??{kind:'global'});
    if (name==='notifications.configure') {
      const origin=admin,host=notificationApplicationHost;
      const result=await host.configureSettings(payload,{isCurrent:()=>admin===origin && !origin.isDestroyed() && host===notificationApplicationHost});
      publish();return {...result,notificationCenter:host.snapshot(payload.scope)};
    }
    if (name==='notifications.confirmation.prepare') {
      const question=voiceCommandHost.prepareSettings(payload,{
        expiresAt:new Date(Date.now()+30_000).toISOString(),summary:`通知设置：${JSON.stringify(payload.scope)}；${JSON.stringify(payload.patch)}。是否确认当前参数？`});
      return {...question,questionDelivery:liveVoice?.askCurrentQuestion()??{state:'unavailable',accepted:false}};
    }
    if (name==='notifications.read') return notificationApplicationHost.acknowledgeRead(payload);
    return notificationApplicationHost.getDigest(payload);
  }
  if (['voice.confirmation.prepareApproval','voice.confirmation.cancel','voice.confirmation.reconcile'].includes(name)) {
    if ((sender!==admin && sender!==panel) || !voiceCommandHost) throw Error('当前语音确认宿主不可用');
    if(name==='voice.confirmation.prepareApproval') {
      const approval=runtimeApplication.runtime.getApproval(payload?.approvalId),task=tasks.get(approval.taskId);
      if(sender===panel && (!task || taskSurface(task)!=='panel')) throw Error('无法确认其他工作区的审批');
      const question=voiceCommandHost.prepareApproval(payload);
      return {...question,questionDelivery:liveVoice?.askCurrentQuestion()??{state:'unavailable',accepted:false}};
    }
    return name.endsWith('cancel')?voiceCommandHost.cancel():voiceCommandHost.reconcile();
  }
  if (['goalCloud.authorize','goalCloud.revoke'].includes(name)) {
    if(sender!==admin || !competitionMode || syntheticMvp || !goalCloudHost) throw Error('请从正式应用目标管理设置操作');
    const result=goalCloudHost[name.slice('goalCloud.'.length)](payload);publish();return result;
  }
  if (['feeds.add','feeds.remove','feeds.authorize','feeds.revoke','feeds.refresh','feeds.classify'].includes(name)) {
    if (sender !== admin || !competitionMode || syntheticMvp || !feedsHost) throw Error('请从正式应用订阅设置操作');
    if (name === 'feeds.classify') {
      if (!payload || Object.keys(payload).length !== 2 || typeof payload.subscriptionId !== 'string'
        || typeof payload.taskId !== 'string') throw Error('请选择订阅和原始任务');
      const originAdmin=admin, originApplication=runtimeApplication, originFeeds=feedsHost;
      const choice=originFeeds.prepareNativeSourceChoice(payload);
      const answer=await dialog.showMessageBox(originAdmin,{type:'question',title:'订阅来源与持续跟踪许可',
        message:`订阅：${choice.title}\n原任务：${choice.taskId}\n用途：${choice.goal}`,
        detail:`实际地址：${choice.url}\n许可到期：${choice.deadline}\n公开选择只适用于无需凭据的公共资料，并允许该原任务持续跟踪；来源获取仍需真实读取证据。分类改变会关闭本会话读取许可并使旧任务绑定失效，请重新允许本会话读取。`,
        buttons:choice.containsCredentials ? ['取消','保持私人'] : ['取消','公开并允许本任务跟踪','保持私人'],
        defaultId:0,cancelId:0,noLink:true});
      if (admin !== originAdmin || originAdmin.isDestroyed() || runtimeApplication !== originApplication
        || feedsHost !== originFeeds) throw Error('订阅许可窗口已经改变');
      if (answer.response === 0) return originFeeds.snapshot();
      const result=originFeeds.applyNativeSourceChoice(choice,
        !choice.containsCredentials && answer.response === 1 ? 'public' : 'private');
      if (!choice.containsCredentials && answer.response === 1) {
        const storage=originApplication.createHostStateStore('knowledge-tracking');
        const key='feed-interest-intake:'+createHash('sha256').update(choice.taskId).digest('hex');
        const previous=storage.get(key);
        if (previous && previous.subscriptionId!==choice.subscriptionId) throw Error('原任务已绑定另一个订阅来源');
        if (!previous) storage.set(key,{taskId:choice.taskId,subscriptionId:choice.subscriptionId,
          purposeDigest:choice.purposeDigest,classifiedAt:new Date().toISOString()});
        storage.set('feed-interest-intake-index',[...new Set([...(storage.get('feed-interest-intake-index') ?? []),choice.taskId])]);
      }
      publish();return result;
    }
    if (name !== 'feeds.revoke' && name !== 'feeds.refresh' && (runtimeApplication?.activeTaskCount || runtimeStartup.snapshot().state==='starting')) {
      throw Error('请等待当前任务和启动结束后修改订阅');
    }
    const result = name === 'feeds.refresh' ? feedsHost.snapshot() : feedsHost[name.slice('feeds.'.length)](payload);
    if (name==='feeds.authorize') await admitNativeFeedInterest?.();
    publish(); return result;
  }
  if (name === 'coding.reconcile') {
    const application = runtimeApplication;
    const authorized = () => sender === admin && !sender.isDestroyed()
      && sender.webContents === event.sender && event.senderFrame === sender.webContents.mainFrame
      && application === runtimeApplication && competitionMode && !syntheticMvp;
    const recovery = createWorkspacePatchRecoveryHost({application, isAuthorized: authorized});
    const result = await recovery.reconcile(payload);
    publish(); return result;
  }
  if (['coding.select','coding.selectNode','coding.selectNpmCli','coding.selectCheckFile','coding.authorize','coding.revoke'].includes(name)) {
    if ((sender !== admin && sender !== workspace) || !competitionMode || syntheticMvp || !codingWorkspace) throw Error('请从正式应用设置配置编程工作区');
    if (name !== 'coding.revoke' && runtimeApplication.activeTaskCount > 0) throw Error('请等待当前任务结束后更改工作区');
    await referenceHost?.invalidate();
    let selectionResult;
    if (name === 'coding.select') selectionResult = await codingWorkspace.select();
    if (name === 'coding.selectNode') selectionResult = await codingWorkspace.selectNode();
    if (name === 'coding.selectNpmCli') selectionResult = await codingWorkspace.selectNpmCli();
    if (name === 'coding.selectCheckFile') selectionResult = await codingWorkspace.selectCheckFile();
    if (name === 'coding.authorize') codingWorkspace.authorize(payload);
    if (name === 'coding.revoke') codingWorkspace.revoke();
    publish();return {coding:codingWorkspace.snapshot(),
      ...(selectionResult?.selectionCancelled === true ? {codingSelectionCancelled:true} : {})};
  }
  if (['reference.mcp','reference.skill','reference.run','reference.reconcile'].includes(name)) {
    if(sender!==admin || !competitionMode || syntheticMvp || !referenceHost) throw Error('请从正式应用的插件设置操作参考工具');
    const result=name==='reference.mcp'?await referenceHost.setMcpEnabled(payload?.enabled)
      :name==='reference.skill'?referenceHost.setSkillEnabled(payload?.enabled)
      :name==='reference.run'?referenceHost.submit({path:payload?.path})
      :await referenceHost.reconcile(payload?.taskId);
    publish();return result;
  }
  if (['calendar.configure','calendar.revoke'].includes(name)) {
    if (sender !== admin || !competitionMode || syntheticMvp || !calendarConfig) throw Error('请从正式应用日历设置操作');
    if (name === 'calendar.configure' && (runtimeApplication?.activeTaskCount || runtimeStartup.snapshot().state === 'starting')) throw Error('请等待当前任务及启动结束后修改日历配置');
    if (name === 'calendar.revoke') calendarMeetingHost?.invalidate();
    const result = name === 'calendar.configure' ? calendarConfig.configure(payload) : calendarConfig.revoke();
    if (name === 'calendar.configure') calendarMeetingHost?.invalidate();
    publish(); return result;
  }
  if (['calendar.read','calendar.readTask','calendar.bindMeeting','calendar.refreshMeeting',
    'calendar.respond','calendar.cancel'].includes(name)) {
    if (sender !== admin || !competitionMode || syntheticMvp || !calendarMeetingHost || !client) {
      throw Error('请从正式应用日历设置操作');
    }
    if (name === 'calendar.read') return calendarMeetingHost.read(payload);
    if (name === 'calendar.readTask') return calendarMeetingHost.readTask(payload);
    if (name === 'calendar.bindMeeting') return calendarMeetingHost.bindMeeting(payload);
    if (name === 'calendar.refreshMeeting') return calendarMeetingHost.refreshMeeting(payload,
      p5Cognition?.refreshCalendarMeeting.bind(p5Cognition));
    if (name === 'calendar.cancel') {
      calendarMeetingHost.readTask(payload);
      return client.call('task.cancel', {taskId: payload, reason: '用户取消日历读取'});
    }
    const task = calendarMeetingHost.readTask(payload?.taskId);
    if (!task.approval || task.approval.approvalId !== payload?.approvalId
      || task.approval.revision !== payload?.revision || !['allow_once','deny'].includes(payload?.decision)) {
      throw Error('日历审批已变更或不属于此任务');
    }
    const response = await client.call('authorization.respond', calendarApprovalResponse(payload));
    publish();return response;
  }
  if (['mail.configure','mail.enable','mail.read','mail.disable','mail.enableCloud','mail.disableCloud','laya.start','laya.stop'].includes(name)) {
    if (sender !== admin || !competitionMode || !mailConfig || !localLaya) throw Error('此操作仅允许从本项目设置调用');
    if (name === 'laya.start') {
      localServicesStopped = false;
      const result = await localLaya.start();
      if (result?.state === 'ready' && proactiveHost?.snapshot().enabled) await startP5DeviceTelemetry();
      publish();
      return result;
    }
    if (name === 'laya.stop') {
      await stopP5DeviceTelemetry();
      await mailHost?.cancel();
      const result = await localLaya.stop();
      publish();
      return result;
    }
    if (name === 'mail.configure') {await mailConfig.configure(payload); mailFailure = '';}
    if (name === 'mail.enable') mailConfig.enableSession(payload);
    if (name === 'mail.disable') await mailConfig.revoke();
    if (name === 'mail.enableCloud') mailConfig.enableCloudAnalysis(payload);
    if (name === 'mail.disableCloud') await mailConfig.revokeCloudAnalysis();
    if (name === 'mail.read') {
      if (!mailHost || mailConfig.snapshot().requiresRestart) throw Error('邮箱配置将在下次启动应用时接入');
      if (!localLaya.snapshot().ready) throw Error('请先启动本地 Laya');
      if (mailHost.snapshot().status === 'classification_unavailable') mailHost.retryClassification();
      else mailHost.startBatch({expiresAt:new Date(Date.now() + 8 * 60 * 60_000).toISOString()});
      localServicesStopped = false;
    }
    publish(); return mailSnapshot();
  }
  if(name==='knowledge.pair' || name==='knowledge.pair.revoke') {
    if(sender!==admin || !competitionMode || !obsidianPairing || payload!==undefined) throw Error('配对仅允许管理后台打开原生窗口');
    if(name==='knowledge.pair') await obsidianPairing.pair();
    else obsidianPairing.useFilesystem();
    publish();return {...knowledgeSourceConfig.snapshot(),monitor:wikiSourceMonitor?.snapshot(),pairing:obsidianPairing.snapshot()};
  }
  if (typeof name==='string' && name.startsWith('knowledge.source.')) {
    if(sender!==admin || !competitionMode || !knowledgeSourceConfig || !knowledgeTools) throw Error('知识源仅在正式管理后台可用');
    const action=name.slice('knowledge.source.'.length);
    if(['select','selectNotes','configure','revoke'].includes(action)) {
      obsidianPairing?.useFilesystem();
      const result=await knowledgeSourceConfig[action](payload);
      cancelKnowledgeTasks();
      publish();return result;
    }
    if(['readNote','submitPatch'].includes(action) && obsidianPairing?.snapshot().mode==='plugin') throw Error('插件配对仅支持只读检索；请先显式撤销配对以整理文件源');
    if(action==='readNote') return knowledgeSourceConfig.readSelectedNote(payload);
    if(action==='reconcile') {
      if(!payload || Object.keys(payload).some(key=>key!=='taskId') || typeof payload.taskId!=='string')throw Error('原知识任务标识无效');
      const task=await runtimeApplication.reconcileKnowledgeWriteTask(payload.taskId,
        {deadline:new Date(Date.now()+30000).toISOString(),signal:new AbortController().signal});
      const projection=await knowledgeTools.recoverProjection(payload.taskId,
        {deadline:new Date(Date.now()+30000).toISOString(),signal:new AbortController().signal});
      publish();return {taskId:task.taskId,state:task.state,projection};
    }
    if(action==='submitPatch') {
      const binding=knowledgeSourceConfig.snapshot();
      if(payload?.sourceId!==binding.sourceId || payload?.configRevision!==binding.configRevision) throw Error('笔记配置已改变，请重新读取');
      const commandId='knowledge-note-'+randomUUID();
      const task=runtimeApplication.prepareHostToolTask({commandId,toolName:'knowledge.apply_note_patch',toolVersion:'1.0.0',
        deadline:new Date(Date.now()+60000).toISOString()});
      if(!knowledgeTools.bindTask(task.taskId)) {
        runtimeApplication.cancelPreparedHostToolTask(task.taskId,commandId,task.revision);throw Error('知识源尚未就绪');
      }
      const result=runtimeApplication.finalizeHostToolTask({taskId:task.taskId,commandId,expectedTaskRevision:task.revision,
        arguments:{sourceId:binding.sourceId,configRevision:binding.configRevision,path:payload.path,
          expectedSha256:payload.expectedSha256,edits:payload.edits}});
      publish();return {taskId:result.task.taskId,state:result.task.state};
    }
    throw Error('不支持的知识源操作');
  }
  if (name === 'knowledge.search') {
    if(sender!==admin || !knowledgeSourceConfig || !knowledgeTools) throw Error('知识检索仅在管理后台可用');
    const query=typeof payload?.query==='string'?payload.query.trim():'';
    if(!query) throw Error('检索词不能为空');
    const binding=(obsidianPairing?.source ?? knowledgeSourceConfig).snapshot(),commandId='knowledge-search-'+randomUUID();
    const deadline=new Date(Date.now()+30000).toISOString();
    const task=runtimeApplication.prepareHostToolTask({commandId,toolName:'knowledge.search',toolVersion:'1.0.0',deadline});
    if(!knowledgeTools.bindTask(task.taskId)) {
      runtimeApplication.cancelPreparedHostToolTask(task.taskId,commandId,task.revision);throw Error('请先启用所选知识源');
    }
    runtimeApplication.finalizeHostToolTask({taskId:task.taskId,commandId,expectedTaskRevision:task.revision,
      arguments:{sourceId:binding.sourceId,configRevision:binding.configRevision,query,limit:Math.min(20,Math.max(1,Number(payload.limit)||5))}});
    while(Date.now()<Date.parse(deadline)) {
      const readback=runtimeApplication.readHostToolTask(task.taskId);
      if(readback.task.state==='succeeded' && readback.confirmed) return readback.confirmed.result;
      if(['failed','cancelled','waiting_approval','waiting_reconciliation'].includes(readback.task.state)) throw Error('知识读取尚未确认，请查看原任务状态');
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    throw Error('知识读取超时，请核对原任务结果');
  }
  if (name === 'knowledge.status') return snapshot(sender === workspace ? 'workspace' : sender === admin ? undefined : 'panel').knowledge;
  if (name.startsWith('proactive.workflow.')) {
    if ((sender!==panel&&sender!==admin)||!competitionMode||!proactiveWorkflowApplication)throw Error('持续工作流仅允许可信设置或面板调用');
    if(name==='proactive.workflow.status')return proactiveWorkflowApplication.snapshot();
    if(name==='proactive.workflow.start')return proactiveWorkflowApplication.start(payload);
    if(name==='proactive.workflow.control')return proactiveWorkflowApplication.control(payload);
    if(!payload||Object.keys(payload).some(key=>key!=='taskId')||typeof payload.taskId!=='string')throw Error('原持续工作流任务标识无效');
    if(name==='proactive.workflow.resume')return proactiveWorkflowApplication.resume(payload.taskId);
    if(name==='proactive.workflow.read')return proactiveWorkflowApplication.read(payload.taskId);
    throw Error('持续工作流操作未公布');
  }
  if (name === 'proactive.configure' || name === 'proactive.analyze' || name === 'proactive.cognition.apply') {
    if ((sender !== panel && sender !== admin) || !competitionMode || !proactiveHost) throw Error('主动观察仅允许可信设置或面板调用');
    if (name === 'proactive.configure') {
      const configuration = proactiveHost.configure(payload);
      if (payload?.enabled === false && !proactiveHost.snapshot().enabled) await stopP5DeviceTelemetry();
      const result = await configuration;
      if (payload?.enabled === true && localLaya?.snapshot().state === 'ready') await startP5DeviceTelemetry();
      publish();
      return result;
    }
    if (name === 'proactive.cognition.apply') {
      const reviewTaskId = typeof payload?.reviewTaskId === 'string' ? payload.reviewTaskId.trim() : '';
      if (!reviewTaskId) throw Error('审阅记录标识不能为空');
      return proactiveHost.applyCognitionDecision(reviewTaskId);
    }
    if (!payload || Object.keys(payload).some(key => key !== 'id') || typeof payload.id !== 'string') throw Error('主动分析请求无效');
    return proactiveHost.analyze(payload.id);
  }
  if (name.startsWith('cognition.')) {
    if (name === 'cognition.status') return p5StatusSnapshot();
    if (sender !== panel && sender !== admin && sender !== workspace) throw Error('认知操作仅允许可信窗口调用');
    if (!competitionMode || !p5Cognition) throw Error('认知组合尚未就绪');
    if (name === 'cognition.proposals.list') return p5Cognition.getPendingProposals();
    if (name === 'cognition.proposals.apply') {
      if (!payload || Object.keys(payload).some(key => !['eventId', 'source'].includes(key))
        || typeof payload.eventId !== 'string' || !payload.eventId.trim() || payload.eventId.length > 256
        || typeof payload.source !== 'string' || !payload.source.trim() || payload.source.length > 256) {
        throw Error('提议必须提供事件与来源标识');
      }
      return p5Cognition.applyMeetingProposal({eventId: payload.eventId, source: payload.source},
        {deadline: new Date(Date.now() + 60_000).toISOString()});
    }
    if (name === 'cognition.receipts.list') return p5Cognition.listMeetingReceipts();
    if (name === 'cognition.dialogue') return p5Cognition.dialogueProjection();
    if (name === 'cognition.device.feedback') {await refreshP5DeviceFeedback(); return structuredClone(p5DeviceFeedback);}
    if (name === 'cognition.mail.triage') {
      throw Error('邮件分类请使用已授权的邮箱读取入口，邮件来源由主进程绑定');
    }
    if (name === 'cognition.mail.triagePaged') {
      throw Error('分页邮件源必须由主进程绑定');
    }
    throw Error(`Unsupported cognition action: ${name}`);
  }
  if (name.startsWith('knowledge.watch.')) {
    if (name === 'knowledge.watch.status') {
      return knowledgeWatchHost?.snapshot() ?? {state: 'unavailable', reason: '知识关注宿主尚未装配'};
    }
    if (sender !== panel && sender !== admin && sender !== workspace) throw Error('知识关注仅允许可信窗口调用');
    if (!competitionMode || !knowledgeWatchHost) throw Error('知识关注宿主尚未就绪');
    if (name === 'knowledge.watch.list') return knowledgeWatchHost.listWatches();
    if (name === 'knowledge.watch.pending') return knowledgeWatchHost.listPending();
    if (name === 'knowledge.watch.dialogue') return knowledgeWatchHost.dialogueProjection?.() ?? {items: []};
    if (name === 'knowledge.watch.refresh') {
      const result = await knowledgeWatchHost.refreshSubscribedFeed(payload);
      await pumpEvents();
      publish();
      return result;
    }
    if (name === 'knowledge.watch.read') {
      const result = await knowledgeWatchHost.markNoticeRead(payload?.id);
      publish();
      return result;
    }
    if (name === 'knowledge.watch.pause' || name === 'knowledge.watch.resume') {
      const result = await knowledgeWatchHost[name.endsWith('.pause')?'pause':'resume'](payload?.topicId);
      publish();return result;
    }
    if (name === 'knowledge.watch.bind') {
      const topicId = typeof payload?.topicId === 'string' ? payload.topicId.trim() : '';
      if (!topicId) throw Error('关注主题标识不能为空');
      const result = await knowledgeWatchHost.bindObservedRevision(topicId);
      publish();
      return result;
    }
    if (name === 'knowledge.watch.revoke') {
      const topicId = typeof payload?.topicId === 'string' ? payload.topicId.trim() : '';
      if (!topicId) throw Error('关注主题标识不能为空');
      const result = await knowledgeWatchHost.revoke(topicId, payload);
      publish();
      return result;
    }
    throw Error(`Unsupported knowledge watch action: ${name}`);
  }
  if (name === 'voice.stop') {
    if (sender !== panel) throw Error('语音操作只能从面板调用');
    if (liveVoice?.hasActive()) {liveVoice.interrupt(); return {stopped: true};}
    return voiceInput ? voiceInput.stopSpeaking(sender.webContents.id)
      : {available: false, stopped: false, reason: '语音供应商尚未连接'};
  }
  if (name === 'voice.wake.enable' || name === 'voice.wake.disable') {
    if (sender !== panel || !competitionMode || payload !== undefined) throw Error('唤醒只能从可信面板显式操作');
    if (name === 'voice.wake.disable') {
      await stopWakeVoice(); publish(); return snapshot('panel').wake;
    }
    if (!panel.isVisible() || panelHiding || voiceConfigurationPending || wakeQuitUnknown
      || !sisConfigHost?.snapshot().configured || !wakeVoice || !voiceInput) {
      throw Error('请先显示面板并连接华为 SIS 语音');
    }
    pinned = true;
    return wakeVoice.enable(sender.webContents.id);
  }
  if (name === 'voice.configure' || name === 'voice.login') {
    if (sender !== admin || !competitionMode) throw Error('SIS 配置只能从 Competition 可信设置页提交');
    if (voiceConfigurationPending) throw Error('语音配置正在更新，请稍候');
    if (!voiceInput && sisPlaybackHost) throw Error('旧语音播放资源释放未确认，无法重新装配');
    voiceConfigurationPending = true;
    try {
    await stopWakeVoice();
    if (voiceInput?.hasActive() || liveVoice?.hasActive()) throw Error('请先结束当前语音会话再更新 SIS 配置');
    const configuration = name === 'voice.login' ? await acquireHuaweiSisToken(payload) : payload;
    // A voice capture may have started while the IAM request was in flight.
    if (voiceInput?.hasActive() || liveVoice?.hasActive() || wakeVoice?.hasActive()) throw Error('请先结束当前语音会话再更新 SIS 配置');
    sisConfigHost.configure(configuration ?? {});
    await stopWakeVoice(true);
    wakeVoice = undefined;
    if (voiceInput) {
      try { await voiceInput.dispose(); }
      catch {
        voiceInput = undefined;
        voicePcmSource = undefined;
        voiceInitializationFailure = {stage: 'cleanup', code: 'EXTERNAL_FAILURE',
          message: '旧语音资源释放未确认'};
        publish();
        throw Error('SIS 配置已保存，但旧语音资源释放未确认');
      }
      voiceInput = undefined;
      voicePcmSource = undefined;
      sisPlaybackHost = undefined;
    }
    try { await initializeSisVoice(); }
    catch {
      voiceInitializationFailure = {stage: 'initialization', code: 'EXTERNAL_FAILURE',
        message: 'SIS 语音适配器启动失败'};
      publish();
      throw Error('SIS 配置已保存，但语音适配器启动失败');
    }
    publish();
    return {...sisConfigHost.snapshot(), connected: Boolean(voiceInput)};
    } finally { voiceConfigurationPending = false; }
  }
  if (name.startsWith('voice.record.') || name === 'voice.play') {
    if (sender !== panel || !voiceInput) throw Error('语音试用只允许从 Competition 可信面板调用');
    if (voiceConfigurationPending) throw Error('语音配置正在更新，请稍候');
    if (liveVoice?.hasActive()) throw Error('请先关闭 Live 再使用语音转文字');
    const senderId = sender.webContents.id;
    if (name === 'voice.record.start') {
      if (panelHiding || !panel.isVisible()) throw Error('请先显示面板');
      if (wakeQuitUnknown) throw Error('唤醒音频资源释放未确认');
      if (wakeVoice?.snapshot().phase === 'listening') return wakeVoice.beginCapture(senderId);
      if (wakeVoice?.hasActive()) throw Error('唤醒正在切换或资源释放未确认，请先关闭唤醒');
      return voiceInput.beginCapture(senderId);
    }
    if (name === 'voice.record.finish') return voiceInput.finishCapture(senderId);
    if (name === 'voice.record.cancel') return voiceInput.cancelCapture(senderId);
    if (name === 'voice.play') {
      await stopWakeVoice();
      if (wakeVoice?.hasActive()) throw Error('请先关闭唤醒');
      return voiceInput.playReply(senderId);
    }
    throw Error('Unsupported voice action');
  }
  if (name === 'live.configure') {
    if (payload?.hotkey === 'F9') throw Error('F9 用于记事本本次写入确认，请为 Live 选择其他快捷键');
    if ((sender !== panel && sender !== admin) || !competitionMode) throw Error('Live 配置只能从可信面板或设置提交');
    if (voiceConfigurationPending) throw Error('语音配置正在更新，请稍候');
    voiceConfigurationPending = true;
    try {
      await stopWakeVoice();
      if (liveVoice?.hasActive() || voiceInput?.hasActive()) throw Error('请先结束语音再修改配置');
      const result = liveConfig.configure(payload);
      registerLiveShortcut(); publish(); return result;
    } finally {voiceConfigurationPending = false;}
  }
  if (name === 'live.toggle') {
    if (sender !== panel || !competitionMode) throw Error('Live 只能从可信面板开启');
    return toggleLive();
  }
  if (name === 'voice.capture.authorize') {
    if (sender !== panel || !competitionMode) throw Error('麦克风只允许 Competition 可信面板启用');
    if (!client) throw Error('Runtime 未连接，麦克风采集尚不可用');
    if (!voicePcmSource) throw Error('Voice PCM 来源尚未接入');
    if (voiceConfigurationPending || panelHiding || wakeQuitUnknown || wakeVoice?.hasActive() || liveVoice?.hasActive()) throw Error('请先结束唤醒或 Live 会话');
    const result = microphoneCaptureHost.authorize();
    publish();
    return result;
  }
  if (name === 'voice.capture.revoke') {
    if (sender !== panel) throw Error('麦克风只能从可信面板关闭');
    await stopWakeVoice();
    await liveVoice?.stop();
    await microphoneCaptureHost.revoke();
    publish();
    return microphoneCaptureHost.snapshot();
  }
  if (name === 'clipboard.writeText') {
    if ((sender !== panel && sender !== workspace) || typeof payload !== 'string' || payload.length > 50000) throw Error('剪贴板内容无效');
    clipboard.writeText(payload);
    return {copied: true};
  }
  if (name === 'model.configure') {
    if (sender !== admin) throw Error('模型配置只能从管理后台调用');
    return configurePangu(payload);
  }
  if (name === 'model.test') {
    if (sender !== admin) throw Error('模型测试只能从管理后台调用');
    return testPangu();
  }
  if (name === 'model.toggle') {
    if (sender !== admin) throw Error('模型启停只能从管理后台调用');
    return toggleModel(payload);
  }
  if (typeof name === 'string' && name.startsWith('learning.')) {
    if(sender!==admin || !competitionMode || !memoryLearningHost) throw Error('流程学习仅在正式管理后台可用');
    const result=await memoryLearningHost.invoke(name,payload);publish();return result;
  }
  if (typeof name === 'string' && name.startsWith('memory.')) {
    if (sender !== admin || !competitionMode || !runtimeApplication) {
      throw Error('私人记忆仅在 Competition 管理后台可用');
    }
    if (name === 'memory.selectVault') {
      if (!knowledgeSourceConfig) throw Error('受信知识源尚未就绪');
      obsidianPairing?.useFilesystem();
      const before = knowledgeSourceConfig.snapshot().sourceId;
      const selected = await knowledgeSourceConfig.select();
      privateMemoryController();
      publish();
      return {selected: selected.available && selected.sourceId !== before};
    }
    if (name === 'memory.search') {
      return privateMemoryController().search(payload?.query);
    }
    if (name === 'memory.listSaved') return privateMemoryController().listSaved(payload);
    if (name === 'memory.selectForConversation') {
      if (!privateConsumption || !payload || Object.keys(payload).some(key=>!['conversationId','ref'].includes(key))
        || !conversations?.containsConversation(payload.conversationId)) throw Error('请选择原对话与精确记忆版本');
      return privateConsumption.select(payload);
    }
    if(['memory.delete','memory.withdraw','memory.save','memory.previewSave','memory.boundErase'].includes(name)) {
      if(!memoryLearningHost) throw Error('私人记忆保障尚未接通');
      const result=await memoryLearningHost.invoke(name,payload);publish();return result;
    }
    throw Error('不支持的私人记忆操作');
  }
  if(['conversation.new','conversation.switch','conversation.rename','conversation.archive','conversation.restore','conversation.draft','conversation.readDraft'].includes(name)){
    if(sender!==panel&&sender!==workspace)throw Error('请从受信对话窗口管理会话');
    return handleConversationAction({name,payload,surface:sender===workspace?'workspace':'panel',conversations,tasks,taskSurface,submitting,publish});
  }
  if (name === 'thinking.update') {
    if (sender !== panel && sender !== admin && sender !== workspace) throw Error('思考设置来源不受信任');
    if (!competitionMode) return updateThinking(payload);
    const conversationId = conversations.activeConversationId(sender===workspace?'workspace':'panel');
    if(payload?.conversationId!==undefined&&payload.conversationId!==conversationId)throw Error('当前对话已切换，请重新操作');
    const previous = conversations.preference(conversationId,{depth:thinking.depth,fast:thinking.fast});
    const value = conversations.setPreference(conversationId,{...previous,depth:payload?.depth,fast:payload?.fast});
    publish();return value;
  }
  if (name === 'conversation.model') {
    if (sender !== panel && sender !== workspace) throw Error('请从当前对话选择主思考模型');
    if (!competitionMode || !payload || Object.keys(payload).some(key=>!['modelId','executionModel','conversationId'].includes(key))) throw Error('模型选择无效');
    const executionModel=payload.executionModel?agentArtsModels.resolveExecutionModel(payload.executionModel):payload.modelId?agentArtsModels.resolveExecutionModel({modelId:payload.modelId}):undefined;
    const id = executionModel?.modelId ?? payload.modelId;
    if (typeof id !== 'string' || (id && !executionModel && !agentArtsModels?.snapshot().catalog?.models.some(item=>item.id===id && item.available!==false))) {
      throw Error('所选主模型未配置或不可用');
    }
    const conversationId = conversations.activeConversationId(sender===workspace?'workspace':'panel');
    if(payload?.conversationId!==undefined&&payload.conversationId!==conversationId)throw Error('当前对话已切换，请重新操作');
    const value = conversations.setPreference(conversationId,{...conversations.preference(conversationId),modelId:id,executionModel});
    publish();return value;
  }
  if (typeof name==='string' && name.startsWith('skill.') && name!=='skill.run') {
    if(sender!==admin || !competitionMode || !installedSkillsHost) throw Error('Skill 安装仅在正式管理后台可用');
    if(name==='skill.install') return installedSkillsHost.install();
    if(name==='skill.preview') return installedSkillsHost.preview(payload);
    if(name==='skill.resource') return installedSkillsHost.previewResource(payload);
    if(name==='skill.enable') return installedSkillsHost.setEnabled(payload);
    if(name==='skill.uninstall') return installedSkillsHost.uninstall(payload);
    throw Error('不支持的 Skill 操作');
  }
  if (sender === orb) throw Error('Action unavailable from orb');
  if (!client) throw Error('Runtime 未连接，此操作尚不可用');
  if (['evidence.list', 'evidence.get', 'authorization.revoke'].includes(name)) {
    if (sender !== admin) throw Error('Evidence 操作仅允许可信后台窗口');
    const namespace = desktopHost.userNamespace;
    const evidenceHost = createDesktopEvidenceHost({
      application: runtimeApplication,
      subjectRef: namespace,
      isAdminSession: () => admin === sender && !sender.isDestroyed()
        && sender.webContents === event.sender && !sender.webContents.isDestroyed(),
      ownsTask: task => {
        if (ownsDesktopReferenceSkillTask(runtimeApplication, namespace, task)) return true;
        const turn = conversations?.turns.get(task.taskId);
        if (turn && ['panel', 'workspace'].includes(turn.surface)
          && task.conversationId === (turn.conversationId??`desktop-${turn.surface}`)) return true;
        if (goalHost && task.conversationId === `host-tool:${namespace}`) {
          try { goalHost.readTask(task.taskId); return true; } catch { return false; }
        }
        return false;
      },
    });
    if (name === 'evidence.list') return evidenceHost.list(payload);
    if (name === 'evidence.get') return evidenceHost.get(payload);
    return evidenceHost.revoke(payload);
  }
  if (name.startsWith('goal.')) {
    if (sender !== panel && sender !== workspace) throw Error('Goal 操作只能从面板或工作区调用');
    if (!goalHost) throw Error('Goal 写入仅在 Competition Profile 的可信宿主中可用');
    if (name === 'goal.list') return goalHost.list();
    if (name === 'goal.get') return goalHost.get(payload);
    if (name === 'goal.create') return goalHost.create(payload);
    if (name === 'goal.revise') return goalHost.revise(payload);
    if (name === 'goal.readTask') return goalHost.readTask(payload);
    if (name === 'goal.listTasks') return goalHost.listTasks();
    if (name === 'goal.cancel') {
      goalHost.readTask(payload);
      const result = await client.call('task.cancel', {taskId: payload, reason: '用户取消 Goal 任务'});
      return {...result, task: goalHost.readTask(payload)};
    }
    throw Error('Unsupported Goal action');
  }
  if (name === 'task.submit' || name==='skill.run') {
    const skillRun=name==='skill.run';
    if(skillRun ? sender!==admin || !competitionMode || !installedSkillsHost : sender !== panel && sender !== workspace) throw Error('请从可信界面提交任务');
    const text=typeof payload==='string'?payload:payload?.text;
    if(!skillRun&&payload&&typeof payload==='object'&&Object.keys(payload).some(k=>!['text','conversationId'].includes(k)))throw Error('任务提交格式无效');
    if (!skillRun && (typeof text !== 'string' || !text.trim())) throw Error('请输入有效任务');
    if (competitionMode && !agentArtsConfig.snapshot().configured) throw Error('请先在设置 → 模型中保存 AgentArts Authorization；Live 语音配置无需重新填写');
    if (!fakeMode && model.enabled === false) throw Error('模型已停用，请先在模型设置中启用');
    const surface = skillRun || sender === workspace ? 'workspace' : 'panel';
    const conversationId=conversations.activeConversationId(surface);
    if(!skillRun&&payload?.conversationId!==undefined&&payload.conversationId!==conversationId)throw Error('当前对话已切换，请重新发送');
    if (submitting.has(conversationId) || [...tasks.values()].some(task => conversations.conversationIdForTask(task)===conversationId && taskSurface(task) === surface && !terminalTaskStates.has(task.state))) throw Error('请等待当前回答完成，或先停止当前任务');
    submitting.add(conversationId);
    try {
    const prepared=skillRun?await installedSkillsHost.prepareRun(payload):undefined;
    if(prepared?.cancelled) return {cancelled:true};
    const goal = skillRun?prepared.publicGoal:text.trim();
    const result = await submitConversationTask(client, {goal, conversationId}, {competition: competitionMode});
    const userGoal=skillRun?prepared.userGoal:goal;
    conversations.add(result.taskId, surface, userGoal,conversationId);
    taskGoals.set(result.taskId, userGoal);
    if (sender === panel) pinned = true;
    const task = await refresh(result.taskId);
    return task;
    } finally { submitting.delete(conversationId); }
  }
  if(name==='task.reconcile.finish')return reconcileTaskFromSurface({taskId:payload,sender,panel,workspace,tasks,taskSurface,application:runtimeApplication,refresh,publish});
  if (name === 'task.cancel') {
    if (typeof payload !== 'string' || !tasks.has(payload)) throw Error('Unknown task');
    if (sender !== admin && taskSurface(tasks.get(payload)) !== (sender === workspace ? 'workspace' : 'panel')) throw Error('无法停止其他工作区的任务');
    return requestTaskCancellation(client, payload, refresh);
  }
  if (name === 'task.refresh') {
    if (!tasks.has(payload)) throw Error('Unknown task');
    if (sender !== admin && taskSurface(tasks.get(payload)) !== (sender === workspace ? 'workspace' : 'panel')) throw Error('无法读取其他工作区的任务');
    return refresh(payload);
  }
  if (name === 'capability.list') { await syncCapabilities(); publish(); return {manifests: capabilities, health}; }
  if (name === 'approval.history') {
    if (sender !== admin) throw Error('授权历史只能从管理后台读取');
    return readApprovalPage(client, payload);
  }
  if (name === 'settings.get') return client.call('settings.get', {namespace: String(payload ?? 'desktop')});
  if (name === 'settings.update') return client.call('settings.update', payload);
  if (name === 'authorization.respond') {
    if (!payload || typeof payload.approvalId !== 'string' || !['allow_once', 'deny'].includes(payload.decision) || !Number.isSafeInteger(payload.expectedRevision)) throw Error('授权决定格式无效');
    if(sender!==admin){const approval=approvals.get(payload.approvalId),surface=sender===workspace?'workspace':'panel';if(sender!==panel&&sender!==workspace||!approval||approval.taskId!==payload.taskId||!tasks.has(approval.taskId)||!visibleConversationTask(tasks.get(approval.taskId),surface))throw Error('审批不属于当前对话');}
    const result = await client.call('authorization.respond', {approvalId: payload.approvalId, decision: payload.decision, expectedRevision: payload.expectedRevision});
    approvals.delete(payload.approvalId);
    if (payload.taskId && tasks.has(payload.taskId)) await refresh(payload.taskId);
    publish();
    return result;
  }
  if (name === 'test.advance' && fakeMode) {
    if (!tasks.has(payload)) throw Error('Unknown task');
    runtime.advance(payload); await pumpEvents(); return refresh(payload);
  }
  if (name === 'test.orbLevel' && fakeMode) {
    clearTimeout(levelDecay); levelDecay = undefined;
    audioLevel = Math.max(0, Math.min(1, Number(payload) || 0)); publish(); return audioLevel;
  }
  if (name === 'test.orbState' && fakeMode) {
    const valid = ['idle', 'listening', 'thinking', 'executing', 'waiting', 'error'];
    orbStateOverride = payload === null ? null : valid.includes(payload) ? payload : null;
    publish(); return orbStateOverride;
  }
  throw Error('Unsupported action');
}

app.on('second-instance', () => {
  if (desktopHost && orb && panel && !orb.isDestroyed() && !panel.isDestroyed()) { pinned = true; openPanel(true); publish(); }
});

async function initializeSisVoice() {
  if (!competitionMode || !client || voiceInput) return;
  if (sisPlaybackHost) throw Error('旧语音播放资源释放未确认');
  if (!sisConfigHost.snapshot().configured) return;
  const accessKeyConfig = sisConfigHost.currentAccessKey();
  const selectedConfig = accessKeyConfig ?? sisConfigHost.current();
  if (!selectedConfig) return;
  const {region, projectId} = selectedConfig;
  const {createVoicePcmFrameSourcePort, createHuaweiSisRecognitionPort,
    createHuaweiSisOutputPort} = await import('@personal-agent/voice');
  const {createDesktopVoiceInput} = await import('./voice-input.js');
  const tokenPort = {getSisToken: async ({region, signal}) => {
    if (signal.aborted || region !== speechConfig.region) throw Error('SIS 凭据不可用');
    const selected = sisConfigHost.current();
    if (!selected || selected.region !== region || selected.projectId !== speechConfig.projectId
      || selected.tokenExpiresAt && Date.parse(selected.tokenExpiresAt) <= Date.now() + 10_000) {
      throw Error('SIS 凭据不可用');
    }
    return selected.token;
  }};
  const speechConfig = accessKeyConfig
    ? {region, projectId, requestAuthPort:(await import('./huawei-sis-auth.js')).createHuaweiSisRequestAuth(accessKeyConfig)}
    : {region, projectId, tokenPort};
  const playback = createDesktopSisPlaybackHost({getPanel: () => panel,
    onDiagnostic: phase => desktopHost.logVoicePlayback(phase)});
  let source;
  let input;
  try {
    const speechPorts = {
      recognition: createHuaweiSisRecognitionPort(speechConfig),
      output: createHuaweiSisOutputPort({...speechConfig, playback}),
      dispose: () => playback.dispose(),
    };
    source = createVoicePcmFrameSourcePort(microphoneCaptureHost.binding);
    input = createDesktopVoiceInput({source, microphoneHost: microphoneCaptureHost,
      client, onUpdate: publish, enabled: true, inputMode: 'dictation', speechPorts,
      readConversationId:()=>conversations.activeConversationId('panel'),
      onTranscript: ({senderId, text,conversationId,dictationId}) => {
        if(!conversations?.containsConversation(conversationId)||conversations.session(conversationId).surface!=='panel')throw Error('原听写会话不存在');
        if (panel && !panel.isDestroyed() && !panel.webContents.isDestroyed()
          && panel.webContents.id === senderId) {
          panel.webContents.send('desktop:dictation-result', {text,conversationId,dictationId});
        }
      },
      onTaskSubmitted: ({taskId, goal}) => {
        taskGoals.set(taskId, goal);
        conversations.add(taskId, 'panel', goal);
      }});
    const wake = createDesktopWakeVoiceHost({getPanel: () => panel, microphoneHost: microphoneCaptureHost,
      voiceInput:input, onUpdate: publish, isBusy: () => Boolean(liveVoice?.hasActive() || voiceConfigurationPending || panelHiding)});
    voiceInput = input;
    voicePcmSource = source;
    sisPlaybackHost = playback;
    wakeVoice = wake;
    voiceDisposed = false;
    voiceDisposal = undefined;
    voiceDisposalFailed = false;
    wakeQuitHandled = false;
    wakeQuitUnknown = false;
    wakeDisposal = undefined;
    voiceInitializationFailure = null;
  } catch (error) {
    if (input) await input.dispose();
    else await source?.dispose?.();
    await playback.dispose();
    throw error;
  }
}

async function toggleLive(shortcut) {
  const revision = ++liveToggleRevision;
  const registration = liveShortcut, previousError = liveShortcutError;
  const current = () => revision === liveToggleRevision && liveShortcut === registration
    && (shortcut === undefined || shortcut === registration);
  try {
    if (!liveVoice) throw Error('Live 服务尚未装配');
    let result;
    if (liveVoice.hasActive()) result = await liveVoice.stop();
    else {
      if (voiceConfigurationPending || panelHiding) throw Error('请先结束面板或语音配置更新');
      await stopWakeVoice();
      if (voiceConfigurationPending || panelHiding || voiceInput?.hasActive() || wakeVoice?.hasActive()) throw Error('请先结束语音转文字或配置更新');
      pinned = true; openPanel(true); publish();
      result = await liveVoice.start();
    }
    if (current() && previousError && liveShortcutError === previousError && previousError.registration === registration) {
      registration.reason = ''; liveShortcutError = undefined; publish();
    }
    return result;
  } catch (error) {
    if (shortcut === registration && current()) {
      registration.reason = error instanceof Error ? error.message : 'Live 开关失败';
      liveShortcutError = {registration};
      pinned = true; openPanel(true); publish();
    }
    throw error;
  }
}

function readNativePublicSkillSource(input) {
  try {
    if (input?.sourceRef !== 'public-reference') return undefined;
    const value=publicSkillSources.get(JSON.stringify([input.taskId,input.configurationRef]));
    if (!value || value.denied || Date.now() >= Date.parse(value.expiresAt)
      || !codingWorkspace.isWorkspaceBindingCurrent(value.workspace)) return undefined;
    referenceHost.assertTask(input.taskId);
    const task=runtimeApplication.runtime.getTask(input.taskId);
    if (task.state !== 'running' || task.cancelRequested || runtimeApplication.runtime.loadCheckpoint(input.taskId,'application-deadline') !== value.expiresAt) return undefined;
    return {...value};
  } catch {return undefined;}
}

async function chooseNativePublicSkillSource(input) {
  const key=JSON.stringify([input.taskId,input.configurationRef]);
  if (publicSkillSources.has(key)) return readNativePublicSkillSource({...input,sourceRef:'public-reference'});
  const workspaceBinding=codingWorkspace?.readWorkspaceBinding();
  if (!workspaceBinding || input.signal.aborted || Date.now() >= Date.parse(input.deadline)) return undefined;
  openAdmin('computer');const originAdmin=admin,originApplication=runtimeApplication;
  const selection=await dialog.showOpenDialog(originAdmin,{title:'选择本任务的公开参考资料',defaultPath:workspaceBinding.rootPath,
    properties:['openFile'],filters:[{name:'公开文本资料',extensions:['md','txt']}]});
  const current=()=>admin === originAdmin && !originAdmin.isDestroyed() && runtimeApplication === originApplication
    && !input.signal.aborted && Date.now() < Date.parse(input.deadline)
    && codingWorkspace.isWorkspaceBindingCurrent(workspaceBinding);
  if (!current()) return undefined;
  if (selection.canceled || selection.filePaths.length !== 1) {publicSkillSources.set(key,{denied:true});return undefined;}
  const relative=path.relative(realpathSync(workspaceBinding.rootPath),realpathSync(selection.filePaths[0]));
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith('..'+path.sep)
    || !/\.(md|txt)$/i.test(relative)) throw Error('公开资料必须位于已许可的当前工作区内');
  const sourcePath=relative.split(path.sep).join('/');
  const answer=await dialog.showMessageBox(originAdmin,{type:'question',title:'本任务公开参考来源',
    message:`公开参考资料：${sourcePath}`,
    detail:`原任务：${input.taskId}\n公开别名：public-reference\n到期：${input.deadline}\n仅将此文件作为公开参考来源。此步骤未读取正文；实际工具读取和对应内容出机会另行核对。`,
    buttons:['取消','确认这是本任务的公开资料'],defaultId:0,cancelId:0,noLink:true});
  if (!current()) return undefined;
  referenceHost.assertTask(input.taskId);
  if (answer.response !== 1) {publicSkillSources.set(key,{denied:true});return undefined;}
  publicSkillSources.set(key,{taskId:input.taskId,configurationRef:input.configurationRef,sourceRef:'public-reference',
    path:sourcePath,expiresAt:input.deadline,workspace:workspaceBinding});
  return readNativePublicSkillSource({...input,sourceRef:'public-reference'});
}

function registerLiveShortcut() {
  if (liveShortcut.registered) globalShortcut.unregister(liveShortcut.key);
  liveShortcutError = undefined;
  const key = liveConfig.snapshot().hotkey;
  if (key === 'F9') {
    liveShortcut={key,registered:false,reason:'F9 用于记事本写入确认，请在 Live 设置中更换快捷键'};
    return;
  }
  let registration;
  const registered = globalShortcut.register(key, () => {
    if (Date.now() - lastLiveShortcutAt < 400) return;
    lastLiveShortcutAt = Date.now();
    void toggleLive(registration).catch(() => {});
  });
  registration = liveShortcut = {key, registered, reason: registered ? '' : `${key} 已被占用，请在 Live 设置中更换快捷键`};
}

async function initializeLiveVoice() {
  if (!competitionMode || !client) return;
  const {createVoicePcmFrameSourcePort, createRuntimeClientTranscriptConsumer} = await import('@personal-agent/voice');
  liveVoice = createLiveVoiceHost({getPanel: () => panel, config: liveConfig, microphoneHost: microphoneCaptureHost,
    createSource: () => createVoicePcmFrameSourcePort(microphoneCaptureHost.binding),
    createGateway: config => runtimeApplication.createLiveVoiceModel(config),
    createConsumer: createRuntimeClientTranscriptConsumer, client, onUpdate: publish,
    readConversationId:()=>conversations.activeConversationId('panel'),
    onDiagnostic:value=>console.info('PersonalAgent Live',JSON.stringify(value)),
    historyStore:createLiveHistoryFileStore(path.join(app.getPath('userData'),'live-history-recovery.json')),
    onLevel: noteVoiceLevel,
    onTranscript: message => conversations.addLiveMessage(message),
    readCurrentQuestion:({conversationId}={})=>voiceQuestionForConversation(conversationId??conversations.activeConversationId('panel')),
    onFinalUserCommand:receipt=>voiceCommandHost?.consumeFinal(receipt),
    onTaskSubmitted: ({taskId, goal,conversationId='desktop-panel'}) => {taskGoals.set(taskId, goal);conversations.add(taskId, 'panel', goal,conversationId);},
    readContext: ({conversationId=conversations.activeConversationId('panel')}={}) => JSON.stringify({profile: 'huawei_ict_agentarts',
      currentUserQuestion:voiceQuestionForConversation(conversationId),
      agentArts:{configured:agentArtsConfig.snapshot().configured,reason:agentArtsSnapshot().reason},
      tasks: orderedTasks().filter(task => taskSurface(task) === 'panel'&&conversations.conversationIdForTask(task)===conversationId).slice(-10)
        .map(task => ({taskId: task.taskId, goal: (taskGoals.get(task.taskId) ?? conversations.goal(task.taskId) ?? '').slice(0, 800),
          state: task.state, failureReason: task.error?.message, result: resultText(task.resultSummary,taskResultMetadata(task)).slice(0, 1600),
          createdAt: conversations?.turns.get(task.taskId)?.createdAt ?? task.createdAt ?? task.updatedAt})),
      messages: conversations.messagesFor('panel',conversationId).slice(-20).map(({id,role, text, createdAt}) => ({id,role, text: text.slice(0, 1600), createdAt})),
      capabilities: capabilities.map(item => ({name: item.name ?? item.id, version: item.version})),
      tools: (competitionToolAvailabilityList.length ? competitionToolAvailabilityList : [
        ...(codingWorkspace?.competitionToolAvailability ?? []),
        ...(productTools?.competitionToolAvailability ?? []),...(feedsHost?.competitionToolAvailability ?? []),
        ...(todoHost?.competitionToolAvailability ?? []),...(goalCloudHost?.competitionToolAvailability ?? [])])
        .map(({toolName,toolVersion})=>({name:toolName,version:toolVersion,state:'registered_requires_task_authorization'})),
      sessionPermissions:{goals:goalCloudHost?.snapshot().sessionAllowed===true,
        coding: codingWorkspace?.snapshot().cloudExportAllowed===true,
        mailAnalysis:mailConfig?.snapshot().cloudAnalysisAllowed===true},
      knowledgeWatch: (knowledgeWatchHost?.dialogueProjection?.()?.items ?? [])
        .map(item => ({topicId: item.topicId, usableAsCurrentFact: item.usableAsCurrentFact, answer: item.answer})),
      note: '工具名称来自与文字任务相同的宿主目录；注册不代表本次已授权或已执行。需要工作时调用 request_work，由 Runtime 为实际任务检查目录、权限和参数；不能将注册列表冒充当前全部可用。任务成功以 Runtime 返回为准。'}),
  });
  liveVoice.flushHistory();
}

app.whenReady().then(async () => {
  if (!ownsDesktopInstance) return;
  desktopHost = createDesktopHost();
  microphonePermissionGate = createMicrophonePermissionGate({
    expectedPageUrl: pathToFileURL(entry).href,
    isTrustedWindow: contents => contents === panel?.webContents,
  });
  session.defaultSession.setPermissionRequestHandler(microphonePermissionGate.request);
  session.defaultSession.setPermissionCheckHandler(microphonePermissionGate.check);
  microphoneCaptureHost = createMicrophoneCaptureHost({permissionGate: microphonePermissionGate,
    getPanel: () => panel, onLevel: noteMicLevel});
  ipcMain.on('desktop:microphone-event', (event, message) => {
    if (microphoneCaptureHost.receive(event, message) && message.type!=='frame') publish();
  });
  sisConfigHost = createDesktopSisConfigHost({userData: app.getPath('userData'), safeStorage});
  liveConfig = createLiveVoiceConfig({userData: app.getPath('userData'), safeStorage,competitionMode,
    readAgentArtsState:()=>agentArtsConfig?.snapshot()??{configured:false}});
  agentArtsConfig = createAgentArtsConfig({userData: app.getPath('userData'), safeStorage});
  if(competitionMode) {
    remoteMcpConfig=createRemoteMcpConfig({userData:app.getPath('userData'),safeStorage});
    remoteMcpHost=createDesktopRemoteMcpHost({config:remoteMcpConfig,readRuntime:()=>runtimeApplication?.runtime,confirmConnection:request=>remoteMcpManagement?.confirmConnection(request)??false});
    remoteMcpManagement=createRemoteMcpManagement({BrowserWindow,ipcMain,dialog,owner:()=>admin,
      config:remoteMcpConfig,host:remoteMcpHost,application:()=>runtimeStartup.snapshot().state==='ready' && !runtimeClosed?runtimeApplication:undefined,client:()=>client,
      namespace:desktopHost.userNamespace,onUpdate:publish});
  }
  agentArtsModels=createAgentArtsModelSettings({configuration:agentArtsConfig,readCatalog:async({deadline,signal})=>{
    const binding=agentArtsConfig.binding();
    const transport=createAgentArtsTransportConfig({binding,environment:{PA_AGENTARTS_TRANSPORT:'https'},configurationProvider:{read:()=>agentArtsConfig.readTransportOptions(binding)}});
    const response=await transport.fetchImpl(binding.gatewayUrl+'/runtimes/'+encodeURIComponent(binding.runtimeName)+'/invocations',{method:'POST',redirect:'error',signal,headers:{Authorization:agentArtsConfig.readAuthorization(binding),'Content-Type':'application/json','X-Request-Id':randomUUID(),'x-hw-agentarts-session-id':randomUUID(),'X-Invoke-Mode':'published','x-pa-deadline':deadline},body:JSON.stringify({query:JSON.stringify({modelCatalogVersion:'1.0',action:'list'})})});
    if(!response.ok)throw Error('当前部署模型目录读取失败');
    let text='';const reader=response.body.getReader();const decoder=new TextDecoder();
    try{while(true){const chunk=await reader.read();if(chunk.done)break;text+=decoder.decode(chunk.value,{stream:true});if(text.length>1000000 || Date.now()>Date.parse(deadline))throw Error('目录响应超出限制');}}finally{await reader.cancel();}
    const events=[];
    if(response.headers.get('content-type')?.includes('text/event-stream')){
      for(const frame of text.split(/\r?\n\r?\n/)){const lines=frame.split(/\r?\n/);const event=lines.find(l=>l.startsWith('event:'))?.slice(6).trim();const data=lines.filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');if(event)events.push({event,data:data?JSON.parse(data):{}});}
    }else{const value=JSON.parse(text);events.push(...(Array.isArray(value)?value:value.events??[]));}
    if(events.some(e=>e.event==='error')||!events.some(e=>e.event==='task_end')||events.at(-1)?.event!=='end')throw Error('目录响应未正常结束');
    const messages=events.filter(e=>e.event==='message'&&typeof e.data?.text==='string');if(messages.length!==1)throw Error('目录响应格式无效');return JSON.parse(messages[0].data.text);
  }});
  if (competitionMode && !syntheticMvp) {
    const {createConfiguredSubagentModelGateway} = await import('@personal-agent/runtime/application');
    modelApiHost = createModelApiConfig({userData:app.getPath('userData'),safeStorage,
      isDefaultExecutionAvailable:()=>runtimeApplication?.isDefaultSubagentAvailable()===true,
      createGateway:createConfiguredSubagentModelGateway});
  }
  if (competitionMode && !syntheticMvp) calendarConfig = createCalendarConfig({userData:app.getPath('userData'),safeStorage});
  if (competitionMode && !syntheticMvp) feedsHost = createDesktopFeedsHost({userData:app.getPath('userData'),safeStorage});
  ipcMain.on('desktop:live-event', (event, message) => {liveVoice?.receive(event, message);});
  ipcMain.on('desktop:voice-playback-event', (event, message) => {
    if (sisPlaybackHost?.receive(event, message)) publish();
  });
  try {
    conversations = new Conversations(dataPaths.conversations);
    await initializeInstalledSkills();
    if (!competitionMode) restoreModelConfig();
    const startup = await runtimeStartup.start();
    if (startup.state === 'configuration_required') {
      runtimeError = agentArtsConfig.snapshot().reason;
      connectionLabel = 'Runtime 等待配置';
    }
  } catch (error) {
    runtimeError = error instanceof Error ? error.message : 'Runtime 初始化失败';
    connectionLabel = 'Runtime 未连接';
  }

  const area = screen.getPrimaryDisplay().workArea;
  orb = windowFor('orb', {x: area.x + area.width - 150, y: area.y + area.height - 180, width: 112, height: 112},
    {frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, hasShadow: false});
  panel = windowFor('panel', panelBounds(orb.getBounds(), area),
    {frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, hasShadow: false, backgroundMaterial: 'none', roundedCorners: true});
  panel.on('close', event => { if (!app.isQuitting) { event.preventDefault(); void hidePanel().catch(reportPanelVoiceFailure); } });
  panel.on('hide', () => {void stopPanelVoice().catch(reportPanelVoiceFailure);});
  createTray();
  if (liveVoice) registerLiveShortcut();
  console.info('PersonalAgent startup',JSON.stringify({runtime:runtimeStartup.snapshot().state,
    agentArtsConfigured:agentArtsConfig.snapshot().configured,liveConfigured:liveConfig.snapshot().configured,
    liveReady:Boolean(liveVoice),liveShortcutRegistered:liveShortcut.registered,
    sisConfigured:sisConfigHost.snapshot().configured,sisReady:Boolean(voiceInput)}));

  ipcMain.handle('desktop:action', async (...args) => {
    try { return {ok: true, value: await action(...args)}; }
    catch (error) { return {ok: false, error: error instanceof Error ? error.message : '操作失败'}; }
  });
  // First-run configuration must be reachable even when cloud credentials prevent Runtime startup.
  if (competitionMode && !agentArtsConfig.snapshot().configured) openAdmin('models');

  function reposition() {
    const bounds = orb.getBounds();
    const next = clampOrb(bounds, screen.getDisplayMatching(bounds).workArea);
    orb.setPosition(next.x, next.y);
    if (panel.isVisible()) openPanel();
  }
  screen.on('display-removed', reposition);
  screen.on('display-metrics-changed', reposition);
  poll = setInterval(() => {
    if (orb.isDestroyed()) return;
    const point = screen.getCursorScreenPoint();
    const bounds = orb.getBounds();
    if (dragging === true) {
      const next = clampOrb({...bounds, x: point.x - dragOffset.x, y: point.y - dragOffset.y}, screen.getDisplayNearestPoint(point).workArea);
      orb.setPosition(next.x, next.y);
      return;
    }
    if (away > Date.now()) return;
    const near = Math.hypot(point.x - bounds.x - bounds.width / 2, point.y - bounds.y - bounds.height / 2) <= 90;
    const panelBoundsValue = panel.getBounds();
    const inside = panel.isVisible() && point.x >= panelBoundsValue.x && point.x <= panelBoundsValue.x + panelBoundsValue.width && point.y >= panelBoundsValue.y && point.y <= panelBoundsValue.y + panelBoundsValue.height;
    if ((near && desktopHost.settings.hover) || inside || pinned) { away = 0; if (near && desktopHost.settings.hover && !panel.isVisible()) openPanel(); }
    else if (panel.isVisible()) { if (!away) away = Date.now(); else if (Date.now() - away > 520) { void hidePanel().catch(reportPanelVoiceFailure); away = 0; } }
  }, 80);
  app.on('before-quit', event => {
    if (runtimeStartup.snapshot().state === 'starting') {
      event.preventDefault(); runtimeError = 'Runtime 正在连接，请稍后退出'; publish(); return;
    }
    if ((runtimeApplication?.activeTaskCount ?? 0) > 0) {
      event.preventDefault();
      app.isQuitting = false;
      runtimeError = 'Runtime 仍有活动任务；请先等待完成或停止任务后再退出';
      publish();
      return;
    }
    if(remoteMcpHost && !remoteMcpClosed) {
      event.preventDefault();
      if(!remoteMcpClosing) {
        remoteMcpManagement.close();
        remoteMcpClosing=remoteMcpHost.dispose().then(()=>{remoteMcpConfig.dispose();remoteMcpClosed=true;app.quit();})
          .catch(()=>{remoteMcpClosing=undefined;runtimeError='远程 MCP 关闭未确认，请先断开连接后再退出';publish();});
      }
      return;
    }
    if (wakeVoice && !wakeQuitHandled) {
      event.preventDefault();
      wakeDisposal ??= disposeWakeForQuit();
      return;
    }
    void stopP5DeviceTelemetry();
    if(referenceHost && !referenceClosed) {
      event.preventDefault();
      referenceClosing??=referenceHost.dispose().then(()=>{referenceClosed=true;app.quit();})
        .catch(()=>{referenceClosing=undefined;runtimeError='参考工具尚未停止，请稍后退出';publish();});
      return;
    }
    proactiveHost?.stop();
    if(todoHost && !todoClosed) {
      event.preventDefault();
      todoClosing ??= todoHost.close().then(()=>{todoClosed=true;app.quit();})
        .catch(()=>{todoClosing=undefined;runtimeError='提醒队列尚未结束，请稍后退出';publish();});
      return;
    }
    if (notepadHost && !notepadClosed) {
      event.preventDefault();
      if (!notepadClosing) notepadClosing = notepadHost.close().then(() => {
        notepadClosed = true; app.quit();
      }).catch(() => {notepadClosing = undefined;runtimeError = '本机操作停止尚未确认，请稍后退出';publish();});
      return;
    }
    if (!localServicesStopped && (mailHost || localLaya)) {
      event.preventDefault();
      if (!localServicesStopping) {
        localServicesStopping = true;
        void (async () => {
          await mailConfig?.revoke();
          const result = await localLaya?.stop();
          if (result?.state === 'stop_unconfirmed') throw Error('本地模型退出尚未确认');
          localServicesStopped = true; app.quit();
        })().catch(() => {runtimeError = '本地分类服务退出尚未确认，请稍后再退出'; publish();})
          .finally(() => {localServicesStopping = false;});
      }
      return;
    }
    if (liveVoice?.hasActive()) {
      event.preventDefault();
      void liveVoice.stop().then(result => {
        if (result.active) {runtimeError = result.reason || 'Live 音频资源释放未确认'; publish(); return;}
        app.quit();
      }).catch(() => {runtimeError = 'Live 音频资源释放未确认'; publish();});
      return;
    }
    if (voiceInput && !voiceDisposed) {
      event.preventDefault();
      if (!voiceDisposal && !voiceDisposalFailed) {
        voiceDisposal = voiceInput.dispose().then(() => {
          voiceDisposed = true;
          app.quit();
        }).catch(error => {
          voiceDisposalFailed = true;
          runtimeError = '语音资源释放未确认';
          publish();
        });
      }
      return;
    }
    if (microphoneCaptureHost?.snapshot().busy) {
      event.preventDefault();
      void microphoneCaptureHost.revoke().then(() => app.quit()).catch(error => {
        runtimeError = error instanceof Error ? error.message : '麦克风释放未确认';
        publish();
      });
      return;
    }
    if ((runtimeApplication?.activeTaskCount ?? 0) > 0) {
      event.preventDefault();
      app.isQuitting = false;
      runtimeError = 'Runtime 仍有活动任务；请先等待完成或停止任务后再退出';
      publish();
      return;
    }
    globalShortcut.unregisterAll();
    try {
      p5DeviceNotificationHost?.dispose();
      notificationApplicationHost?.dispose();
      p5Cognition?.dispose();
      p5SystemObservationSource?.dispose();
      knowledgeWatchHost?.dispose();
      modelApiHost?.dispose();
      privateConsumption?.close();
      wikiSourceMonitor?.close();
      installedSkillsHost?.close();
      coordinationWatchInputs.clear();
      privateMemory?.close();
      learningStore?.close();
      obsidianPairing?.close();
      knowledgeSourceConfig?.close();
      proactiveHost?.close();
      goalCloudHost?.close();
      calendarMeetingHost?.close();
      mailAnalysisHost?.close();
      competitionFactBridge?.close();
      if (runtimeApplication) runtimeApplication.close();
      else runtime?.close?.();
      runtimeClosed = true;
      competitionCatalog?.close();
      productTools?.close();
      codingWorkspace?.close();
      publicReferenceConsent?.close();
      publicSkillSources.clear();
      feedsHost?.close();
      void todoHost?.close();
    } catch (error) {
      event.preventDefault();
      app.isQuitting = false;
      runtimeError = error instanceof Error ? error.message : 'Runtime 仍有活动任务，无法安全退出';
      publish();
      return;
    }
    try { syntheticRepairHost?.close(); }
    catch { console.error('Synthetic repair host failed to close'); }
    microphonePermissionGate?.revoke();
    app.isQuitting = true;
    clearInterval(poll);
    clearInterval(eventPoll);
    tray?.destroy();
    runtimeConnection?.dispose?.();
  });
  app.on('window-all-closed', event => event.preventDefault());
}).catch(error => { console.error(error); app.exit(1); });
