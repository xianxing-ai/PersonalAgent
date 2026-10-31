import {
  AgentArtsCloudAgentPort,
  CompetitionCoordinator,
  type AgentArtsAuthorizationProvider,
  type AgentArtsFailureDiagnostic,
  type AgentArtsFetch,
  type CoordinationRequest,
  type AgentArtsTransportState,
  type AgentArtsWebSocketFactory,
} from '@personal-agent/coordination';
import {ProtocolError} from '@personal-agent/contracts';
import {AgentArtsRealtimeModelGateway} from '@personal-agent/models';
import type {RealtimeSocketConstructor} from '@personal-agent/models';
import {createHash} from 'node:crypto';
import {createRuntimeOwnedWorkflowImageAdapter} from './owned-workflow-image-adapter.js';
import {createRuntimeWikiImportHost} from './wiki-import.js';
import type {RuntimeWikiImportOptions,RuntimeWikiImportHost} from './wiki-import.js';
import {createAgentArtsWikiModel} from './wiki-image-adapter.js';
import type {RuntimeConfiguredWorkflowOptions} from './configured-workflow-worker.js';
import {runtimeOwnedWorkflowWorkerConfigured,type RuntimeOwnedWorkflowWorkerOptions} from './owned-workflow-worker-capability.js';
import {
  createAgentArtsObservationHost,
  type AgentArtsObservationAuthorization,
  type AgentArtsObservationFetch,
  type AgentArtsObservationInput,
  type AgentArtsPlatformObservationRecord,
} from './agentarts-observation.js';
import {recordCompetitionCloudAcceptance, recordCompetitionCloudReceipt,
  recordCompetitionCloudRequestIdentity} from './coordination.js';
import {CompetitionCloudStatusReader, recordCompetitionCloudStatusBinding} from './competition-cloud-status.js';
import type {CompetitionCloudStatusScope, CompetitionCloudStatusObservation} from './competition-cloud-status.js';
import {
  runtimeF09WorkflowWorkerConfigured,
  type RuntimeF09WorkflowWorkerOptions,
} from './owned-workflow-f09-worker-capability.js';
import {
  createRuntimeApplication,
  type RuntimeApplication,
  type RuntimeApplicationOptions,
} from './runtime-application.js';

/** RuntimeApplication with the Competition platform observation consumer attached. */
export interface AgentArtsObservationApplication extends RuntimeApplication {
  readTaskPlatformObservation(input: AgentArtsObservationInput): Promise<AgentArtsPlatformObservationRecord>;
}

export interface AgentArtsRuntimeApplicationOptions
  extends Omit<RuntimeApplicationOptions, 'profile' | 'coordination' | 'text' | 'competitionRealtimeModel'> {
  gatewayUrl: string;
  runtimeName: string;
  /** Non-secret fixed deployment identity; credentials remain re-readable. */
  deploymentVersion?: string;
  /** Trusted synchronous check of the current host's fixed deployment. */
  assertDeploymentBinding?: () => void;
  invokeMode?: 'debug' | 'published';
  workflowGoalInput?: string;
  responseMode?: 'text' | 'tool-proposal-json';
  initialRequestMode?: 'goal' | 'goal-with-tools-json';
  continuationContext?: 'goal';
  authorizationProvider: AgentArtsAuthorizationProvider;
  fetchImpl?: AgentArtsFetch;
  transport?: 'https' | 'wss';
  websocketUrl?: string;
  allowHttpsFallback?: boolean;
  websocketAuthorizationProvider?: AgentArtsAuthorizationProvider;
  /** Host-only delivery recovery of an original accepted WSS request, without invoke replay. */
  recoverAcceptedStatus?: true;
  websocketFactory?: AgentArtsWebSocketFactory;
  /** Offline/native socket injection, independent of the task transport protocol. */
  realtimeSocket?: RealtimeSocketConstructor;
  onTransportState?: (state: AgentArtsTransportState) => void;
  onDiagnostic?: (receipt: AgentArtsFailureDiagnostic) => void;
  /** Trusted host egress check, synchronously re-run immediately before each HTTP send. */
  beforeCompetitionSend?: (request: CoordinationRequest) => void;
  /** Explicit host-only key source for an image configured with a receipt-key override. */
  readOwnedWorkflowReceiptSecret?: (signal:AbortSignal)=>Promise<string>;
  /**
   * Desktop-trusted F09 ports without image. Composition merges the fixed owned-workflow
   * AgentArts image when deploymentVersion and goal-with-tools-json are present.
   * A fully configured `f09WorkflowWorker` on RuntimeApplicationOptions still wins.
   */
  f09WorkflowWorkerPorts?: Omit<RuntimeF09WorkflowWorkerOptions,'image'>;
  /** Trusted per-graph ports share the fixed AgentArts image; absent deployment stays unavailable. */
  configuredWorkflowWorkerPorts?: readonly Omit<RuntimeConfiguredWorkflowOptions,'image'>[];
  f20WorkflowWorkerPorts?: Omit<RuntimeOwnedWorkflowWorkerOptions,'image'>;
  fetchHandlesHostAuthorization?:true;
  wikiImport?:RuntimeWikiImportOptions;
  /** Trusted observation read-back authorization; real reads need an AK/SK signer,
   * and an absent provider leaves observation explicitly unavailable. */
  observationAuthorization?: AgentArtsObservationAuthorization;
  /** Optional injected observation transport; defaults to globalThis.fetch. */
  observationFetchImpl?: AgentArtsObservationFetch;
  /** Platform application id (resource_id) enabling exact request-correlation.
   * A configured runtime name is never substituted; without it, correlation stays not_checked. */
  observationApplicationId?: string;
}

export type AgentArtsRuntimeApplication = AgentArtsObservationApplication & {
  wikiImport?:RuntimeWikiImportHost;
  /** Trusted host only; reads persisted identity and returns metadata, never cloud event bodies. */
  queryCompetitionCloudStatus(taskId:string,scope:CompetitionCloudStatusScope):Promise<CompetitionCloudStatusObservation>;
};

/**
 * Trusted Competition composition root. AgentArts provides unverified text;
 * RuntimeApplication remains the task-state and persistence authority.
 */
export function createAgentArtsRuntimeApplication(
  options: AgentArtsRuntimeApplicationOptions
): AgentArtsRuntimeApplication {
  const {
    gatewayUrl,
    runtimeName,
    deploymentVersion,
    assertDeploymentBinding,
    invokeMode,
    workflowGoalInput,
    responseMode,
    initialRequestMode,
    continuationContext,
    repairCandidateVersion,
    authorizationProvider,
    fetchImpl,
    transport,
    websocketUrl,
    allowHttpsFallback,
    websocketAuthorizationProvider,
    recoverAcceptedStatus,
    websocketFactory,
    realtimeSocket,
    onTransportState,
    onDiagnostic,
    beforeCompetitionSend,
    readOwnedWorkflowReceiptSecret,
    f09WorkflowWorkerPorts,
    configuredWorkflowWorkerPorts,
    f20WorkflowWorkerPorts,
    fetchHandlesHostAuthorization,
    wikiImport,
    observationAuthorization,
    observationFetchImpl,
    observationApplicationId,
    ...runtimeOptions
  } = options;
  if(recoverAcceptedStatus!==undefined&&(recoverAcceptedStatus!==true||transport!=='wss'))
    throw new ProtocolError('INVALID_ARGUMENT','Accepted-status recovery requires explicit WSS transport');
  if (deploymentVersion !== undefined && !/^[A-Za-z0-9_.-]{1,128}$/.test(deploymentVersion)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Invalid fixed AgentArts deployment version');
  }
  if (initialRequestMode === 'goal-with-tools-json'
    && (responseMode !== 'tool-proposal-json'
      || !runtimeOptions.competitionToolAvailability?.length
      || !runtimeOptions.competitionToolExports?.length)) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Competition tool catalog needs proposal mode and explicit local bindings');
  }
  if (initialRequestMode !== 'goal-with-tools-json'
    && runtimeOptions.competitionToolAvailability !== undefined) {
    throw new ProtocolError('INVALID_ARGUMENT', 'Competition tool catalog requires explicit initial request mode');
  }
  if(runtimeOptions.enableNewTaskToolContinuations && (responseMode!=='tool-proposal-json'
    || initialRequestMode!=='goal-with-tools-json')) {
    throw new ProtocolError('INVALID_ARGUMENT','New task continuations require the guarded Competition tool catalog');
  }
  let application: RuntimeApplication;
  const cloud = new AgentArtsCloudAgentPort(
    {
      gatewayUrl,
      runtimeName,
      ...(transport === undefined ? {} : {transport}),
      ...(websocketUrl === undefined ? {} : {websocketUrl}),
      ...(allowHttpsFallback === undefined ? {} : {allowHttpsFallback}),
      ...(invokeMode === undefined ? {} : {invokeMode}),
      ...(workflowGoalInput === undefined ? {} : {workflowGoalInput}),
      ...(responseMode === undefined ? {} : {responseMode}),
      ...(initialRequestMode === undefined ? {} : {initialRequestMode}),
      ...(continuationContext === undefined ? {} : {continuationContext}),
      ...(repairCandidateVersion === undefined ? {} : {repairCandidateVersion}),
    },
    authorizationProvider,
    fetchImpl,
    request => {
      application.assertCompetitionExportAllowed(request);
      return beforeCompetitionSend?.(request);
    },
    request => {
      if (!request.availableTools) throw new ProtocolError('UNAUTHORIZED', 'Initial Competition tool catalog is missing');
      return application.assertCompetitionToolCatalogAllowed({taskId: request.taskId,
        revision: request.revision, deadline: request.deadline, signal: request.signal,
        availableTools: request.availableTools,...(request.continuation?{continuation:true as const}:{})});
    },
    onDiagnostic,
    transport !== 'wss' && websocketAuthorizationProvider === undefined && websocketFactory === undefined
      && onTransportState === undefined ? undefined : {
        ...(websocketAuthorizationProvider === undefined ? {} : {authorizationProvider: websocketAuthorizationProvider}),
        ...(websocketFactory === undefined ? {} : {factory: websocketFactory}),
        ...(recoverAcceptedStatus===true?{recoverAcceptedStatus:true as const}:{}),
        ...(onTransportState === undefined ? {} : {onState: onTransportState}),
        onDispatch: (request, receipt) => {
          application.runtime.saveCheckpoint(request.taskId, 'competition-cloud-inflight', receipt);
          recordCompetitionCloudStatusBinding(application.runtime,request.taskId,application.coordinationConfigurationRef,receipt,request);
          application.runtime.saveCheckpoint(request.taskId, 'competition-cloud-received', null);
        },
        onAccepted: (request, receipt) => {
          recordCompetitionCloudAcceptance(application.runtime, request.taskId, receipt);
        },
        onTerminal: (request, receipt) => {
          recordCompetitionCloudReceipt(application.runtime, request.taskId, receipt);
        },
      },
    // Observation-only bookkeeping of the actual outgoing X-Request-Id. A recording
    // failure (e.g. a storage error) never changes the invocation outcome.
    (receipt, request) => {
      try {
        recordCompetitionCloudRequestIdentity(application.runtime, request.taskId, request.revision, receipt);
      } catch {
        // Without the durable identity a later observation read reports unknown_request.
      }
    },
    runtimeOptions.enableNewTaskToolContinuations ? taskId => application.usesGoalContinuation(taskId) ? 'goal' : undefined : undefined,
  );
  const ownedImage=initialRequestMode==='goal-with-tools-json'&&deploymentVersion!==undefined
    ?createRuntimeOwnedWorkflowImageAdapter({gatewayUrl,runtimeName,deploymentVersion,authorizationProvider,
      ...(f20WorkflowWorkerPorts?{assertWorkflowCurrent:(request:import('@personal-agent/agentarts').OwnedWorkflowAdvanceRequest)=>{
        if(request.workflowId==='F20')f20WorkflowWorkerPorts.assertCurrent({taskId:request.taskId,deadline:request.taskDeadline??request.deadline,signal:request.signal});}}:{}),
      ...(fetchHandlesHostAuthorization?{fetchHandlesHostAuthorization}:{}),
      ...(transport===undefined?{}:{transport}),...(websocketUrl===undefined?{}:{websocketUrl}),
      ...(allowHttpsFallback===undefined?{}:{allowHttpsFallback}),...(websocketAuthorizationProvider?{websocketAuthorizationProvider}:{}),
      ...(websocketFactory?{websocketFactory}:{}),...(fetchImpl?{fetchImpl}:{}),...(invokeMode?{invokeMode}:{}),
      ...(workflowGoalInput?{workflowGoalInput}:{}),...(assertDeploymentBinding?{assertDeploymentBinding}:{}),
      ...(onTransportState?{onTransportState}:{}),...(readOwnedWorkflowReceiptSecret?{readReceiptSecret:readOwnedWorkflowReceiptSecret}:{})}):undefined;
  const f09FromPorts=ownedImage&&f09WorkflowWorkerPorts
    ?{...f09WorkflowWorkerPorts,image:ownedImage} satisfies RuntimeF09WorkflowWorkerOptions:undefined;
  const f09WorkflowWorker=runtimeOptions.f09WorkflowWorker??(runtimeF09WorkflowWorkerConfigured(f09FromPorts)?f09FromPorts:undefined);
  const configuredWorkflowWorkers=[...(runtimeOptions.configuredWorkflowWorkers??[]),
    ...(ownedImage?(configuredWorkflowWorkerPorts??[]).map(ports=>({...ports,image:ownedImage})):[])];
  const wikiModel=wikiImport?createAgentArtsWikiModel({gatewayUrl,runtimeName,authorizationProvider,
    ...(deploymentVersion===undefined?{}:{deploymentVersion}),...(assertDeploymentBinding?{assertDeploymentBinding}:{}),
    ...(transport?{transport}:{}),...(websocketUrl?{websocketUrl}:{}),...(websocketFactory?{websocketFactory}:{}),
    ...(websocketAuthorizationProvider?{websocketAuthorizationProvider}:{}),...(fetchImpl?{fetchImpl}:{}),
    ...(fetchHandlesHostAuthorization?{fetchHandlesHostAuthorization}:{}),...(invokeMode?{invokeMode}:{}),
    ...(workflowGoalInput?{workflowGoalInput}:{})}):undefined;
  const wikiHost=wikiImport&&wikiModel?createRuntimeWikiImportHost({...wikiImport,model:wikiModel}):undefined;
  const f20FromPorts=ownedImage&&f20WorkflowWorkerPorts?{...f20WorkflowWorkerPorts,image:ownedImage}:undefined;
  application = createRuntimeApplication({
    ...runtimeOptions,
    ...(wikiHost?{tools:[...(runtimeOptions.tools??[]),...wikiHost.tools],
      hostOnlyTools:[...(runtimeOptions.hostOnlyTools??[]),...wikiHost.hostOnlyTools]}:{}),
    retainPriorToolResults:continuationContext==='goal',
    ...(repairCandidateVersion === undefined ? {} : {repairCandidateVersion}),
    profile: 'huawei_ict_agentarts',
    ...(runtimeOptions.codingRepair?{}:ownedImage?{codingRepair:{image:ownedImage}}:{}),
    ...(f09WorkflowWorker?{f09WorkflowWorker}:{}),
    ...(configuredWorkflowWorkers.length?{configuredWorkflowWorkers}:{}),
    ...(runtimeOptions.ownedWorkflowWorker?{}:runtimeOwnedWorkflowWorkerConfigured(f20FromPorts)?{ownedWorkflowWorker:f20FromPorts}:{}),
    ...(assertDeploymentBinding === undefined ? {} : {assertCoordinationBinding: assertDeploymentBinding}),
    // Cloud construction above already validated the same gateway/runtime target.
    // Missing WSS/credentials stays a connect-time error, never a direct API fallback.
    competitionRealtimeModel: new AgentArtsRealtimeModelGateway({
      ...(transport === 'wss' && websocketUrl !== undefined ? {websocketUrl} : {}),
      authorizationProvider,
      ...(websocketAuthorizationProvider === undefined ? {} : {websocketAuthorizationProvider}),
    }, realtimeSocket),
    coordinationBinding:createHash('sha256').update(JSON.stringify({gatewayUrl,runtimeName,
      ...(deploymentVersion === undefined ? {} : {deploymentVersion}),
      invokeMode:invokeMode??'published',workflowGoalInput:workflowGoalInput??null,
      responseMode:responseMode??'text',initialRequestMode:initialRequestMode??'goal',
      ...(continuationContext==='goal'?{continuationContext:'goal'}:{}),
      ...(transport === 'wss' ? {transport,websocketUrl,allowHttpsFallback:allowHttpsFallback??false} : {}),
      ...(repairCandidateVersion === undefined ? {} : {repairCandidateVersion})})).digest('hex'),
    coordination: new CompetitionCoordinator(cloud),
  });
  const statusReader=new CompetitionCloudStatusReader(application.runtime,application.coordinationConfigurationRef,cloud,transport==='wss');
  wikiHost?.bind(application);
  const closeRuntime = application.close.bind(application);
  application.close = () => { closeRuntime(); statusReader.close(); cloud.close(); ownedImage?.close(); wikiHost?.close(); wikiModel?.close(); };
  // The platform observation consumer lives only on the Competition composition; the
  // default (local) application keeps no observation surface at all.
  const observationHost = createAgentArtsObservationHost({
    runtime: application.runtime,
    runtimeName,
    ...(observationAuthorization === undefined ? {} : {authorization: observationAuthorization}),
    ...(observationFetchImpl === undefined ? {} : {fetchImpl: observationFetchImpl}),
    ...(observationApplicationId === undefined ? {} : {applicationId: observationApplicationId}),
  });
  return Object.assign(application, {
    ...(wikiHost?{wikiImport:wikiHost}:{}),
    queryCompetitionCloudStatus: statusReader.query.bind(statusReader),
    readTaskPlatformObservation: (input: AgentArtsObservationInput) => observationHost.read(input),
  }) as AgentArtsRuntimeApplication;
}
