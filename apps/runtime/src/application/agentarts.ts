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
import {createHash} from 'node:crypto';
import {recordCompetitionCloudAcceptance, recordCompetitionCloudReceipt} from './coordination.js';
import {CompetitionCloudStatusReader, recordCompetitionCloudStatusBinding} from './competition-cloud-status.js';
import type {CompetitionCloudStatusScope, CompetitionCloudStatusObservation} from './competition-cloud-status.js';
import {
  createRuntimeApplication,
  type RuntimeApplication,
  type RuntimeApplicationOptions,
} from './runtime-application.js';

export interface AgentArtsRuntimeApplicationOptions
  extends Omit<RuntimeApplicationOptions, 'profile' | 'coordination' | 'text'> {
  gatewayUrl: string;
  runtimeName: string;
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
  onTransportState?: (state: AgentArtsTransportState) => void;
  onDiagnostic?: (receipt: AgentArtsFailureDiagnostic) => void;
  /** Trusted host egress check, synchronously re-run immediately before each HTTP send. */
  beforeCompetitionSend?: (request: CoordinationRequest) => void;
}

export type AgentArtsRuntimeApplication = RuntimeApplication & {
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
    onTransportState,
    onDiagnostic,
    beforeCompetitionSend,
    ...runtimeOptions
  } = options;
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
  );
  application = createRuntimeApplication({
    ...runtimeOptions,
    ...(repairCandidateVersion === undefined ? {} : {repairCandidateVersion}),
    profile: 'huawei_ict_agentarts',
    coordinationBinding:createHash('sha256').update(JSON.stringify({gatewayUrl,runtimeName,
      invokeMode:invokeMode??'published',workflowGoalInput:workflowGoalInput??null,
      responseMode:responseMode??'text',initialRequestMode:initialRequestMode??'goal',
      ...(transport === 'wss' ? {transport,websocketUrl,allowHttpsFallback:allowHttpsFallback??false} : {}),
      ...(repairCandidateVersion === undefined ? {} : {repairCandidateVersion})})).digest('hex'),
    coordination: new CompetitionCoordinator(cloud),
  });
  const statusReader=new CompetitionCloudStatusReader(application.runtime,application.coordinationConfigurationRef,cloud,transport==='wss');
  const closeRuntime = application.close.bind(application);
  application.close = () => { closeRuntime(); statusReader.close(); cloud.close(); };
  return Object.assign(application,{queryCompetitionCloudStatus:statusReader.query.bind(statusReader)});
}
