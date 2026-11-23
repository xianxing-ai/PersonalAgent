/**
 * One operator brake for autonomous work.
 * It records the pause and asks the host to reuse the existing checkpoint,
 * abort and resume ports. It does not keep a second task store.
 *
 * Optional extensions are the hooks for work that is not on main yet:
 * PR #630 risk autonomy, PR #631 proactive source triggers, PR #633 repair retries.
 * Absent extensions are skipped. This module does not import those packages.
 */

export const OPERATOR_BRAKE_RECORD_VERSION = 1;

export type OperatorRunKind = 'task' | 'workflow' | 'tool';

export interface OperatorRun {
  id: string;
  kind: OperatorRunKind;
  /** Cursor already stored by the existing loop or workflow checkpoint. */
  cursor?: unknown;
}

export interface OperatorBrakeMarker {
  version: 1;
  runId: string;
  kind: OperatorRunKind;
  pausedAt: string;
  cursor?: unknown;
}

export interface OperatorBrakeRecord {
  version: 1;
  paused: boolean;
  pausedAt?: string;
  holds: OperatorBrakeMarker[];
}

export interface OperatorBrakeStore {
  load(): unknown;
  save(record: OperatorBrakeRecord): void;
}

export interface OperatorBrakeExtension {
  hold(): void;
  release(): void;
}

/** Adapters for unmerged PRs. Each one is optional and must not be required to pause. */
export interface OperatorBrakeExtensions {
  /** #630: stop or restore the risk-autonomy auto-run switch. */
  riskAutonomy?: OperatorBrakeExtension;
  /** #631: hold or release proactive source triggers. */
  sourceTriggers?: OperatorBrakeExtension;
  /** #633: hold or release failure-repair retries. */
  repair?: OperatorBrakeExtension;
}

export interface OperatorBrakePorts {
  now(): string;
  store: OperatorBrakeStore;
  listActive(): readonly OperatorRun[];
  /** Write the existing checkpoint, then stop the run. May be async. */
  checkpoint(run: OperatorRun, marker: OperatorBrakeMarker): void | Promise<void>;
  abort(run: OperatorRun): void | Promise<void>;
  resume(run: OperatorRun, marker: OperatorBrakeMarker): void | Promise<void>;
  /** Scheduler and proactive pumps. */
  holdTriggers(): void;
  releaseTriggers(): void;
  extensions?: OperatorBrakeExtensions;
}

export interface OperatorBrake {
  snapshot(): OperatorBrakeRecord;
  isPaused(): boolean;
  /** New autonomous, scheduled, cloud or tool work. */
  admit(kind: OperatorRunKind | 'schedule'): {accepted: true} | {accepted: false; reason: 'operator_paused'};
  engage(): Promise<OperatorBrakeRecord>;
  release(): Promise<OperatorBrakeRecord>;
}

function copy<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function markerFrom(run: OperatorRun, pausedAt: string): OperatorBrakeMarker {
  return {
    version: 1,
    runId: run.id,
    kind: run.kind,
    pausedAt,
    ...(run.cursor === undefined ? {} : {cursor: copy(run.cursor)}),
  };
}

function readRecord(value: unknown): OperatorBrakeRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {version: 1, paused: false, holds: []};
  const record = value as Partial<OperatorBrakeRecord>;
  const holds = Array.isArray(record.holds) ? record.holds.filter(isMarker) : [];
  return {
    version: 1,
    paused: record.paused === true,
    ...(typeof record.pausedAt === 'string' ? {pausedAt: record.pausedAt} : {}),
    holds,
  };
}

function isMarker(value: unknown): value is OperatorBrakeMarker {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const marker = value as Partial<OperatorBrakeMarker>;
  return marker.version === 1 && typeof marker.runId === 'string' && marker.runId.length > 0
    && (marker.kind === 'task' || marker.kind === 'workflow' || marker.kind === 'tool')
    && typeof marker.pausedAt === 'string';
}

function applyExtensions(extensions: OperatorBrakeExtensions | undefined, method: 'hold' | 'release'): void {
  extensions?.riskAutonomy?.[method]();
  extensions?.sourceTriggers?.[method]();
  extensions?.repair?.[method]();
}

export function createOperatorBrake(ports: OperatorBrakePorts): OperatorBrake {
  if (typeof ports?.now !== 'function' || typeof ports.store?.load !== 'function' || typeof ports.store?.save !== 'function'
    || typeof ports.listActive !== 'function' || typeof ports.checkpoint !== 'function'
    || typeof ports.abort !== 'function' || typeof ports.resume !== 'function'
    || typeof ports.holdTriggers !== 'function' || typeof ports.releaseTriggers !== 'function') {
    throw new Error('Operator brake requires the existing checkpoint, abort and resume ports');
  }
  let record = readRecord(ports.store.load());
  if (record.paused) {
    ports.holdTriggers();
    applyExtensions(ports.extensions, 'hold');
  }

  const currentRecord = (): OperatorBrakeRecord => {
    try { record = readRecord(ports.store.load()); } catch {}
    return record;
  };

  const persist = (next: OperatorBrakeRecord): void => {
    ports.store.save(next);
    record = readRecord(ports.store.load());
  };

  return {
    snapshot: () => copy(currentRecord()),
    isPaused: () => currentRecord().paused,
    admit(kind) {
      if (kind !== 'task' && kind !== 'workflow' && kind !== 'tool' && kind !== 'schedule') {
        throw new Error('Unknown operator brake admission');
      }
      return currentRecord().paused ? {accepted: false, reason: 'operator_paused'} : {accepted: true};
    },
    async engage() {
      if (currentRecord().paused) return copy(record);
      const pausedAt = ports.now();
      if (typeof pausedAt !== 'string' || !Number.isFinite(Date.parse(pausedAt))) throw new Error('Operator brake clock is invalid');
      // The flag is durable before any abort, so a crash still stays paused.
      persist({version: 1, paused: true, pausedAt, holds: []});
      ports.holdTriggers();
      applyExtensions(ports.extensions, 'hold');
      const holds: OperatorBrakeMarker[] = [];
      for (const run of ports.listActive()) {
        if (!run || typeof run.id !== 'string' || !run.id) continue;
        const marker = markerFrom(run, pausedAt);
        await ports.checkpoint(run, marker);
        await ports.abort(run);
        holds.push(marker);
      }
      persist({version: 1, paused: true, pausedAt, holds});
      return copy(record);
    },
    async release() {
      if (!currentRecord().paused) return copy(record);
      const holds = record.holds;
      persist({version: 1, paused: false, holds: []});
      ports.releaseTriggers();
      applyExtensions(ports.extensions, 'release');
      for (const marker of holds) {
        await ports.resume({id: marker.runId, kind: marker.kind, ...(marker.cursor === undefined ? {} : {cursor: copy(marker.cursor)})}, marker);
      }
      return copy(record);
    },
  };
}
