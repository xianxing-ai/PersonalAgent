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
  authorizationProvider: AgentArtsAuthorizationProvider;
  fetchImpl?: AgentArtsFetch;
  transport?: 'https' | 'wss';
  websocketUrl?: string;
  allowHttpsFallback?: boolean;
  websocketAuthorizationProvider?: AgentArtsAuthorizationProvider;
  websocketFactory?: AgentArtsWebSocketFactory;
  /** Offline/native socket injection, independent of the task transport protocol. */
  realtimeSocket?: RealtimeSocketConstructor;
  onTransportState?: (state: AgentArtsTransportState) => void;
  onDiagnostic?: (receipt: AgentArtsFailureDiagnostic) => void;
  /** Trusted host egress check, synchronously re-run immediately before each HTTP send. */
  beforeCompetitionSend?: (request: CoordinationRequest) => void;
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
    repairCandidateVersion,
    authorizationProvider,
    fetchImpl,
    transport,
    websocketUrl,
    allowHttpsFallback,
    websocketAuthorizationProvider,
    websocketFactory,
    realtimeSocket,
    onTransportState,
    onDiagnostic,
    beforeCompetitionSend,
    observationAuthorization,
    observationFetchImpl,
    observationApplicationId,
    ...runtimeOptions
  } = options;
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
        availableTools: request.availableTools});
    },
    onDiagnostic,
    transport !== 'wss' && websocketAuthorizationProvider === undefined && websocketFactory === undefined
      && onTransportState === undefined ? undefined : {
        ...(websocketAuthorizationProvider === undefined ? {} : {authorizationProvider: websocketAuthorizationProvider}),
        ...(websocketFactory === undefined ? {} : {factory: websocketFactory}),
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
  );
  application = createRuntimeApplication({
    ...runtimeOptions,
    ...(repairCandidateVersion === undefined ? {} : {repairCandidateVersion}),
    profile: 'huawei_ict_agentarts',
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
      ...(transport === 'wss' ? {transport,websocketUrl,allowHttpsFallback:allowHttpsFallback??false} : {}),
      ...(repairCandidateVersion === undefined ? {} : {repairCandidateVersion})})).digest('hex'),
    coordination: new CompetitionCoordinator(cloud),
  });
  const statusReader=new CompetitionCloudStatusReader(application.runtime,application.coordinationConfigurationRef,cloud,transport==='wss');
  const closeRuntime = application.close.bind(application);
  application.close = () => { closeRuntime(); statusReader.close(); cloud.close(); };
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
    queryCompetitionCloudStatus: statusReader.query.bind(statusReader),
    readTaskPlatformObservation: (input: AgentArtsObservationInput) => observationHost.read(input),
  }) as AgentArtsRuntimeApplication;
}
