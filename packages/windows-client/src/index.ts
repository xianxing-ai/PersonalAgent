import os from 'node:os';
import {performance} from 'node:perf_hooks';
import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool, ToolContext, ToolDescriptor, ToolHost} from '@personal-agent/contracts';

export const SYSTEM_OBSERVATION_TOOL_NAME = 'computer.system.observe';
export const SYSTEM_OBSERVATION_TOOL_VERSION = '1.0.0';
export const SYSTEM_OBSERVATION_SCOPE = 'computer:system:read';

export interface CpuTimes {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}

export interface SystemObservationProbe {
  cpuTimes(): readonly CpuTimes[];
  totalMemoryBytes(): number;
  freeMemoryBytes(): number;
  uptimeSeconds(): number;
}

export interface SystemObservation {
  source: 'node:os' | 'injected';
  capturedAt: string;
  sampledFrom: string;
  sampledUntil: string;
  actualSampleWindowMs: number;
  requestedSampleWindowMs: number;
  cpu: {
    logicalProcessorCount: number;
    utilizationPercent: number;
  };
  memory: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    utilizationPercent: number;
  };
  uptimeSeconds: number;
  unavailable: readonly ['process_breakdown', 'disk_io', 'thermal', 'network_activity'];
}

/** Supported fields describe the adapter, not a guarantee that this particular read succeeds. */
export const SYSTEM_OBSERVATION_SUPPORTED = Object.freeze(['cpu', 'memory', 'uptime'] as const);
export const SYSTEM_OBSERVATION_UNAVAILABLE = Object.freeze([
  'process_breakdown', 'disk_io', 'thermal', 'network_activity',
] as const);

export function describeSystemObservationCapabilities(): {
  toolName: typeof SYSTEM_OBSERVATION_TOOL_NAME;
  requiredScope: typeof SYSTEM_OBSERVATION_SCOPE;
  supported: typeof SYSTEM_OBSERVATION_SUPPORTED;
  unavailable: typeof SYSTEM_OBSERVATION_UNAVAILABLE;
} {
  return {
    toolName: SYSTEM_OBSERVATION_TOOL_NAME,
    requiredScope: SYSTEM_OBSERVATION_SCOPE,
    supported: SYSTEM_OBSERVATION_SUPPORTED,
    unavailable: SYSTEM_OBSERVATION_UNAVAILABLE,
  };
}

export interface SystemObservationToolOptions {
  probe?: SystemObservationProbe;
  now?: () => Date;
  sampleWindowMs?: number;
}

const inputSchema: ToolDescriptor['inputSchema'] = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
};

const outputSchema: ToolDescriptor['outputSchema'] = {
  type: 'object',
  required: ['source', 'capturedAt', 'requestedSampleWindowMs', 'cpu', 'memory', 'uptimeSeconds', 'unavailable'],
  additionalProperties: false,
  properties: {
    source: {enum: ['node:os', 'injected']},
    capturedAt: {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'},
    sampledFrom: {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'},
    sampledUntil: {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'},
    actualSampleWindowMs: {type: 'number', minimum: 0},
    requestedSampleWindowMs: {type: 'integer', minimum: 1, maximum: 5_000},
    cpu: {
      type: 'object',
      required: ['logicalProcessorCount', 'utilizationPercent'],
      additionalProperties: false,
      properties: {
        logicalProcessorCount: {type: 'integer', minimum: 1},
        utilizationPercent: {type: 'number', minimum: 0, maximum: 100},
      },
    },
    memory: {
      type: 'object',
      required: ['totalBytes', 'freeBytes', 'usedBytes', 'utilizationPercent'],
      additionalProperties: false,
      properties: {
        totalBytes: {type: 'integer', minimum: 1},
        freeBytes: {type: 'integer', minimum: 0},
        usedBytes: {type: 'integer', minimum: 0},
        utilizationPercent: {type: 'number', minimum: 0, maximum: 100},
      },
    },
    uptimeSeconds: {type: 'number', minimum: 0},
    unavailable: {
      type: 'array',
      minItems: 4,
      maxItems: 4,
      uniqueItems: true,
      items: {enum: ['process_breakdown', 'disk_io', 'thermal', 'network_activity']},
    },
  },
};

const defaultProbe: SystemObservationProbe = {
  cpuTimes: () => os.cpus().map(cpu => ({...cpu.times})),
  totalMemoryBytes: () => os.totalmem(),
  freeMemoryBytes: () => os.freemem(),
  uptimeSeconds: () => os.uptime(),
};

function observationError(): ProtocolError {
  return new ProtocolError('EXTERNAL_FAILURE', 'System observation is unavailable');
}

function safeNow(now: () => Date): Date {
  try {
    const value = now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw observationError();
    return value;
  } catch {
    throw observationError();
  }
}

function safeNumber(value: number, integer = false): number {
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) throw observationError();
  return value;
}

function cpuTotals(probe: SystemObservationProbe): {count: number; idle: number; total: number; counters: CpuTimes[]} {
  try {
    const samples = probe.cpuTimes();
    if (!Array.isArray(samples) || samples.length === 0) throw observationError();
    let idle = 0;
    let total = 0;
    const counters: CpuTimes[] = [];
    for (const sample of samples) {
      if (!sample || typeof sample !== 'object') throw observationError();
      const user = safeNumber(sample.user);
      const nice = safeNumber(sample.nice);
      const sys = safeNumber(sample.sys);
      const sampleIdle = safeNumber(sample.idle);
      const irq = safeNumber(sample.irq);
      // A probe may reuse and mutate its array and objects on the next read.
      counters.push({user, nice, sys, idle: sampleIdle, irq});
      idle += sampleIdle;
      total += user + nice + sys + sampleIdle + irq;
    }
    if (!Number.isSafeInteger(samples.length) || !Number.isFinite(idle) || !Number.isFinite(total)) throw observationError();
    return {count: samples.length, idle, total, counters};
  } catch {
    throw observationError();
  }
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function requireActive(context: ToolContext, now: () => Date): number {
  if (context.signal.aborted) throw new ProtocolError('CANCELLED', 'System observation was cancelled');
  const deadline = Date.parse(context.deadline);
  if (!Number.isFinite(deadline) || safeNow(now).getTime() >= deadline) {
    throw new ProtocolError('TIMEOUT', 'System observation deadline expired');
  }
  return deadline;
}

async function waitForSample(windowMs: number, context: ToolContext, now: () => Date): Promise<void> {
  const deadline = requireActive(context, now);
  const remaining = deadline - safeNow(now).getTime();
  const waitMs = Math.min(windowMs, remaining);
  const reachesDeadline = remaining <= windowMs;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (work: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      context.signal.removeEventListener('abort', onAbort);
      work();
    };
    const onAbort = (): void => finish(() => reject(new ProtocolError('CANCELLED', 'System observation was cancelled')));
    context.signal.addEventListener('abort', onAbort, {once: true});
    timer = setTimeout(() => finish(() => reachesDeadline
      ? reject(new ProtocolError('TIMEOUT', 'System observation deadline expired'))
      : resolve()), waitMs);
    if (context.signal.aborted) onAbort();
  });

  requireActive(context, now);
}

function readMemory(probe: SystemObservationProbe): SystemObservation['memory'] {
  try {
    const totalBytes = safeNumber(probe.totalMemoryBytes(), true);
    const freeBytes = safeNumber(probe.freeMemoryBytes(), true);
    if (totalBytes < 1 || freeBytes > totalBytes) throw observationError();
    const usedBytes = totalBytes - freeBytes;
    return {totalBytes, freeBytes, usedBytes, utilizationPercent: roundPercent(usedBytes / totalBytes * 100)};
  } catch {
    throw observationError();
  }
}

/**
 * Creates one read-only tool. It reports aggregate pressure signals only and never
 * reads host/user names, processes, paths, files, network addresses, or credentials.
 */
export function createSystemObservationTool(options: SystemObservationToolOptions = {}): RegisteredTool {
  const probe = options.probe ?? defaultProbe;
  const source: SystemObservation['source'] = options.probe === undefined ? 'node:os' : 'injected';
  const now = options.now ?? (() => new Date());
  const sampleWindowMs = options.sampleWindowMs ?? 250;
  if (!Number.isSafeInteger(sampleWindowMs) || sampleWindowMs < 1 || sampleWindowMs > 5_000) {
    throw new ProtocolError('INVALID_ARGUMENT', 'sampleWindowMs must be between 1 and 5000');
  }

  return Object.freeze({
    descriptor: Object.freeze({
      name: SYSTEM_OBSERVATION_TOOL_NAME,
      version: SYSTEM_OBSERVATION_TOOL_VERSION,
      inputSchema,
      outputSchema,
      sideEffect: 'read',
      requiredScopes: [SYSTEM_OBSERVATION_SCOPE],
      idempotencySupport: false,
      recoverySupport: false,
      requiresPresence: false,
    }),
    execute: async (_input: unknown, context: ToolContext): Promise<SystemObservation> => {
      requireActive(context, now);
      const sampledFrom = safeNow(now).toISOString();
      const monotonicFrom = performance.now();
      const before = cpuTotals(probe);
      await waitForSample(sampleWindowMs, context, now);
      if (context.signal.aborted) throw new ProtocolError('CANCELLED', 'System observation was cancelled');
      const after = cpuTotals(probe);
      const monotonicUntil = performance.now();
      const sampledUntil = safeNow(now).toISOString();
      if (before.count !== after.count) throw observationError();
      const categories = ['user', 'nice', 'sys', 'idle', 'irq'] as const;
      if (before.counters.some((sample, index) => categories.some(category =>
        after.counters[index]![category] < sample[category]))) throw observationError();
      const totalDelta = after.total - before.total;
      const idleDelta = after.idle - before.idle;
      if (!Number.isFinite(totalDelta) || totalDelta <= 0 || idleDelta < 0 || idleDelta > totalDelta) throw observationError();

      let uptimeSeconds: number;
      try { uptimeSeconds = safeNumber(probe.uptimeSeconds()); }
      catch { throw observationError(); }
      const observation: SystemObservation = {
        source,
        capturedAt: safeNow(now).toISOString(),
        sampledFrom,
        sampledUntil,
        actualSampleWindowMs: Math.max(0, Math.round((monotonicUntil - monotonicFrom) * 100) / 100),
        requestedSampleWindowMs: sampleWindowMs,
        cpu: {
          logicalProcessorCount: after.count,
          utilizationPercent: roundPercent((totalDelta - idleDelta) / totalDelta * 100),
        },
        memory: readMemory(probe),
        uptimeSeconds,
        unavailable: SYSTEM_OBSERVATION_UNAVAILABLE,
      };
      requireActive(context, now);
      return structuredClone(observation);
    },
  });
}

/** Registers this provider through the existing ToolHost lifecycle. */
export function register(host: ToolHost, options: SystemObservationToolOptions = {}): () => void {
  return host.register(createSystemObservationTool(options));
}
