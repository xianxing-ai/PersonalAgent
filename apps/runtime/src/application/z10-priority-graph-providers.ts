import type {RegisteredTool,ToolContext} from '@personal-agent/contracts';
import type {CompetitionToolExport} from './coordination.js';
import type {CompetitionToolAvailability} from './tool-catalog.js';
import type {RuntimeApplication} from './runtime-application.js';
import type {RuntimeConfiguredWorkflowOptions} from './configured-workflow-worker.js';
import type {RuntimeF09WorkflowWorkerOptions} from './owned-workflow-f09-worker-capability.js';
import type {RuntimeOwnedWorkflowWorkerOptions} from './owned-workflow-worker-capability.js';
import {F09_WORKFLOW_WORKER_TOOL,F09_WORKFLOW_WORKER_VERSION} from './owned-workflow-f09-worker-capability.js';
import {OWNED_WORKFLOW_WORKER_TOOL,OWNED_WORKFLOW_WORKER_VERSION} from './owned-workflow-worker-capability.js';
import {createRuntimeF13DiagnosticControlHost} from './workflow-f13-diagnostic-control-host.js';
import {createRuntimeF13SystemProbeHost} from './workflow-f13-probe-graph-host.js';
import {createRuntimeF14DeviceControlHost} from './workflow-f14-device-control-host.js';
import {createRuntimeF14ObservationHost} from './workflow-f14-observation-host.js';
import {createRuntimeF22ShadowObservationHost} from './workflow-f22-shadow-graph-host.js';
import {createF22TraceReplayWorkflowPorts,type F22TraceReplayOptions} from './workflow-f22-trace-replay.js';
import {createRuntimeF26DeploymentReadbackHost} from './workflow-f26-deployment-graph-host.js';
import {createF26WorkflowWorkerPorts,type F26WorkflowOptions} from './workflow-f26-worker.js';
import {createF28ModelCandidateWorkflowPorts,type F28ModelCandidateOptions} from './workflow-f28-model-candidates.js';
import {createRuntimeF28NativeConfigHost} from './workflow-f28-model-native-host.js';
import type {OwnedWorkflowHostScope} from './workflow-owned-host-scope.js';

export const Z10_PRIORITY_WORKFLOW_IDS = ['F09','F13','F14','F20','F22','F26','F28'] as const;
export type Z10PriorityWorkflowId = (typeof Z10_PRIORITY_WORKFLOW_IDS)[number];

type ProbeOptions = NonNullable<Parameters<typeof createRuntimeF13SystemProbeHost>[0]>;
type DiagnosticControlOptions = Parameters<typeof createRuntimeF13DiagnosticControlHost>[0];
type F14ObservationOptions = NonNullable<Parameters<typeof createRuntimeF14ObservationHost>[0]>;
type F14DeviceControlOptions = Parameters<typeof createRuntimeF14DeviceControlHost>[0];
type F22ShadowOptions = NonNullable<Parameters<typeof createRuntimeF22ShadowObservationHost>[0]>;
type F26ReadbackOptions = NonNullable<Parameters<typeof createRuntimeF26DeploymentReadbackHost>[0]>;
type F28NativeOptions = NonNullable<Parameters<typeof createRuntimeF28NativeConfigHost>[0]>;

export interface Z10PriorityGraphComposeContext {
  readonly runtimeModule?: unknown;
  readonly getApplication: () => RuntimeApplication;
  readonly assertCurrent?: (scope: OwnedWorkflowHostScope, context: ToolContext) => void;
  readonly now?: () => Date;
}

export interface Z10PriorityGraphComposeResult {
  readonly entry?: {readonly name: string; readonly version: string};
  readonly tools: RegisteredTool[];
  readonly competitionToolAvailability?: CompetitionToolAvailability[];
  readonly competitionToolExports?: CompetitionToolExport[];
  readonly ownedWorkflowWorker?: RuntimeOwnedWorkflowWorkerOptions;
  readonly f09WorkflowWorker?: RuntimeF09WorkflowWorkerOptions;
  readonly configuredWorkflowWorker?: RuntimeConfiguredWorkflowOptions;
  readonly unavailable?: readonly string[];
  readonly close?: () => void;
}

export interface Z10PriorityGraphProvider {
  readonly workflowId: Z10PriorityWorkflowId;
  available(): boolean;
  readonly unavailableReason: string;
  compose(context: Z10PriorityGraphComposeContext): Z10PriorityGraphComposeResult;
}

export interface Z10PriorityGraphProvidersOptions {
  readonly F09?: {
    readonly worker?: RuntimeF09WorkflowWorkerOptions;
    readonly tools?: readonly RegisteredTool[];
    readonly competitionToolAvailability?: readonly CompetitionToolAvailability[];
    readonly competitionToolExports?: readonly CompetitionToolExport[];
  };
  readonly F13?: {
    readonly systemProbe?: Omit<ProbeOptions, 'application' | 'getApplication' | 'now' | 'assertCurrent'> & {
      readonly assertCurrent?: ProbeOptions['assertCurrent'];
    };
    readonly diagnosticControl?: Omit<DiagnosticControlOptions, 'getApplication' | 'now' | 'assertCurrent'> & {
      readonly assertCurrent?: DiagnosticControlOptions['assertCurrent'];
    };
    readonly configuredWorker?: RuntimeConfiguredWorkflowOptions;
    readonly extraTools?: readonly RegisteredTool[];
    readonly competitionToolAvailability?: readonly CompetitionToolAvailability[];
    readonly competitionToolExports?: readonly CompetitionToolExport[];
  };
  readonly F14?: {
    readonly observation?: Omit<F14ObservationOptions, 'application' | 'now' | 'assertCurrent'> & {
      readonly assertCurrent?: F14ObservationOptions['assertCurrent'];
    };
    readonly deviceControl?: Omit<F14DeviceControlOptions, 'getApplication' | 'now' | 'assertCurrent'> & {
      readonly assertCurrent?: F14DeviceControlOptions['assertCurrent'];
    };
    readonly configuredWorker?: RuntimeConfiguredWorkflowOptions;
    readonly extraTools?: readonly RegisteredTool[];
    readonly competitionToolAvailability?: readonly CompetitionToolAvailability[];
    readonly competitionToolExports?: readonly CompetitionToolExport[];
  };
  readonly F20?: {
    readonly worker?: RuntimeOwnedWorkflowWorkerOptions;
    readonly tools?: readonly RegisteredTool[];
    readonly competitionToolAvailability?: readonly CompetitionToolAvailability[];
    readonly competitionToolExports?: readonly CompetitionToolExport[];
  };
  readonly F22?: {
    readonly shadowObservation?: Omit<F22ShadowOptions, 'application' | 'now' | 'assertCurrent'> & {
      readonly assertCurrent?: F22ShadowOptions['assertCurrent'];
    };
    readonly traceReplay?: Omit<F22TraceReplayOptions, 'application'>;
    readonly image?: RuntimeConfiguredWorkflowOptions['image'];
    readonly configuredWorker?: RuntimeConfiguredWorkflowOptions;
    readonly extraTools?: readonly RegisteredTool[];
    readonly competitionToolAvailability?: readonly CompetitionToolAvailability[];
    readonly competitionToolExports?: readonly CompetitionToolExport[];
  };
  readonly F26?: {
    readonly deploymentReadback?: Omit<F26ReadbackOptions, 'application' | 'now' | 'assertCurrent'> & {
      readonly assertCurrent?: F26ReadbackOptions['assertCurrent'];
    };
    readonly workerPorts?: Omit<F26WorkflowOptions, 'getApplication'>;
    readonly image?: RuntimeConfiguredWorkflowOptions['image'];
    readonly configuredWorker?: RuntimeConfiguredWorkflowOptions;
    readonly extraTools?: readonly RegisteredTool[];
    readonly competitionToolAvailability?: readonly CompetitionToolAvailability[];
    readonly competitionToolExports?: readonly CompetitionToolExport[];
  };
  readonly F28?: {
    readonly nativeConfig?: Omit<F28NativeOptions, 'application' | 'now' | 'assertCurrent'> & {
      readonly assertCurrent?: F28NativeOptions['assertCurrent'];
    };
    readonly modelCandidates?: Omit<F28ModelCandidateOptions, 'application' | 'getApplication'>;
    readonly image?: RuntimeConfiguredWorkflowOptions['image'];
    readonly configuredWorker?: RuntimeConfiguredWorkflowOptions;
    readonly extraTools?: readonly RegisteredTool[];
    readonly competitionToolAvailability?: readonly CompetitionToolAvailability[];
    readonly competitionToolExports?: readonly CompetitionToolExport[];
  };
}

function failClosedResult(reason: string): Z10PriorityGraphComposeResult {
  return {tools: [], unavailable: [reason]};
}

function hasObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function configuredWorkerFromPorts(
  configuredWorker: RuntimeConfiguredWorkflowOptions | undefined,
  ports: readonly Omit<RuntimeConfiguredWorkflowOptions, 'image'>[],
  image: RuntimeConfiguredWorkflowOptions['image'] | undefined,
): RuntimeConfiguredWorkflowOptions | undefined {
  if (configuredWorker) return configuredWorker;
  if (ports.length && image) return {...ports[0]!, image};
  return undefined;
}

function makeFailClosedProvider(
  workflowId: Z10PriorityWorkflowId,
  unavailableReason: string,
  hasConfig: () => boolean,
  composeImpl: (ctx: Z10PriorityGraphComposeContext) => Z10PriorityGraphComposeResult,
): Z10PriorityGraphProvider {
  return {
    workflowId,
    available: () => hasConfig(),
    unavailableReason,
    compose(context) {
      if (!hasConfig() || typeof context?.getApplication !== 'function') {
        return failClosedResult(unavailableReason);
      }
      return composeImpl(context);
    },
  };
}

/** PR-#681-compatible graph providers for Z-10 priority workflows (fail-closed without trusted ports). */
export function createZ10PriorityGraphProviders(
  options: Z10PriorityGraphProvidersOptions = {},
): Z10PriorityGraphProvider[] {
  const defaultAssertCurrent: (scope: OwnedWorkflowHostScope, context: ToolContext) => void = () => {};
  const resolveNow = (context: Z10PriorityGraphComposeContext) => context.now ?? (() => new Date());

  const f09Provider = makeFailClosedProvider(
    'F09',
    'f09_feed_subscription_trusted_ports_unavailable',
    () => hasObject(options.F09?.worker) && hasObject(options.F09?.worker?.image),
    () => ({
      entry: {name: F09_WORKFLOW_WORKER_TOOL, version: F09_WORKFLOW_WORKER_VERSION},
      tools: [...(options.F09?.tools ?? [])],
      ...(options.F09?.competitionToolAvailability
        ? {competitionToolAvailability: [...options.F09.competitionToolAvailability]} : {}),
      ...(options.F09?.competitionToolExports
        ? {competitionToolExports: [...options.F09.competitionToolExports]} : {}),
      f09WorkflowWorker: options.F09!.worker!,
    }),
  );

  const f13Provider = makeFailClosedProvider(
    'F13',
    'f13_system_probe_trusted_ports_unavailable',
    () => hasObject(options.F13?.systemProbe) || hasObject(options.F13?.diagnosticControl) || hasObject(options.F13?.configuredWorker),
    context => {
      const now = resolveNow(context);
      const assertCurrent = options.F13?.systemProbe?.assertCurrent ?? context.assertCurrent;
      const unavailable: string[] = [];
      const tools: RegisteredTool[] = [];
      if (options.F13?.systemProbe) {
        if (!assertCurrent) return failClosedResult('f13_system_probe_assert_current_unavailable');
        const probe = createRuntimeF13SystemProbeHost({
          ...options.F13.systemProbe,
          getApplication: context.getApplication,
          assertCurrent,
          now,
        });
        if (probe.unavailable) unavailable.push(probe.unavailable);
        tools.push(...probe.tools);
      }
      if (options.F13?.diagnosticControl) {
        const controlAssert = options.F13.diagnosticControl.assertCurrent ?? context.assertCurrent ?? defaultAssertCurrent;
        const control = createRuntimeF13DiagnosticControlHost({
          ...options.F13.diagnosticControl,
          getApplication: context.getApplication,
          assertCurrent: controlAssert,
          now,
        });
        tools.push(...control.tools);
      }
      tools.push(...(options.F13?.extraTools ?? []));
      if (unavailable.length || !tools.length && !options.F13?.configuredWorker) {
        return {tools, unavailable: unavailable.length ? unavailable : ['f13_system_probe_trusted_ports_unavailable']};
      }
      const worker = options.F13?.configuredWorker;
      return {
        ...(worker ? {entry: {name: worker.toolName, version: worker.toolVersion}, configuredWorkflowWorker: worker} : {}),
        tools,
        ...(options.F13?.competitionToolAvailability
          ? {competitionToolAvailability: [...options.F13.competitionToolAvailability]} : {}),
        ...(options.F13?.competitionToolExports
          ? {competitionToolExports: [...options.F13.competitionToolExports]} : {}),
      };
    },
  );

  const f14Provider = makeFailClosedProvider(
    'F14',
    'f14_observation_trusted_ports_unavailable',
    () => hasObject(options.F14?.observation) || hasObject(options.F14?.deviceControl) || hasObject(options.F14?.configuredWorker),
    context => {
      const now = resolveNow(context);
      const application = context.getApplication();
      const unavailable: string[] = [];
      const tools: RegisteredTool[] = [];
      if (options.F14?.observation) {
        const obsAssert = options.F14.observation.assertCurrent ?? context.assertCurrent;
        if (!obsAssert) return failClosedResult('f14_observation_assert_current_unavailable');
        const observed = createRuntimeF14ObservationHost({
          ...options.F14.observation,
          application,
          assertCurrent: obsAssert,
          now,
        });
        if (observed.unavailable) unavailable.push(observed.unavailable);
        tools.push(...observed.tools);
      }
      if (options.F14?.deviceControl) {
        const ctrlAssert = options.F14.deviceControl.assertCurrent ?? context.assertCurrent ?? defaultAssertCurrent;
        const controlled = createRuntimeF14DeviceControlHost({
          ...options.F14.deviceControl,
          getApplication: context.getApplication,
          assertCurrent: ctrlAssert,
          now,
        });
        tools.push(...controlled.tools);
      }
      tools.push(...(options.F14?.extraTools ?? []));
      if (unavailable.length || !tools.length && !options.F14?.configuredWorker) {
        return {tools, unavailable: unavailable.length ? unavailable : ['f14_observation_trusted_ports_unavailable']};
      }
      const worker = options.F14?.configuredWorker;
      return {
        ...(worker ? {entry: {name: worker.toolName, version: worker.toolVersion}, configuredWorkflowWorker: worker} : {}),
        tools,
        ...(options.F14?.competitionToolAvailability
          ? {competitionToolAvailability: [...options.F14.competitionToolAvailability]} : {}),
        ...(options.F14?.competitionToolExports
          ? {competitionToolExports: [...options.F14.competitionToolExports]} : {}),
      };
    },
  );

  const f20Provider = makeFailClosedProvider(
    'F20',
    'f20_owned_workflow_trusted_ports_unavailable',
    () => hasObject(options.F20?.worker) && hasObject(options.F20?.worker?.image),
    () => ({
      entry: {name: OWNED_WORKFLOW_WORKER_TOOL, version: OWNED_WORKFLOW_WORKER_VERSION},
      tools: [...(options.F20?.tools ?? [])],
      ...(options.F20?.competitionToolAvailability
        ? {competitionToolAvailability: [...options.F20.competitionToolAvailability]} : {}),
      ...(options.F20?.competitionToolExports
        ? {competitionToolExports: [...options.F20.competitionToolExports]} : {}),
      ownedWorkflowWorker: options.F20!.worker!,
    }),
  );

  const f22Provider = makeFailClosedProvider(
    'F22',
    'f22_shadow_observation_trusted_ports_unavailable',
    () => hasObject(options.F22?.shadowObservation) || hasObject(options.F22?.traceReplay) || hasObject(options.F22?.configuredWorker),
    context => {
      const now = resolveNow(context);
      const application = context.getApplication();
      const unavailable: string[] = [];
      const tools: RegisteredTool[] = [];
      let replayPorts: readonly Omit<RuntimeConfiguredWorkflowOptions, 'image'>[] = [];
      if (options.F22?.shadowObservation) {
        const shadowAssert = options.F22.shadowObservation.assertCurrent ?? context.assertCurrent;
        if (!shadowAssert) return failClosedResult('f22_shadow_assert_current_unavailable');
        const shadow = createRuntimeF22ShadowObservationHost({
          ...options.F22.shadowObservation,
          application,
          assertCurrent: shadowAssert,
          now,
        });
        if (shadow.unavailable) unavailable.push(shadow.unavailable);
        tools.push(...shadow.tools);
      }
      if (options.F22?.traceReplay) {
        const replay = createF22TraceReplayWorkflowPorts({...options.F22.traceReplay, application});
        if (replay.unavailable) unavailable.push(replay.unavailable);
        tools.push(...replay.tools);
        replayPorts = replay.configuredWorkflowWorkerPorts;
      }
      tools.push(...(options.F22?.extraTools ?? []));
      const worker = configuredWorkerFromPorts(options.F22?.configuredWorker, replayPorts, options.F22?.image);
      if (unavailable.length || !tools.length && !worker) {
        return {tools, unavailable: unavailable.length ? unavailable : ['f22_shadow_observation_trusted_ports_unavailable']};
      }
      return {
        ...(worker ? {entry: {name: worker.toolName, version: worker.toolVersion}, configuredWorkflowWorker: worker} : {}),
        tools,
        ...(options.F22?.competitionToolAvailability
          ? {competitionToolAvailability: [...options.F22.competitionToolAvailability]} : {}),
        ...(options.F22?.competitionToolExports
          ? {competitionToolExports: [...options.F22.competitionToolExports]} : {}),
      };
    },
  );

  const f26Provider = makeFailClosedProvider(
    'F26',
    'f26_deployment_readback_trusted_ports_unavailable',
    () => hasObject(options.F26?.deploymentReadback) || hasObject(options.F26?.workerPorts) || hasObject(options.F26?.configuredWorker),
    context => {
      const now = resolveNow(context);
      const application = context.getApplication();
      const unavailable: string[] = [];
      const tools: RegisteredTool[] = [];
      let workerPorts: readonly Omit<RuntimeConfiguredWorkflowOptions, 'image'>[] = [];
      if (options.F26?.deploymentReadback) {
        const readbackAssert = options.F26.deploymentReadback.assertCurrent ?? context.assertCurrent;
        if (!readbackAssert) return failClosedResult('f26_deployment_assert_current_unavailable');
        const readback = createRuntimeF26DeploymentReadbackHost({
          ...options.F26.deploymentReadback,
          application,
          assertCurrent: readbackAssert,
          now,
        });
        if (readback.unavailable) unavailable.push(readback.unavailable);
        tools.push(...readback.tools);
      }
      if (options.F26?.workerPorts) {
        const f26 = createF26WorkflowWorkerPorts({...options.F26.workerPorts, getApplication: context.getApplication});
        if (f26.unavailable) unavailable.push(f26.unavailable);
        tools.push(...f26.tools);
        workerPorts = f26.configuredWorkflowWorkerPorts;
      }
      tools.push(...(options.F26?.extraTools ?? []));
      const worker = configuredWorkerFromPorts(options.F26?.configuredWorker, workerPorts, options.F26?.image);
      if (unavailable.length || !tools.length && !worker) {
        return {tools, unavailable: unavailable.length ? unavailable : ['f26_deployment_readback_trusted_ports_unavailable']};
      }
      return {
        ...(worker ? {entry: {name: worker.toolName, version: worker.toolVersion}, configuredWorkflowWorker: worker} : {}),
        tools,
        ...(options.F26?.competitionToolAvailability
          ? {competitionToolAvailability: [...options.F26.competitionToolAvailability]} : {}),
        ...(options.F26?.competitionToolExports
          ? {competitionToolExports: [...options.F26.competitionToolExports]} : {}),
      };
    },
  );

  const f28Provider = makeFailClosedProvider(
    'F28',
    'f28_native_config_trusted_ports_unavailable',
    () => hasObject(options.F28?.nativeConfig) || hasObject(options.F28?.modelCandidates) || hasObject(options.F28?.configuredWorker),
    context => {
      const now = resolveNow(context);
      const application = context.getApplication();
      const unavailable: string[] = [];
      const tools: RegisteredTool[] = [];
      let candidatePorts: readonly Omit<RuntimeConfiguredWorkflowOptions, 'image'>[] = [];
      if (options.F28?.nativeConfig) {
        const nativeAssert = options.F28.nativeConfig.assertCurrent ?? context.assertCurrent;
        if (!nativeAssert) return failClosedResult('f28_native_assert_current_unavailable');
        const nativeHost = createRuntimeF28NativeConfigHost({
          ...options.F28.nativeConfig,
          application,
          assertCurrent: nativeAssert,
          now,
        });
        if (nativeHost.unavailable) unavailable.push(nativeHost.unavailable);
        tools.push(...nativeHost.tools);
      }
      if (options.F28?.modelCandidates) {
        const f28 = createF28ModelCandidateWorkflowPorts({
          ...options.F28.modelCandidates,
          application,
          getApplication: context.getApplication,
        });
        if (f28.unavailable) unavailable.push(f28.unavailable);
        tools.push(...f28.tools);
        candidatePorts = f28.configuredWorkflowWorkerPorts;
      }
      tools.push(...(options.F28?.extraTools ?? []));
      const worker = configuredWorkerFromPorts(options.F28?.configuredWorker, candidatePorts, options.F28?.image);
      if (unavailable.length || !tools.length && !worker) {
        return {tools, unavailable: unavailable.length ? unavailable : ['f28_native_config_trusted_ports_unavailable']};
      }
      return {
        ...(worker ? {entry: {name: worker.toolName, version: worker.toolVersion}, configuredWorkflowWorker: worker} : {}),
        tools,
        ...(options.F28?.competitionToolAvailability
          ? {competitionToolAvailability: [...options.F28.competitionToolAvailability]} : {}),
        ...(options.F28?.competitionToolExports
          ? {competitionToolExports: [...options.F28.competitionToolExports]} : {}),
      };
    },
  );

  return [f09Provider, f13Provider, f14Provider, f20Provider, f22Provider, f26Provider, f28Provider];
}
