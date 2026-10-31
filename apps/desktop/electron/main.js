import {errorDisplay,errorDisplayText} from '../src/shared/error-display.js';
import {knowledgeSourceNotReadyMessage} from '../src/shared/public-error-messages.js';
import {readCompetitionExecutionPolicy} from './competition-execution-config.js';
import {createMailMonitorPreparation} from './mail-monitor-preparation.js';
import {handleConversationAction} from './conversation-actions.js';
import {createConversationEnvironmentContext} from './conversation-environment-context.js';
import {createConversationDelivery} from './conversation-delivery.js';
import {readReconciliationStatus} from './reconciliation-status.js';
import {flushConversationDrafts} from './conversation-draft-close.js';
import {createDraftQuitPreflight} from './draft-quit-preflight.js';
import {featuredModelChoices} from './featured-model-choices.js';
import {reconcileTaskFromSurface} from './reconcile-task-action.js';
import {withNativeReadbackScope} from './native-readback-scope.js';
import {ProtocolError} from '@personal-agent/contracts';
import {computerControlFailure} from './computer-control-errors.js';
import {createComputerControlLaya} from './computer-control-laya.js';
import {createOpenCliBrowserHost} from './opencli-browser-host.js';
import {projectSubagentResult} from './subagent-result-projection.js';
import {createConversationHistoryTool} from './conversation-history-tool.js';
import {createConnectorConversationTools} from './connector-conversation-tools.js';
import {projectMailStatus} from './mail-status-projection.js';
import {projectSubagentActivity,scopeSubagentConversations, openTaskConversation, readSubagentConversation} from './subagent-activity.js';
import {handleSubagentWindowAction,handleSubagentListAction,handleWorkspaceSubagentAction} from './subagent-window-actions.js';
import {createMemoryWatchdog} from './memory-watchdog.js';
import {createSnapshotPublisher} from './snapshot-publisher.js';
import {createResourcePolicy} from './resource-policy.js';
import {TaskProjectionCache,readSafeTaskProjection} from './task-projection-cache.js';
import {createHistoryPages,compareHistoryKeys} from './history-pages.js';
import {app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, Notification, powerMonitor, safeStorage, screen, session, Tray} from 'electron';
import {createDesktopVoiceStartupHost} from './voice-startup-host.js';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import path from 'node:path';
import {freemem,totalmem,availableParallelism} from 'node:os';
import {existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync} from 'node:fs';
import {EventCursor} from '@personal-agent/client';
import {register, requestTaskCancellation, submitConversationTask} from './runtime.js';
import {panelBounds, clampOrb, draggedGroupBounds, placeOrb} from './placement.js';
import {Conversations} from './conversations.js';
import {createDesktopHost} from './desktop-host.js';
import {panelWindowAppearance, bindPanelMaterial} from './panel-material.js';
import {workspaceWindowAppearance,bindWorkspaceMaterial} from './workspace-material.js';
import {desktopDataPaths} from './data-paths.js';
import {restoreSyntheticRepairSubmission} from './competition-repair-submission.js';
import {readCapabilityDirectory} from './capability-directory.js';
import {createMicrophonePermissionGate} from './microphone-permission.js';
import {readApprovalPage} from './approval-history.js';
import {projectDesktopApproval} from './approval-projection.js';
import {createPrivateMemoryController} from './private-memory.js';
import {createPrivateMemoryConsumptionHost} from './private-memory-consumption-host.js';
import {createPrivateMemoryErasureHost} from './private-memory-erasure-host.js';
import {createPrivateMemoryBackupHost} from './private-memory-backups.js';
import {createLiveHistoryFileStore} from './live-history-file-store.js';
import {createMemoryLearningHost} from './memory-learning-host.js';
import {createKnowledgeSourceConfig} from './knowledge-source-config.js';
import {createWikiImportHost} from './wiki-import-host.js';
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
import {needsMicrophoneApproval} from './authorization-operation-policy.js';
import {workspaceLiveEntry} from './workspace-live-entry.js';
import {createDesktopWakeVoiceHost} from './wake-voice-host.js';
import {createDesktopProactiveHost} from './proactive-host.js';
import {createP5SystemObservationSource} from './p5-system-observation-source.js';
import {createP5DeviceReceiptStore} from './p5-device-receipt-store.js';
import {createP5DeviceNotificationHost} from './p5-device-notification-host.js';
import {createDesktopNotificationPort} from './desktop-notification-port.js';
import {createDesktopNotificationApplicationHost} from './notification-application-host.js';
import {createDesktopVoiceCommandHost} from './voice-command-host.js';
import {createVoiceRuntimeApprovalBridge} from './voice-runtime-approval-bridge.js';
import {createConversationToolAccess,projectComputerConversationStatus} from './conversation-tool-access.js';
import {createDesktopAuthorizationQuestionHost} from './authorization-question-host.js';
import {createDesktopAuthorizationIntentHost,AUTHORIZATION_INTENT_TOOL} from './authorization-intent-host.js';
import {createDesktopNativeExecutionHost} from './native-execution-host.js';
import {createDesktopProactiveConversationTools} from './proactive-conversation-tools.js';
import {createDesktopProactiveWorkflowApplication} from './proactive-workflow-host.js';
import {createDesktopProactiveControllerHost} from './proactive-controller-host.js';
import {createDesktopProactiveRuntimePump} from './proactive-runtime-pump.js';
import {createMaintenancePoll} from './maintenance-poll.js';
import {createDesktopConnectorChangeHost} from './connector-change-host.js';
import {createDesktopConnectorWatchHost} from './connector-watch-host.js';
import {defaultNotificationSettings} from '../shared/notification-defaults.js';
import {createConnectorReadOrigin} from './connector-read-origin.js';
import {createDesktopProactiveConfirmedSourceRouter} from './proactive-confirmed-source-router.js';
import {createDesktopProactiveContextPorts} from './proactive-context-ports.js';
import {createKnowledgeWatchHost, createProductionKnowledgeReevaluator} from './knowledge-watch-host.js';
import {createPublicConnectorHost} from './public-connector-host.js';
import {createWeatherCardHost} from './weather-card-host.js';
import {createWorkspaceConfigHost} from './workspace-config-host.js';
import {createDesktopF15ReviewConfigHost} from './f15-review-config-host.js';
import {createDesktopF15ReviewOriginHost} from './f15-review-origin-host.js';
import {createF15NativeReviewViewer} from './f15-review-native-view.js';
import {projectDeveloperConversationStatus} from './developer-deployment-config.js';
import {verifyWindowsRecoveryAcl} from './coding-tool-host.js';
import {createToolPresenceHost} from './tool-presence-host.js';
import {createConversationToolSurface} from './conversation-tool-surface.js';
import {createImageWorkflowCatalogHost} from './image-workflow-catalog.js';
import {resolveDesktopWorkflowShadowRelease} from './workflow-shadow-release-host.js';
import {createF02WorkflowWorkerPorts} from './f02-workflow-worker-ports.js';
import {createWorkflowExportConsent} from './workflow-export-consent.js';
import {createSystemObservationConversation} from './system-observation-conversation.js';
import {createDesktopWindowsControlHost} from './windows-control-host.js';
import {createComputerControlLease} from './computer-control-lease.js';
import {createWindowsDesktopControlHost,createWindowsNativeDesktopControlHost} from '@personal-agent/windows-client';
import {createComputerControlConfig} from './computer-control-config.js';
import {createComputerVisionConfig} from './computer-vision-config.js';
import {createComputerVisionHost} from './computer-vision-host.js';
import {createBrowserControlHost} from './browser-control-host.js';
import {prepareNativeDesktopComponent,nativeDesktopExecutable} from './native-desktop-component.js';
import {createWorkspacePatchRecoveryAction} from './workspace-patch-recovery-action.js';
import {createDesktopReferenceHost} from './reference-tools-host.js';
import {createInstalledSkillsHost} from './installed-skills-host.js';
import {createRemoteMcpCompetitionComposition} from './remote-mcp-competition.js';
import {createRemoteMcpManagement} from './remote-mcp-management.js';
import {createRemoteMcpRegistry} from './remote-mcp-registry.js';
import {createDesktopRemoteMcpServices} from './remote-mcp-services.js';
import {createNativePublicReferenceConsent} from './public-reference-consent.js';
import {createPublicReferenceQuestionConsent} from './public-reference-question.js';
import {createWorkspaceCommandRecipeTool} from './workspace-command-recipes.js';
import {createF20WorkflowWorkerPorts} from './f20-workflow-worker-ports.js';
import {prepareWorkflowHostPreflight} from './workflow-host-preflight.js';
import {createAgentArtsModelSettings,readDesktopExecutionModel,refreshAgentArtsModelsOnStartup} from './agentarts-model-settings.js';
import {createAgentArtsConfig} from './agentarts-config.js';
import {initializeDefaultWorkspace,readSavedWorkspaceStatus} from './default-workspace.js';
import {createAgentArtsObservationConfig} from './agentarts-observation-config.js';
import {resolveDesktopAgentArtsObservation} from './agentarts-observation-auth.js';
import {createAgentArtsTransportConfig,agentArtsTransportNotice} from './agentarts-transport-config.js';
import {agentArtsModelSnapshot} from './agentarts-model-state.js';
import {agentArtsFailureNotice} from './agentarts-failure-notice.js';
import {createDeferredRuntimeStartup} from './runtime-startup.js';
import {createMailConfig} from './mail-config.js';
import {createCalendarConfig} from './calendar-config.js';
import {createModelApiConfig} from './model-api-config.js';
import {createDesktopHarnessContextHost} from './harness-context-host.js';
import {createDesktopHarnessEventsHost} from './harness-events-host.js';
import {createHarnessExperienceAdminHost} from './harness-experience-host.js';
import {createDeveloperSettingsHost} from './developer-settings-host.js';
import {developerSettingsError,developerSettingsErrorResponse} from '../shared/developer-settings-diagnostics.js';
import {resolveRuntimeProfile} from './runtime-profile.js';
import {createDesktopCalendarMeetingHost,calendarConfigurationId,calendarApprovalResponse} from './calendar-meeting-host.js';
import {createDesktopMailReviewHost} from './mail-review-host.js';
import {createDesktopFeedsHost} from './feeds-host.js';
import {createF09FeedGraphHost} from './f09-feed-graph-host.js';
import {createF09WorkflowWorkerPorts} from './f09-workflow-worker-ports.js';
import {createVerifyWorkflowReminderBinding} from './f06-reminder-binding.js';
import {createDesktopWorkflowGraphComposition} from './workflow-graph-composition.js';
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
let taskReadbackAt = 0;
let eventSubscriptionConnection;
let eventThroughSequence;
let eventContinuation;
const resourcePolicy = createResourcePolicy();
let resourcePoll;
let thermalState='unknown',speedLimit=100;
const maintenancePoll=createMaintenancePoll({interval:()=>resourcePolicy.snapshot().maintenanceIntervalMs,
  onError:()=>{
    const message='后台维护暂未完成，原任务与记录保留；请检查对应功能状态';
    if(!runtimeClosed&&runtimeError!==message){runtimeError=message;publish();}
  }});
const snapshotPublisher = createSnapshotPublisher({project:projectWindowSnapshot,
  interval:()=>resourcePolicy.snapshot().publishIntervalMs,
  onError:()=>{runtimeError='桌面状态投影失败；任务记录仍由 Runtime 保留';}});
let orb;
let panel;
let draftQuitPreflight;
let admin;
let workspace;
const subagentWindows=new Map();
// Each child conversation owns a renderer process. Keeping every one alive across turns is what
// made long sessions slow, so the host recycles the least recently used window past this bound.
const SUBAGENT_WINDOW_LIMIT=6;
let subagentListWindow;
let adminNavigation = {page: 'settings', revision: 0};
let tray;
let poll;
let memoryWatchdog;
let pinned = false;
let dragging = false;
let orbDragRevision = 0;
let dragOffset;
let orbDragPoll;
let panelDragOrigin;
let away = 0;
let audioLevel = 0;
let levelDecay;
let lastVoiceLevelPublish = 0;
let orbStateOverride = null;
let connectionLabel = '未连接 Runtime';
let runtimeError = '';
let applicationAuthorizationRevision = 0;
let applicationAuthorizationDecisionNotice;
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
const tasks = new TaskProjectionCache({pinned:()=>new Set([...historyPages.pinned(),...[...approvals.values()].filter(a=>a.state==='pending').map(a=>a.taskId)])});
const historyPages=createHistoryPages({
  conversationId:surface=>surface?conversations?.activeConversationId(surface):undefined,
  readMessages:()=>conversations?.messages??new Map(),
  readMessagePage:input=>conversations?.readMessageDisplayPage(input)??[],
  readRevision:()=>`${tasks.version}:${conversations?.messageRevision??0}`,
  readTasks:readDisplayTaskPage,
  onTasks:items=>{for(const task of items)tasks.set(task.taskId,task);},
});
const taskGoals = new Map();
// Goals are a display cache: the conversation store and SQLite keep the durable copy, so the
// oldest entries can be dropped without losing history (#435).
const TASK_GOAL_LIMIT = 500;
function rememberTaskGoal(taskId, goal) {
  taskGoals.set(taskId, goal);
  if (taskGoals.size <= TASK_GOAL_LIMIT) return;
  for (const key of taskGoals.keys()) {
    if (taskGoals.size <= TASK_GOAL_LIMIT) break;
    if (key !== taskId) taskGoals.delete(key);
  }
}
let conversations;
const submitting = new Set();
const conversationDelivery = createConversationDelivery(submitting);
const terminalTaskStates = new Set(['succeeded', 'failed', 'cancelled']);
const approvals = new Map();
const notifications = new Map();
let runtimeApplication;
// The public-reference consent belongs to one Runtime instance. It is bound after the
// Runtime is created; capturing it earlier left every native export preflight denied.
let referenceApplication;
let authorizationQuestionHost;
let nativeExecutionHost,localAuthorizationOnly=false;
let defaultWorkspaceState={configured:false,selectionAvailable:false,reason:'编程工作区尚未装配'};
let authorizationIntentHost;
const authorizationQuestionPort=Object.freeze(Object.fromEntries([
  'prepare','prepareExport','currentRequirement','authorizeExport','authorizeConsumedExport','assertConsumedResult','deriveMailBatch','deriveHostIntent','readResourceGeneration','rotateResourceGeneration',
].map(name=>[name,(...args)=>{
  if(!authorizationQuestionHost)throw new ProtocolError('UNSUPPORTED_CAPABILITY','当前对话授权卡尚未装配');
  return authorizationQuestionHost[name](...args);
}])));
let syntheticRepairHost;
const repairPrompts = new Set();
let microphonePermissionGate;
let privateMemory;
let privateConsumption, privateErasure, privateBackups;
const coordinationWatchInputs = new Map();
let memoryLearningHost,learningApplication,learningStore;
const harnessExperienceLifetime=new AbortController();
let harnessEventsHost,harnessEventsClosing,harnessEventsClosed=false;
let installedSkillsHost;
let remoteMcpConfig,remoteMcpHost,remoteMcpServices,remoteMcpManagement,remoteMcpClosing,remoteMcpClosed=false;
let microphoneCaptureHost;
let voicePcmSource;
let voiceInput;
let sisPlaybackHost;
let sisConfigHost;
let liveConfig;
let agentArtsConfig;
let agentArtsObservationConfig;
let agentArtsModels;
let activeCloudBinding;
let activeCloudTransportSignature;
const runtimeStartup = createDeferredRuntimeStartup({
  isConfigured: () => !competitionMode || agentArtsConfig?.snapshot().runtimeReady === true,
  initialize: initializeProductServices,
});
let liveVoice;
let f02Workflow;
let voiceStartupHost, voiceStartupDisposal, voiceStartupDisposed = false;
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
let notificationApplicationHost, voiceCommandHost, voiceApprovalBridge, proactiveWorkflowApplication;
let conversationToolAccess, proactiveConversationTools;
let proactiveRuntimePump,proactiveSourceRouter;
let connectorChangeHost,connectorWatchHost,connectorTriggersClosing,connectorTriggersClosed=false;
let harnessExperienceAdminHost;
let proactiveMaintenanceFailure='',proactiveSourceRoutingFailure='';
let p5DeviceTelemetrySubscription;
let p5UnavailableReason = '';
let p5RuntimeFailure = '';
let p5ReceiptFailure = '';
let p5DeviceFeedback = {state: 'unread', items: []};
let p5FeedbackReading = false;
let knowledgeWatchHost;
let admitNativeFeedInterest;
let modelApiHost;
let harnessContextHost;
let harnessContextFailure='';
let harnessModelSummarizer;
let runtimeBuildIdentityReader;
let startupRecoveryStatus={state:'not_run',verification:'not_run'};
let reviewedRepairLock = Promise.resolve();
function withReviewedRepairLock(work) {
  const result = reviewedRepairLock.then(work);
  reviewedRepairLock = result.catch(() => {});
  return result;
}
let productTools;
let weatherCardHost;
let connectorConversationTools;
let codingWorkspace;
let f15ReviewHost,f15ReviewOrigin,f15ReviewViewer,f15ReviewInstalled=false,f15ReviewNotice='';
let developerDeployment;
let developerSettings;
let developerDeploymentFailure='';
let toolPresenceHost,windowsControlHost,windowsControlClosing,computerControlLaya;
let computerControlLease;
let computerControlConfig,browserControlHost,openCliBrowserHost,computerPreparing,browserControlClosing,computerVisionConfig,computerVisionHost;
let browserControlClosed=false;
let computerLaunch;
const computerTasks=new Set();
let imageWorkflowCatalog;
let systemObservationConversation;
let windowsControlClosed=false;
let referenceHost;
let referenceClosing;
let referenceClosed=false;
let knowledgeSourceConfig,knowledgeTools,wikiSourceMonitor,obsidianPairing,wikiImportHost;
let competitionToolAvailabilityList = [];
let mailConfig;
let calendarConfig;
let calendarMeetingHost;
let feedsHost;
let f09FeedGraphHost={tools:[],unavailable:'feeds_host_required'};
let workflowGraphComposition={tools:[],unavailable:['not_assembled']};
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
let activeConnectorMailRead;
let mailMonitorRequest;
const mailMonitorPreparation=createMailMonitorPreparation();
let manualMailReadConversationId;
const connectorMailReadOrigin=createConnectorReadOrigin({getApplication:()=>runtimeApplication,
  // Binding an independently approved conversation read must not require the
  // separate local classification session. Change consumption still checks it.
  readSourceAuthorization:source=>({...readConnectorSourceAuthorization(source),available:Boolean(mailConfig?.current())})});

function mailSnapshot() {
  const config = mailConfig?.snapshot() ?? {configured:false, status:'unconfigured', sessionAllowed:false};
  const host = mailHost?.snapshot();
  const analyses=mailAnalysisHost?.snapshot();
  const watches=connectorWatchHost?.snapshot().watches?.filter(watch=>watch.source==='mail')??[];
  const watch=watches.find(item=>item.enabled)??watches.at(-1);
  let monitoring=watch?{...watch}:{state:'stopped',enabled:false};
  if(watch?.enabled) {
    const baseline=connectorChangeHost?.snapshot({mailWatchId:watch.watchId})?.mailWatchBaselines?.[0];
    monitoring={...monitoring,baselineState:baseline?.state
      ??(watch.lastCheckedAt?'unknown':'waiting_first_read')};
  }
  if(mailMonitorRequest)try{
    const task=runtimeApplication.runtime.getTask(mailMonitorRequest.taskId);
    if(!watch?.enabled||task.state!=='succeeded')monitoring={...monitoring,taskId:task.taskId,
      state:task.state==='succeeded'?monitoring.state:task.state,errorCode:task.error?.code};
  }catch{}
  if(mailMonitorPreparation.hasPending())monitoring={...monitoring,state:'starting'};
  return {...host, ...config, ...projectMailStatus(config,host,mailFailure),
    configurationPending:mailMonitorPreparation.configurationPending(),
    cloudAnalysisAllowed:analyses?.enabled===true,
    counts:host?.counts, analyses, monitoring, localModelReady:localLaya?.snapshot().ready === true,
  };
}

function readConnectorSourceAuthorization(source) {
  if(source==='mail') {
    const status=mailConfig?.snapshot(),config=mailConfig?.current();
    let generation;
    const batchAuthorization=mailConfig?.batchAuthorization;
    const ready=Boolean(mailHost&&config&&!status?.requiresRestart
      &&(batchAuthorization?batchAuthorization.canRequest():status?.sessionAllowed));
    if(ready&&batchAuthorization) {
      const resource=createHash('sha256').update(JSON.stringify({namespace:desktopHost.userNamespace,
        kind:'mail-local-batch',user:config.user,revision:config.revision})).digest('hex');
      try{generation=authorizationQuestionPort.readResourceGeneration(resource);}catch{return {available:false};}
    }
    return {available:ready,
      configurationRef:createHash('sha256').update(JSON.stringify(['mail',config?.user,config?.revision,generation])).digest('hex')};
  }
  const descriptor=runtimeApplication?.tools?.list().find(tool=>tool.name==='weather.forecast');
  return {available:source==='weather'&&descriptor?.sideEffect==='read',
    configurationRef:createHash('sha256').update(JSON.stringify(['weather',descriptor?.version])).digest('hex')};
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
  return voiceCommandHost?.snapshot(conversationId)??null;
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
  return {...base, p5, suggestions,...(runtimeApplication&&!runtimeClosed
    ?{connectorChanges:connectorChangeHost?.snapshot(),connectorWatches:connectorWatchHost?.snapshot()}:{})};
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
  return tasks.ordered(task=>task.createdAt??conversations?.turns.get(task.taskId)?.createdAt??task.updatedAt??'');
}
function readDisplayTaskPage(input) {
  if(!fakeMode&&runtimeApplication)return runtimeApplication.runtime.readTaskDisplayPage(input);
  // Explicit Fake-runtime compatibility; production never silently switches to in-memory data.
  if(!fakeMode)return {items:[],snapshotSequence:0,hasMore:false};
  const candidates=[...tasks.values()].filter(task=>!input.conversationId||conversations?.conversationIdForTask(task)===input.conversationId)
    .map(task=>({...task,createdAt:task.createdAt??conversations?.turns.get(task.taskId)?.createdAt??task.updatedAt}));
  const keyed=task=>({createdAt:task.createdAt,key:`task:${task.taskId}`});
  const matches=candidates.filter(task=>(!input.before||compareHistoryKeys(keyed(task),input.before)<0)&&(!input.after||compareHistoryKeys(keyed(task),input.after)>0))
    .sort((a,b)=>compareHistoryKeys(keyed(a),keyed(b)));
  return {items:input.after?matches.slice(0,input.limit):matches.slice(-input.limit),snapshotSequence:0,hasMore:matches.length>input.limit};
}
function privateMemoryController() {
  if (!privateMemory) {
    mkdirSync(path.dirname(dataPaths.privateMemory), {recursive: true});
    privateMemory = createPrivateMemoryController(dataPaths.privateMemory, async details => {
      const originAdmin=admin;if(!originAdmin || originAdmin.isDestroyed())return false;
      return confirmApplicationAuthorization('memory.save',details,{signal:details.signal,
        scope:{source:details.source},summary:details.previous?'更正所选私人记忆版本；仅此来源与本次内容':'保存所选私人记忆；仅此来源与本次内容',
        isCurrent:()=>admin===originAdmin&&!originAdmin.isDestroyed()});
    }, async current => {
      const originAdmin=admin;if(!originAdmin || originAdmin.isDestroyed())return false;
      return confirmApplicationAuthorization('memory.erase',current,{scope:{sourceRef:current.sourceRef},
        summary:'删除所选私人记忆的全部版本及应用管理副本；不表示擦除已完成，原存储核实规则继续生效',
        isCurrent:()=>admin===originAdmin&&!originAdmin.isDestroyed()});
    }, {knowledgeSource:()=>obsidianPairing?.memorySource, confirmWithdraw:async current=>{
      const originAdmin=admin;if(!originAdmin || originAdmin.isDestroyed())return false;
      return confirmApplicationAuthorization('memory.withdraw',current,{scope:{ref:current.ref,revision:current.revision},
        summary:'撤回所选私人记忆版本，停止后续消费',isCurrent:()=>admin===originAdmin&&!originAdmin.isDestroyed()});
    },authorizeConsumption:async scope=>{
      if(!admin || admin.isDestroyed() || !runtimeApplication || !scope.taskId) return false;
      const originAdmin=admin,originApplication=runtimeApplication;
      const task=runtimeApplication.runtime.getTask(scope.taskId);
      if(task.cancelRequested || ['succeeded','failed','cancelled'].includes(task.state)) return false;
      return confirmApplicationAuthorization('memory.consume',scope,{scope:{taskId:scope.taskId,destination:scope.destination},
        deadline:scope.deadline,signal:scope.signal,summary:scope.destination==='agentarts'
          ?'仅原任务使用所选版本记忆摘要，并发送这些已选摘要给 AgentArts；不含其他记忆'
          :'仅原任务在本机使用所选版本记忆摘要',isCurrent:()=>{
          const current=originApplication.runtime.getTask(scope.taskId);
          return admin===originAdmin&&!originAdmin.isDestroyed()&&runtimeApplication===originApplication
            &&!current.cancelRequested&&!['succeeded','failed','cancelled'].includes(current.state);
        }});
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
  const failure=cloudRequestFailureNotice || cloudTransportNotice;
  const observation = agentArtsObservationConfig?.snapshot();
  return value && {...value,reason:failure?errorDisplayText(failure,'runtime'):value.reason,
    ...(observation ? {observation} : {})};
}

function visibleConversationTask(task,surface){return !(task.goal?.startsWith('判断是否告知用户：')&&connectorChangeHost?.ownsDecisionTask(task.taskId))&&(!surface||taskSurface(task)===surface&&conversations?.conversationIdForTask(task)===conversations?.activeConversationId(surface));}
function conversationProjection(surface) {
  const page=historyPages.get(surface);
  const pageTasks=new Set(page.entries.filter(entry=>entry.kind==='task').map(entry=>entry.id));
  const authorizationQuestions=authorizationQuestionHost?.snapshot(surface?conversations?.activeConversationId(surface):undefined)??[];
  const ordered=orderedTasks();
  const scoped=ordered.filter(task=>visibleConversationTask(task,surface));
  const active=scoped.filter(task=>!terminalTaskStates.has(task.state));
  const liveIds=new Set(active.slice(-8).map(task=>task.taskId));
  const projectedTasks=scoped.filter(task=>pageTasks.has(task.taskId)||liveIds.has(task.taskId));
  const workspaceChildren=surface==='workspace'&&!fakeMode?scopeSubagentConversations(runtimeApplication?.listSubagentConversations({limit:100,
    parentTaskIds:[...new Set(projectedTasks.map(task=>task.taskId))]}).items??[],
    taskId=>runtimeApplication.runtime.getTask(taskId),parent=>visibleConversationTask(parent,'workspace')):[];
  return {
    subagentTasks:fakeMode?[]:(surface==='workspace'?workspaceChildren:projectSubagentActivity({tasks:projectedTasks,surface,visible:visibleConversationTask,
      readChildren:taskId=>runtimeApplication?.readSubagentTasks?.(taskId),sourceSurface:taskSurface,
      readTask:taskId=>runtimeApplication.runtime.getTask(taskId)})),
    tasks: projectedTasks.map(original => {const task=readSafeTaskProjection(original,{runtime:runtimeClosed?undefined:runtimeApplication?.runtime,
      delivery:conversationDelivery,cache:tasks,goals:taskGoals});return ({...structuredClone(task),
      ...(task.error?{error:{...task.error,...errorDisplay(task.error,'task')}}:{}),
      reconciliationStatus:readReconciliationStatus(runtimeApplication,task),
      resultMetadata:taskResultMetadata(task),
      createdAt: task.createdAt ?? conversations?.turns.get(task.taskId)?.createdAt ?? task.updatedAt,
      userMessage: task.bodyWithheld?task.goal:taskGoals.get(task.taskId) ?? conversations?.goal(task.taskId) ?? task.goal,
      // UI summary is derived from trusted readback; TaskRuntime still owns state.
      ...(notepadHost?.projectTask(task) ?? {})});}),
    messages: page.entries.filter(entry=>entry.kind==='message').map(entry=>conversations?.messages.get(entry.id)).filter(Boolean).map(message=>({...message})),
    historyPage:{...historyPages.summary(surface),activeCount:active.length},
    conversationState:surface?conversations?.snapshot(surface):undefined,
    surfaceBusy:surface?active.length>0:false,
    conversation: surface ?? 'all',
    authorizationQuestions,
    authorizationSandbox:runtimeApplication&&authorizationQuestionHost?authorizationQuestionHost.sandboxSnapshot().selected:undefined,
    approvals: (authorizationQuestionHost?.automaticallyApproves()?[]:[...approvals.values()]).filter(approval=>(!surface||tasks.has(approval.taskId)&&visibleConversationTask(tasks.get(approval.taskId),surface))
      &&!authorizationQuestionHost?.hasPending(approval.approvalId)
      &&!authorizationQuestions.some(question=>question.state==='pending'&&question.taskId===approval.taskId))
      .map(approval=>projectDesktopApproval(approval,runtimeApplication?.runtime)),
  };
}
function orbSnapshot() {
  const visible=orderedTasks().filter(task=>visibleConversationTask(task,'panel'));
  const task=visible.findLast(task=>!terminalTaskStates.has(task.state))??visible.at(-1);
  const live=liveVoice?.snapshot()??liveConfig?.snapshot();
  return {tasks:task?[{taskId:task.taskId,state:task.state}]:[],audioLevel,orbStateOverride,
    live:live?{active:live.active,status:live.status}:undefined,resourceBudget:resourcePolicy.snapshot()};
}
function projectWindowSnapshot(surface,topics=['all']) {
  if(surface==='orb')return orbSnapshot();
  if(topics.includes('all'))return snapshot(surface);
  return {
    ...(topics.some(topic=>topic==='tasks'||topic==='approvals')?conversationProjection(surface):{}),
    ...(topics.includes('notifications')?{notifications:[...notifications.values(),...(todoHost?.snapshot().notifications??[])],
      notificationCenter:surface?undefined:notificationApplicationHost?.snapshot()}:{}),
    connection:connectionLabel,
    connectionError:(runtimeError||cloudRequestFailureNotice||cloudTransportNotice)?errorDisplayText(runtimeError||cloudRequestFailureNotice||cloudTransportNotice,'runtime'):undefined,
    resourceBudget:resourcePolicy.snapshot(),
  };
}
function snapshot(surface) {
  const cloudSettings=agentArtsSnapshot();
  return {
    ...conversationProjection(surface),
    connection: connectionLabel,
    connectionError: (runtimeError || cloudRequestFailureNotice || cloudTransportNotice) ? errorDisplayText(runtimeError || cloudRequestFailureNotice || cloudTransportNotice,'runtime') : undefined,
    fakeModel: fakeModelMode,
    fake: fakeMode,
    pinned,
    adminNavigation: {...adminNavigation},
    audioLevel,
    orbStateOverride,
    resourceBudget:resourcePolicy.snapshot(),
    capabilities: structuredClone(capabilities),
    health: structuredClone(health),
    capabilityDirectory: {...capabilityDirectory},
    privateMemory: {available: competitionMode && Boolean(runtimeApplication),
      vaultSelected: obsidianPairing?.memorySource.snapshot().available===true, writeEnabled: memoryLearningHost?.snapshot().writeEnabled===true},
    memoryLearning:surface ? undefined : memoryLearningHost?.snapshot(),
    installedSkills:surface ? undefined : installedSkillsHost?.snapshot(),
    remoteMcp:surface ? undefined : remoteMcpHost?.snapshot(),
    loginItem:surface ? undefined : desktopHost?.loginItemSnapshot?.(),
    notifications: [...notifications.values(),...(todoHost?.snapshot().notifications ?? [])],
    notificationCenter: surface ? undefined : notificationApplicationHost?.snapshot(),
    voiceQuestion: surface?voiceQuestionForConversation(conversations?.activeConversationId(surface)):voiceCommandHost?.snapshot(),
    proactiveWorkflow: proactiveWorkflowApplication?.snapshot(),
    model: (()=>{const value=structuredClone(competitionMode?agentArtsModelSnapshot(model,cloudSettings):model);return value.status==='error'?{...value,reason:errorDisplayText(value.reason,'configuration')}:value;})(),
    agentArtsModels:agentArtsModels?.snapshot(),
    modelApi: surface ? undefined : readDesktopModelApiState(),
    harnessContext:surface?undefined:harnessContextHost?.snapshot()??{state:harnessContextFailure?'unavailable':'disabled',
      enabled:false,reason:harnessContextFailure,verification:'not_run'},
    startupRecovery:surface?undefined:startupRecoveryStatus,
    harnessEvents:surface?undefined:harnessEventsHost?.snapshot(),
    modelChoices: featuredModelChoices(agentArtsModels?.snapshot().catalog?.models,{selectedId:conversations?.preference(conversations?.activeConversationId(surface==='workspace'?'workspace':'panel'),thinking)?.modelId??''}),
    conversationPreference: conversations?.preference(conversations?.activeConversationId(surface==='workspace'?'workspace':'panel'),thinking),
    thinking: {...thinking,...(conversations?.preference(conversations?.activeConversationId(surface==='workspace'?'workspace':'panel'),thinking) ?? {}),
      reason:'本对话的步骤预算在提交时固定；AgentArts 负责主编排，辅助任务使用当前对话的模型选择。原生思考能力以模型设置和实际参数回执为准。'},
    live: {...(liveVoice?.snapshot() ?? liveConfig?.snapshot()), startup:voiceStartupHost?.snapshot(), shortcut: {...liveShortcut}},
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
    weather:weatherCardHost?.snapshot(),
    todo: todoHost?.snapshot() ?? {available:false,items:[],notifications:[],reason:todoFailure || '待办将在 Runtime 连接后可用'},
    goalCloud:goalCloudHost?.snapshot() ?? {available:false,sessionAllowed:false,reason:'目标工具将在 Runtime 连接后可用'},
    notepad: notepadHost?.snapshot() ?? {available:false,busy:false,state:'unavailable',
      reason:'本机执行组件尚未就绪，记事本操作暂不可用。'},
    computerControl:computerControlSnapshot(surface),
    coding: {...(codingWorkspace?.snapshot() ?? defaultWorkspaceState),
      independentReview:f15ReviewSnapshot(),f20:codingWorkspace?.readF20CaseConfiguration?.()??{configured:false}},
    reference:surface ? undefined : referenceHost?.snapshot(),
    agentArts: cloudSettings,
    laya: localLaya?.snapshot() ?? {state:'unavailable', ready:false, reason:'本地模型尚未装配'},
    knowledge: (obsidianPairing?.source ?? knowledgeSourceConfig)?.snapshot()??structuredClone(knowledgeStatus),
    knowledgeSource:surface ? undefined : knowledgeSourceConfig ? {...knowledgeSourceConfig.snapshot(),
      monitor:wikiSourceMonitor?.snapshot(),pairing:obsidianPairing?.snapshot()} : undefined,
    wikiImport:surface ? undefined : wikiImportHost?.snapshot() ?? (competitionMode
      ? {available:false,selectionAvailable:false,reason:'请先在模型设置中配置 AgentArts，再重新启动后导入 Wiki'} : undefined),
    voice: voiceInput ? {...voiceInput.snapshot(), hostReady:true, experimental: sisConfigHost?.snapshot().configured,
      configuration: sisConfigHost?.snapshot()} : {available: false, status: voiceInitializationFailure ? 'error' : 'unconfigured',
      hostReady:false,
      reason: voiceInitializationFailure?.message ?? sisConfigHost?.snapshot().reason ?? 'SIS 尚未配置',
      failure: voiceInitializationFailure, configuration: sisConfigHost?.snapshot(),
      capture: microphoneCaptureHost?.snapshot() ?? {authorized: false, active: false, busy: false,
        subscriberCount: 0, lastRelease: {stopped: true, verified: false, reason: 'never_started'}}},
  };
}

function computerControlSnapshot(surface){
  const current=windowsControlHost?.snapshot(),preference=computerControlConfig?.snapshot();
  if(!current)return {state:'unavailable',enabled:preference?.enabled!==false,available:false,providerAvailable:false,
    observationExportAllowed:false,waitingConfirmation:false,reason:'电脑组件将在Runtime连接后准备。',input:{state:'unavailable',busy:false,writeBlocked:true},browser:{state:'unavailable',available:false},vision:computerVisionConfig?.snapshot()};
  const {presenceTasks,taskId,activeTaskId,recoveryTaskId,recoveryRunId,...publicStatus}=current;
  const active=activeTaskId??(current.waitingConfirmation?taskId:undefined);
  const owned=!surface||active&&conversationToolAccess?.resolveConversation(active)===conversations?.activeConversationId(surface);
  const recoveryOwned=!surface||recoveryTaskId&&conversationToolAccess?.resolveConversation(recoveryTaskId)===conversations?.activeConversationId(surface);
  const input=computerControlLease?.snapshot()??{state:'unavailable',busy:false,writeBlocked:true};
  if(current.state==='blocked'||browserControlHost?.snapshot().state==='blocked'||openCliBrowserHost?.snapshot().state==='blocked')Object.assign(input,{state:'blocked',writeBlocked:true});
  return {...publicStatus,...(owned&&active?{activeTaskId:active}:{}),...(recoveryOwned&&recoveryTaskId?{recoveryTaskId}:{}),waitingConfirmation:owned&&current.waitingConfirmation===true,
    input,browser:{...(browserControlHost?.snapshot()??{state:'unavailable',available:false}),connected:openCliBrowserHost?.snapshot()},vision:computerVisionHost?.snapshot()??computerVisionConfig?.snapshot(),
    ...(computerPreparing?{state:'preparing',reason:'正在准备电脑组件；可以立即停止。'}:{})};
}

async function stopComputerControl(){
  computerPreparing?.abort();
  if(computerLaunch){computerLaunch.stopped=true;conversationDelivery.interruptPending(computerLaunch.conversationId);}
  const activeTasks=[...new Set([...computerTasks,...(windowsControlHost?.activeTasks?.()??[]),...(browserControlHost?.activeTasks?.()??[]),...(openCliBrowserHost?.activeTasks?.()??[])])]
    .filter(taskId=>{try{return !terminalTaskStates.has(runtimeApplication.runtime.getTask(taskId).state);}catch{return false;}});
  const stopped=await Promise.allSettled([windowsControlHost?.stop(),browserControlHost?.stop(),openCliBrowserHost?.stop()]);
  const cancelled=await Promise.allSettled(activeTasks.map(taskId=>client.call('task.cancel',{taskId,reason:'用户停止电脑输入'})));
  publish();
  const failures=[...stopped.map((item,index)=>({item,stage:index===0?'stop.desktop':'stop.browser'})),
    ...cancelled.map(item=>({item,stage:'stop.task'}))].filter(({item})=>item.status==='rejected')
    .map(({item,stage})=>computerControlFailure(item.reason,stage));
  if(failures.length)throw new ProtocolError('RESULT_UNKNOWN','电脑输入或原任务停止尚未确认：'
    +failures.map(error=>`[${error.code}/${error.stage}] ${error.message}`).join('；')+'。请查看原对话；不会自动重做。');
  return {computerControl:computerControlSnapshot()};
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
  for(const win of [orb,panel,admin,workspace])if(win&&!win.isDestroyed()&&win.isVisible()&&!win.isMinimized())win.webContents.send('desktop:audio-level',level);
}
function publish(topics) {
  if (runtimeClosed) return;
  snapshotPublisher.mark(topics);
  for(const record of subagentWindows.values()){
    if(record.window.isDestroyed())continue;
    // A hidden child keeps its last rendered state. Re-reading every child on every publish made
    // idle cost grow with the number of open windows, which is what accumulated into stutter.
    if(!record.window.isVisible()||record.window.isMinimized())continue;
    const now=Date.now();
    if(now-(record.checkedAt??0)<500)continue;
    record.checkedAt=now;
    let revision='unavailable';
    try{
      const conversation=runtimeApplication?.readSubagentConversation(record.binding);
      revision=conversation?JSON.stringify([conversation.updatedAt,conversation.activeTaskId,conversation.messages.map(t=>[t.taskId,t.state,t.replyText])]):revision;
    }catch{/* Reader reports missing original records without interrupting other windows. */}
    if(revision!==record.revision){record.revision=revision;record.window.webContents.send('desktop:update',{subagentTaskChanged:true});}
  }
}

function windowFor(mode, bounds, options = {}) {
  const centerOnPresent = mode === 'workspace' && !desktopHost.hasSavedBounds(mode);
  const win = new BrowserWindow({...desktopHost.restore(mode, bounds), show: false, backgroundColor: '#00000000',
    webPreferences: {preload: path.join(dir, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      ...(mode === 'panel' ? {autoplayPolicy: 'no-user-gesture-required'} : {})}, ...options});
  win.setMenuBarVisibility(false);
  desktopHost.attach(win, mode, {remember:!['subagent','subagent-list'].includes(mode)});
  if(['orb','panel','admin','workspace'].includes(mode))snapshotPublisher.attach(win,mode==='admin'?undefined:mode);
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  win.webContents.on('will-navigate', event => {
    event.preventDefault();
    if (mode === 'panel') void stopPanelVoice().catch(reportPanelVoiceFailure);
  });
  if (mode === 'panel') {
    win.on('resize', () => applyShape(win, 40));
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
      if (dragging === true) { dragging = false; stopOrbDrag(); }
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
    if (mode === 'orb') placeOrb(win, win.getBounds());
    if (centerOnPresent) win.center();
    if (mode === 'panel') applyShape(win, 40);
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
  // Leave one DIP for the per-pixel visual/CSS antialiasing; the native region
  // is the hit mask, not the final optical edge of the clipped glass layer.
  win.setShape(roundedRects(bounds.width, bounds.height, Math.max(0, radius * win.webContents.getZoomFactor() - 1)));
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
  applyShape(panel, 40);
  if (focus) panel.show(); else panel.showInactive();
  away = 0;
}

function stopOrbDrag() {
  clearInterval(orbDragPoll);
  orbDragPoll = undefined;
}

function moveOrbDrag() {
  if (dragging !== true || !orb || orb.isDestroyed()) return;
  const point = screen.getCursorScreenPoint(), bounds = orb.getContentBounds();
  const next = clampOrb({...bounds, x: point.x - dragOffset.x, y: point.y - dragOffset.y}, screen.getDisplayNearestPoint(point).workArea);
  if (next.x !== bounds.x || next.y !== bounds.y) placeOrb(orb, next);
}

function movePanelGroup(point) {
  if (!panelDragOrigin || !orb || !panel) return;
  const area = screen.getDisplayNearestPoint(point).workArea;
  const next = draggedGroupBounds(panelDragOrigin.orb, panelDragOrigin.pointer, point, area);
  placeOrb(orb, next.orb);
  placePanel(next.panel);
  applyShape(panel, 40);
}

function openAdmin(page) {
  if (page && ['settings','profile','models','tasks','capabilities','authorizations','git','environment','connections','memory','voice','computer'].includes(page)) {
    adminNavigation = {page, revision:adminNavigation.revision + 1};
  }
  if (admin && !admin.isDestroyed()) { admin.show(); admin.focus(); publish(); return; }
  const area = screen.getDisplayMatching(orb.getBounds()).workArea;
  admin = windowFor('admin', {width: Math.min(1120, area.width), height: Math.min(760, area.height)},
    // Resizable windows use native maximize/restore state; transparent Windows
    // windows only resize to the work area without reliably entering that state.
    {title: 'PersonalAgent · 管理后台', frame: false, transparent: false, backgroundMaterial: 'none', roundedCorners: true, hasShadow: true, minWidth: 600, minHeight: 400});
  admin.on('closed', () => { mailMonitorPreparation.cancel(); admin = undefined; });
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
  } catch {wakeQuitUnknown = true; reportQuitFailure('语音资源释放未确认；请勿重新开启麦克风');}
  finally {clearTimeout(timer);}
  // This marks only the quit attempt as handled, never physical release verified.
  wakeQuitHandled = true;
  app.quit();
}

function reportPanelVoiceFailure() {
  runtimeError = '语音资源释放未确认；请勿重新开启麦克风';
  publish();
}

function reportQuitFailure(message) {
  draftQuitPreflight?.cancel();
  app.isQuitting = false;
  runtimeError = message;
  publish();
}

async function stopPanelVoice() {
  const results = await Promise.allSettled([stopWakeVoice()]);
  if (voiceInput?.hasActive()) {
    results.push(...await Promise.allSettled([voiceInput.cancelCapture(panel?.webContents.id)]));
  }
  results.push(...await Promise.allSettled([
    voiceStartupHost?.stop(), liveVoice?.stop(), sisPlaybackHost?.stop(), microphoneCaptureHost?.revoke(),
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
  if(weatherCardHost?.snapshot().configured&&!weatherCardHost.snapshot().busy&&(!weatherCardHost.snapshot().fetchedAt||weatherCardHost.snapshot().ageMs>600000)){
    try{weatherCardHost.refresh();}catch{/* Preserve the unavailable state; never substitute a provider. */}
  }
  await hidePanel();
  if (workspace && !workspace.isDestroyed()) { if(workspace.isMinimized())workspace.restore(); workspace.show(); workspace.focus(); publish(); return; }
  const area = screen.getDisplayMatching(orb.getBounds()).workArea;
  const width = Math.min(1280, area.width - 32), height = Math.min(820, area.height - 32);
  workspace = windowFor('workspace', {width, height, x: area.x + Math.round((area.width-width)/2), y: area.y + Math.round((area.height-height)/2)},
    {title: 'PersonalAgent · 工作区', frame: false, ...workspaceWindowAppearance(nativeTheme), roundedCorners: true, hasShadow: true, minWidth: Math.min(760,width), minHeight: Math.min(540,height)});
  bindWorkspaceMaterial(workspace,nativeTheme);
  workspace.once('ready-to-show', () => workspace.focus());
  workspace.on('closed', () => { workspace = undefined; });
}

async function readChildConversation(payload){
  const detail=await readSubagentConversation({payload,tasks:{get:id=>tasks.get(id)??runtimeApplication.runtime.getTask(id)},
    readChildren:id=>runtimeApplication?.readSubagentTasks?.(id),
    readTask:id=>runtimeApplication.runtime.getTask(id)});
  let conversation;
  try{conversation=runtimeApplication.readSubagentConversation(payload);}
  catch(error){
    if(error?.code!=='UNSUPPORTED_CAPABILITY')throw error;
    conversation={parentTaskId:detail.parentTaskId,taskId:detail.taskId,messages:[],canSubmit:false,
      submitUnavailableReason:'此历史子任务缺少可继续执行的绑定，保留原记录供查看'};
  }
  const unavailable=!competitionMode||!agentArtsConfig.snapshot().configured?'AgentArts 尚未配置':model.enabled===false?'模型已停用':'';
  return {...detail,...conversation,canSubmit:conversation.canSubmit&&!unavailable,
    ...(unavailable?{submitUnavailableReason:unavailable}:{})};
}
async function submitChildConversation(binding,payload){
  if(!competitionMode||!runtimeApplication||!agentArtsConfig.snapshot().configured)throw Error('请先配置 AgentArts');
  if(model.enabled===false)throw Error('模型已停用');
  await readChildConversation(binding);
  installedSkillsHost?.assertTask(binding.taskId);
  const result=await runtimeApplication.submitSubagentConversationMessage({...binding,...payload});
  const task=runtimeApplication.runtime.getTask(result.acceptedTaskId);
  tasks.set(task.taskId,structuredClone(task));rememberTaskGoal(task.taskId,task.goal);
  publish();return result;
}
async function cancelChildConversation(binding,executionTaskId){
  await readChildConversation(binding);
  const result=await runtimeApplication.cancelSubagentConversationTask({...binding,executionTaskId});
  publish();return result;
}
async function openSubagentConversation(payload){
  const detail=await readChildConversation(payload);
  const key=JSON.stringify([detail.parentTaskId,detail.taskId]);
  const previous=subagentWindows.get(key);
  if(previous&&!previous.window.isDestroyed()){previous.lastUsedAt=Date.now();previous.window.show();previous.window.focus();return {opened:true};}
  await recycleSubagentWindows();
  if(subagentWindows.size>=SUBAGENT_WINDOW_LIMIT)throw Error('子对话窗口仍在使用，请先发送草稿或关闭空闲窗口');
  const area=screen.getDisplayMatching(orb.getBounds()).workArea;
  const width=Math.min(780,area.width-32),height=Math.min(760,area.height-32);
  const window=windowFor('subagent',{width,height,x:area.x+Math.round((area.width-width)/2),y:area.y+Math.round((area.height-height)/2)},
    {title:'PersonalAgent · 子智能体对话',frame:true,transparent:false,backgroundColor:'#151515',minWidth:Math.min(420,width),minHeight:Math.min(440,height)});
  const record={window,binding:{parentTaskId:detail.parentTaskId,taskId:detail.taskId},revision:runtimeApplication.runtime.getTask(detail.taskId).updatedAt,lastUsedAt:Date.now(),checkedAt:0};
  subagentWindows.set(key,record);
  window.on('focus',()=>{record.lastUsedAt=Date.now();});
  window.on('closed',()=>subagentWindows.delete(key));
  return {opened:true};
}
/** Bounded child windows: close the least recently used one before opening another. */
async function canRecycleSubagentWindow(window){
  if(window.isDestroyed())return true;
  try{
    // Read only a fixed boolean; drafts stay in their original renderer.
    return await window.webContents.executeJavaScript(`(() => {
      const input=document.querySelector('textarea');
      return Boolean(input&&!input.disabled&&!input.value.trim()&&!document.querySelector('[aria-busy="true"]'));
    })()`)===true;
  }catch{return false;}
}
async function closeSubagentWindow(window){
  if(window.isDestroyed())return true;
  return new Promise(resolve=>{
    let timer;
    const finish=closed=>{clearTimeout(timer);window.removeListener('closed',closedEvent);window.webContents.removeListener('will-prevent-unload',prevented);resolve(closed);};
    const closedEvent=()=>finish(true),prevented=()=>finish(false);
    window.once('closed',closedEvent);window.webContents.once('will-prevent-unload',prevented);
    timer=setTimeout(()=>finish(window.isDestroyed()),1000);
    try{window.close();}catch{finish(false);}
  });
}
async function recycleSubagentWindows(){
  while(subagentWindows.size>=SUBAGENT_WINDOW_LIMIT){
    let recycled=false;
    const ordered=[...subagentWindows].sort((a,b)=>(a[1].lastUsedAt??0)-(b[1].lastUsedAt??0));
    for(const [key,record] of ordered){
      if(record.window.isDestroyed()){subagentWindows.delete(key);recycled=true;break;}
      if(!await canRecycleSubagentWindow(record.window))continue;
      if(await closeSubagentWindow(record.window)){recycled=true;break;}
    }
    if(!recycled)throw Error('子对话窗口均有草稿或状态无法确认，已保留输入；请先发送草稿或关闭空闲窗口');
  }
}
/** One action closes every child conversation window, releasing their renderer processes. */
async function collapseAllSubagentConversations(keep){
  let closed=0,preserved=0;
  for(const [key,record] of [...subagentWindows]){
    if(!await canRecycleSubagentWindow(record.window)){preserved++;continue;}
    if(record.window.isDestroyed()){subagentWindows.delete(key);continue;}
    if(await closeSubagentWindow(record.window))closed++;else preserved++;
  }
  if(preserved)throw Error(`已收起 ${closed} 个子对话；${preserved} 个含草稿或状态无法确认的窗口已保留。`);
  if(subagentListWindow&&!subagentListWindow.isDestroyed()&&subagentListWindow!==keep){subagentListWindow.close();closed++;}
  if(subagentListWindow===keep)subagentListWindow=keep;else subagentListWindow=undefined;
  return {closed};
}
function openAllSubagentConversations(){
  if(subagentListWindow&&!subagentListWindow.isDestroyed()){subagentListWindow.show();subagentListWindow.focus();return;}
  const area=screen.getDisplayMatching(orb.getBounds()).workArea;
  const width=Math.min(900,area.width-32),height=Math.min(760,area.height-32);
  subagentListWindow=windowFor('subagent-list',{width,height,x:area.x+Math.round((area.width-width)/2),y:area.y+Math.round((area.height-height)/2)},
    {title:'PersonalAgent · 全部子智能体',frame:true,transparent:false,backgroundColor:'#151515',minWidth:Math.min(420,width),minHeight:Math.min(440,height)});
  subagentListWindow.on('closed',()=>{subagentListWindow=undefined;});
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

async function refresh(taskId, isCurrent = () => true) {
  if (!isCurrent()) throw Error('Task refresh session changed');
  const task = await client.call('task.get', {taskId});
  if (!isCurrent()) throw Error('Task refresh session changed');
  const current = tasks.get(taskId);
  if (current?.taskId === task.taskId && current.revision > task.revision) return current;
  tasks.set(taskId, task);
  observeTextTaskOutput(task);
  clearInactiveTaskExitWarning();
  publish(['tasks','approvals']);
  return task;
}

function clearInactiveTaskExitWarning() {
  if (runtimeError === 'Runtime 仍有活动任务；请先等待完成或停止任务后再退出'
    && [...tasks.values()].every(task => terminalTaskStates.has(task.state))) {
    runtimeError = '';
  }
}

function observeTextTaskOutput(task) {
  if (conversationDelivery.stopped(task)) return;
  liveVoice?.observeTextTask({...task,resultSummary:resultText(task.resultSummary,taskResultMetadata(task))});
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
      observeTextTaskOutput(event.payload);
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
    // Existing trusted Runtime events wake receipt-only reconciliation; no new poll or resubmit.
    harnessEventsHost?.flush();
  }
}

async function pumpEvents() {
  if (runtimeClosed || eventBusy || !client || !runtimeConnection?.readEvents || !eventCursor) return;
  eventBusy = true;
  const connection=runtimeConnection,currentClient=client,cursor=eventCursor;
  const isCurrent=()=>runtimeConnection===connection&&client===currentClient&&eventCursor===cursor;
  let hasMore = false;
  try {
    // Events are the fast path. Recover active projections even after a lost event
    // or cursor/read failure, without resubmitting work or changing Runtime state.
    if(Date.now()>=taskReadbackAt){
      taskReadbackAt=Date.now()+2000;
      for (const task of tasks.values()) {
        if (terminalTaskStates.has(task.state)) continue;
        try { await refresh(task.taskId,isCurrent); } catch { /* The next recovery tick retries the original read. */ }
        if(!isCurrent())return;
      }
      // Re-send even when all tasks are terminal: the final IPC update may have
      // arrived while a renderer was loading or failed to apply its projection.
      publish();
    }
    const afterSequence = eventCursor.afterSequence;
    if (eventSubscriptionConnection !== connection) {
      await currentClient.call('event.subscribe', {streamId: 'tasks', afterSequence});
      if(!isCurrent())return;
      eventSubscriptionConnection = connection;
      eventThroughSequence = undefined;
    }
    // Production uses the original Runtime's bounded reader. Only the explicit Fake has the
    // old in-memory reader; it does not become a fallback for an unavailable production port.
    const batch = connection.readEventBatch
      ? await connection.readEventBatch({afterSequence, throughSequence:eventThroughSequence, limit:128})
      : fakeMode ? {events:await connection.readEvents(afterSequence), hasMore:false} : undefined;
    if (!batch) throw Error('Runtime 有界事件读取未就绪');
    if (runtimeClosed || !isCurrent()) return;
    const events = batch.events;
    hasMore = batch.hasMore;
    eventThroughSequence = hasMore ? batch.throughSequence : undefined;
    const accepted = eventCursor.accept(events);
    for (const event of accepted) {
      if(!isCurrent())return;
      applyEvent(event);
      if(['task.completed','task.progress'].includes(event.type)&&event.taskId)
        connectorChangeHost?.observeTask(event.taskId);
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
        if(!isCurrent())return;
        if (result.items[0]) approvals.set(event.payload.approvalId, structuredClone(result.items[0]));
      }
    }
    const progressTaskIds = new Set(accepted.filter(event => event.type === 'task.progress' && event.taskId).map(event => event.taskId));
    // A bounded batch must not fan out a second unbounded queue of readbacks.
    let progressError;
    for (const taskId of progressTaskIds) {
      try { await refresh(taskId,isCurrent); }
      catch (error) { progressError ??= error instanceof Error ? error.message : '任务进度读取失败'; }
      if(!isCurrent())return;
    }
    if (progressError !== undefined) runtimeError = progressError;
    if (accepted.length) publish(['tasks','approvals','notifications']);
    void connectorChangeHost?.flush();
  } catch (error) {
    if(!isCurrent())return;
    hasMore = false;
    runtimeError = error instanceof Error ? error.message : '事件流读取失败';
    publish();
  } finally {
    eventBusy = false;
    if (hasMore && !runtimeClosed && runtimeConnection === connection && !eventContinuation) {
      eventContinuation = setImmediate(() => {eventContinuation=undefined; void pumpEvents();});
    }
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
  historyPages.clear();tasks.clear(); approvals.clear();
  let beforeSequence;
  let snapshotSequence;
  do {
    const page = await client.call('task.list', {limit: 100,
      states:['created','planning','running','verifying','waiting_approval','waiting_external','waiting_reconciliation','cancelling'],
      ...(beforeSequence ? {beforeSequence} : {}), ...(snapshotSequence === undefined ? {} : {snapshotSequence})});
    snapshotSequence = page.snapshotSequence;
    for (const task of page.items) { tasks.set(task.taskId, structuredClone(task)); if (task.goal) rememberTaskGoal(task.taskId, task.goal); }
    beforeSequence = page.nextBeforeSequence;
    if(beforeSequence)await new Promise(resolve=>setImmediate(resolve));
  } while (beforeSequence);
  let beforeRowId;
  do {
    const pending=await client.call('approval.list',{state:'pending',limit:100,...(beforeRowId?{beforeRowId}:{})});
    for(const approval of pending.items){approvals.set(approval.approvalId,structuredClone(approval));
      if(!tasks.has(approval.taskId)){const task=await client.call('task.get',{taskId:approval.taskId});tasks.set(task.taskId,task);}}
    beforeRowId=pending.nextBeforeRowId;
    if(beforeRowId)await new Promise(resolve=>setImmediate(resolve));
  } while(beforeRowId);
  if(fakeMode){const recent=await client.call('task.list',{limit:100});for(const task of recent.items)tasks.set(task.taskId,task);}
  for(const surface of ['panel','workspace',undefined])historyPages.load(surface);
  eventCursor.reset(snapshotSequence ?? 0);
  eventThroughSequence = undefined;
  eventSubscriptionConnection = undefined;
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

function readDesktopRequestContext(scope) {
  if (!conversationToolAccess?.resolveConversation(scope.taskId)) return;
  return createConversationEnvironmentContext({readTodoState:current=>todoHost?.readConversationGuidance?.(current),
    readCalendarState:()=>({registered:connectorConversationTools?.tools.some(tool=>tool.descriptor.name==='calendar.create')===true,
      configured:calendarConfig?.snapshot().configured===true})})(scope);
}

function readDesktopConversationContext(scope,maxMessages) {
  const requestingTaskId=scope.taskId;
  const parent=scope.taskId?runtimeApplication.readDelegatedUserTaskParent?.(scope.taskId):undefined;
  if(parent)scope={...scope,taskId:parent.taskId,conversationId:parent.conversationId};
  if (!conversations?.containsConversation(scope.conversationId)) {
    if(requestingTaskId)coordinationWatchInputs.set(requestingTaskId,'[]');return [];
  }
  const task=scope.taskId ? runtimeApplication.runtime.getTask(scope.taskId) : undefined;
  const cutoff=conversations.turns.get(scope.taskId)?.createdAt ?? task?.createdAt ?? task?.updatedAt ?? new Date().toISOString();
  const surface=conversations.session(scope.conversationId).surface;
  const messages=[...conversations.messagesFor(surface,scope.conversationId),...(liveVoice?.historyMessages({...scope,cutoff}) ?? [])]
    .filter(message=>Date.parse(message.createdAt)<=Date.parse(cutoff))
    .map(message=>({id:message.id,role:message.role,content:message.text,createdAt:message.createdAt}));
  let context=runtimeApplication.readConversationContext({...scope,historyMessages:messages,...(maxMessages===undefined?{}:{maxMessages})});
  if(installedSkillsHost)context=installedSkillsHost.filterContext(context);
  const current=(knowledgeWatchHost?.dialogueProjection?.()?.items ?? [])
    .filter(item=>item.usableAsCurrentFact === true && item.answer?.kind === 'current_fact');
  if(requestingTaskId)coordinationWatchInputs.set(requestingTaskId,JSON.stringify(current));
  if(current.length)context.push({id:'knowledge-watch-current',role:'assistant',
    content:JSON.stringify({treatment:'untrusted_public_facts',items:current})});
  if(maxMessages!==undefined&&(!Number.isSafeInteger(maxMessages)||maxMessages<1||context.length>maxMessages))
    throw new ProtocolError('INVALID_ARGUMENT','Complete conversation exceeds the explicit source range');
  return context;
}

function refreshHarnessContextHost(createModelSummarizer=harnessModelSummarizer) {
  harnessModelSummarizer=createModelSummarizer;
  harnessContextHost?.dispose();harnessContextHost=undefined;harnessContextFailure='';
  try {
    harnessContextHost=createDesktopHarnessContextHost({readConfiguration:()=>modelApiHost?.readHarnessConfiguration().context??{enabled:false},
      modelApi:modelApiHost,getApplication:()=>runtimeApplication,resolveConversation:taskId=>conversationToolAccess.resolveConversation(taskId),
      readSnapshot:(scope,maxMessages)=>readDesktopConversationContext(scope,maxMessages),confirmExport:confirmDeveloperExport,createModelSummarizer});
  }catch{harnessContextFailure='上下文摘要设置、原模型版本或发送门禁不可用；未启用摘要模型';}
}

function readDesktopDeveloperHarnessConfiguration() {
  const setting=modelApiHost?.readHarnessConfiguration(),workspace=codingWorkspace?.readDeveloperConfiguration?.(),
    permissionRef=codingWorkspace?.readWorkspaceExportConfigurationRef?.();
  if(!setting?.enabled||!workspace||!permissionRef)return undefined;
  const original={revision:setting.revision,workspaceRef:workspace.bindingId,permissionRef};
  return {workspaceRef:workspace.bindingId,maxExecutorSteps:setting.maxExecutorSteps,
    configurationRef:createHash('sha256').update(JSON.stringify(original)).digest('hex'),assertCurrent:()=>{
      const current=modelApiHost?.readHarnessConfiguration(),latest=codingWorkspace?.readDeveloperConfiguration?.();
      if(!current?.enabled||current.revision!==original.revision||latest?.bindingId!==original.workspaceRef
        ||codingWorkspace?.readWorkspaceExportConfigurationRef?.()!==original.permissionRef)
        throw Error('原开发者 Harness 设置或工作区许可已变化');
    }};
}

// Windows' own signed-code verifier checks the fixed PowerShell viewer binary;
// source text is never passed to it, to a command line, or to the Renderer.
const f15ViewerSignatureCache=new Map();
function verifyF15ViewerExecutable({path:executable,sha256}) {
  if(process.platform!=='win32'||typeof executable!=='string'||!/^[a-f0-9]{64}$/.test(sha256))return false;
  const key=executable+'\0'+sha256,prior=f15ViewerSignatureCache.get(key);
  if(prior&&Date.now()-prior.time<60000)return prior.valid;
  try {
    const systemRoot=process.env.SystemRoot;if(!systemRoot||!path.isAbsolute(systemRoot))return false;
    const verifier=path.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
    if(realpathSync.native(verifier).toLowerCase()!==path.normalize(verifier).toLowerCase())return false;
    const target=Buffer.from(executable,'utf8').toString('base64');
    const script=`$ErrorActionPreference='Stop';$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${target}'));$s=Get-AuthenticodeSignature -LiteralPath $p;if($s.Status -eq 'Valid' -and $s.SignerCertificate.Subject -match '(^|,\\s*)CN=Microsoft Corporation(,|$)'){[Console]::Write('OK')}else{exit 1}`;
    const output=execFileSync(verifier,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
      {encoding:'utf8',windowsHide:true,timeout:10000,stdio:['ignore','pipe','ignore']});
    const valid=output==='OK';f15ViewerSignatureCache.set(key,{time:Date.now(),valid});return valid;
  }catch{return false;}
}
function f15ReviewSnapshot(){
  const state=f15ReviewHost?.snapshot()??{configured:false,available:false},viewer=f15ReviewViewer?.snapshot();
  return {...state,canConfigure:Boolean(f15ReviewOrigin?.readAuthorIdentity()&&viewer?.available),
    installed:Boolean(f15ReviewInstalled&&state.available&&viewer?.available),pending:f15ReviewHost?.pending()??[],
    ...(f15ReviewNotice?{reason:f15ReviewNotice}:{})};
}
function installF15Review(){
  f15ReviewInstalled=false;f15ReviewNotice='';
  if(!f15ReviewHost?.snapshot().available||!f15ReviewViewer?.snapshot().available)return;
  try{runtimeApplication.configureCodingRepairIndependentReview(f15ReviewHost.createBinding());f15ReviewInstalled=true;}
  catch{f15ReviewNotice='独立审核已配置，但原任务或 Runtime 绑定尚不允许接入。';}
}

function readDesktopModelApiState() {
  const value=modelApiHost?.snapshot();
  if(!value)return undefined;
  let harnessExperience;
  try{harnessExperience=harnessExperienceAdminHost?.snapshot();}
  catch{harnessExperience={available:false,entries:[],reason:'原开发经验宿主暂不可读取'};}
  let executionAvailable=false;try{executionAvailable=Boolean(readDesktopDeveloperHarnessConfiguration());}catch{}
  return {...value,developerSettings:developerSettings?.snapshot(),harnessExperience,
    harness:{...value.harness,executionAvailable,
    executionReason:executionAvailable?'按当前编程工作区的原许可接入':value.harness?.enabled
      ?'请在「开发 → 环境 / Worktrees」选择本地工作区并重启装配，再启用原本会话读取与结果出机许可':'开发任务规划未启用',
    contextAvailable:Boolean(harnessContextHost?.runtimeHooks),contextReason:harnessContextFailure}};
}

function readDesktopHarnessVersions() {
  if(!competitionMode||fakeMode||fakeModelMode||syntheticMvp)return undefined;
  try {
    const binding=agentArtsConfig.binding(),transport=agentArtsConfig.readTransportOptions(binding),
      deploymentVersion=transport.deploymentVersion,runtimeVersion=runtimeBuildIdentityReader?.();
    if(typeof deploymentVersion!=='string'||!deploymentVersion||/^(latest|current|default)$/iu.test(deploymentVersion)
      ||typeof runtimeVersion!=='string'||!/^runtime-artifacts:sha256:[a-f0-9]{64}$/u.test(runtimeVersion))return undefined;
    return {workflowVersion:'agentarts-deployment:'+deploymentVersion,runtimeVersion,executionKind:'real_host'};
  }catch{return undefined;}
}

// The native workflow and event guards share this live deployment/configuration reader.
// Reading it does not describe, advance or start a cloud session.
function readProactiveWorkflowConfiguration() {
  const binding=agentArtsConfig?.runtimeBinding(),receiptSecret=process.env.PA_WORKFLOW_RECEIPT_SECRET,
    contractRef=process.env.PA_PROACTIVE_CONTRACT_REF,hostToken=process.env.PA_AGENT_WSS_AUTH_TOKEN;
  if(!binding||!receiptSecret||!contractRef||!hostToken)return undefined;
  const transport=agentArtsConfig.transportConfig(binding);
  const assertDeploymentBinding=()=>{
    transport.assertDeploymentBinding?.();
    if(!agentArtsConfig.isTransportCurrent(transport))throw Error('持续工作流原部署已改变');
  };
  return {contractRef,adapter:{config:{...binding,
    ...(transport.deploymentVersion?{deploymentVersion:transport.deploymentVersion}:{}),
    ...(transport.websocketUrl?{websocketUrl:transport.websocketUrl}:{})},receiptSecret,
    assertDeploymentBinding,fetchImpl:transport.fetchImpl,
    authorizationProvider:{read:async()=>agentArtsConfig.readAuthorization(binding,transport)},
    hostAuthorizationProvider:{read:async()=>'Bearer '+hostToken},invokeMode:agentArtsInvokeMode}};
}

function initializeHarnessEventPorts(runtimeModule) {
  if(!competitionMode||!runtimeApplication?.startProactiveTask||proactiveWorkflowApplication)return;
  proactiveWorkflowApplication=createDesktopProactiveWorkflowApplication({application:runtimeApplication,
    resolveUserConversation:id=>conversationToolAccess.resolveConversation(id),
    readPersistedSession:(taskId,sessionId)=>runtimeModule.readPersistedRuntimeProactiveWorkflow(runtimeApplication.runtime,taskId,sessionId),
    notificationHost:notificationApplicationHost?.runtimeHost,localDeviceAvailable:()=>!app.isQuitting,onUpdate:publish,
    // Production controller consumer; absent cloudPersistentHost stays unavailable (no invented port).
    controller:createDesktopProactiveControllerHost({getRuntime:()=>runtimeApplication?.runtime}),
    bindings:[{kind:'teacher_decision',toolName:'proactive.teacher_decision',toolVersion:'1.0.0',location:'local_device',effect:'read'}],
    context:()=>createDesktopProactiveContextPorts({readMemory:()=>proactiveHost?.publicMemory,
      readGoals:()=>runtimeApplication.runtime.provisionCoordinationStore(desktopHost.userNamespace),
      readKnowledgeSource:()=>obsidianPairing?.source??knowledgeSourceConfig,limit:20}),
    readConfiguration:readProactiveWorkflowConfiguration});
  proactiveSourceRouter=createDesktopProactiveConfirmedSourceRouter({getApplication:()=>runtimeApplication,
    getWorkflow:()=>proactiveWorkflowApplication,namespace:desktopHost.userNamespace,
    resolveUserConversation:id=>conversationToolAccess.resolveConversation(id),
    readSourceBinding:id=>feedsHost?.readSourceBinding(id),readTrackingGrant:query=>feedsHost?.readTrackingGrant(query)});
  harnessEventsHost=createDesktopHarnessEventsHost({getApplication:()=>runtimeApplication,
    getWorkflow:()=>proactiveWorkflowApplication,getNotifications:()=>notificationApplicationHost,
    resolveUserConversation:id=>conversationToolAccess.resolveConversation(id),
    readConfigurationRef:()=>runtimeApplication.coordinationConfigurationRef,
    readWorkflowConfiguration:readProactiveWorkflowConfiguration,
    readNativeConfiguration:()=>modelApiHost?.readHarnessConfiguration(),
    readDeveloperHarnessConfiguration:readDesktopDeveloperHarnessConfiguration,
    readSourceOrigin:(taskId,event)=>proactiveSourceRouter.readHarnessSourceOrigin(taskId,event),
    readSourceAuthorization:(taskId,event)=>proactiveSourceRouter.readHarnessSourceAuthorization(taskId,event),
    readPersistedWorkflow:runtimeModule.readPersistedRuntimeProactiveWorkflow,
    readPersistedDelivery:runtimeModule.readPersistedHarnessOriginalDelivery,
    namespace:desktopHost.userNamespace,readSourceBinding:id=>feedsHost?.readSourceBinding(id),
    readTrackingGrant:query=>feedsHost?.readTrackingGrant(query)});
}

async function confirmHarnessExperienceActivation(version,context) {
  const owner=admin;
  const current=()=>{
    if(harnessExperienceLifetime.signal.aborted||context.signal.aborted||!owner||owner!==admin||owner.isDestroyed()
      ||!Number.isFinite(Date.parse(context.deadline))||Date.now()>=Date.parse(context.deadline))
      throw new ProtocolError('CANCELLED','开发经验确认已失效');
  };
  current();
  const allowed=await confirmApplicationAuthorization('experience.activate',version,{scope:{workflowId:version.workflowId,revision:version.revision},
    deadline:context.deadline,signal:context.signal,summary:`启用开发经验版本 ${version.revision}；仅采用已验证配方，具体执行仍受本次工具卡与沙箱约束`,
    isCurrent:()=>{try{current();return true;}catch{return false;}}});
  current();return allowed;
}

async function initializeInstalledSkills() {
  if(competitionMode && !installedSkillsHost) {
    const {openLocalSkillStore}=await import('@personal-agent/skills');
    installedSkillsHost=createInstalledSkillsHost({
      store:openLocalSkillStore(path.join(app.getPath('userData'),'installed-skills.json')),onUpdate:publish,
      readParentTaskId:taskId=>runtimeApplication?.runtime.loadCheckpoint(taskId,'subtask-parent')?.parentTaskId,
      validateRunInput:async publicGoal=>{
        const {compileCoordinationGoal}=await import('@personal-agent/runtime/application');
        const limit=harnessContextHost?.runtimeHooks?.policy.maxSourceMessages;
        const context=readDesktopConversationContext({conversationId:conversations.activeConversationId('workspace'),
          deadline:new Date(Date.now()+180000).toISOString(),signal:new AbortController().signal},limit);
        if(harnessContextHost?.runtimeHooks)harnessContextHost.preflight(publicGoal,publicGoal,context,compileCoordinationGoal);
        else compileCoordinationGoal(publicGoal,publicGoal,context);
      },
      selectDirectory:async()=>{
        const result=await dialog.showOpenDialog(admin,{title:'选择包含 SKILL.md 的 Skill 文件夹',properties:['openDirectory']});
        return result.canceled?undefined:result.filePaths[0];
      },
      confirm:async request=>{
        const origin=admin,application=runtimeApplication;
        if(!origin || origin.isDestroyed()) return false;
        const actions={install:'安装 Skill',enable:'启用 Skill',uninstall:'卸载 Skill',run:'仅本任务使用 Skill'};
        return confirmApplicationAuthorization('skill.'+request.action,request,{scope:{action:request.action,digest:request.digest},
          summary:`${actions[request.action]}；仅已核对内容摘要的此 Skill 版本，不授权其任意工具调用`,
          isCurrent:()=>origin===admin&&!origin.isDestroyed()&&application===runtimeApplication});
      }});
  }
}

function initializeAuthorizationHosts(runtimeModule){
  authorizationQuestionHost?.close();
  authorizationQuestionHost=createDesktopAuthorizationQuestionHost({createQuestions:options=>new runtimeModule.AuthorizationQuestions(options),
    getApplication:()=>runtimeApplication,namespace:desktopHost.userNamespace,
    resolveConversation:taskId=>conversationToolAccess?.resolveConversation(taskId)
      ??connectorWatchHost?.resolveUserConversation(taskId)
      ??connectorMailReadOrigin?.read(taskId)?.conversationId
      ??conversations?.activeConversationId('panel'),
    available:()=>Boolean(panel&&!panel.isDestroyed()||workspace&&!workspace.isDestroyed()),onUpdate:publish,
    profiles:[{ref:'default-read-only',label:'应用内只读权限',mode:'read-only',revision:1,available:true},
      {ref:'workspace-write',label:'应用内受限写入／工作区权限',mode:'workspace-write',revision:1,available:true},
      {ref:'full-access',label:'完全访问（自动同意；以当前用户权限执行）',mode:'full-access',revision:1,available:true}],
    defaultProfileRef:'default-read-only',
    resolveProfile:(request,selected)=>selected.mode==='read-only'&&(request.taskConsent?.mode==='workspace-write'||request.requirements.some(item=>
      item.scopes.some(scope=>/:(?:write|execute|verify|patch|send|create|delete)(?:$|:)/u.test(scope)
        ||scope==='notifications:settings'||/^(?:memory\.(?:save|erase|withdraw)|skill\.(?:install|enable|uninstall)|experience\.activate|workflow\.(?:enable|delete)|facts\.erase|feeds\.classify|knowledge\.(?:configure|pair)|remoteMcp\.configure)$/u.test(scope)))
      )&&request.toolName!=='workspace.node_check'?'workspace-write':selected.ref,
    describeExecution:(request,profile)=>nativeExecutionHost?.describeExecution(request,profile)
      ??{required:false,available:false,backend:'unavailable',enforced:false,reason:'本次为应用内工具；外部进程隔离未就绪'}});
  authorizationIntentHost?.close();
  authorizationIntentHost=createDesktopAuthorizationIntentHost({getApplication:()=>runtimeApplication,question:authorizationQuestionPort,
    openConversation:()=>openPanel(true)});
}

async function initializeLocalAuthorizationControlPlane(){
  if(runtimeApplication)return;
  const module=await import('@personal-agent/runtime/application');
  initializeAuthorizationHosts(module);
  // The same Competition TaskRuntime DB remains authoritative. No model/provider or substitute agent is created.
  runtimeApplication=module.createRuntimeApplication({path:dataPaths.runtime,profile:'huawei_ict_agentarts',
    hostUserNamespace:desktopHost.userNamespace,tools:[authorizationIntentHost.tool],hostOnlyTools:[AUTHORIZATION_INTENT_TOOL],
    requestToolAuthorization:scope=>{authorizationIntentHost.prepareQuestion(scope);return authorizationQuestionHost.requestToolAuthorization(scope);},
    requiresToolAuthorization:()=>true});
  runtime=runtimeApplication.runtime;localAuthorizationOnly=true;
  runtimeConnection=await register({transport:runtimeApplication,now:Date.now,readEvents:after=>runtimeApplication.readEvents(after),
    readEventBatch:input=>runtimeApplication.readEventBatch(input),
    attachClient:value=>{client=value;return()=>{client=undefined;};}});
  client=runtimeConnection.client;eventCursor=new EventCursor('tasks');
  await syncCapabilities();
  await syncRuntimeSnapshots();
  await pumpEvents();
  eventPoll=setInterval(()=>{void pumpEvents();},120);
}

async function initializeLocalLaya() {
  if (!competitionMode || localLaya) return;
  const {createLocalInboxClassifier} = await import('@personal-agent/runtime/application');
  const {LayaActionChoiceService, LocalLayaHttpTransport} = await import('@personal-agent/cognition');
  localLaya = createLocalLayaHost({projectRoot:path.resolve(dir, '../../..'),
    getPendingLimit:()=>resourcePolicy.snapshot().inferencePendingLimit,
    createService:createLocalInboxClassifier,
    createChooser:({port,getApiKey}) => new LayaActionChoiceService(new LocalLayaHttpTransport(port,getApiKey)),
    onUpdate:publish});
}

async function initializeRuntime() {
  const runtimeModule = await import('@personal-agent/runtime/application');
  const runtimeRoot=await import('@personal-agent/runtime');
  runtimeBuildIdentityReader=runtimeRoot.readRuntimeBuildIdentity;
  const {createRuntimeApplication} = runtimeModule;
  if(localAuthorizationOnly){
    if(runtimeApplication.activeTaskCount)throw Error('请先完成或取消当前本机授权卡');
    clearInterval(eventPoll);eventPoll=undefined;
    runtimeConnection?.dispose();runtimeApplication.close();runtimeApplication=undefined;runtime=undefined;localAuthorizationOnly=false;
  }
  initializeAuthorizationHosts(runtimeModule);
  conversationToolAccess=createConversationToolAccess({getApplication:()=>runtimeApplication,getConversations:()=>conversations});
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
      await initializeLocalLaya();
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
      const codingModule=await import('@personal-agent/coding-tools');
      const {createWorkspaceReadTool}=codingModule;
      nativeExecutionHost?.close();
      nativeExecutionHost=createDesktopNativeExecutionHost({coding:codingModule,question:authorizationQuestionHost,getApplication:()=>runtimeApplication,
        readConfiguration:()=>codingWorkspace?.readWorkspaceBinding(),probeRootPath:path.join(app.getPath('userData'),'native-probes'),
        systemRoot:process.env.SystemRoot,localAppData:app.getPath('userData'),onUpdate:publish,
        ensureHelper:async()=>{
          const helper=path.join(app.getPath('userData'),'native-tools','workspace-command','WindowsJobProcessHost.exe');
          if(existsSync(helper))return helper;
          if(app.isPackaged)throw new ProtocolError('UNSUPPORTED_CAPABILITY','安装包缺少已发布的原生进程隔离组件');
          const {buildNativeHelper}=await import('@personal-agent/coding-tools/native-helper');
          return buildNativeHelper({targetDir:path.dirname(helper)}).helperPath;
        }});
      const createWorkspaceCommandTool=options=>nativeExecutionHost.createCommandTool(options);
      const {createDesktopCompetitionToolCatalog} = await import('./competition-tool-catalog.js');
      const namespace = desktopHost.userNamespace;
      if (!syntheticMvp) {
        const channel = createDesktopNotificationPort({storageDir: app.getPath('userData'),
          onOutcome: outcome => notificationApplicationHost?.receipt(outcome)});
        notificationApplicationHost = createDesktopNotificationApplicationHost({namespace, channel,question:authorizationQuestionPort,onUpdate: publish});
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
          fetchImpl:(url,init)=>{
            if(!calendarMeetingHost)throw new ProtocolError('UNAUTHORIZED','原日历授权宿主不可用');
            calendarMeetingHost.assertCurrentRead();return fetch(url,init);
          },
        });
        calendarMeetingHost = createDesktopCalendarMeetingHost({config: calendarConfig, namespace,question:authorizationQuestionPort,
          readTool: calendarReadTool, readArguments: (binding,externalId) => ({configurationId:calendarConfigurationId(binding),externalId}),
          onUpdate: publish});
      }
      if (!syntheticMvp) goalCloudHost = createDesktopGoalCloudHost({goalHost, namespace,question:authorizationQuestionPort,
        isConversationAllowed:(id,taskId)=>conversationToolAccess.isConversationAllowed(id,taskId),
        readProactiveBinding: taskId => proactiveHost?.readRepairBinding?.(taskId)});
      if (!syntheticMvp) proactiveConversationTools=createDesktopProactiveConversationTools({
        getApplication:()=>runtimeApplication,getHost:()=>proactiveWorkflowApplication,
        isConversationAllowed:(id,taskId)=>conversationToolAccess.isConversationAllowed(id,taskId),
        resolveUserConversation:taskId=>conversationToolAccess.resolveConversation(taskId)});
      if(!syntheticMvp)connectorWatchHost=createDesktopConnectorWatchHost({getApplication:()=>runtimeApplication,
        namespace,question:authorizationQuestionPort,readSourceAuthorization:readConnectorSourceAuthorization,
        resolveUserConversation:taskId=>conversationToolAccess.resolveConversation(taskId),
        isUserConversation:id=>conversations?.containsConversation(id)===true,
        startMailRead:input=>{
          if(!readConnectorSourceAuthorization('mail').available)return false;
          if(!localLaya?.snapshot().ready)return false;
          if(!['ready','complete','disabled','failed','resync_required'].includes(mailHost.snapshot().status))return false;
          const token={watchId:input.watchId,commandId:input.commandId,sessionId:randomUUID()};
          activeConnectorMailRead=token;
          try {mailHost.startBatch({expiresAt:input.expiresAt});return {sessionId:token.sessionId};}
          catch(error){if(activeConnectorMailRead===token)activeConnectorMailRead=undefined;throw error;}
        },readMailStatus:scope=>activeConnectorMailRead?.watchId===scope.watchId&&activeConnectorMailRead.sessionId===scope.sessionId
          ?{sessionId:scope.sessionId,state:mailHost?.snapshot().status??'unavailable'}:{state:'unavailable'},
        stopMailRead:scope=>{
          if(activeConnectorMailRead?.watchId!==scope.watchId||activeConnectorMailRead.sessionId!==scope.sessionId)return;
          activeConnectorMailRead=undefined;return mailHost?.cancel();
        },
        observeTask:taskId=>connectorChangeHost?.observeTask(taskId),onUpdate:publish});
      if (!syntheticMvp) {
        try {todoHost = createDesktopTodoHost({userData:app.getPath('userData'),safeStorage,namespace,question:authorizationQuestionPort,
          notificationHost:notificationApplicationHost,
          verifyWorkflowReminderBinding:createVerifyWorkflowReminderBinding({getApplication:()=>runtimeApplication}),
          createDeliveryHost:runtimeModule.createReminderDeliveryHost,onUpdate:publish,
          onNotification:async item=>{
            if (!item.batchId) return;
            return notificationApplicationHost.deliverBatch({batchId:item.batchId,
              scope:{kind:'connector',connectorId:'productivity'},expiresAt:new Date(Date.now()+30_000).toISOString(),
              title:'PersonalAgent 待办提醒',body:item.summary.slice(0,2000),source:'productivity'});
          }});}
        catch {todoFailure = '待办存储无法读取，原数据已保留，请恢复本机安全存储';}
      }
      if(!syntheticMvp){
        computerControlLease=createComputerControlLease({getRuntime:()=>runtimeApplication?.runtime});
        toolPresenceHost=createToolPresenceHost({
          isFullAccess:()=>authorizationQuestionHost?.automaticallyApproves()===true,
          readPolicyBinding:()=>{const selected=authorizationQuestionHost?.sandboxSnapshot().selected;
            return selected?JSON.stringify([selected.mode,selected.revision]):undefined;},
          registerNativeShortcut:handler=>globalShortcut.register('F9',handler)
            ?()=>globalShortcut.unregister('F9'):undefined,
          isTaskCurrent:taskId=>{
            try{const task=runtimeApplication.runtime.getTask(taskId);
              return ['running','waiting_approval'].includes(task.state)&&!task.cancelRequested;
            }catch{return false;}
          },
          readTaskBinding:taskId=>conversationToolAccess.resolveConversation(taskId),
          onPrompt:request=>{
            if(request.state==='waiting'&&request.kind==='presence'&&Notification.isSupported())new Notification({title:'PersonalAgent 本机确认',
              body:'保持本次操作的应用在前台，按 F9 确认当前任务在场。具体写入仍按原任务审批。'}).show();
            publish();
          },
        });
        computerControlConfig=createComputerControlConfig({userData:app.getPath('userData')});
        const computerPreference=computerControlConfig.snapshot();
        const compatibilityPython=process.env.PA_WINDOWS_CONTROL_PYTHON;
        computerControlLaya=createComputerControlLaya({getHost:()=>localLaya,readTask:taskId=>{
          try{return runtimeApplication?.runtime.getTask(taskId);}catch{return undefined;}
        }});
        windowsControlHost=createDesktopWindowsControlHost({createControlHost:compatibilityPython?createWindowsDesktopControlHost:createWindowsNativeDesktopControlHost,
          isFullAccess:()=>authorizationQuestionHost?.automaticallyApproves()===true,
          readPolicyBinding:()=>{const selected=authorizationQuestionHost?.sandboxSnapshot().selected;
            return selected?JSON.stringify([selected.mode,selected.revision]):undefined;},
          readTaskBinding:taskId=>conversationToolAccess.resolveConversation(taskId),
          pythonExecutable:compatibilityPython,presenceHost:toolPresenceHost,
          allowObservationExport:computerPreference.allowObservationExport||process.env.PA_WINDOWS_CONTROL_EXPORT==='1',onUpdate:publish,
          readObservationExportPreference:()=>{const preference=computerControlConfig.snapshot();
            return preference.observationExportConfigured?preference.allowObservationExport:process.env.PA_WINDOWS_CONTROL_EXPORT==='1'?true:undefined;},
          providerOptions:compatibilityPython?{}:{executable:nativeDesktopExecutable({electronDir:dir,packaged:app.isPackaged,resourcesPath:process.resourcesPath}),
            artifactDirectory:path.join(app.getPath('userData'),'computer-artifacts'),selectControl:input=>computerControlLaya.select(input)}});
        windowsControlHost.configure({enabled:computerPreference.enabled,allowObservationExport:computerPreference.allowObservationExport||process.env.PA_WINDOWS_CONTROL_EXPORT==='1'});
        if(process.platform==='win32'&&computerPreference.enabled){
          await windowsControlHost.start({deadline:new Date(Date.now()+60_000).toISOString(),signal:new AbortController().signal});
        }
        browserControlHost=createBrowserControlHost({userDataPath:path.join(app.getPath('userData'),'controlled-browser'),
          downloadDirectory:path.join(app.getPath('downloads'),'PersonalAgent'),
          isFullAccess:()=>computerControlConfig?.snapshot().enabled===true&&windowsControlHost?.snapshot().observationExportAllowed===true&&authorizationQuestionHost?.automaticallyApproves()===true,
          authorizePresence:async scope=>{
            if(!computerControlConfig?.snapshot().enabled||!windowsControlHost?.snapshot().observationExportAllowed)return false;
            if(scope.phase!=='export')await windowsControlHost.preparePresence(scope);
            return windowsControlHost.hasPresence(scope.taskId);
          },onUpdate:publish});
        openCliBrowserHost=createOpenCliBrowserHost({
          readTask:taskId=>{try{return runtimeApplication?.runtime.getTask(taskId);}catch{return undefined;}},
          authorize:async scope=>{
            if(!computerControlConfig?.snapshot().enabled||!windowsControlHost?.snapshot().observationExportAllowed)return false;
            if(scope.phase!=='export')await windowsControlHost.preparePresence(scope);
            return windowsControlHost.hasPresence(scope.taskId);
          },onUpdate:publish});
        if(computerVisionConfig)computerVisionHost=createComputerVisionHost({configuration:computerVisionConfig,
          getApplication:()=>runtimeApplication,question:authorizationQuestionPort,
          isObservationAllowed:()=>computerControlConfig?.snapshot().enabled===true&&windowsControlHost?.snapshot().observationExportAllowed===true,
          hasPresence:taskId=>windowsControlHost?.hasPresence(taskId)===true,
          readArtifact:(driver,scope)=>{
            const host=driver==='windows'?windowsControlHost:browserControlHost;
            const {metadataOnly,...request}=scope;
            if(metadataOnly)return host.readScreenshotArtifactMetadata(request);
            return host.readScreenshotArtifact(request);
          },onUpdate:publish});
      }
      const hostPath = path.resolve(dir, '../../windows-host/host/bin/Release/net8.0-windows/WindowsHost.Host.exe');
      const bridgePath = path.resolve(dir, '../../windows-host/host/bridge/bin/Release/net8.0-windows/WindowsHost.PipeBridge.exe');
      if (!syntheticMvp && process.platform === 'win32' && existsSync(hostPath) && existsSync(bridgePath)) {
        notepadHost = createDesktopNotepadHost({
          isFullAccess:()=>authorizationQuestionHost?.automaticallyApproves()===true,
          readPolicyBinding:()=>{const selected=authorizationQuestionHost?.sandboxSnapshot().selected;
            return selected?JSON.stringify([selected.mode,selected.revision]):undefined;},
          createAdapter:runtimeModule.createWindowsHostNotepadAdapter,
          createAttempts:runtimeModule.createRuntimeWindowsHostAttemptStore,
          transport:runtimeModule.createWindowsHostBridgeTransport({hostPath,bridgePath}),
          registerConfirmation:handler=>toolPresenceHost?.registerConfirmation(handler),
          openNotepad:() => new Promise((resolve,reject) => {
            const child=spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows','System32','notepad.exe'),[],
              {windowsHide:false,stdio:'ignore'});
            child.once('spawn',()=>{child.unref();resolve();});child.once('error',reject);
          }),
          respond:payload => client.call('authorization.respond',payload),
          cancelTask:taskId => client.call('task.cancel',{taskId,reason:'用户停止记事本操作'}),
          reconcileTask:taskId=>withNativeReadbackScope({owner:admin},
            scope=>runtimeApplication.reconcileWindowsHostTask(taskId,scope)),
          onUpdate:publish,
          onTask:({taskId,goal}) => {
            conversations.add(taskId,'panel',goal); rememberTaskGoal(taskId,goal);
          },
        });
      }
      if (syntheticFactSource) competitionCatalog = createDesktopCompetitionToolCatalog({
        rootPath: path.resolve(dir, '../fixtures/agentarts'), createWorkspaceReadTool,
      });
      productTools = createPublicConnectorHost({systemObservationFactory:runtimeModule.createSystemObservationTool});
      if(!syntheticMvp)imageWorkflowCatalog=createImageWorkflowCatalogHost({getApplication:()=>runtimeApplication});
      if(!syntheticMvp){
        const observation=productTools.tools.find(tool=>tool.descriptor.name==='computer.system.observe');
        if(observation)systemObservationConversation=createSystemObservationConversation({tool:observation,
          getApplication:()=>runtimeApplication,resolveUserConversation:id=>conversationToolAccess.resolveConversation(id),
          confirmExport:confirmDeveloperExport});
      }
      const publicReferenceModule=await import('@personal-agent/mcp');
      publicReferenceConsent?.close();
      const confirmPublicReference=createPublicReferenceQuestionConsent({question:authorizationQuestionPort,confirmApplicationAuthorization,
        readMcpDescriptor:()=>referenceHost?.tools?.[0]?.descriptor,readSkillManifest:()=>runtimeApplication?.referenceSkillSnapshot().manifest,
        bindOriginalReference:request=>{
          const candidate=referenceHost?.readPublicReferencePreflightCandidate(request.query);
          if(candidate?.toolName!=='mcp.workspace.read_text')return false;
          runtimeApplication.bindPublicReferenceQuestion(candidate);return true;
        },
        readOriginalScope:(taskId,runId,completed=false)=>runtimeApplication?.readAuthorizationQuestionInvocation(taskId,runId,completed),
        isCurrent:()=>runtimeApplication===referenceApplication});
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
        confirmNative:confirmPublicReference,
      });
      const commandHelper=path.join(app.getPath('userData'),'native-tools','workspace-command','WindowsJobProcessHost.exe');
      codingWorkspace = createWorkspaceConfigHost({userData:app.getPath('userData'),safeStorage,
        defaultWorkspace:path.join(app.getPath('userData'),'Workspace'),
        question:authorizationQuestionPort,createWorkspaceCommandTool,
        readHarnessVersions:readDesktopHarnessVersions,
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
      if(!syntheticMvp){
        const developerCache=path.join(app.getPath('userData'),'developer-tool-cache');
        mkdirSync(developerCache,{recursive:true,mode:0o700});
        const powerShellPath=path.join(process.env.ProgramFiles??'C:\\Program Files','PowerShell','7','pwsh.exe');
        const developerOptions={
          configPath:process.env.PA_DEVELOPER_CONFIG_FILE,
          workspace:codingWorkspace.readDeveloperConfiguration(),cacheRootPath:developerCache,
          readModelGateway:(id,configurationRef)=>modelApiHost?.getModelGateway(id,configurationRef),
          confirmExport:confirmDeveloperExport,
          available:scope=>{
            try{
              const task=runtimeApplication.runtime.getTask(scope.taskId);
              return task.state==='running'&&!task.cancelRequested
                &&Boolean(conversationToolAccess.resolveConversation(scope.taskId));
            }catch{return false;}
          },
          assertPrivateFile:file=>{
            try{verifyWindowsRecoveryAcl(file,powerShellPath);return true;}catch{return false;}
          },
        };
        developerSettings=createDeveloperSettingsHost({userData:app.getPath('userData'),safeStorage,
          readWorkspace:()=>codingWorkspace.readDeveloperConfiguration(),
          readWorkspaceStatus:()=>codingWorkspace.snapshot(),
          readModels:()=>modelApiHost?.snapshot().models??[],onUpdate:publish});
        developerDeployment=await developerSettings.createDeployment(developerOptions);
      }
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
      mailConfig = createMailConfig({userData:app.getPath('userData'), safeStorage,namespace,question:authorizationQuestionPort,
        onRevoke:async () => {activeConnectorMailRead=undefined;await connectorConversationTools?.invalidate('mail');await mailHost?.cancel();},
        onCloudRevoke:async () => {await mailAnalysisHost?.revoke();}});
      const configuredMail = mailConfig.current();
      if (configuredMail) {
        try {
          const {user, authCode, revision} = configuredMail;
          mailHost = runtimeModule.createQQMailTriageHost({user, authCode, accountRef:'desktop-qq-inbox',
            onReadTask:({taskId})=>{
              if(activeConnectorMailRead)connectorWatchHost?.bindMailRead(taskId,activeConnectorMailRead);
              const conversationId=activeConnectorMailRead?connectorWatchHost?.resolveUserConversation(taskId):manualMailReadConversationId;
              connectorMailReadOrigin.bind({taskId,conversationId});
            },
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
            isSessionAllowed:scope => mailConfig.isSessionAllowed(revision,scope),batchAuthorization:mailConfig.batchAuthorization});
        } catch {mailFailure = '邮箱本地分类状态无法装配；其他功能可继续使用';}
      }
      if(!syntheticMvp)connectorConversationTools=createConnectorConversationTools({mail:mailConfig,calendar:calendarConfig,question:authorizationQuestionPort,
        localInbox:mailHost?.tools.find(tool=>tool.descriptor.name==='mail.inbox'),
        getApplication:()=>runtimeApplication,resolveConversation:taskId=>conversationToolAccess.resolveConversation(taskId),
        onReadTask:({taskId})=>connectorMailReadOrigin.bind({taskId,conversationId:conversationToolAccess.resolveConversation(taskId)}),
        confirmExport:confirmDeveloperExport});
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
        exportPolicyVersion: '1.2.0',
        accepts: ({arguments: args}) => Array.isArray(args?.subtasks) && args.subtasks.length > 0 && args.subtasks.length <= 10,
        project: async input => {
          const delegation=runtimeApplication.runtime.loadCheckpoint(input.taskId,'required-subagent-delegation:v1');
          const task=runtimeApplication.runtime.getTask(input.taskId);
          const context=delegation ? await readDesktopConversationContext({taskId:input.taskId,
            conversationId:task.conversationId,deadline:delegation.deadline,signal:input.signal}) : [];
          return projectSubagentResult({...input,userRequest:delegation
            ? process.env.PA_AGENTARTS_CONTINUATION_CONTEXT==='goal'?delegation.goal
              :runtimeApplication.compileTaskConversationGoal(input.taskId,delegation.goal,delegation.goal,context) : undefined});
        },
      };

      const powerShell=path.join(process.env.ProgramFiles??'C:\\Program Files','PowerShell','7','pwsh.exe');
      knowledgeSourceConfig=await createKnowledgeSourceConfig({userData:app.getPath('userData'),safeStorage,namespace,
        question:authorizationQuestionPort,
        hostIdentity:createHash('sha256').update(app.getPath('userData')).digest('hex'),
        powerShellPath:existsSync(powerShell)?powerShell:undefined,
        processIdentityHelperPath:existsSync(commandHelper)?commandHelper:undefined,
        selectDirectory:async()=>{
          const choice=await dialog.showOpenDialog(admin,{title:'选择本机知识库',properties:['openDirectory']});
          return choice.canceled?undefined:choice.filePaths[0];
        },selectNoteFiles:async root=>{
          const choice=await dialog.showOpenDialog(admin,{title:'选择允许整理的知识笔记',defaultPath:root,
            properties:['openFile','multiSelections'],filters:[{name:'Markdown',extensions:['md']}]});
          return choice.canceled?undefined:choice.filePaths;
        },confirmPermissions:async details=>{
          const {isCurrent,...payload}=details;
          return confirmApplicationAuthorization('knowledge.configure',payload,{scope:{sourceId:details.sourceId,configRevision:details.configRevision},
            summary:`配置知识源 ${details.displayName}：${details.writeAllowed?'可整理选定笔记；':''}${details.cloudExportAllowed?'向本任务模型公布选定PUBLIC查询与笔记目录；':''}具体内容操作在任务卡片确认。`.slice(0,512),isCurrent});
        }});
      obsidianPairing=createDesktopObsidianPairing({source:knowledgeSourceConfig,
        userData:app.getPath('userData'),
        createPairingHost:runtimeModule.createObsidianPairingHost,
        ui:createObsidianPairingUI({BrowserWindow,ipcMain,owner:()=>admin,
          confirmAuthorization:request=>confirmApplicationAuthorization('knowledge.pair',request.payload,request)}),
        changed:()=>{cancelKnowledgeTasks();publish();}});
      knowledgeTools=runtimeModule.createTrustedKnowledgeTools(obsidianPairing.source, {
        revalidate:(input,context)=>privateMemoryController().revalidateSource(input,context),
      });
      knowledgeTools={...knowledgeTools,
        tools:knowledgeTools.tools.map(tool=>({get descriptor(){return tool.descriptor;},execute:(input,context)=>
          knowledgeSourceConfig.withAuthorization(context,async()=>{const result=await tool.execute(input,context);
            knowledgeSourceConfig.assertAuthorization(context);return result;})})),
        competitionToolAvailability:knowledgeTools.competitionToolAvailability.map(entry=>({...entry,available:async scope=>
          await entry.available(scope)&&await knowledgeSourceConfig.authorizeCatalog(scope)})),
      };
      const agentArtsTransportConfig = agentArtsConfig.transportConfig(cloudBinding);
      const desktopControl={
        tools:[...(toolPresenceHost?.tools??[]),...(windowsControlHost?.tools??[]),...(browserControlHost?.tools??[]),...(openCliBrowserHost?.tools??[]),...(computerVisionHost?.tools??[])],
        availability:[...(toolPresenceHost?.competitionToolAvailability??[]),...(windowsControlHost?.competitionToolAvailability??[]),...(browserControlHost?.competitionToolAvailability??[]),...(openCliBrowserHost?.competitionToolAvailability??[]),...(computerVisionHost?.competitionToolAvailability??[])],
        exports:[...(toolPresenceHost?.competitionToolExports??[]),...(windowsControlHost?.competitionToolExports??[]),...(browserControlHost?.competitionToolExports??[]),...(openCliBrowserHost?.competitionToolExports??[]),...(computerVisionHost?.competitionToolExports??[])],
      };
      const historyTool=syntheticMvp?undefined:createConversationHistoryTool({readContext:({taskId,signal})=>{
        const task=runtimeApplication.runtime.getTask(taskId);
        return readDesktopConversationContext({taskId,conversationId:task.conversationId,
          deadline:runtimeApplication.runtime.loadCheckpoint(taskId,'application-deadline'),signal:signal??new AbortController().signal});
      }});
      f09FeedGraphHost=feedsHost?createF09FeedGraphHost({getApplication:()=>runtimeApplication,
        collectTool:feedsHost.tools.find(tool=>tool.descriptor?.name==='feeds.collect'),
        assertFeedAccess:binding=>feedsHost.assertWorkflowFeedAccess(binding)}):{tools:[],unavailable:'feeds_host_required'};
      const systemObserveTool=productTools?.tools?.find(tool=>tool.descriptor?.name==='computer.system.observe');
      workflowGraphComposition=createDesktopWorkflowGraphComposition({runtimeModule,getApplication:()=>runtimeApplication,
        feedsHost,todoHost,mailHost,notificationApplicationHost,systemObserveTool});
      // F09 worker ports require a pinned AgentArts deployment (matches ownedImage gate).
      // Unpinned / missing version stays unavailable — never inject ports that would look ready without image.
      const agentArtsPinned=(()=>{
        const snap=agentArtsConfig.snapshot();
        return snap?.deploymentSelection==='pinned'
          &&typeof snap.deploymentVersion==='string'
          &&!!snap.deploymentVersion.trim()
          &&!/^(latest|current|default)$/iu.test(snap.deploymentVersion);
      })();
      const f09WorkflowWorkerPorts=feedsHost&&agentArtsPinned?createF09WorkflowWorkerPorts({
        getApplication:()=>runtimeApplication,feedsHost,
        readHarnessVersions:()=>readDesktopHarnessVersions(),
      }):undefined;
      const f20WorkflowWorkerPorts=agentArtsPinned&&codingWorkspace?.readF20CaseConfiguration
        ?createF20WorkflowWorkerPorts({getApplication:()=>runtimeApplication,codingWorkspace,runtimeModule,
          readHarnessVersions:()=>readDesktopHarnessVersions(),readReviewerIdentity:()=>localLaya?.readClassifierIdentity?.()}):undefined;
      const authorizeWorkflowExport=createWorkflowExportConsent({getApplication:()=>runtimeApplication,
        confirmAuthorization:confirmApplicationAuthorization,readDeploymentBinding:()=>{
          const selected=agentArtsConfig.snapshot();
          if(!selected.runtimeReady||selected.deploymentSelection!=='pinned'||!selected.deploymentVersion)return;
          return createHash('sha256').update(JSON.stringify({binding:agentArtsConfig.binding(),version:selected.deploymentVersion,
            transport:agentArtsConfig.readTransportPreferences()})).digest('hex');
        }});
      f02Workflow=agentArtsPinned?createF02WorkflowWorkerPorts({getApplication:()=>runtimeApplication,
        authorizationQuestions:authorizationQuestionHost,authorizeExport:authorizeWorkflowExport,
        liveVoiceHost:{readFinalUserAudio:(...args)=>liveVoice?.readFinalUserAudio(...args),
          readFinalCaptureEvidence:(...args)=>liveVoice?.readFinalCaptureEvidence(...args),
          readQuestionDelivery:(...args)=>liveVoice?.readQuestionDelivery(...args),askCurrentQuestion:()=>liveVoice?.askCurrentQuestion()},
        microphoneHost:{readCaptureReceipt:(...args)=>microphoneCaptureHost?.readCaptureReceipt(...args)},
        voiceCommandHost:{prepareApproval:(...args)=>voiceCommandHost?.prepareApproval(...args)}}):undefined;
      let conversationTools=[...(historyTool?[historyTool.tool]:[]),...desktopControl.tools,...(imageWorkflowCatalog?.tools??[]),
        ...(syntheticMvp?syntheticTools.tools:codingWorkspace.tools.length?codingWorkspace.tools:competitionCatalog?[competitionCatalog.tool]:[]),
        ...(developerDeployment?.host.tools??[]),...(goalCloudHost?.tools??goalHost.tools),
        ...(proactiveConversationTools?.tools??[]),...(connectorWatchHost?.tools??[]),...productTools.tools,...(connectorConversationTools?.tools??[]),
        ...(calendarMeetingHost?.tools??[]),...(feedsHost?.tools??[]),...(f09FeedGraphHost.tools??[]),...(workflowGraphComposition.tools??[]),...(f02Workflow?.tools??[]),
        ...(notepadHost?.tools??[]),
        ...(todoHost?.tools??[]),...(notificationApplicationHost?.tools??[]),...(subagentTool?[subagentTool]:[]),
        ...(knowledgeTools?.tools??[]),...(referenceHost?.tools??[]),...(remoteMcpServices?.tools??remoteMcpHost?.tools??[]),authorizationIntentHost.tool];
      if(computerControlLease)conversationTools=computerControlLease.wrapTools(conversationTools);
      void refreshAgentArtsModelsOnStartup({configuration:agentArtsConfig,models:agentArtsModels,onUpdate:publish});
      activeCloudTransportSignature=JSON.stringify([agentArtsConfig.readTransportPreferences(),agentArtsConfig.snapshot().deploymentVersion]);
      cloudTransportNotice = '';
      // 平台观测读回（MOD-32）：仅当受信设置提供观测 AK/SK（及可选 applicationId）时
      // 注入 observationAuthorization / observationApplicationId；缺省保持显式 unavailable。
      // 绝不复用 invoke Bearer，也不静默装配 Fake 签名器。
      refreshHarnessContextHost(runtimeModule.createContextModelSummarizer);
      wikiImportHost?.close();
      wikiImportHost=await createWikiImportHost({userData:app.getPath('userData'),safeStorage,namespace,
        hostIdentity:createHash('sha256').update(app.getPath('userData')).digest('hex'),changed:publish,
        selectFiles:async()=>{
          const choice=await dialog.showOpenDialog(admin,{title:'选择要生成 Wiki 的文件',properties:['openFile','multiSelections']});
          return choice.canceled?undefined:choice.filePaths;
        },selectFolder:async()=>{
          const choice=await dialog.showOpenDialog(admin,{title:'选择要生成 Wiki 的资料文件夹',properties:['openDirectory']});
          return choice.canceled?undefined:choice.filePaths[0];
        },selectLibrary:async()=>{
          const choice=await dialog.showOpenDialog(admin,{title:'选择 Wiki 保存目录',properties:['openDirectory','createDirectory']});
          return choice.canceled?undefined:choice.filePaths[0];
        }});
      // F23 shadow promote/readback: only when host supplies trusted CAS + acceptance +
      // verifiers via resolveDesktopWorkflowShadowRelease({...}). No production ports yet
      // → undefined → tools stay unregistered; never invent Fake ports here.
      const workflowShadowRelease = resolveDesktopWorkflowShadowRelease();
      const observationOptions = resolveDesktopAgentArtsObservation(agentArtsObservationConfig);
      let prepareWorkflowToolExport;
      const remoteMcpCompetition=createRemoteMcpCompetitionComposition({services:remoteMcpServices,
        readApplication:()=>runtimeApplication,question:authorizationQuestionPort});
      runtimeApplication = runtimeModule.createAgentArtsRuntimeApplication({
        path: dbPath,
        wikiImport:wikiImportHost.runtimeOptions,
        delegateUserTasks: true,
        ...(f09WorkflowWorkerPorts?{f09WorkflowWorkerPorts}:{}),
        ...(f20WorkflowWorkerPorts?{f20WorkflowWorkerPorts}:{}),
        configuredWorkflowWorkerPorts:[...(f02Workflow?.configuredWorkflowWorkerPorts??[])],
        ...(workflowShadowRelease ? {workflowShadowRelease} : {}),
        ...(observationOptions?.observationAuthorization
          ? {observationAuthorization: observationOptions.observationAuthorization} : {}),
        ...(observationOptions?.observationApplicationId
          ? {observationApplicationId: observationOptions.observationApplicationId} : {}),
        assertHarnessEventCurrent:(rootTaskId,origin)=>{
          if(!harnessEventsHost)throw new ProtocolError('UNSUPPORTED_CAPABILITY','原生事件授权宿主尚未装配');
          harnessEventsHost.assertHarnessEventCurrent(rootTaskId,origin);
        },
        onHarnessEventProgress:()=>harnessEventsHost?.flush(),
        readDeveloperHarnessConfiguration:readDesktopDeveloperHarnessConfiguration,
        ...(codingWorkspace.harnessRepairHost&&typeof codingWorkspace.readHarnessCandidateContext==='function'?{
          harnessCandidates:{host:codingWorkspace.harnessRepairHost,
            readF20WorkspaceRef:scope=>codingWorkspace.readF20WorkspaceRef(scope),
            readContext:(context,scope)=>codingWorkspace.readHarnessCandidateContext(context,scope),
            reconcileOriginalSession:input=>codingWorkspace.reconcileHarnessOriginalSession(input)},
        }:{}),
        proactiveWorkflows: true,
        proactiveDecision: {localChooser:localLaya},
        hostUserNamespace: namespace,
        ...(developerDeployment?{readDeveloperWorkflows:scope=>developerDeployment.readDeveloperWorkflows(scope)}:{}),
        isUserPresent:taskId=>windowsControlHost?.hasPresence(taskId)===true||toolPresenceHost?.isUserPresent(taskId)===true,
        ...(notepadHost ? {windowsHostRecovery:{recover:(taskId,runId)=>{
          const intent=runtimeApplication.runtime.loadCheckpoint(taskId,'host-tool-intent');
          return withNativeReadbackScope({owner:admin},scope=>notepadHost.recoverOriginalRun(
            {taskId,runId,argumentsDigest:intent?.argumentsDigest},scope));
        }}} : {}),
        coordinationInput:{
          get contextCompaction(){return harnessContextHost?.runtimeHooks;},
          readRequestContext:readDesktopRequestContext,
          prepareCoordinationGoal:async scope=>{
            const parent=runtimeApplication.readDelegatedUserTaskParent?.(scope.taskId);
            if(parent){
              const original=runtimeApplication.runtime.getTask(parent.taskId);
              installedSkillsHost?.prepareTask({...parent,publicGoal:original.goal,signal:scope.signal});
              installedSkillsHost?.assertTask(scope.taskId);
              if(privateConsumption?.snapshot(parent.conversationId).selected)throw Error('主对话所选私人记忆许可不覆盖子任务；需要独立确认后才能使用，当前未发送私人记忆');
              return scope.publicGoal;
            }
            if (!conversations?.containsConversation(scope.conversationId)) return scope.publicGoal;
            installedSkillsHost?.prepareTask(scope);
            if (!privateConsumption) throw Error('私人记忆消费宿主尚未装配');
            if(runtimeApplication.runtime.loadCheckpoint(scope.taskId,'required-subagent-delegation:v1')
              &&privateConsumption.snapshot(scope.conversationId).selected)throw Error('委派任务的汇总不能继承主对话所选私人记忆许可，当前未发送私人记忆');
            return (await privateConsumption.prepare({...scope,goal:scope.publicGoal})).goal;
          },
          readConversationContext:readDesktopConversationContext,
          readConversationSnapshot:readDesktopConversationContext,
          beforeCoordinationSend:(request,scope)=>{
            cloudRequestFailureNotice = '';
            const conversationOrigin=runtimeApplication.readSubagentConversationOrigin?.(request.taskId);
            if(conversationOrigin)installedSkillsHost?.assertTask(conversationOrigin.taskId);
            installedSkillsHost?.assertTask(request.taskId);
            const parent=runtimeApplication.readDelegatedUserTaskParent?.(request.taskId);
            const conversationId=parent?.conversationId??runtimeApplication.runtime.getTask(request.taskId).conversationId;
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
        competitionMaxSteps: readCompetitionExecutionPolicy().initialWindowSteps,
        competitionExecution:readCompetitionExecutionPolicy().policy,
        competitionMessageTimeoutMs:readCompetitionExecutionPolicy().taskTimeoutMs,
        // Module availability/consent, input validation and ToolGateway still run.
        // Explicit names prevent future destructive tools inheriting this policy.
        automaticTools: [...[...(historyTool?[historyTool.tool]:[]),...productTools.tools,...codingWorkspace.tools,...desktopControl.tools,...(imageWorkflowCatalog?.tools??[]),...(developerDeployment?.host.tools??[]),...(goalCloudHost?.tools??[]),...(subagentTool?[subagentTool]:[]),...(knowledgeTools?.tools??[]),...(referenceHost?.tools??[]),
          ...(todoHost?.tools??[]),...(feedsHost?.tools??[])].filter(tool=>[
            'conversation.read_history','weather.forecast','research.search','feeds.collect','feeds.subscriptions',
            'todo.list','todo.create','todo.update','notifications.status',
            'goals.list','goals.get','goals.create','goals.revise',
            'workspace.read_text','workspace.list_entries','workspace.preview_text_patch',
            'workspace.stage_text_patch','workspace.apply_text_patch','workspace.git_diff_check',
            'workspace.node_check','workspace.npm_build','workspace.npm_test',SUBAGENT_DISPATCH_TOOL_NAME,'knowledge.search','mcp.workspace.read_text',
            'desktop.request_presence','computer.request_access',
            'developer.repository_context',
            'workflow.image.catalog',
          ].includes(tool.descriptor.name))
          .map(tool=>({toolName:tool.descriptor.name,toolVersion:tool.descriptor.version})),
          ...(!syntheticMvp ? [{toolName:runtimeModule.LOCAL_REPAIR_TOOL,toolVersion:'1.0.0'},
            {toolName:runtimeModule.DEVELOPER_HARNESS_TOOL_NAME,toolVersion:runtimeModule.DEVELOPER_HARNESS_TOOL_VERSION}] : [])],
        // A missing remote catalog omits only the implicit model; an invalid configured default remains an error.
        readDefaultExecutionModel:role=>readDesktopExecutionModel(agentArtsModels,undefined,role),
        resolveExecutionModel:selection=>agentArtsModels.resolveExecutionModel(selection),
        readConversationPreference: conversationId => {
          if (!conversations?.containsConversation(conversationId)) return undefined;
          const preference = conversations.preference(conversationId,{depth:thinking.depth,fast:thinking.fast});
          const models=modelApiHost?.snapshot();
          const modelId=preference.modelId || undefined;
          const selected=models?.models.find(item=>item.id===modelId);
          const executionModel=readDesktopExecutionModel(agentArtsModels,preference);
          return {...preference,modelId,...(executionModel!==undefined?{executionModel}:{}),configurationRef:selected?.configurationRef};
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
          mailAnalysisHost?.assertCloudSend?.(request);
        },
        mailReview:{
          readEnvelope:(binding,context)=>{
            if(!mailAnalysisHost)throw Error('邮件云复核宿主尚未就绪');
            return mailAnalysisHost.readEnvelope(binding,context);
          },
          assertExport:(binding,envelope,context)=>{
            if(!mailAnalysisHost)throw Error('邮件云复核宿主尚未就绪');
            mailAnalysisHost.assertExport(binding,envelope,context);
          },
        },
        tools: conversationTools,
        competitionToolDiscovery:true,
        hostOnlyTools:[AUTHORIZATION_INTENT_TOOL],
        requestToolAuthorization:async scope=>{
          await prepareWorkflowHostPreflight({application:runtimeApplication,scope,prepareExport:prepareWorkflowToolExport});
          if(/^(?:computer\.desktop\.|computer\.request_access$|computer\.vision\.|browser\.)/.test(scope.toolName))computerTasks.add(scope.taskId);
          authorizationIntentHost.prepareQuestion(scope);
          calendarMeetingHost?.prepareAuthorization?.(scope);
          mailHost?.prepareAuthorization?.(scope);
          mailAnalysisHost?.prepareAuthorization?.(scope);
          codingWorkspace?.prepareAuthorization?.(scope);
          knowledgeSourceConfig?.prepareAuthorization?.(scope);
          notificationApplicationHost?.prepareAuthorization?.(scope);
          connectorWatchHost?.prepareAuthorization?.(scope);
          feedsHost?.prepareWorkflowFeedSource?.(scope);
          return nativeExecutionHost.prepare(scope,{forTaskConsent:authorizationQuestionHost.requiresNativeForAuthorization(scope)})
            .then(()=>authorizationQuestionHost.requestToolAuthorization(scope));
        },
        requiresToolAuthorization:scope=>authorizationQuestionHost.automaticallyApproves()||authorizationQuestionHost.requiresAuthorization(scope)
          ||remoteMcpCompetition.ownsTool(scope.toolName)
          ||scope.toolName===AUTHORIZATION_INTENT_TOOL||scope.toolName==='mail.review'||scope.toolName==='notifications.interruption_policy.set'
          ||/^(?:computer\.desktop\.|computer\.vision\.|browser\.)/u.test(scope.toolName)
          ||/^(?:workspace\.|coding\.repair\.|workflow\.host\.f15_|workflow\.host\.f09_)/u.test(scope.toolName),
        prepareCompetitionToolExport:prepareWorkflowToolExport=async ({phase,taskId,runId,proposal,deadline,signal})=>{
          const scope={phase,taskId,runId,proposal,deadline,signal};
          await remoteMcpCompetition.prepare(scope);
          if(phase==='preflight'&&proposal?.toolName==='computer.request_access'&&computerControlConfig?.snapshot().enabled)computerControlLaya?.prepare();
          if(phase==='preflight'&&(/^computer\.desktop\./u.test(proposal?.toolName??'')||proposal?.toolName==='computer.vision.inspect'))await windowsControlHost?.prepareToolPresence({taskId,deadline,signal});
          await computerVisionHost?.prepareExport(scope);
          await todoHost?.prepareExport?.(scope);
          await feedsHost?.prepareExport?.(scope);
          await developerDeployment?.prepareExport(scope);
          await connectorConversationTools?.prepareExport(scope);
          await codingWorkspace?.prepareExport?.(scope);
          await goalCloudHost?.prepareExport?.(scope);
          if(['knowledge.search','knowledge.apply_note_patch'].includes(proposal?.toolName)) {
            const binding=knowledgeSourceConfig.snapshot();
            const isCurrent=()=>{const value=knowledgeSourceConfig.snapshot();return value.available&&value.sourceId===binding.sourceId
              &&value.configRevision===binding.configRevision&&value.dataLevel==='public'&&value.cloudExportAllowed;};
            if(!isCurrent())throw Error('知识公开结果出机范围不可用');
            if(phase==='preflight')authorizationQuestionPort.prepareExport(scope,{requirementId:'knowledge-export',
              ruleBindingDigest:createHash('sha256').update(JSON.stringify({sourceId:binding.sourceId,configRevision:binding.configRevision,
                publicQueries:binding.publicQueries,allowedNotePaths:binding.allowedNotePaths,projection:'knowledge-public-summary-v1'})).digest('hex'),
              summary:'把PUBLIC查询的有界摘要或整理结果用于本次对话。',assertCurrent:isCurrent});
            else authorizationQuestionPort.currentRequirement(scope,'knowledge-export');
            return;
          }
          if (!['workspace.read_text','mcp.workspace.read_text','skill.workspace_reference_summary'].includes(proposal?.toolName)) return;
          if (!publicReferenceConsent || !['preflight','projection'].includes(phase)) throw Error('原生公开资料许可入口不可用');
          const configurationRef=proposal.toolName === 'workspace.read_text'
            ? codingWorkspace?.readWorkspaceExportConfigurationRef?.() : referenceHost?.bindTask(taskId);
          const selected=proposal.toolName === 'skill.workspace_reference_summary'
            ? readNativePublicSkillSource({taskId,sourceRef:proposal.arguments.sourceRef,configurationRef}) : undefined;
          const query={taskId,proposalId:proposal.proposalId,path:selected?.path ?? proposal.arguments.path,
            configurationRef,arguments:selected ? {path:selected.path} : proposal.arguments};
          if (phase === 'preflight') await publicReferenceConsent.requestPreflight(query,scope);
          else await publicReferenceConsent.requestExact(query,scope);
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
        ...(process.env.PA_AGENTARTS_CONTINUATION_CONTEXT?{continuationContext:process.env.PA_AGENTARTS_CONTINUATION_CONTEXT}:{}),
        ...(!syntheticMvp && (agentArtsResponseMode ?? 'tool-proposal-json')==='tool-proposal-json'
          ? {enableNewTaskToolContinuations:true} : {}),
        ...(syntheticMvp ? {competitionToolExports: syntheticTools.competitionToolExports} : {
          initialRequestMode: 'goal-with-tools-json',
          competitionToolAvailability: (competitionToolAvailabilityList = createConversationToolSurface({
            profile:'huawei_ict_agentarts',tools:conversationTools,
            competitionToolAvailability:[...(connectorWatchHost?.competitionToolAvailability??[]),...(historyTool?[historyTool.availability]:[]),...(connectorConversationTools?.competitionToolAvailability??[]),...desktopControl.availability,...(imageWorkflowCatalog?.competitionToolAvailability??[]),...(codingWorkspace.tools.length ? codingWorkspace.competitionToolAvailability : competitionCatalog ? [competitionCatalog.availability] : []), ...(developerDeployment?.host.competitionToolAvailability??[]), ...productTools.competitionToolAvailability.filter(binding=>!systemObservationConversation||binding.toolName!=='computer.system.observe'),...(systemObservationConversation?.competitionToolAvailability??[]), ...feedsHost.competitionToolAvailability, ...(todoHost?.competitionToolAvailability ?? []), ...(goalCloudHost?.competitionToolAvailability ?? []), ...(proactiveConversationTools?.competitionToolAvailability??[]), ...(subagentAvailability ? [subagentAvailability] : []), ...(knowledgeTools?.competitionToolAvailability??[]),...(referenceHost?.competitionToolAvailability??[]),...remoteMcpCompetition.competitionToolAvailability]})),
          competitionToolExports: [...(connectorWatchHost?.competitionToolExports??[]),...(historyTool?[historyTool.binding]:[]),...(connectorConversationTools?.competitionToolExports??[]),...desktopControl.exports,...(imageWorkflowCatalog?.competitionToolExports??[]),...(systemObservationConversation?.competitionToolExports??[]),...(codingWorkspace.tools.length ? codingWorkspace.competitionToolExports : competitionCatalog ? [competitionCatalog.export] : []), ...(developerDeployment?.host.competitionToolExports??[]), ...productTools.competitionToolExports, ...feedsHost.competitionToolExports, ...(todoHost?.competitionToolExports ?? []), ...(goalCloudHost?.competitionToolExports ?? []), ...(proactiveConversationTools?.competitionToolExports??[]), ...(subagentExport ? [subagentExport] : []), ...(knowledgeTools?.competitionToolExports??[]),...(referenceHost?.competitionToolExports??[]),...remoteMcpCompetition.competitionToolExports],
        }),
        ...cloudBinding,
        ...agentArtsTransportConfig,
        ...(agentArtsTransportConfig.transport==='wss'?{recoverAcceptedStatus:true}:{}),
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
            return agentArtsConfig.readAuthorization(cloudBinding, agentArtsTransportConfig);
          },
        },
      });
      if (runtimeApplication?.configureThinking) {
        const state = runtimeApplication.configureThinking({depth: thinking.depth, fast: thinking.fast});
        thinking = {depth: state.depth, fast: state.fast, applied: true, maxSteps: state.maxSteps, reason: state.reason};
      }
      wikiImportHost.bind(runtimeApplication.wikiImport);
      if (syntheticRepairHost) await syntheticRepairHost.initialize(runtimeApplication.runtime);
      if (mailHost) {mailHost.bindApplication(runtimeApplication); mailConfig.markBound(configuredMail.revision);}
      codingWorkspace.bindApplication(runtimeApplication);
      f15ReviewHost?.close();f15ReviewViewer?.close();f15ReviewInstalled=false;
      if(!syntheticMvp&&typeof runtimeModule.createRuntimeCodingRepairSignedReview==='function'){
        const workspaceRoot=codingWorkspace.readWorkspaceBinding?.()?.rootPath;
        const viewerPath=path.join(process.env.ProgramFiles??'C:\\Program Files','PowerShell','7','pwsh.exe');
        f15ReviewViewer=createF15NativeReviewViewer({powerShellPath:viewerPath,verifyExecutable:verifyF15ViewerExecutable,
          excludedDirectories:[app.getPath('userData'),...(workspaceRoot?[workspaceRoot]:[])]});
        const confirmNative=async(message,detail,button)=>{
          const owner=admin;if(!owner||owner.isDestroyed())return false;
          const answer=await dialog.showMessageBox(owner,{type:'warning',message,detail,buttons:[button,'取消'],defaultId:1,cancelId:1,noLink:true});
          return answer.response===0&&admin===owner&&!owner.isDestroyed();
        };
        f15ReviewOrigin=createDesktopF15ReviewOriginHost({getApplication:()=>runtimeApplication,
          readExecutionConfig:()=>runtimeApplication?.readCodingRepairExecutionIdentity?.(),
          assertWorkspacePermission:input=>codingWorkspace?.assertF15ReviewWorkspacePermission?.(input)===true,
          confirmNativeDisclosure:input=>confirmNative('在本机显示原补丁与源码？',
            `审核者：${input.reviewerId}\n任务：${input.taskId}\n补丁 SHA-256：${input.patchDigest}\n将仅在本机只读窗口显示，不会自动发送。`, '显示'),
          showNativePatch:async value=>(await f15ReviewViewer.show(value,{signal:new AbortController().signal,
            assertCurrent:()=>f15ReviewOrigin?.assertOriginalOwner(value)===true})).state==='shown'});
        f15ReviewHost=createDesktopF15ReviewConfigHost({userData:app.getPath('userData'),safeStorage,
          selectPublicKey:async()=>{const owner=admin;if(!owner||owner.isDestroyed())return;
            const choice=await dialog.showOpenDialog(owner,{title:'选择独立审核者 Ed25519 公钥',properties:['openFile'],filters:[{name:'公钥',extensions:['pem']}]});
            return admin===owner&&!owner.isDestroyed()&&!choice.canceled&&choice.filePaths.length===1?choice.filePaths[0]:undefined;},
          selectReviewDirectory:async()=>{const owner=admin;if(!owner||owner.isDestroyed())return;
            const choice=await dialog.showOpenDialog(owner,{title:'选择独立审核签名记录目录',properties:['openDirectory']});
            return admin===owner&&!owner.isDestroyed()&&!choice.canceled&&choice.filePaths.length===1?choice.filePaths[0]:undefined;},
          confirmConfiguration:input=>confirmNative('确认独立审核配置',
            `审核者：${input.reviewerId}\n部署作者标识：${input.authorId}\n审核策略：${input.policyId}\n公钥指纹：${input.publicKeyFingerprint}\n公钥：${input.publicKeyPath}\n签名目录：${input.reviewDirectoryPath}`,'确认配置'),
          confirmIndependence:input=>confirmNative('确认审核者独立性',
            `请确认 ${input.reviewerId} 的密钥由独立审核者掌握，并独立于本次编码部署。此确认不验证自然人身份，也不代表补丁已审核。\n公钥指纹：${input.publicKeyFingerprint}`,'我确认独立'),
          readAuthorIdentity:()=>f15ReviewOrigin.readAuthorIdentity(),assertOriginalOwner:value=>f15ReviewOrigin.assertOriginalOwner(value),
          getApplication:()=>runtimeApplication,createSignedReview:runtimeModule.createRuntimeCodingRepairSignedReview,onPendingChange:publish});
        installF15Review();
      }
      developerDeployment?.host.bind(runtimeApplication);
      windowsControlHost?.bind(runtimeApplication);
      browserControlHost?.bind(runtimeApplication);
      openCliBrowserHost?.bind(runtimeApplication);
      installedSkillsHost.bindRuntime(runtimeApplication.runtime);
      referenceHost.bindApplication(runtimeApplication);
      referenceApplication=runtimeApplication;
      const cloudSkillSelector=referenceHost.configureCloudSkillWorker(runtimeApplication.referenceSkillWorker());
      runtimeApplication.configureCloudSkillSelection({
        cloudSkillCatalog:input=>referenceHost.cloudSkillCatalog(input),
        dispatchCloudSkillProposal:(proposal,context)=>referenceHost.dispatchCloudSkillProposal(proposal,context),
        assertReceiptAllowed:(selection,receipt,context)=>cloudSkillSelector.assertReceiptAllowed(selection,receipt,context),
      });
      knowledgeTools.bindApplication(runtimeApplication);
      const {openSqliteLearningHost}=await import('@personal-agent/learning');
      learningStore=openSqliteLearningHost(path.join(app.getPath('userData'),'workflow-learning.sqlite'));
      runtimeApplication.configureHarnessExperience({namespace,learning:learningStore,
        readCurrent:()=>codingWorkspace.readHarnessExperienceCurrentSync(),
        confirmActivation:confirmHarnessExperienceActivation});
      harnessExperienceAdminHost=createHarnessExperienceAdminHost({getApplication:()=>runtimeApplication.harnessExperience,
        context:()=>{throw Error('开发经验操作需要当前受信观察范围');}});
      learningStore.resumeErasureMaintenance(namespace);
      learningApplication=runtimeModule.createWorkflowLearningApplication({profile:'huawei_ict_agentarts',namespace,
        learning:learningStore,runtime:runtimeApplication.runtime,
        skillManifest:()=>runtimeApplication.referenceSkillSnapshot().manifest,
        submitSkillTask:(binding,context)=>runtimeApplication.submitReferenceSkillTask({
          skillId:binding.skillId,version:binding.version,digest:binding.digest,path:binding.path,
          idempotencyKey:binding.operationId,deadline:context.deadline,conversationId:`learning:${namespace}`,
          hostBinding:{key:runtimeModule.LEARNING_BINDING_CHECKPOINT,value:binding}}).taskId,
        confirmActivation:async binding=>{
          return confirmApplicationAuthorization('workflow.enable',binding,{scope:{workflowId:binding.workflowId,revision:binding.revision},
            summary:`启用所选已验证流程版本 ${binding.revision}；不授权任意工具或资料出机`});
        },confirmDeletion:async version=>{
          return confirmApplicationAuthorization('workflow.delete',version,{scope:{workflowId:version.workflowId},
            summary:'删除所选学习流程全部版本并停止其未完成任务；保留工作区原文件，原存储核实规则仍生效'});
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
      // Startup guards read the same native policy host; the Client is attached after registration.
      notificationApplicationHost?.bindApplication(runtimeApplication);
      initializeHarnessEventPorts(runtimeModule);
      let startupRecovered=false;
      if(typeof runtimeRoot.createRuntimeStartupRecovery==='function'&&typeof runtimeApplication.resumeStartupTask==='function') {
        const recovery=runtimeRoot.createRuntimeStartupRecovery({runtime:runtimeApplication.runtime,
          configurationRef:runtimeApplication.coordinationConfigurationRef,exclusiveOwner:ownsDesktopInstance===true,
          durableCloudDispatch:agentArtsTransportConfig.transport==='wss',
          canResumeHarnessEvent:request=>harnessEventsHost?.canResumeHarnessEvent(request),
          resumeOriginalTask:request=>runtimeApplication.resumeStartupTask(request)});
        const recovered=await recovery.recover();startupRecovered=true;
        startupRecoveryStatus={state:'classified',inspectedTasks:recovered.items.length,verification:'not_run'};
      }else startupRecoveryStatus={state:'unavailable',reason:'原任务恢复门禁未装配，历史任务保留核实状态',verification:'not_run'};
      if(startupRecovered)goalHost.resumeApproved();
      if (!syntheticMvp && competitionCatalog && !codingWorkspace.tools.length) competitionFactBridge = createDesktopCompetitionFactBridge({
        application: runtimeApplication, catalog: competitionCatalog,
        runtimePath: dbPath, userNamespace: namespace,
      });
      if(startupRecovered)await competitionFactBridge?.recover();
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
    readEventBatch:fakeMode?undefined:input=>runtimeApplication.readEventBatch(input),
    attachClient: value => { client = value; return () => { client = undefined; }; },
  });
  client = runtimeConnection.client;
  if (notificationApplicationHost) {
    notificationApplicationHost.bindApplication(runtimeApplication, client);
    const readCurrentVoiceQuestion=({conversationId}={})=>authorizationQuestionHost?.snapshot(conversationId??conversations.activeConversationId('panel'))
      .find(question=>question.state==='pending')??null;
    const focusVoiceQuestion=question=>{if(question.conversationId!==conversations.activeConversationId('panel'))return;pinned=true;openPanel(true);publish();};
    voiceCommandHost = createDesktopVoiceCommandHost({onUpdate:publish,
      readCurrentQuestion:readCurrentVoiceQuestion,focusQuestion:focusVoiceQuestion});
    // Live final → prepareTaskApproval focuses the original card; voice never calls authorization.respond.
    if (conversationToolAccess) {
      voiceApprovalBridge = createVoiceRuntimeApprovalBridge({
        readPendingApproval:scope=>conversationToolAccess.readPendingApproval(scope),
        readCurrentQuestion:readCurrentVoiceQuestion,
        focusQuestion:focusVoiceQuestion,
      });
    }
  }
  if(proactiveWorkflowApplication){
    proactiveRuntimePump=createDesktopProactiveRuntimePump({getApplication:()=>runtimeApplication,
      getWorkflow:()=>proactiveWorkflowApplication,
      recoverSources:(taskId,context)=>proactiveSourceRouter?.recoverPending(taskId,context),
      afterNativeMaintenance:(taskId,context)=>harnessEventsHost?.start(taskId,context),
      resolveUserConversation:id=>conversationToolAccess.resolveConversation(id)});
  }
  connectionLabel = fakeMode
    ? 'Fake Runtime · 联调模式'
    : competitionMode ? '本地 Runtime · AgentArts Competition' : '本地 Runtime · 已连接';
  eventCursor = new EventCursor('tasks');
  if (competitionMode && mailHost) mailAnalysisHost = createDesktopMailReviewHost({
    getApplication:()=>runtimeApplication,mail:mailHost,question:authorizationQuestionPort,
    readConfigurationRef:()=>mailHost?mailConfig?.reviewConfigurationRef(runtimeApplication?.coordinationConfigurationRef):undefined,
    labelKeys:['meeting','work','subscription','transaction','personal','other'],
    getNotifications:()=>notificationApplicationHost,namespace:desktopHost.userNamespace,
    confirmConsent:request=>confirmApplicationAuthorization('mail.review.configure',request.payload??request,{
      scope:request.scope??{kind:'mail-headers',policy:'new-ambiguous-only'},
      summary:request.summary??'允许选定测试信及之后新增的模糊邮件信头交给当前云端模型复核；不含正文，不上传历史积压，不发送或修改邮件。',
      deadline:request.deadline,signal:request.signal,isCurrent:request.isCurrent,
    }),onUpdate:publish,
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
      rememberTaskGoal(taskId, goal);
    },
  });
  if(competitionMode&&!syntheticMvp)connectorChangeHost=createDesktopConnectorChangeHost({application:runtimeApplication,
    namespace:desktopHost.userNamespace,chooser:{snapshot:()=>localLaya?.snapshot()??{ready:false},choose:input=>localLaya.choose(input)},
    notifications:notificationApplicationHost,readSourceAuthorization:readConnectorSourceAuthorization,
    resolveUserConversation:taskId=>conversationToolAccess.resolveConversation(taskId)??connectorWatchHost?.resolveUserConversation(taskId)
      ??connectorMailReadOrigin.read(taskId)?.conversationId,
    readOriginalSourceBinding:taskId=>connectorMailReadOrigin.read(taskId),
    readWatchOrigin:taskId=>connectorWatchHost?.readOrigin(taskId),
    onUpdate:publish});
  if(competitionMode && memoryLearningHost && proactiveHost) {
    const publicErasure=proactiveHost.createPublicFactErasureApplication({confirm:async ref=>{
      return confirmApplicationAuthorization('facts.erase',ref,{scope:{id:ref.id,revision:ref.revision},
        summary:'删除所选公共事实及其绑定版本/投影；已有依赖或未核实状态仍拒绝删除，原擦除审计继续核实'});
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
      const feedCollect = async (query, signal, sourceScope) => {
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
        const responsibilities=typeof sourceScope?.trackingTaskId==='string'&&proactiveSourceRouter
          ?(proactiveWorkflowApplication?.snapshot().sessions??[]).filter(session=>
            !['succeeded','failed','cancelled'].includes(session.taskState)&&Date.parse(session.taskDeadline)>Date.now()
            &&proactiveSourceRouter.matchesTrackingTask(session.sourceTaskId,sourceScope.trackingTaskId)):[];
        let proactiveReadBound=false;
        if(responsibilities.length){
          try{
            proactiveSourceRouter.bindPreparedFeedRead({taskId:prepared.taskId,expectedTaskRevision:prepared.revision,
              trackingTaskId:sourceScope.trackingTaskId,commandId,toolVersion:collectTool.descriptor.version,arguments:query});
            proactiveReadBound=true;
          }catch{proactiveSourceRoutingFailure='原持续责任与订阅读取未能绑定；未自动投递来源';}
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
              if(proactiveReadBound)for(const session of responsibilities){
                try{
                  const routed=await proactiveSourceRouter.routeConfirmedFeed({workflowTaskId:session.taskId,taskId:prepared.taskId,
                    runId:read.confirmed.runId,toolVersion:collectTool.descriptor.version,arguments:query,
                    scopeRef:read.confirmed.runId,trackingTaskId:sourceScope.trackingTaskId},{signal,deadline});
                  if(!['persisted','already_persisted'].includes(routed?.state))
                    proactiveSourceRoutingFailure='订阅已读取，但原持续责任的来源适配尚不可用';
                }catch{proactiveSourceRoutingFailure='订阅已读取，但原持续责任尚未确认接收来源';}
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
          await feedCollect({subscriptionId:intake.subscriptionId,limit:20},signal,{trackingTaskId:taskId});
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
  eventPoll = setInterval(() => {void pumpEvents(); void todoHost?.tick();
    if(runtimeClosed)return;
    void maintenancePoll.run('proactive',()=>tickProactiveP5());
    void maintenancePoll.run('mail',()=>refreshMail());
    void maintenancePoll.run('notepad',()=>notepadHost?.refresh());
    void maintenancePoll.run('knowledge-schedules',()=>tickKnowledgeSchedules());
    void maintenancePoll.run('connector-watch',()=>connectorWatchHost?.tick());
    void maintenancePoll.run('proactive-runtime',()=>proactiveRuntimePump?.tick().then(result=>{
      const issue=result?.state==='unavailable'||result?.sessions?.some(item=>item.state!=='bound')
        ?'持续任务仍有缺配置、过期或待核实的维护项；未自动重放操作':'';
      if(proactiveMaintenanceFailure!==issue){proactiveMaintenanceFailure=issue;publish();}
    }).catch(()=>{
      if(!proactiveMaintenanceFailure){proactiveMaintenanceFailure='原持续任务的唤醒维护暂不可用；未新建任务或重放操作';publish();}
    }));
    void maintenancePoll.run('wiki',()=>wikiSourceMonitor?.tick().then(changed=>{if(changed)publish();}));}, 120);
}

/** Exact payload consent stays in the trusted host and never grants tool permission. */
async function confirmDeveloperExport(request) {
  if(!authorizationQuestionHost)return false;
  try {
    if(request.kind?.endsWith('_tool_metadata')){
      authorizationQuestionHost.prepareExport(request);return true;
    }
    if(request.kind?.endsWith('_tool_result')){
      authorizationQuestionHost.authorizeExport(request,request.payload?.result);return true;
    }
    if(['developer_model_request','developer_workflow_result','harness_context_summary'].includes(request.kind)){
      const application=runtimeApplication,taskId=request.taskId;
      const hash=value=>createHash('sha256').update(JSON.stringify(value)??'undefined').digest('hex');
      const proposal=hash(application.runtime.loadCheckpoint(taskId,'competition-loop')?.pending);
      const destination=application.readAuthorizationQuestionDestination(taskId);
      const current=()=>{
        try{const task=application.runtime.getTask(taskId);
          return runtimeApplication===application&&!request.signal.aborted&&!task.cancelRequested
            &&['running','waiting_approval'].includes(task.state)&&Date.now()<Date.parse(request.deadline)
            &&proposal===hash(application.runtime.loadCheckpoint(taskId,'competition-loop')?.pending)
            &&destination===application.readAuthorizationQuestionDestination(taskId);
        }catch{return false;}
      };
      if(!current()||Buffer.byteLength(JSON.stringify(request.payload),'utf8')>512*1024)return false;
      const harness=request.kind==='harness_context_summary';
      return confirmApplicationAuthorization(harness?'harness.export':'developer.export',request.payload,{
        operation:{taskId,digest:hash([taskId,proposal,request.policyBinding??request.payload?.destination,request.deadline])},
        scope:{namespace:desktopHost.userNamespace,purpose:harness?'bounded-history-summary':'bounded-developer-workflow',destination,
          configuration:request.policyBinding??hash(request.payload?.destination)},deadline:request.deadline,signal:request.signal,
      summary:harness?'本次历史摘要操作：请在3分钟内确认；仅已核对历史范围和选定模型，沿原摘要预算及截止时间；各次发送最多512KiB，保留来源和凭据过滤'
          :'本次开发操作的模型消息、工具投影与最终总结共用本卡；仅原仓库/工作区和固定模型，沿原步骤/token预算及期限，每次最多512KiB',
        isCurrent:current});
    }
    return false;
  }catch{runtimeError='原操作的出机许可不可用或已失效，未发送新的私人资料';publish();return false;}
}

/** Existing callback compatibility: one card, a separately audited decision, no business success claim. */
async function confirmApplicationAuthorization(action,payload,{scope={},summary,deadline,signal,operation,isCurrent=()=>true}={}) {
  const owner=admin??panel??workspace,application=runtimeApplication;
  if(!owner||owner.isDestroyed()||!authorizationIntentHost)return false;
  const revision=++applicationAuthorizationRevision;
  // A cancelled or denied decision stays in Runtime history. Retire only the transient
  // notice owned by that decision, without erasing a newer failure or unknown result.
  if(applicationAuthorizationDecisionNotice&&runtimeError===applicationAuthorizationDecisionNotice.message){
    runtimeError=applicationAuthorizationDecisionNotice.previous;publish();
  }
  applicationAuthorizationDecisionNotice=undefined;
  let failure;
  const allowed=await authorizationIntentHost.request({action,payload,scope,summary,deadline,signal,operation,
    onError:error=>{failure=errorDisplay(error,'runtime');},
    isCurrent:()=>runtimeApplication===application&&!owner.isDestroyed()&&isCurrent()});
  if(!allowed&&(revision===applicationAuthorizationRevision||failure?.code==='RESULT_UNKNOWN')
    &&runtimeApplication===application&&!owner.isDestroyed()){
    const message=failure?.message??'本次操作未获得有效授权，业务操作未执行；请查看当前对话卡或重新发起。';
    if(!failure||['CANCELLED','UNAUTHORIZED'].includes(failure.code))applicationAuthorizationDecisionNotice={message,previous:runtimeError};
    runtimeError=message;publish();
  }
  return allowed;
}

function focusRemoteMcpAuthorizationQuestion({taskId,approvalId}){
  if(!panel||panel.isDestroyed()||!authorizationQuestionHost)return false;
  const question=authorizationQuestionHost.snapshot().find(item=>item.taskId===taskId&&item.sourceApprovalId===approvalId
    &&item.state==='pending'&&Date.parse(item.expiresAt)>Date.now()
    &&item.conversationId===conversations?.activeConversationId('panel'));
  if(!question)return false;
  pinned=true;openPanel(true);publish();return true;
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

const recoverWorkspacePatch = createWorkspacePatchRecoveryAction({
  getApplication: () => runtimeApplication, getAdmin: () => admin,
  isEnabled: () => competitionMode && !syntheticMvp, refresh,
});

async function interruptConversation(conversationId,surface,except,previous) {
  const pending=conversationDelivery.interruptPending(conversationId,except)??previous;
  const running=[...tasks.values()].filter(task=>conversations.conversationIdForTask(task)===conversationId
    &&taskSurface(task)===surface&&!terminalTaskStates.has(task.state));
  // Acceptance may precede the first task.get. A stalled readback cannot hide this task from Stop.
  if(pending?.taskId&&!running.some(task=>task.taskId===pending.taskId))running.push({taskId:pending.taskId});
  for(const task of running){conversationDelivery.truncate(task);liveVoice?.cancelTextTask(task.taskId);}
  publish();
  const results=await Promise.allSettled(running.map(async task=>{
    const result=await client.call('task.cancel',{taskId:task.taskId,reason:'用户截断当前回答'});
    conversationDelivery.acceptStop(task.taskId,result);
    // A readback must never hold up a new message after cancellation is accepted.
    void refresh(task.taskId).catch(()=>{});
    return result;
  }));
  const failed=results.find(result=>result.status==='rejected');
  if(failed)throw failed.reason;
  return {interrupted:true};
}

async function action(event, name, payload) {
  if(subagentListWindow&&!subagentListWindow.isDestroyed()&&subagentListWindow.webContents===event.sender)
    return handleSubagentListAction({event,name,payload,window:subagentListWindow,
      list:input=>runtimeApplication.listSubagentConversations(input),open:openSubagentConversation,
      collapse:async()=>{const result=await collapseAllSubagentConversations(subagentListWindow);publish();return result;}});
  const child=[...subagentWindows.values()].find(record=>record.window.webContents===event.sender);
  if(child)return handleSubagentWindowAction({event,name,payload,record:child,readDetail:readChildConversation,
    openMain:()=>openPanel(true),submit:submitChildConversation,cancel:cancelChildConversation});
  const sender = [orb, panel, admin, workspace].find(win => win && !win.isDestroyed() && win.webContents === event.sender);
  if (!sender || event.senderFrame !== sender.webContents.mainFrame) throw Error('Untrusted sender');
  if(['todo.authorize','feeds.authorize','goalCloud.authorize','coding.authorize','mail.enable','mail.enableCloud','calendar.respond',
    'notifications.confirmation.prepare','voice.confirmation.prepareApproval','voice.confirmation.cancel','voice.confirmation.reconcile'].includes(name))
    throw new ProtocolError('UNSUPPORTED_CAPABILITY','旧会话允许入口已移除；请在当前对话操作卡中决定本次权限');
  if (competitionMode && ['model.configure', 'model.test', 'model.toggle'].includes(name)) {
    throw Error('Competition Profile 的 AgentArts 配置只允许由可信主进程提供；盘古配置操作不可用');
  }
  if (name === 'snapshot') return {...(sender===orb?orbSnapshot():snapshot(sender === workspace ? 'workspace' : sender === admin ? undefined : 'panel')),sourceRevision:snapshotPublisher.revision()};
  if (name === 'snapshot.resync') {
    if(payload!==undefined)throw Error('状态恢复不接受额外参数');
    snapshotPublisher.resync(sender);return {scheduled:true};
  }
  if(name==='conversation.page') {
    if(sender!==panel&&sender!==workspace&&sender!==admin)throw Error('历史读取来源无效');
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(key=>!['direction','conversationId'].includes(key)))throw Error('历史翻页参数无效');
    const surface=sender===workspace?'workspace':sender===panel?'panel':undefined;
    if(payload.conversationId!==(surface?conversations.activeConversationId(surface):undefined))throw Error('当前对话已切换，请重试');
    historyPages.load(surface,payload.direction);tasks.prune();publish(['tasks','approvals']);return {loaded:true};
  }
  if(name==='weather.configure'||name==='weather.refresh'){
    if(!competitionMode||fakeMode||sender!==workspace&&sender!==admin||!weatherCardHost)throw Error('请从正式应用配置天气');
    if(name==='weather.refresh'&&payload!==undefined)throw Error('天气刷新不接受额外字段');
    const value=name==='weather.configure'?weatherCardHost.configure(payload):weatherCardHost.refresh();publish();return value;
  }
  if(name==='workspace.appearance'){
    if(sender!==workspace||!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(key=>key!=='theme')||!['dark','light','system'].includes(payload.theme))throw Error('工作区主题参数无效');
    if(nativeTheme.themeSource!==payload.theme)nativeTheme.themeSource=payload.theme;
    return {theme:payload.theme};
  }
  if(name==='workspace.live.toggle'){
    // Capture, playback, conversation ownership and approvals stay with the original panel host.
    return workspaceLiveEntry({sender,workspace,payload,competitionMode,configuration:liveConfig,openSettings:openAdmin,toggle:()=>toggleLive()});
  }
  if(name.startsWith('workspace.subagent.')){
    if(sender!==workspace)throw Error('请从可信主工作区打开内嵌子对话');
    if(!runtimeApplication)throw Error('当前没有可读取的子对话记录');
    return handleWorkspaceSubagentAction({event,name,payload,window:workspace,readDetail:readChildConversation,submit:submitChildConversation,cancel:cancelChildConversation});
  }
  if(name==='authorization.question.respond'){
    if(sender!==panel&&sender!==workspace&&sender!==admin||!authorizationQuestionHost)throw Error('当前对话授权卡不可用');
    const question=authorizationQuestionHost.snapshot().find(item=>item.questionId===payload?.questionId);
    const conversationId=sender===admin?question?.conversationId:conversations?.activeConversationId(sender===workspace?'workspace':'panel');
    if(!question||question.conversationId!==conversationId)throw Error('此授权请求不属于当前对话');
    const result=authorizationQuestionHost.respond(payload,conversationId);publish();return result;
  }
  if(['authorization.sandbox.read','authorization.sandbox.select','authorization.rule.revoke'].includes(name)){
    if(sender!==admin||!authorizationQuestionHost)throw Error('请从可信授权管理页操作');
    if(name==='authorization.sandbox.read'&&payload!==undefined)throw Error('授权管理读取不接受额外字段');
    const result=name==='authorization.sandbox.read'?authorizationQuestionHost.sandboxSnapshot()
      :name==='authorization.sandbox.select'?authorizationQuestionHost.selectSandbox(payload):authorizationQuestionHost.revokeRule(payload);
    if(name==='authorization.sandbox.select'){
      toolPresenceHost?.refresh();await notepadHost?.refresh();await microphoneCaptureHost?.revoke();
    }
    publish();return result;
  }
  if(name==='app.startup.read'||name==='app.startup.configure'){
    if(sender!==admin||(name==='app.startup.read'&&payload!==undefined))throw Error('请从可信管理后台设置登录自启');
    const result=name==='app.startup.read'?desktopHost.readLoginItem():desktopHost.configureLoginItem(payload);
    publish();return result;
  }
  if(name==='remoteMcp.open') {
    if(sender!==admin || !competitionMode || !remoteMcpManagement || payload!==undefined)throw Error('请从正式管理后台打开远程 MCP 管理');
    remoteMcpManagement.open();return;
  }
  if (['agentartsModels.state','agentartsModels.refresh','agentartsModels.configure'].includes(name)) {
    if(sender!==admin || !competitionMode || !agentArtsModels)throw Error('请从模型设置管理 AgentArts 模型');
    const result=name==='agentartsModels.state'?agentArtsModels.snapshot():name==='agentartsModels.refresh'?await agentArtsModels.refresh():agentArtsModels.configure(payload);publish();return result;
  }
  if (['modelApi.state','modelApi.configure','modelApi.remove','modelApi.harness.configure'].includes(name)) {
    if (sender !== admin || !competitionMode || !modelApiHost) throw Error('请从模型设置管理辅助模型');
    const result = name === 'modelApi.state' ? modelApiHost.snapshot()
      : name === 'modelApi.configure' ? modelApiHost.configure(payload)
        :name==='modelApi.harness.configure'?modelApiHost.configureHarness(payload):modelApiHost.remove(payload);
    if(name!=='modelApi.state'){refreshHarnessContextHost();harnessEventsHost?.flush();}
    publish();return {...result,...readDesktopModelApiState()};
  }
  if(['developer.settings.read','developer.settings.configure','developer.settings.toggle'].includes(name)) {
    if(sender!==admin||!competitionMode||!developerSettings)throw developerSettingsError('DEV_SETTINGS_ACCESS_DENIED');
    if(name==='developer.settings.read'&&payload!==undefined)throw developerSettingsError('DEV_SETTINGS_INPUT_INVALID');
    const result=name==='developer.settings.read'?developerSettings.snapshot()
      :name==='developer.settings.configure'?await developerSettings.configure(payload):await developerSettings.setEnabled(payload);
    publish();return result;
  }
  if(['harness.experience.list','harness.experience.validate','harness.experience.activate','harness.experience.stop'].includes(name)) {
    if(sender!==admin||!competitionMode||!harnessExperienceAdminHost||harnessExperienceLifetime.signal.aborted)
      throw Error('请从正式管理后台操作开发经验');
    if(name==='harness.experience.list') {
      if(payload!==undefined&&(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).length))
        throw Error('开发经验列表不接受额外参数');
      return harnessExperienceAdminHost.snapshot();
    }
    const result=await withNativeReadbackScope({owner:admin,signal:harnessExperienceLifetime.signal},scope=>createHarnessExperienceAdminHost({
      getApplication:()=>runtimeApplication.harnessExperience,context:()=>scope}).invoke(name,payload));
    publish();return result;
  }
  if (name === 'notepad.start' || name === 'notepad.cancel') {
    if ((sender !== admin && sender !== workspace) || !notepadHost || notepadClosing) throw Error('请从电脑操控设置操作记事本');
    return name === 'notepad.start' ? notepadHost.start(payload) : notepadHost.cancel();
  }
  if(name==='computer.vision.configure'){
    if(sender!==admin||!computerVisionConfig)throw new ProtocolError('UNAUTHORIZED','请从电脑操作设置管理可选视觉模型');
    computerVisionConfig.configure(payload);publish();return {computerControl:computerControlSnapshot()};
  }
  if(name.startsWith('computer.control.')){
    if(![admin,panel,workspace].includes(sender)||!computerControlConfig||!windowsControlHost||!runtimeApplication)
      throw new ProtocolError('UNSUPPORTED_CAPABILITY','请从电脑操控设置或当前对话使用已连接的Runtime');
    if(!['computer.control.stop','computer.control.confirm'].includes(name)&&sender!==admin)
      throw new ProtocolError('UNAUTHORIZED','请从电脑操控设置管理组件');
    if(name==='computer.control.stop'){
      if(payload!==undefined&&(!payload||typeof payload!=='object'||Object.keys(payload).length))throw new ProtocolError('INVALID_ARGUMENT','停止不接受额外参数');
      return stopComputerControl();
    }
    if(name==='computer.control.configure'){
      const previous=computerControlConfig.snapshot();
      if(payload?.allowObservationExport===true&&!previous.allowObservationExport&&!authorizationQuestionHost.automaticallyApproves()){
        const allowed=await confirmApplicationAuthorization('computer.observation.configure',payload,{scope:{purpose:'target-window-observation'},
          summary:'允许当前任务模型接收本次选定窗口的界面文字；截图默认只保存在本机。',isCurrent:()=>computerControlConfig.snapshot().revision===previous.revision});
        if(!allowed)throw new ProtocolError('UNAUTHORIZED','电脑观察出口尚未允许');
      }
      if(computerControlConfig.snapshot().revision!==previous.revision)throw new ProtocolError('REVISION_CONFLICT','等待授权期间电脑设置已变化，请查看当前设置');
      computerControlConfig.configure(payload);windowsControlHost.configure(payload);
      if(!payload.enabled||previous.allowObservationExport&&!payload.allowObservationExport)await stopComputerControl();
      publish();return {computerControl:computerControlSnapshot()};
    }
    if(name==='computer.control.prepare'){
      if(payload!==undefined&&(!payload||typeof payload!=='object'||Object.keys(payload).length))throw new ProtocolError('INVALID_ARGUMENT','组件准备不接受额外参数');
      if(computerPreparing)throw new ProtocolError('REVISION_CONFLICT','电脑组件正在准备');
      if(!computerControlConfig.snapshot().enabled)throw new ProtocolError('UNAUTHORIZED','请先启用电脑控制');
      const owned=new AbortController();computerPreparing=owned;publish();
      try{
        const context={signal:owned.signal,deadline:new Date(Date.now()+120000).toISOString()};
        if(!process.env.PA_WINDOWS_CONTROL_PYTHON)await prepareNativeDesktopComponent({electronDir:dir,packaged:app.isPackaged,resourcesPath:process.resourcesPath,...context});
        await windowsControlHost.start(context);openCliBrowserHost?.start();
        if(openCliBrowserHost)await openCliBrowserHost.probeExtension({signal:owned.signal}).catch(()=>{});
        return {computerControl:computerControlSnapshot()};
      }finally{if(computerPreparing===owned)computerPreparing=undefined;publish();}
    }
    if(name==='computer.control.probeConnectedBrowser'){
      if(payload!==undefined&&(!payload||typeof payload!=='object'||Object.keys(payload).length))throw new ProtocolError('INVALID_ARGUMENT','扩展检测不接受额外参数');
      if(!openCliBrowserHost)throw new ProtocolError('UNSUPPORTED_CAPABILITY','现有浏览器控制尚未装配');
      const connectedBrowser=await openCliBrowserHost.probeExtension();
      publish();return {computerControl:computerControlSnapshot(),connectedBrowser};
    }
    if(name==='computer.control.confirm'){
      if(!payload||typeof payload.taskId!=='string'||Object.keys(payload).some(key=>key!=='taskId'))throw new ProtocolError('INVALID_ARGUMENT','缺少原电脑任务');
      const pending=windowsControlHost.snapshot();
      if(!pending.waitingConfirmation||pending.taskId!==payload.taskId||sender!==admin&&conversationToolAccess.resolveConversation(payload.taskId)!==conversations.activeConversationId(sender===workspace?'workspace':'panel'))
        throw new ProtocolError('UNAUTHORIZED','此确认不属于当前等待的电脑任务');
      if(toolPresenceHost?.confirmPending(payload.taskId)!==true)throw new ProtocolError('UNAUTHORIZED','本次在场确认已失效');
      publish();return {computerControl:computerControlSnapshot()};
    }
    if(name==='computer.control.launch'){
      if(!payload||typeof payload.text!=='string'||!payload.text.trim()||payload.text.length>8000||Object.keys(payload).some(key=>key!=='text'))throw new ProtocolError('INVALID_ARGUMENT','请输入电脑操作任务');
      const status=computerControlSnapshot();
      if(!status.enabled||!status.available||status.waitingConfirmation||status.input.writeBlocked||computerPreparing)
        throw new ProtocolError('UNSUPPORTED_CAPABILITY',status.reason||'电脑组件未就绪或原输入尚未核实');
      openPanel(true);
      const launched={conversationId:conversations.activeConversationId('panel'),stopped:false};computerLaunch=launched;
      try{
        const accepted=await action({sender:panel.webContents,senderFrame:panel.webContents.mainFrame},'task.submit',{text:payload.text.trim(),conversationId:launched.conversationId});
        if(accepted?.taskId){computerTasks.add(accepted.taskId);
          if(launched.stopped)await client.call('task.cancel',{taskId:accepted.taskId,reason:'用户在电脑任务受理前停止操作'});}
        return accepted;
      }finally{if(computerLaunch===launched)computerLaunch=undefined;}
    }
    throw new ProtocolError('UNSUPPORTED_CAPABILITY','此电脑管理操作不可用');
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
    const report = locateTestFailures(text, {root: repoRootForLocate(), allowedPaths: [], maxSnippetReads: 0, contextLines: 2});
    return {failures: report.failures.map(f => ({name: f.name, error: f.error, timedOut: f.timedOut,
      frames: f.frames.map(fr => ({file: fr.file, line: fr.line, column: fr.column, confidence: fr.confidence,
        snippet: fr.snippet === undefined ? null : fr.snippet}))})),
      totalFailures: report.totalFailures};
  }
  if (name === 'admin.open') { openAdmin(payload?.page); return; }
  if (name === 'conversation.open') {
    if (sender !== admin || payload !== undefined || !panel || panel.isDestroyed()) throw Error('对话面板不可用');
    openPanel(true); return {opened:true};
  }
  if (name === 'task.openConversation') {
    if ((sender !== panel && sender !== admin && sender !== workspace) || event.senderFrame !== sender.webContents.mainFrame) throw Error('任务定位窗口不可信');
    return openTaskConversation({payload,tasks:{get:id=>tasks.get(id)??runtimeApplication?.runtime.getTask(id)},conversations,sourceSurface:taskSurface,openPanel:()=>openPanel(true),openWorkspace,publish});
  }
  if (name === 'task.subagentConversation') {
    if ((sender !== panel && sender !== admin && sender !== workspace) || event.senderFrame !== sender.webContents.mainFrame) throw Error('子对话窗口不可信');
    return readSubagentConversation({payload,tasks:{get:id=>tasks.get(id)??runtimeApplication?.runtime.getTask(id)},readChildren:id=>runtimeApplication?.readSubagentTasks?.(id),
      readTask:id=>runtimeApplication.runtime.getTask(id)});
  }
  if(name==='task.openSubagentConversation'){
    if(sender!==panel&&sender!==workspace&&sender!==admin)throw Error('请从主对话或工作区打开子对话');
    return openSubagentConversation(payload);
  }
  if(name==='subagentConversations.openAll'){
    if(sender!==workspace||payload!==undefined)throw Error('请从工作区打开全部子智能体');
    openAllSubagentConversations();return;
  }
  if(name==='subagentConversations.collapseAll'){
    if(![panel,workspace,admin].includes(sender)||payload!==undefined)throw Error('请从主对话或工作区收起子对话');
    const result=await collapseAllSubagentConversations();publish();return result;
  }
  if (name === 'workspace.open' && sender === panel) { await openWorkspace(); return; }
  if (name === 'workspace.close' && sender === workspace) { workspace.close(); return; }
  if (name === 'workspace.minimize' && sender === workspace) { workspace.minimize(); return; }
  if (name === 'workspace.maximize' && sender === workspace) { if(workspace.isMaximized()) workspace.unmaximize(); else workspace.maximize(); return; }
  if (name === 'admin.minimize' || name === 'admin.maximize') {
    if (sender !== admin) throw Error('Untrusted sender');
    if (name === 'admin.minimize') admin.minimize();
    else if (admin.isMaximized()) admin.unmaximize(); else admin.maximize();
    return;
  }
  if (name === 'admin.close') {
    if (sender !== admin) throw Error('Untrusted sender');
    admin.close(); return;
  }
  if (name === 'panel.pin' && sender === panel) { const next=Boolean(payload);if(next===pinned)return;pinned=next;publish();return; }
  if (name === 'panel.hide' && sender === panel) { await hidePanel(); return; }
  if (name === 'orb.open' && sender === orb) { pinned = true; openPanel(true); publish(); return; }
  if (name === 'orb.dragStart' && sender === orb) {
    const revision = ++orbDragRevision, dragWindow = orb;
    const point = screen.getCursorScreenPoint(), bounds = dragWindow.getBounds();
    if (payload !== undefined && (!payload || !Number.isFinite(payload.x) || !Number.isFinite(payload.y)
      || payload.x < 0 || payload.y < 0 || payload.x > bounds.width || payload.y > bounds.height)) throw Error('拖动坐标无效');
    // Keep the pointer-down offset in window-local DIPs, before asynchronous panel cleanup.
    const offset = payload === undefined ? {x: point.x - bounds.x, y: point.y - bounds.y} : {x: payload.x, y: payload.y};
    await hidePanel();
    if (revision !== orbDragRevision || orb !== dragWindow || dragWindow.isDestroyed()) return;
    dragging = true; dragOffset = offset;
    stopOrbDrag(); moveOrbDrag();
    orbDragPoll = setInterval(moveOrbDrag, 16); return;
  }
  if (name === 'orb.dragEnd' && sender === orb) { orbDragRevision++; if (dragging === 'panel') return; moveOrbDrag(); dragging = false; stopOrbDrag(); desktopHost.snap(orb); away = Date.now() + 400; return; }
  if (name === 'panel.dragStart' && sender === panel) {
    if (!payload || !Number.isFinite(payload.x) || !Number.isFinite(payload.y)) throw Error('拖动坐标无效');
    orbDragRevision++;
    stopOrbDrag();
    dragging = 'panel';
    panelDragOrigin = {pointer: {x: payload.x, y: payload.y}, orb: orb.getContentBounds()};
    return;
  }
  if (name === 'panel.dragMove' && sender === panel && dragging === 'panel') {
    if (!payload || !Number.isFinite(payload.x) || !Number.isFinite(payload.y)) throw Error('拖动坐标无效');
    movePanelGroup(payload);
    return;
  }
  if (name === 'panel.dragEnd' && sender === panel) { orbDragRevision++; dragging = false; stopOrbDrag(); panelDragOrigin = undefined; away = Date.now() + 400; return; }
  if (name === 'app.quit') { app.quit(); return; }
  if (name === 'agentarts.configure'||name==='agentarts.restoreDefaultConnection') {
    if (sender!==admin || !competitionMode || runtimeApplication?.activeTaskCount || liveVoice?.hasActive()
      || runtimeStartup.snapshot().state==='starting') throw Error('请在任务、通话及启动结束后从设置配置 AgentArts');
    if(name==='agentarts.restoreDefaultConnection'&&payload!==undefined)throw Error('恢复默认连接不接受额外参数');
    const result=name==='agentarts.restoreDefaultConnection'?agentArtsConfig.restoreDefaultConnection():agentArtsConfig.configure(payload);
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
  if (name === 'agentarts.observation.configure' || name === 'agentarts.observation.revoke') {
    if (sender !== admin || !competitionMode || runtimeApplication?.activeTaskCount || liveVoice?.hasActive()
      || runtimeStartup.snapshot().state === 'starting') throw Error('请在任务、通话及启动结束后从设置配置观测凭据');
    if (!agentArtsObservationConfig) throw Error('AgentArts 观测配置宿主尚未装配');
    try {
      if (name === 'agentarts.observation.revoke' && payload !== undefined) {
        throw Error('撤销观测凭据不接受额外参数');
      }
      const result = name === 'agentarts.observation.revoke'
        ? agentArtsObservationConfig.revoke()
        : agentArtsObservationConfig.configure(payload);
      return {...result, requiresRestart: true,
        reason: name === 'agentarts.observation.revoke'
          ? '已清除本机观测 AK/SK；重启后观测读回恢复为显式 unavailable。'
          : '观测凭据已加密保存；请重启应用以注入 observationAuthorization（不复用 invoke Bearer）。'};
    } finally {publish();}
  }
  if (['todo.authorize','todo.revoke','todo.configureNotifications','todo.dismiss','todo.create','todo.update'].includes(name)) {
    if ((sender !== admin && sender !== workspace && sender !== panel) || !competitionMode || syntheticMvp || !todoHost) throw Error('请从正式应用待办设置操作');
    const result = await todoHost[name.slice(5)](payload); publish(); return result;
  }
  if (['notifications.get','notifications.configure','notifications.read','notifications.digest'].includes(name)) {
    if (sender!==admin || !competitionMode || syntheticMvp || !notificationApplicationHost) throw Error('请从通知设置页操作');
    if (name==='notifications.get') return notificationApplicationHost.snapshot(payload?.scope??{kind:'global'});
    if (name==='notifications.configure') {
      const origin=admin,host=notificationApplicationHost;
      const result=await host.configureSettings(payload,{isCurrent:()=>admin===origin && !origin.isDestroyed() && host===notificationApplicationHost});
      publish();return {...result,notificationCenter:host.snapshot(payload.scope)};
    }
    if (name==='notifications.read') return notificationApplicationHost.acknowledgeRead(payload);
    return notificationApplicationHost.getDigest(payload);
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
      if(choice.containsCredentials)throw new ProtocolError('UNAUTHORIZED','含凭据的来源保持私人，不能申请公开持续跟踪');
      const allowed=await confirmApplicationAuthorization('feeds.classify',choice,{scope:{subscriptionId:choice.subscriptionId,
        configurationRef:choice.configurationRef,generation:choice.generation,taskId:choice.taskId,purposeDigest:choice.purposeDigest},
        summary:'将此无凭据订阅标记为公开资料，并允许所选原任务按其原期限跟踪；本卡不证明来源已实际读取',deadline:choice.deadline,
        isCurrent:()=>admin===originAdmin&&!originAdmin.isDestroyed()&&runtimeApplication===originApplication&&feedsHost===originFeeds});
      if (admin !== originAdmin || originAdmin.isDestroyed() || runtimeApplication !== originApplication
        || feedsHost !== originFeeds) throw Error('订阅许可窗口已经改变');
      if (!allowed) return originFeeds.snapshot();
      const result=originFeeds.applyNativeSourceChoice(choice,'public');
      if (allowed) {
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
    return recoverWorkspacePatch(event, payload);
  }
  if(['coding.review.configure','coding.review.revoke','coding.review.show'].includes(name)){
    if(sender!==admin||!competitionMode||syntheticMvp||!codingWorkspace||!f15ReviewHost||!f15ReviewOrigin)
      throw new ProtocolError('UNSUPPORTED_CAPABILITY','请从正式应用设置操作独立审核');
    if(name==='coding.review.configure'){
      if(!payload||Object.keys(payload).sort().join(',')!=='policyId,reviewerId'||typeof payload.reviewerId!=='string'||typeof payload.policyId!=='string')
        throw new ProtocolError('INVALID_ARGUMENT','请输入审核者与审核策略标识');
      if(runtimeApplication.activeTaskCount||runtimeApplication.runtime.listTasks({states:['created','planning','running','waiting_approval',
        'waiting_external','waiting_reconciliation','verifying','cancelling'],limit:1}).items.length)
        throw new ProtocolError('REVISION_CONFLICT','请先完成或核实当前任务，再更改独立审核配置');
      const authorId=f15ReviewOrigin.readAuthorIdentity();if(!authorId||!f15ReviewViewer?.snapshot().available)
        throw new ProtocolError('UNSUPPORTED_CAPABILITY','原部署身份或本机审核窗口不可用');
      await f15ReviewHost.configure({reviewerId:payload.reviewerId,policyId:payload.policyId,authorId});installF15Review();
    }else if(name==='coding.review.revoke'){
      if(payload!==undefined)throw new ProtocolError('INVALID_ARGUMENT','撤销操作不接受参数');
      f15ReviewHost.revoke();f15ReviewInstalled=false;f15ReviewNotice='';
    }else{
      if(!payload||Object.keys(payload).join(',')!=='operationId'||typeof payload.operationId!=='string'
        ||!/^f15-review-[a-f0-9]{64}$/.test(payload.operationId))throw new ProtocolError('INVALID_ARGUMENT','请选择原审核任务');
      const pending=f15ReviewHost.pending().find(item=>item.recordFileName===payload.operationId+'.json');
      if(!pending)throw new ProtocolError('UNSUPPORTED_CAPABILITY','原审核任务不再等待');
      const result=await f15ReviewOrigin.showOriginalPatch(pending);publish();
      return {coding:{...codingWorkspace.snapshot(),independentReview:f15ReviewSnapshot()},reviewShown:result.shown};
    }
    publish();return {coding:{...codingWorkspace.snapshot(),independentReview:f15ReviewSnapshot(),
      f20:codingWorkspace.readF20CaseConfiguration?.()??{configured:false}}};
  }
  if(name==='coding.f20.configure'){
    if(sender!==admin||!competitionMode||syntheticMvp||!codingWorkspace?.setF20CaseFromNativeSelection)
      throw new ProtocolError('UNSUPPORTED_CAPABILITY','请从正式应用设置配置 F20 固定 case');
    if(runtimeApplication?.activeTaskCount)throw new ProtocolError('REVISION_CONFLICT','请等待当前任务结束后更改 F20 case');
    if(!payload||typeof payload!=='object'||Array.isArray(payload)
      ||Object.keys(payload).sort().join(',')!=='docTemplate,inputRef,recipeId'
      ||typeof payload.inputRef!=='string'||typeof payload.recipeId!=='string'||typeof payload.docTemplate!=='string')
      throw new ProtocolError('INVALID_ARGUMENT','请提供 F20 inputRef、recipeId 与文档模板');
    const binding=codingWorkspace.readWorkspaceBinding?.();
    if(!binding?.rootPath||!path.isAbsolute(binding.rootPath))
      throw new ProtocolError('UNSUPPORTED_CAPABILITY','请先选择编程工作区');
    const owner=admin;const pick=async title=>{
      if(!owner||owner.isDestroyed())return;
      const choice=await dialog.showOpenDialog(owner,{title,properties:['openFile'],
        filters:[{name:'源文件',extensions:['js','mjs','cjs','ts','json','md']}]});
      if(admin!==owner||owner.isDestroyed()||choice.canceled||choice.filePaths.length!==1)return;
      const relative=path.relative(binding.rootPath,choice.filePaths[0]);
      if(!relative||relative.startsWith('..')||path.isAbsolute(relative))
        throw new ProtocolError('UNAUTHORIZED','F20 源文件必须位于当前工作区内');
      return relative.split(path.sep).join('/');
    };
    const schemaFile=await pick('选择 F20 schema 文件');
    const codeFile=await pick('选择 F20 代码文件');
    const targetDoc=await pick('选择 F20 目标文档');
    if(!schemaFile||!codeFile||!targetDoc){
      publish();return {coding:{...codingWorkspace.snapshot(),independentReview:f15ReviewSnapshot(),
        f20:codingWorkspace.readF20CaseConfiguration?.()??{configured:false}},codingSelectionCancelled:true};
    }
    codingWorkspace.setF20CaseFromNativeSelection({inputRef:payload.inputRef,recipeId:payload.recipeId,
      docTemplate:payload.docTemplate,schemaFile,codeFile,targetDoc});
    publish();return {coding:{...codingWorkspace.snapshot(),independentReview:f15ReviewSnapshot(),
      f20:codingWorkspace.readF20CaseConfiguration?.()??{configured:false}}};
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
    if (name === 'coding.authorize') await codingWorkspace.authorize(payload);
    if (name === 'coding.revoke') codingWorkspace.revoke();
    publish();return {coding:{...codingWorkspace.snapshot(),independentReview:f15ReviewSnapshot(),
      f20:codingWorkspace.readF20CaseConfiguration?.()??{configured:false}},
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
    await connectorConversationTools?.invalidate('calendar');
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
  if (name === 'laya.start' || name === 'laya.stop') {
    if (sender !== admin || !competitionMode || !localLaya) throw Error('此操作仅允许从本项目设置调用');
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
  }
  if (['mail.configure','mail.enable','mail.read','mail.disable','mail.review.configure','mail.disableCloud','mail.monitor.start','mail.monitor.stop'].includes(name)) {
    if (sender !== admin || !competitionMode) throw Error('此操作仅允许从本项目设置调用');
    if(name==='mail.monitor.stop') {
      if(payload!==undefined)throw Error('邮件监测参数无效');
      const valid=mailMonitorPreparation.stop(),origin=admin,application=runtimeApplication,host=connectorWatchHost;
      try{
        if(!host||!application)throw Error('邮件监测尚未就绪，请查看当前状态');
        const conversationId=conversations.activeConversationId('panel');
        const isCurrent=()=>valid()&&admin===origin&&!origin.isDestroyed()&&runtimeApplication===application&&connectorWatchHost===host;
        mailMonitorRequest=host.requestFromSettings('stop',{conversationId,isCurrent});return mailSnapshot();
      }finally{publish();}
    }
    if(!mailConfig)throw Error('此操作仅允许从本项目设置调用');
    if(name==='mail.read'&&mailMonitorPreparation.configurationPending())throw Error('邮箱配置正在更新，请等待完成后再读取邮件');
    if((name==='mail.read'||name==='mail.monitor.start')&&!localLaya)throw Error('本地分类模型不可用，请检查模型设置');
    if(name==='mail.monitor.start') {
      if(payload!==undefined||!mailHost||!connectorWatchHost||!runtimeApplication||!mailConfig.snapshot().configured)
        throw Error('邮件监测尚未就绪，请先保存邮箱配置');
      if(mailConfig.snapshot().requiresRestart)throw Error('邮箱配置已保存，请重启应用使新配置生效');
      const origin=admin,application=runtimeApplication,host=connectorWatchHost;
      const configuration=mailConfig;
      const conversationId=conversations.activeConversationId('panel');
      const sourceCurrent=()=>admin===origin&&!origin.isDestroyed()&&runtimeApplication===application&&connectorWatchHost===host
        &&mailConfig===configuration&&configuration.snapshot().configured===true&&!configuration.snapshot().requiresRestart
        &&!mailMonitorPreparation.configurationPending()&&!runtimeClosed;
      const starting=mailMonitorPreparation.run(async({isCurrent})=>{
        try{
          mailFailure='';localServicesStopped=false;
          const model=localLaya.snapshot().ready?localLaya.snapshot():await localLaya.start();
          if(!isCurrent())return;
          if(!model.ready&&model.state!=='ready')throw Error(model.reason||'本地分类模型未启动，邮件监测尚未开始');
          const notificationScope={kind:'connector',connectorId:'mail'},policy=notificationApplicationHost?.getInterruptionPolicy(notificationScope);
          if(!policy)throw Error('通知服务尚未就绪，邮件监测尚未开始');
          if(!policy.effective){
            const configured=await notificationApplicationHost.configureSettings({operationId:randomUUID(),scope:notificationScope,
              expectedRevision:policy.revision,patch:{...defaultNotificationSettings}},{isCurrent});
            if(!isCurrent())return;
            if(configured.state!=='confirmed')throw Error('提醒设置尚未确认，请查看主对话授权卡后再启动监测');
          }
          if(mailHost.snapshot().status==='classification_unavailable')mailHost.retryClassification();
          await host.tick();
          if(!isCurrent())return;
          mailMonitorRequest=host.requestFromSettings('start',{conversationId,isCurrent});
        }catch(error){if(isCurrent()){mailFailure=error.message;throw error;}}
      },{isCurrent:sourceCurrent});
      publish();try{await starting;return runtimeClosed?undefined:mailSnapshot();}finally{if(!runtimeClosed)publish();}
    }
    if(name==='mail.configure'||name==='mail.disable'){
      const finished=mailMonitorPreparation.beginConfigurationChange();publish();
      try{if(name==='mail.configure'){await mailConfig.configure(payload);mailFailure='';}else await mailConfig.revoke();}
      finally{
        finished();
        if(!mailMonitorPreparation.configurationPending()&&runtimeError==='邮箱配置正在更新，请等待完成后再退出')runtimeError='';
        if(!runtimeClosed)publish();
      }
      if(!runtimeClosed)return mailSnapshot();return;
    }
    if (name === 'mail.enable') mailConfig.enableSession(payload);
    if (name === 'mail.review.configure') {
      if(!mailAnalysisHost)throw Error('邮件云复核宿主尚未就绪');
      await mailAnalysisHost.configure(payload??{enabled:true});
    }
    if (name === 'mail.disableCloud') {await mailAnalysisHost?.revoke();await mailConfig.revokeCloudAnalysis();}
    if (name === 'mail.read') {
      if (!mailHost || mailConfig.snapshot().requiresRestart) throw Error('邮箱配置将在下次启动应用时接入');
      if (!localLaya.snapshot().ready) throw Error('请先启动本地 Laya');
      if (mailHost.snapshot().status === 'classification_unavailable') mailHost.retryClassification();
      else {
        if(activeConnectorMailRead&&!['ready','complete','disabled'].includes(mailHost.snapshot().status))
          throw Error('邮箱持续订阅仍在读取，请先停止该订阅或等待本批读取完成');
        const previous=activeConnectorMailRead,previousConversation=manualMailReadConversationId;activeConnectorMailRead=undefined;
        manualMailReadConversationId=conversations.activeConversationId('panel');
        try {mailHost.startBatch({expiresAt:new Date(Date.now() + 8 * 60 * 60_000).toISOString()});}
        catch(error){activeConnectorMailRead=previous;manualMailReadConversationId=previousConversation;throw error;}
      }
      localServicesStopped = false;
    }
    publish(); return mailSnapshot();
  }
  if (typeof name==='string' && name.startsWith('wiki.import.')) {
    if(sender!==admin || !competitionMode || !wikiImportHost) throw Error('Wiki 导入仅在正式管理后台可用');
    const result=await wikiImportHost.action(name.slice('wiki.import.'.length),payload);
    publish();return result;
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
      const before=knowledgeSourceConfig.snapshot();
      const result=await knowledgeSourceConfig[action](payload);
      if(before.sourceId!==result.sourceId||before.configRevision!==result.configRevision||action==='revoke')obsidianPairing?.useFilesystem();
      cancelKnowledgeTasks();
      publish();return result;
    }
    if(['readNote','submitPatch'].includes(action) && obsidianPairing?.snapshot().mode==='plugin') throw Error('插件配对仅支持只读检索；请先显式撤销配对以整理文件源');
    if(action==='readNote') {
      const binding=knowledgeSourceConfig.snapshot();
      const isCurrent=()=>{const value=knowledgeSourceConfig.snapshot();return value.available&&value.sourceId===binding.sourceId&&value.configRevision===binding.configRevision;};
      if(!isCurrent()||!await confirmApplicationAuthorization('knowledge.read',payload,{scope:{sourceId:binding.sourceId,configRevision:binding.configRevision,path:payload?.path},
        summary:`只读显示当前知识源中所选笔记 ${payload?.path??''}；不向模型发送正文。`.slice(0,512),isCurrent}))throw Error('本次笔记读取未获有效原卡授权');
      return knowledgeSourceConfig.readSelectedNote(payload);
    }
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
    if (name === 'voice.wake.enable' && voiceStartupHost && !voiceStartupHost.snapshot().resourcesReleased) throw Error('请先结束启动语音');
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
    if (voiceStartupHost && !voiceStartupHost.snapshot().resourcesReleased) throw Error('请先结束启动语音');
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
      await voiceStartupHost?.stop();
      await stopWakeVoice();
      if (liveVoice?.hasActive() || voiceInput?.hasActive()) throw Error('请先结束语音再修改配置');
      const result = liveConfig.configure(payload);
      registerLiveShortcut(); publish();
      if (Object.hasOwn(payload,'startupGreeting') || Object.hasOwn(payload,'continuousListening')) {
        queueMicrotask(() => {void voiceStartupHost?.start().catch(reportPanelVoiceFailure);});
      }
      return result;
    } finally {voiceConfigurationPending = false;}
  }
  if (name === 'live.toggle') {
    if (sender !== panel || !competitionMode) throw Error('Live 只能从可信面板开启');
    return toggleLive();
  }
  if (name === 'voice.capture.authorize') {
    if (voiceStartupHost && !voiceStartupHost.snapshot().resourcesReleased) throw Error('请先结束启动语音');
    if (sender !== panel || !competitionMode) throw Error('麦克风只允许 Competition 可信面板启用');
    if (!client) throw Error('Runtime 未连接，麦克风采集尚不可用');
    if (!voicePcmSource) throw Error('Voice PCM 来源尚未接入');
    if (voiceConfigurationPending || panelHiding || wakeQuitUnknown || wakeVoice?.hasActive() || liveVoice?.hasActive()) throw Error('请先结束唤醒或 Live 会话');
    const result = await microphoneCaptureHost.authorize({purpose:'dictation'});
    publish();
    return result;
  }
  if (name === 'voice.capture.revoke') {
    if (sender !== panel) throw Error('麦克风只能从可信面板关闭');
    await stopWakeVoice();
    await voiceStartupHost?.stop();
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
      if (!knowledgeSourceConfig) throw Error(knowledgeSourceNotReadyMessage);
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
    const surface=sender===workspace?'workspace':'panel',previousConversationId=conversations.activeConversationId(surface);
    const result=await handleConversationAction({name,payload,surface,conversations,tasks,taskSurface,submitting,publish});
    if(conversations.activeConversationId(surface)!==previousConversationId)liveVoice?.invalidateTextOutput(previousConversationId);
    return result;
  }
  if (name === 'thinking.update') {
    if (sender !== panel && sender !== admin && sender !== workspace) throw Error('思考设置来源不受信任');
    if (!competitionMode) return updateThinking(payload);
    const conversationId = conversations.activeConversationId(sender===workspace?'workspace':'panel');
    if(payload?.conversationId!==undefined&&payload.conversationId!==conversationId)throw Error('当前对话已切换，请重新操作');
    const previous = conversations.preference(conversationId,{depth:thinking.depth,fast:thinking.fast});
    const preference={...previous,depth:payload?.depth,fast:payload?.fast};
    if(preference.modelSelection==='default')readDesktopExecutionModel(agentArtsModels,preference);
    const value = conversations.setPreference(conversationId,preference);
    publish();return value;
  }
  if (name === 'conversation.model') {
    if (sender !== panel && sender !== workspace) throw Error('请从当前对话选择主思考模型');
    if (!competitionMode || !payload || Object.keys(payload).some(key=>!['modelId','executionModel','conversationId','modelSelection','depth','fast','catalogRevision'].includes(key))) throw Error('模型选择无效');
    if(payload.modelSelection!==undefined&&(payload.modelSelection!=='default'||payload.modelId!==''||payload.executionModel!==undefined||!Number.isInteger(payload.depth)||payload.depth<0||payload.depth>5||typeof payload.fast!=='boolean'))throw Error('默认组合选择无效');
    if(payload.modelSelection==='default'&&payload.catalogRevision!==agentArtsModels.snapshot().catalog?.revision)throw Error('模型目录已改变，请重新选择');
    if(payload.modelSelection===undefined&&['depth','fast','catalogRevision'].some(key=>Object.hasOwn(payload,key)))throw Error('模型选择无效');
    const executionModel=payload.executionModel?agentArtsModels.resolveExecutionModel(payload.executionModel):payload.modelId?agentArtsModels.resolveExecutionModel({modelId:payload.modelId}):undefined;
    const id = executionModel?.modelId ?? payload.modelId;
    if (typeof id !== 'string' || (id && !executionModel && !agentArtsModels?.snapshot().catalog?.models.some(item=>item.id===id && item.available!==false))) {
      throw Error('所选主模型未配置或不可用');
    }
    const conversationId = conversations.activeConversationId(sender===workspace?'workspace':'panel');
    if(payload?.conversationId!==undefined&&payload.conversationId!==conversationId)throw Error('当前对话已切换，请重新操作');
    const preference={...conversations.preference(conversationId),modelId:id,executionModel,modelSelection:payload.modelSelection,...(payload.modelSelection==='default'?{depth:payload.depth,fast:payload.fast}:{})};
    if(payload.modelSelection==='default')readDesktopExecutionModel(agentArtsModels,preference);
    const value = conversations.setPreference(conversationId,preference);
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
  if(name==='conversation.interrupt') {
    if(sender!==panel)throw Error('请从主面板停止当前回答');
    if(!payload||typeof payload!=='object'||Object.keys(payload).some(key=>key!=='conversationId')
      ||payload.conversationId!==conversations.activeConversationId('panel'))throw Error('当前对话已切换，请重试');
    return interruptConversation(payload.conversationId,'panel');
  }
  if (name === 'task.submit' || name==='skill.run') {
    const skillRun=name==='skill.run';
    // The redesigned workspace consumes the original trusted Runtime submit path.
    if(!skillRun&&sender===workspace&&!competitionMode&&!fakeMode)throw Error('主工作区任务入口需要 AgentArts 比赛配置；本地模式请使用原主面板');
    if(skillRun ? sender!==admin || !competitionMode || !installedSkillsHost : sender !== panel && sender !== workspace) throw Error('请从可信界面提交任务');
    const text=typeof payload==='string'?payload:payload?.text;
    if(!skillRun&&payload&&typeof payload==='object'&&(Object.keys(payload).some(k=>!['text','conversationId','delivery'].includes(k))
      ||payload.delivery!==undefined&&!['steer','send'].includes(payload.delivery)))throw Error('任务提交格式无效');
    if (!skillRun && (typeof text !== 'string' || !text.trim())) throw Error('请输入有效任务');
    const compactCommand=!skillRun&&/^(?:\/压缩|\/compact)$/iu.test(text.trim());
    if(compactCommand&&!harnessContextHost?.runtimeHooks)
      throw Error('请先在设置 → 模型 → 开发者 Harness 中选择摘要模型并启用自动压缩，再发送 /压缩');
    if (competitionMode && !agentArtsConfig.snapshot().configured) throw Error('请先在设置 → 模型中保存 AgentArts Authorization；Live 语音配置无需重新填写');
    if (!fakeMode && model.enabled === false) throw Error('模型已停用，请先启用');
    const surface = skillRun || sender === workspace ? 'workspace' : 'panel';
    const conversationId=conversations.activeConversationId(surface);
    if(!skillRun&&payload?.conversationId!==undefined&&payload.conversationId!==conversationId)throw Error('当前对话已切换，请重新发送');
    const steering=!skillRun&&!compactCommand&&payload?.delivery==='steer';
    const previous=steering?conversationDelivery.interruptPending(conversationId):undefined;
    if (!steering&&(submitting.has(conversationId) || [...tasks.values()].some(task => conversations.conversationIdForTask(task)===conversationId && taskSurface(task) === surface && !terminalTaskStates.has(task.state)&&!conversationDelivery.stopped(task)))) throw Error('请等待当前回答完成，或先停止当前任务');
    const deliveryRequest=conversationDelivery.begin(conversationId);
    try {
    if(steering)await interruptConversation(conversationId,surface,deliveryRequest,previous);
    if(deliveryRequest.interrupted)return {interrupted:true};
    const prepared=skillRun?await installedSkillsHost.prepareRun(payload):undefined;
    if(prepared?.cancelled) return {cancelled:true};
    if(deliveryRequest.interrupted)return {interrupted:true};
    const goal = skillRun?prepared.publicGoal:text.trim();
    const result = await submitConversationTask(client, {goal, conversationId}, {competition: competitionMode,contextCompaction:Boolean(harnessContextHost?.runtimeHooks),
      ...(competitionMode?{competitionTimeoutMs:readCompetitionExecutionPolicy().taskTimeoutMs}:{})});
    deliveryRequest.taskId=result.taskId;
    const userGoal=skillRun?prepared.userGoal:goal;
    conversations.add(result.taskId, surface, userGoal,conversationId);
    if (!skillRun && !deliveryRequest.interrupted) liveVoice?.trackTextTask({taskId:result.taskId,conversationId});
    rememberTaskGoal(result.taskId, userGoal);
    const stopAcceptedTask=async()=>{
      conversationDelivery.truncate({taskId:result.taskId});
      const stopped=await client.call('task.cancel',{taskId:result.taskId,reason:'用户在任务受理前截断回答'});
      conversationDelivery.acceptStop(result.taskId,stopped);
      void refresh(result.taskId).catch(()=>{});
      return {taskId:result.taskId,interrupted:true};
    };
    if(deliveryRequest.interrupted)return stopAcceptedTask();
    if (sender === panel) pinned = true;
    const task = await refresh(result.taskId);
    if(deliveryRequest.interrupted)return stopAcceptedTask();
    return task;
    } finally { conversationDelivery.finish(deliveryRequest); }
  }
  if(name==='task.reconcile.finish')return reconcileTaskFromSurface({taskId:payload,sender,panel,workspace,tasks,taskSurface,
    application:runtimeApplication,refresh,publish,observe:operation=>withNativeReadbackScope({owner:sender},operation),
    reportNative:result=>dialog.showMessageBox(sender,{type:'info',message:`已读取原编码会话；原任务状态：${({waiting_reconciliation:'待核实',cancelled:'已取消',failed:'失败',succeeded:'已完成'})[result.task?.state]??result.task?.state??'未知'}`,
      detail:(result.readbacks??[]).map(item=>`${item.taskId}：${({clear:'原宿主当前已空闲；这不证明未知试验成功',in_progress:'原宿主仍在执行',unknown:'原宿主状态仍无法确认'})[item.recovery.state]??'状态未知'}；证据 ${item.evidenceRef}`).join('\n')
        +'\n本次只读取原会话，没有重发试验或更改原 UNKNOWN。',buttons:['关闭'],noLink:true})});
  if (name === 'task.cancel') {
    if (typeof payload !== 'string' || !tasks.has(payload)) throw Error('Unknown task');
    if (sender !== admin && taskSurface(tasks.get(payload)) !== (sender === workspace ? 'workspace' : 'panel')) throw Error('无法停止其他工作区的任务');
    conversationDelivery.truncate(tasks.get(payload));liveVoice?.cancelTextTask(payload);publish();
    const result=await client.call('task.cancel',{taskId:payload,reason:'用户截断当前回答'});
    conversationDelivery.acceptStop(payload,result);
    void refresh(payload).catch(()=>{});
    return result;
  }
  if (name === 'task.refresh') {
    if (!tasks.has(payload)) throw Error('Unknown task');
    if (sender !== admin && taskSurface(tasks.get(payload)) !== (sender === workspace ? 'workspace' : 'panel')) throw Error('无法读取其他工作区的任务');
    return refresh(payload);
  }
  if (name === 'capability.list') { await syncCapabilities(); publish(); return {manifests: capabilities, health}; }
  if (name === 'approval.history') {
    if (sender !== admin) throw Error('授权历史只能从管理后台读取');
    const page=await readApprovalPage(client, payload);
    return {...page,items:page.items.map(approval=>projectDesktopApproval(approval,runtimeApplication?.runtime))};
  }
  if (name === 'settings.get') return client.call('settings.get', {namespace: String(payload ?? 'desktop')});
  if (name === 'settings.update') return client.call('settings.update', payload);
  if (name === 'authorization.respond') {
    if (!payload || typeof payload.approvalId !== 'string' || !['allow_once', 'deny'].includes(payload.decision) || !Number.isSafeInteger(payload.expectedRevision)) throw Error('授权决定格式无效');
    if(sender!==admin){const approval=approvals.get(payload.approvalId),surface=sender===workspace?'workspace':'panel';if(sender!==panel&&sender!==workspace||!approval||approval.taskId!==payload.taskId||!tasks.has(approval.taskId)||!visibleConversationTask(tasks.get(approval.taskId),surface))throw Error('审批不属于当前对话');}
    if(authorizationQuestionHost?.hasPending(payload.approvalId))throw new ProtocolError('UNAUTHORIZED','请在原对话的统一授权卡完成本次决定');
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
        rememberTaskGoal(taskId, goal);
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
    if (liveVoice.hasActive()) {await voiceStartupHost?.stop();result = await liveVoice.stop();}
    else if (voiceStartupHost && !voiceStartupHost.snapshot().resourcesReleased) {
      await voiceStartupHost.stop();result=liveVoice.snapshot();
    }
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
  const accepted=await confirmApplicationAuthorization('reference.source',
    {taskId:input.taskId,configurationRef:input.configurationRef,sourceRef:'public-reference',path:sourcePath,expiresAt:input.deadline},
    {scope:{taskId:input.taskId,configurationRef:input.configurationRef,workspace:workspaceBinding},
      summary:`选择 ${sourcePath} 为本任务PUBLIC参考来源；此步骤不读取正文，实际读取与有界出机由原工具同一卡核对。`.slice(0,512),
      deadline:input.deadline,signal:input.signal,isCurrent:current});
  if (!current()) return undefined;
  referenceHost.assertTask(input.taskId);
  if (!accepted) {publicSkillSources.set(key,{denied:true});return undefined;}
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
    authorizeTaskRead:scope=>conversationToolAccess?.authorizeTaskRead(scope)===true,
    authorizeFinalRead:(...args)=>f02Workflow?.authorizeFinalRead?.(...args)===true,
    prepareTaskApproval:scope=>voiceApprovalBridge?.prepareTaskApproval(scope)??null,
    onTaskSubmitted: ({taskId, goal,conversationId='desktop-panel'}) => {rememberTaskGoal(taskId, goal);conversations.add(taskId, 'panel', goal,conversationId);},
    readContext: ({conversationId=conversations.activeConversationId('panel')}={}) => JSON.stringify({profile: 'huawei_ict_agentarts',
      contextMessages:readDesktopConversationContext({conversationId,deadline:new Date(Date.now()+180000).toISOString(),signal:new AbortController().signal}),
      currentUserQuestion:voiceQuestionForConversation(conversationId),
      agentArts:{configured:agentArtsConfig.snapshot().configured,reason:agentArtsSnapshot().reason},
      developer:{...projectDeveloperConversationStatus(developerDeployment?.snapshot()),
        ...(developerDeploymentFailure?{configurationFailure:developerDeploymentFailure}:{})},
      computer:projectComputerConversationStatus(windowsControlHost?.snapshot()),
      proactiveMaintenance:{state:proactiveWorkflowApplication?.snapshot().state??'unavailable',
        ...(proactiveMaintenanceFailure?{wakeFailure:proactiveMaintenanceFailure}:{}),
        ...(proactiveSourceRoutingFailure?{sourceFailure:proactiveSourceRoutingFailure}:{})},
      subagentDispatch:{registered:competitionToolAvailabilityList.some(tool=>tool.toolName==='subagent.dispatch'),
        available:runtimeApplication?.isDefaultSubagentAvailable?.()===true},
      subagentTasks:orderedTasks().filter(task=>conversations.conversationIdForTask(task)===conversationId)
        .flatMap(task=>runtimeApplication?.readSubagentTasks?.(task.taskId)??[]).slice(-10)
        .map(({parentTaskId,taskId,role,modelId,reasoningEffort,state,resultSummary,error,evidenceRefs})=>
          ({parentTaskId,taskId,role,modelId,reasoningEffort,state,resultSummary:resultSummary?.slice(0,800),
            errorCode:error?.code,evidenceRefCount:evidenceRefs?.length??0})),
      tasks: orderedTasks().filter(task => taskSurface(task) === 'panel'&&conversations.conversationIdForTask(task)===conversationId).slice(-10)
        .map(task => ({taskId: task.taskId, goal: (taskGoals.get(task.taskId) ?? conversations.goal(task.taskId) ?? '').slice(0, 800),
          state: task.state, failureReason: task.error?.message, result: resultText(task.resultSummary,taskResultMetadata(task)).slice(0, 1600),
          createdAt: conversations?.turns.get(task.taskId)?.createdAt ?? task.createdAt ?? task.updatedAt})),
      messages: conversations.messagesFor('panel',conversationId).slice(-20).map(({id,role, text, createdAt}) => ({id,role, text: text.slice(0, 1600), createdAt})),
      capabilities: capabilities.map(item => ({name: item.name ?? item.id, version: item.version})),
      tools: runtimeApplication?.readConversationToolCapabilities?.() ?? (competitionToolAvailabilityList.length ? competitionToolAvailabilityList : [
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
  const {createWindowsSystemSpeechPorts} = await import('@personal-agent/voice');
  if (voiceStartupHost) await voiceStartupHost.dispose();
  const startupSpeech = createWindowsSystemSpeechPorts();
  voiceStartupHost = createDesktopVoiceStartupHost({config:liveConfig,liveVoice,output:startupSpeech.output,
    disposeOutput:()=>startupSpeech.dispose(), onUpdate:publish, async prepare({isCurrent}) {
      if (voiceConfigurationPending || panelHiding || app.isQuitting) throw Error('语音配置或窗口正在更新');
      await stopWakeVoice();
      if (!isCurrent()) return;
      if (voiceConfigurationPending || panelHiding || voiceInput?.hasActive() || wakeVoice?.hasActive()) throw Error('请先结束其他语音');
      pinned=true;openPanel(true);publish();
    }});
  voiceStartupDisposed=false;voiceStartupDisposal=undefined;
  if (panel && !panel.webContents.isLoadingMainFrame()) {
    queueMicrotask(() => {void voiceStartupHost.start().catch(reportPanelVoiceFailure);});
  }
}

app.whenReady().then(async () => {
  if (!ownsDesktopInstance) return;
  const sampleResources=()=>{
    if(resourcePolicy.sample({freeBytes:freemem(),totalBytes:totalmem(),cores:availableParallelism(),
      onBattery:powerMonitor.isOnBatteryPower(),thermalState,speedLimit}))publish(['resources']);
  };
  sampleResources();
  resourcePoll=setInterval(sampleResources,2000);resourcePoll.unref();
  powerMonitor.on('thermal-state-change',value=>{thermalState=value.state;sampleResources();});
  powerMonitor.on('speed-limit-change',value=>{speedLimit=value.limit;sampleResources();});
  powerMonitor.on('on-battery',sampleResources);powerMonitor.on('on-ac',sampleResources);
  desktopHost = createDesktopHost();
  microphonePermissionGate = createMicrophonePermissionGate({
    expectedPageUrl: pathToFileURL(entry).href,
    isTrustedWindow: contents => contents === panel?.webContents,
  });
  session.defaultSession.setPermissionRequestHandler(microphonePermissionGate.request);
  session.defaultSession.setPermissionCheckHandler(microphonePermissionGate.check);
  microphoneCaptureHost = createMicrophoneCaptureHost({permissionGate: microphonePermissionGate,
    confirmAuthorization:request=>{
      const {signal,isCurrent,...payload}=request;
      if(!isCurrent()||voiceConfigurationPending||panelHiding)return false;
      if(!needsMicrophoneApproval(authorizationQuestionHost?.sandboxSnapshot().selected.mode,payload.purpose))return true;
      return confirmApplicationAuthorization('voice.capture',payload,{scope:{panelId:payload.panelId,purpose:payload.purpose,expiresAt:payload.expiresAt},
        summary:`允许本次${payload.purpose==='live'?'Live语音与所选AgentArts音频服务':payload.purpose==='wake'?'本机关键词唤醒及后续听写':'麦克风听写'}，期限至${payload.expiresAt}；系统麦克风权限仍单独核验，停止立即撤销。`,
        deadline:new Date(Math.min(Date.parse(payload.expiresAt),Date.now()+180000)).toISOString(),signal,
        isCurrent:()=>!voiceConfigurationPending&&!panelHiding&&isCurrent()});
    },
    getPanel: () => panel, onLevel: noteMicLevel});
  ipcMain.on('desktop:microphone-event', (event, message) => {
    if (microphoneCaptureHost.receive(event, message) && message.type!=='frame') publish();
  });
  sisConfigHost = createDesktopSisConfigHost({userData: app.getPath('userData'), safeStorage});
  liveConfig = createLiveVoiceConfig({userData: app.getPath('userData'), safeStorage,competitionMode,
    readAgentArtsState:()=>agentArtsConfig?.snapshot()??{configured:false}});
  agentArtsConfig = createAgentArtsConfig({userData: app.getPath('userData'), safeStorage});
  if(competitionMode&&!syntheticMvp) {
    try {
      const created=initializeDefaultWorkspace({userData:app.getPath('userData'),
        workspace:path.join(app.getPath('userData'),'Workspace'),safeStorage});
      defaultWorkspaceState=created
        ? {configured:true,selectionAvailable:false,displayName:'Workspace',reason:'默认文件夹已准备；连接 AI 后装配工具，写入仍需原授权'}
        : readSavedWorkspaceStatus({userData:app.getPath('userData'),safeStorage});
    } catch {defaultWorkspaceState={configured:false,selectionAvailable:false,reason:'默认工作文件夹不可用；连接 AI 后可选择其他目录'};}
  }
  agentArtsObservationConfig = createAgentArtsObservationConfig({
    userData: app.getPath('userData'), safeStorage});
  if(competitionMode&&!fakeMode)weatherCardHost=createWeatherCardHost({userData:app.getPath('userData'),getApplication:()=>runtimeApplication,
    readToolVersion:()=>productTools?.tools.find(tool=>tool.descriptor.name==='weather.forecast')?.descriptor.version,onUpdate:publish});
  app.once('will-quit',()=>{
    try{conversations?.close();}
    catch{console.error('[conversations] close failed after committed quit');}
    weatherCardHost?.dispose();
  });
  app.once('will-quit',()=>{void openCliBrowserHost?.close();});
  ipcMain.on('desktop:draft-close',(event,entries)=>{
    try{flushConversationDrafts(event,entries,{panel,workspace,conversations});event.returnValue={ok:true};}
    catch{event.returnValue={ok:false,error:'关闭前草稿保存未确认，请保持窗口打开并重试'};}
  });

  if(competitionMode) {
    const registry=createRemoteMcpRegistry({userData:app.getPath('userData'),safeStorage});
    remoteMcpServices=await createDesktopRemoteMcpServices({registry,readRuntime:()=>runtimeApplication?.runtime,
      confirmConnection:request=>remoteMcpManagement?.confirmConnection(request)??false});
    ({config:remoteMcpConfig,host:remoteMcpHost}=remoteMcpServices.get('legacy'));
    remoteMcpManagement=createRemoteMcpManagement({BrowserWindow,ipcMain,dialog,owner:()=>admin,
      confirmAuthorization:request=>confirmApplicationAuthorization('remoteMcp.configure',request.payload,request),
      focusAuthorizationQuestion:focusRemoteMcpAuthorizationQuestion,
      config:remoteMcpConfig,host:remoteMcpHost,services:remoteMcpServices,application:()=>runtimeStartup.snapshot().state==='ready' && !runtimeClosed?runtimeApplication:undefined,client:()=>client,
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
      createGateway:createConfiguredSubagentModelGateway,createGuardedGateway:createConfiguredSubagentModelGateway});
    computerVisionConfig=createComputerVisionConfig({userData:app.getPath('userData'),safeStorage,
      createGateway:createConfiguredSubagentModelGateway,onUpdate:publish});
  }
  if (competitionMode && !syntheticMvp) calendarConfig = createCalendarConfig({userData:app.getPath('userData'),safeStorage,question:authorizationQuestionPort});
  if (competitionMode && !syntheticMvp) feedsHost = createDesktopFeedsHost({userData:app.getPath('userData'),safeStorage,question:authorizationQuestionPort});
  ipcMain.on('desktop:live-event', (event, message) => {liveVoice?.receive(event, message);});
  ipcMain.on('desktop:voice-playback-event', (event, message) => {
    if (sisPlaybackHost?.receive(event, message)) publish();
  });
  try {
    conversations = new Conversations(dataPaths.conversations);
    // The cloud startup gate must not defer explicit local service management.
    // Constructing this owned host does not load weights or start a process.
    await initializeLocalLaya();
    await initializeInstalledSkills();
    if (!competitionMode) restoreModelConfig();
    const startup = await runtimeStartup.start();
    if (startup.state === 'configuration_required') {
      await initializeLocalAuthorizationControlPlane();
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
    {frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, hasShadow: false, roundedCorners: true, ...panelWindowAppearance(nativeTheme)});
  const panelMaterial=bindPanelMaterial(panel, nativeTheme);
  panel.on('close', event => { if (!app.isQuitting) { event.preventDefault(); void hidePanel().catch(reportPanelVoiceFailure); } });
  panel.on('hide', () => {void stopPanelVoice().catch(reportPanelVoiceFailure);});
  panel.webContents.once('did-finish-load', () => {void voiceStartupHost?.start().catch(reportPanelVoiceFailure);});
  powerMonitor.on('suspend', () => {void voiceStartupHost?.suspend().catch(reportPanelVoiceFailure);});
  powerMonitor.on('resume', () => {void voiceStartupHost?.resume().catch(reportPanelVoiceFailure);});
  createTray();
  if (liveVoice) registerLiveShortcut();
  console.info('PersonalAgent startup',JSON.stringify({runtime:runtimeStartup.snapshot().state,
    agentArtsConfigured:agentArtsConfig.snapshot().configured,liveConfigured:liveConfig.snapshot().configured,
    liveReady:Boolean(liveVoice),liveShortcutRegistered:liveShortcut.registered,
    sisConfigured:sisConfigHost.snapshot().configured,sisReady:Boolean(voiceInput)}));

  ipcMain.handle('desktop:action', async (...args) => {
    try { return {ok: true, value: await action(...args)}; }
    catch (error) {
      if(['developer.settings.read','developer.settings.configure','developer.settings.toggle'].includes(args[1]))
        return developerSettingsErrorResponse(error);
      if(typeof args[1]==='string'&&(args[1].startsWith('computer.control.')||args[1]==='computer.vision.configure')){
        const failure=computerControlFailure(error,args[1]);
        return {ok:false,error:failure.message,errorCode:failure.code,stage:failure.stage,
          diagnostic:{kind:args[1]==='computer.vision.configure'?'computer-vision':'computer-control',...failure}};
      }
      const failure=errorDisplay(error,'ipc');
      return {ok: false, error: failure.message, errorCode:failure.code};
    }
  });
  ipcMain.on('desktop:snapshot-ack',(event,token)=>{
    const sender=[orb,panel,admin,workspace].find(win=>win&&!win.isDestroyed()&&win.webContents===event.sender);
    if(sender&&event.senderFrame===sender.webContents.mainFrame)snapshotPublisher.ack(sender,token);
  });
  // First-run configuration must be reachable even when cloud credentials prevent Runtime startup.
  if (competitionMode && !agentArtsConfig.snapshot().configured) openAdmin('models');

  function reposition() {
    const bounds = orb.getContentBounds();
    const next = clampOrb(bounds, screen.getDisplayMatching(bounds).workArea);
    placeOrb(orb, next);
    if (panel.isVisible()) openPanel();
  }
  screen.on('display-removed', reposition);
  screen.on('display-metrics-changed', reposition);
  poll = setInterval(() => {
    if (orb.isDestroyed() || dragging === true) return;
    const point = screen.getCursorScreenPoint();
    const bounds = orb.getBounds();
    if (away > Date.now()) return;
    const near = Math.hypot(point.x - bounds.x - bounds.width / 2, point.y - bounds.y - bounds.height / 2) <= 90;
    const panelBoundsValue = panel.getBounds();
    const inside = panel.isVisible() && point.x >= panelBoundsValue.x && point.x <= panelBoundsValue.x + panelBoundsValue.width && point.y >= panelBoundsValue.y && point.y <= panelBoundsValue.y + panelBoundsValue.height;
    if ((near && desktopHost.settings.hover) || inside || pinned) { away = 0; if (near && desktopHost.settings.hover && !panel.isVisible()) openPanel(); }
    else if (panel.isVisible()) { if (!away) away = Date.now(); else if (Date.now() - away > 520) { void hidePanel().catch(reportPanelVoiceFailure); away = 0; } }
  }, 80);
  draftQuitPreflight=createDraftQuitPreflight({windows:()=>[panel,workspace],retry:()=>app.quit(),
    onFailure:error=>{app.isQuitting=false;runtimeError=error.message;publish();}});
  // Long-running sessions grow a renderer past what the user can keep using (#435). A reload is
  // guarded: editable/unknown surfaces remain open, and active work or voice prevents recycling.
  memoryWatchdog = createMemoryWatchdog({
    getMetrics: () => app.getAppMetrics(),
    resolveTarget: async pid => {
      const windows = [panel, admin, workspace, orb, ...[...subagentWindows.values()].map(record => record.window)];
      for (const win of windows) {
        if (!win || win.isDestroyed()) continue;
        try {
          if(win.webContents.getOSProcessId()!==pid)continue;
          // Editable surfaces have no atomic draft-flush/reload handshake. Only the stateless orb
          // can be recycled; all conversation and settings windows retain their in-memory input.
          if(win!==orb){
            console.warn('[memory] oversized renderer retained to protect unsaved input',{pid});return undefined;
          }
          return win.webContents;
        }catch{return undefined;}
      }
      return undefined;
    },
    isBusy: () => runtimeClosed || runtimeStartup.snapshot().state === 'starting'
      || submitting.size>0 || voiceConfigurationPending || panelHiding
      || (runtimeApplication?.activeTaskCount ?? 0) > 0 || liveVoice?.hasActive()===true
      || voiceInput?.hasActive()===true || wakeVoice?.hasActive()===true
      || microphoneCaptureHost?.snapshot().busy===true,
    onReload: info => {console.warn('[memory] reloaded an oversized renderer', {pid: info.pid, megabytes: Math.round(info.bytes / 1024 / 1024)});},
  });
  memoryWatchdog.start();
  app.on('before-quit', event => {
    if (runtimeStartup.snapshot().state === 'starting') {
      event.preventDefault(); reportQuitFailure('Runtime 正在连接，请稍后退出'); return;
    }
    if ((runtimeApplication?.activeTaskCount ?? 0) > 0 || submitting.size > 0) {
      event.preventDefault();
      app.isQuitting = false;
      reportQuitFailure('Runtime 仍有活动任务；请先等待完成或停止任务后再退出');
      return;
    }
    if(mailMonitorPreparation?.configurationPending()){
      event.preventDefault();reportQuitFailure('邮箱配置正在更新，请等待完成后再退出');return;
    }
    mailMonitorPreparation?.cancel();
    if(!draftQuitPreflight.allow()){event.preventDefault();return;}
    if((connectorChangeHost||connectorWatchHost)&&!connectorTriggersClosed) {
      event.preventDefault();
      connectorTriggersClosing??=Promise.resolve().then(()=>connectorWatchHost?.close()).then(()=>connectorChangeHost?.close())
        .then(()=>{connectorTriggersClosed=true;app.quit();})
        .catch(()=>{connectorTriggersClosing=undefined;reportQuitFailure('连接器变化判断尚未停止，未关闭原任务数据库');});
      return;
    }
    if(harnessEventsHost&&!harnessEventsClosed) {
      event.preventDefault();
      harnessExperienceLifetime.abort();
      harnessEventsClosing??=harnessEventsHost.close().then(()=>{harnessEventsClosed=true;app.quit();})
        .catch(()=>{harnessEventsClosing=undefined;reportQuitFailure('开发事件消费尚未停止，未关闭原任务数据库');});
      return;
    }
    if(remoteMcpHost && !remoteMcpClosed) {
      event.preventDefault();
      if(!remoteMcpClosing) {
        remoteMcpManagement.close();
        remoteMcpClosing=remoteMcpServices.dispose().then(()=>{remoteMcpClosed=true;app.quit();})
          .catch(()=>{remoteMcpClosing=undefined;reportQuitFailure('远程 MCP 关闭未确认，请先断开连接后再退出');});
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
        .catch(()=>{referenceClosing=undefined;reportQuitFailure('参考工具尚未停止，请稍后退出');});
      return;
    }
    proactiveHost?.stop();
    if(todoHost && !todoClosed) {
      event.preventDefault();
      todoClosing ??= todoHost.close().then(()=>{todoClosed=true;app.quit();})
        .catch(()=>{todoClosing=undefined;reportQuitFailure('提醒队列尚未结束，请稍后退出');});
      return;
    }
    if (notepadHost && !notepadClosed) {
      event.preventDefault();
      if (!notepadClosing) notepadClosing = notepadHost.close().then(() => {
        notepadClosed = true; app.quit();
      }).catch(() => {notepadClosing = undefined;reportQuitFailure('本机操作停止尚未确认，请稍后退出');});
      return;
    }
    if(windowsControlHost&&!windowsControlClosed){
      event.preventDefault();
      windowsControlClosing??=windowsControlHost.close().then(()=>{windowsControlClosed=true;app.quit();})
        .catch(()=>{windowsControlClosing=undefined;reportQuitFailure('电脑控制进程停止尚未确认');});
      return;
    }
    if(browserControlHost&&!browserControlClosed){
      event.preventDefault();
      browserControlClosing??=browserControlHost.close().then(()=>{browserControlClosed=true;app.quit();})
        .catch(()=>{browserControlClosing=undefined;reportQuitFailure('浏览器控制进程停止尚未确认');});
      return;
    }
    if (!localServicesStopped && (mailHost || localLaya)) {
      event.preventDefault();
      if (!localServicesStopping) {
        localServicesStopping = true;
        void (async () => {
          await mailAnalysisHost?.close();
          await mailConfig?.releaseSession();
          const result = await localLaya?.stop();
          if (result?.state === 'stop_unconfirmed') throw Error('本地模型退出尚未确认');
          localServicesStopped = true; app.quit();
        })().catch(() => {reportQuitFailure('本地分类服务退出尚未确认，请稍后再退出');})
          .finally(() => {localServicesStopping = false;});
      }
      return;
    }
    if (voiceStartupHost && !voiceStartupDisposed) {
      event.preventDefault();
      voiceStartupDisposal ??= voiceStartupHost.dispose();
      void voiceStartupDisposal.then(() => {if(!voiceStartupDisposed){voiceStartupDisposed=true;app.quit();}})
        .catch(() => {reportQuitFailure('启动语音资源释放未确认');});
      return;
    }
    if (liveVoice?.hasActive()) {
      event.preventDefault();
      void liveVoice.stop().then(result => {
        if (result.active) {reportQuitFailure(result.reason || 'Live 音频资源释放未确认'); return;}
        app.quit();
      }).catch(() => {reportQuitFailure('Live 音频资源释放未确认');});
      return;
    }
    if (voiceInput && !voiceDisposed) {
      event.preventDefault();
      if(voiceDisposalFailed){reportQuitFailure('语音资源释放未确认');return;}
      if (!voiceDisposal && !voiceDisposalFailed) {
        voiceDisposal = voiceInput.dispose().then(() => {
          voiceDisposed = true;
          app.quit();
        }).catch(error => {
          voiceDisposalFailed = true;
          reportQuitFailure('语音资源释放未确认');
        });
      }
      return;
    }
    if (microphoneCaptureHost?.snapshot().busy) {
      event.preventDefault();
      void microphoneCaptureHost.revoke().then(() => app.quit()).catch(error => {
        reportQuitFailure(error instanceof Error ? error.message : '麦克风释放未确认');
      });
      return;
    }
    if ((runtimeApplication?.activeTaskCount ?? 0) > 0) {
      event.preventDefault();
      app.isQuitting = false;
      reportQuitFailure('Runtime 仍有活动任务；请先等待完成或停止任务后再退出');
      return;
    }
    // A cross-process child HWND must exit while the parent UI thread can
    // still process messages, before native parent destruction begins.
    if(!panelMaterial.allowQuit(()=>app.quit())){event.preventDefault();return;}
    if(!draftQuitPreflight.commit()){event.preventDefault();draftQuitPreflight.allow();return;}
    globalShortcut.unregisterAll();
    try {
      p5DeviceNotificationHost?.dispose();
      notificationApplicationHost?.dispose();
      p5Cognition?.dispose();
      p5SystemObservationSource?.dispose();
      knowledgeWatchHost?.dispose();
      modelApiHost?.dispose();
      harnessContextHost?.dispose();
      privateConsumption?.close();
      wikiSourceMonitor?.close();
      installedSkillsHost?.close();
      coordinationWatchInputs.clear();
      privateMemory?.close();
      learningStore?.close();
      obsidianPairing?.close();
      knowledgeSourceConfig?.close();
      wikiImportHost?.close();
      proactiveHost?.close();
      goalCloudHost?.close();
      calendarMeetingHost?.close();
      void connectorConversationTools?.close();
      computerVisionHost?.close();
      computerVisionConfig?.dispose();
      f15ReviewViewer?.close();f15ReviewHost?.close();
      authorizationQuestionHost?.close();
      authorizationIntentHost?.close();
      mailMonitorPreparation?.close();
      nativeExecutionHost?.close();
      mailAnalysisHost?.close();
      competitionFactBridge?.close();
      if (runtimeApplication) runtimeApplication.close();
      else runtime?.close?.();
      runtimeClosed = true;
      memoryWatchdog?.stop();
      competitionCatalog?.close();
      productTools?.close();
      codingWorkspace?.close();
      developerSettings?.close();
      developerDeployment?.close();
      toolPresenceHost?.close();
      computerControlLease?.close();
      imageWorkflowCatalog?.close();
      systemObservationConversation?.close();
      publicReferenceConsent?.close();
      publicSkillSources.clear();
      feedsHost?.close();
      f09FeedGraphHost={tools:[],unavailable:'feeds_host_required'};
      workflowGraphComposition={tools:[],unavailable:['reset']};
      f02Workflow=undefined;
      void todoHost?.close();
    } catch (error) {
      event.preventDefault();
      app.isQuitting = false;
      reportQuitFailure(error instanceof Error ? error.message : 'Runtime 仍有活动任务，无法安全退出');
      return;
    }
    try { syntheticRepairHost?.close(); }
    catch { console.error('Synthetic repair host failed to close'); }
    microphonePermissionGate?.revoke();
    app.isQuitting = true;
    clearInterval(poll);
    stopOrbDrag();
    clearInterval(eventPoll);
    clearInterval(resourcePoll);
    clearImmediate(eventContinuation);
    snapshotPublisher.close();
    tray?.destroy();
    runtimeConnection?.dispose?.();
  });
  app.on('window-all-closed', event => event.preventDefault());
}).catch(error => { console.error(error); app.exit(1); });
