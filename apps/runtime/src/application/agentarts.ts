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
import {recordCompetitionCloudAcceptance, recordCompetitionCloudReceipt} from './coordination.js';
import {
  createRuntimeApplication,
  type RuntimeApplication,
  type RuntimeApplicationOptions,
} from './runtime-application.js';

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
}

/**
 * Trusted Competition composition root. AgentArts provides unverified text;
 * RuntimeApplication remains the task-state and persistence authority.
 */
export function createAgentArtsRuntimeApplication(
  options: AgentArtsRuntimeApplicationOptions
): RuntimeApplication {
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
          application.runtime.saveCheckpoint(request.taskId, 'competition-cloud-received', null);
        },
        onAccepted: (request, receipt) => {
          recordCompetitionCloudAcceptance(application.runtime, request.taskId, receipt);
        },
        onTerminal: (request, receipt) => {
          recordCompetitionCloudReceipt(application.runtime, request.taskId, receipt);
        },
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
  const closeRuntime = application.close.bind(application);
  application.close = () => { closeRuntime(); cloud.close(); };
  return application;
}
