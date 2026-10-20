import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {ProactiveInputEvent, ProactiveResponsibility} from '@personal-agent/agentarts';
import type {TaskRuntime} from '../index.js';
import {createRuntimeAtomicStatePort} from '../atomic-host-state.js';
import type {RuntimeProactiveWorkflowHost} from './proactive-workflow-application.js';

type Event = Omit<ProactiveInputEvent, 'proof'>;
type Context = {signal: AbortSignal; deadline: string};
export interface HarnessEventReceipt {
  deliveryId: string; eventDigest: string; taskId: string; parentTaskId: string; receiptRef: string;
}
export interface HarnessEventAnchor {
  sourceTaskId: string; parentTaskId: string; deadline: string;
  responsibility: Omit<ProactiveResponsibility, 'proof'>;
}
export interface RuntimeHarnessEventsOptions {
  runtime: Pick<TaskRuntime, 'bindTrustedHostState' | 'getTask' | 'loadCheckpoint'>;
  host: Pick<RuntimeProactiveWorkflowHost, 'taskId' | 'sessionId' | 'binding' | 'inspect' | 'subscribe'>;
  /** Pure original responsibility/sourceTaskId readback, per entry; never creates a task. */
  resolveAnchor(event: Event): HarnessEventAnchor;
  resolveUserConversation(taskId: string): string | undefined;
  /** Re-read original responsibility, source version, native lease and Policy. Does not issue grants. */
  assertCurrentAuthorization(anchor: HarnessEventAnchor, event: Event, context: Context, mode: 'dispatch' | 'readback'): void;
  /** Native control readback; these settings do not grant source/tool permissions. */
  readControl(): {enabled: boolean; quiet: boolean; revision: string};
  /** Original Runtime user-work dispatch/receipt reader, not a second executor. */
  delivery: {
    consume(input: {deliveryId: string; eventDigest: string; anchor: HarnessEventAnchor; event: Event}, context: Context): Promise<HarnessEventReceipt>;
    readReceipt(input: {deliveryId: string; eventDigest: string; anchor: HarnessEventAnchor}, context: Context): Promise<HarnessEventReceipt | undefined>;
  };
  now?(): number;
}
interface Delivery {
  version: 1; event: Event; eventDigest: string; deliveryId: string; anchor: HarnessEventAnchor;
  state: 'pending' | 'confirmed' | 'suppressed'; controlRevision: string;
  reason?: 'disabled' | 'quiet' | 'expired' | 'cancelled'; receipt?: HarnessEventReceipt;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'cancelling']);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const fail = (code: string): never => {throw new ProtocolError(code, 'Original harness event delivery: ' + code);};

/** Consume original durable entries. No source reads, cursor commits, timers, notifications or model calls.
 * A pending call is only read back, including after cancellation, process restart or a lost acknowledgement.
 */
export function createRuntimeHarnessEvents(options: RuntimeHarnessEventsOptions) {
  const {runtime, host, delivery} = options;
  const now = options.now ?? Date.now;
  if (typeof options.resolveAnchor !== 'function' || typeof options.assertCurrentAuthorization !== 'function'
    || typeof options.resolveUserConversation !== 'function'
    || typeof options.readControl !== 'function' || typeof delivery?.consume !== 'function'
    || typeof delivery?.readReceipt !== 'function') fail('INVALID_ARGUMENT');
  const atomic = createRuntimeAtomicStatePort(runtime, 'runtime-harness-events');
  const scope = hash([host.taskId, host.sessionId]);
  const lifecycleKey = 'lifecycle:' + scope;
  let unsubscribe: (() => void) | undefined;
  let active: Promise<void> | undefined;
  let rerun = false;
  let controller: AbortController | undefined;
  let lastError: string | undefined;
  let generation = 0;
  const key = (event: Event) => 'delivery:' + hash([scope, event.sourceId, event.entityRef, event.sourceVersion]);
  function control() {
    const value = options.readControl();
    if (!value || typeof value.enabled !== 'boolean' || typeof value.quiet !== 'boolean' || !text(value.revision)) fail('INVALID_ARGUMENT');
    return {...value};
  }
  function binding(event: Event, anchor: HarnessEventAnchor, context: Context, mode: 'dispatch' | 'readback' = 'dispatch') {
    const conversation = options.resolveUserConversation(anchor.parentTaskId);
    if (!conversation || anchor.responsibility.conversationId !== conversation
      || options.resolveUserConversation(anchor.sourceTaskId) !== conversation
      || options.resolveUserConversation(host.taskId) !== conversation
      || !anchor.responsibility.sourceQuotes.length || anchor.responsibility.authority !== 'explicit_instruction'
      || !(event.responsibilityRefs.includes(anchor.responsibility.id)
        || event.entry === 'wake' && Object.hasOwn(host.inspect().application.state.schedules, event.entityRef))
      || !Number.isSafeInteger(anchor.responsibility.revision) || anchor.responsibility.revision < 1
      || !Number.isFinite(Date.parse(anchor.deadline)) || Date.parse(anchor.deadline) > Date.parse(host.binding.taskDeadline)) fail('SCOPE_DENIED');
    for (const taskId of [host.taskId, anchor.parentTaskId, anchor.sourceTaskId]) {
      if (runtime.loadCheckpoint(taskId, 'private-copy-erasure') !== undefined
        || runtime.loadCheckpoint(taskId, 'private-copy-erasure-binding') !== undefined) fail('SCOPE_DENIED');
    }
    options.assertCurrentAuthorization(structuredClone(anchor), structuredClone(event), context, mode);
    return host.binding;
  }
  function stoppedReason(event: Event, anchor: HarnessEventAnchor, settings: ReturnType<typeof control>): Delivery['reason'] {
    const task = runtime.getTask(host.taskId), parent = runtime.getTask(anchor.parentTaskId);
    if (task.cancelRequested || parent.cancelRequested || terminal.has(task.state) || ['cancelled', 'cancelling'].includes(parent.state)) return 'cancelled';
    if (now() >= Date.parse(host.binding.taskDeadline) || now() >= Date.parse(anchor.deadline)
      || event.expiresAt !== undefined && now() >= Date.parse(event.expiresAt)) return 'expired';
    if (!settings.enabled) return 'disabled';
    if (settings.quiet) return 'quiet';
    return undefined;
  }
  function lifecycle(running: boolean) {
    const old = atomic.read(lifecycleKey);
    const next = {version: 1, taskId: host.taskId, sessionId: host.sessionId, running, changedAt: new Date(now()).toISOString()};
    if (!atomic.compareAndSet(lifecycleKey, old?.revision, next)) fail('REVISION_CONFLICT');
  }
  function running() {return (atomic.read(lifecycleKey)?.value as {running?: boolean} | undefined)?.running === true;}
  function events(): Event[] {
    const snapshot = host.inspect().application.state;
    return Object.values(snapshot.entries).map(entry => structuredClone(entry.event)).filter(event => {
      if (!['connector', 'wake'].includes(event.entry)) return false;
      if (![event.eventId, event.sourceId, event.entityRef, event.sourceVersion, event.payloadRef, event.payloadDigest].every(text)
        || !Number.isFinite(Date.parse(event.observedAt)) || event.expiresAt !== undefined && !Number.isFinite(Date.parse(event.expiresAt))
        || !event.evidenceRefs.length) fail('INVALID_ARGUMENT');
      // The signed workflow's original responsibility/source validation remains upstream.
      return true;
    });
  }
  function confirm(saved: {revision: number; value: unknown}, receipt: HarnessEventReceipt) {
    const value = saved.value as Delivery;
    if (!receipt || receipt.deliveryId !== value.deliveryId || receipt.eventDigest !== value.eventDigest
      || !text(receipt.taskId) || !text(receipt.receiptRef)) fail('REVISION_CONFLICT');
    const child = runtime.getTask(receipt.taskId);
    const dispatch = runtime.loadCheckpoint(child.taskId, 'subtask-parent') as {parentTaskId?: string} | undefined;
    if (!text(receipt.parentTaskId) || dispatch?.parentTaskId !== receipt.parentTaskId
      || options.resolveUserConversation(child.taskId) !== value.anchor.responsibility.conversationId
      || options.resolveUserConversation(receipt.parentTaskId) !== value.anchor.responsibility.conversationId) fail('SCOPE_DENIED');
    if (receipt.parentTaskId !== value.anchor.parentTaskId) {
      // A terminal controller is never reopened. H1 may create a new original conversation round.
      const origin = runtime.loadCheckpoint(receipt.parentTaskId, 'harness-event-origin');
      if (!isDeepStrictEqual(origin, {deliveryId: value.deliveryId, eventDigest: value.eventDigest,
        sourceTaskId: value.anchor.sourceTaskId, originalParentTaskId: value.anchor.parentTaskId})) fail('SCOPE_DENIED');
    }
    if (!atomic.compareAndSet(key(value.event), saved.revision, {...value, state: 'confirmed', receipt: structuredClone(receipt)})) fail('REVISION_CONFLICT');
  }
  async function bounded<T>(operation: () => Promise<T>, context: Context): Promise<T> {
    if (context.signal.aborted) fail('CANCELLED');
    const ms = Date.parse(context.deadline) - now();
    if (!(ms > 0) || ms > 2_147_483_647) fail('TIMEOUT');
    let abort = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopped = new Promise<never>((_, reject) => {
      abort = () => reject(new ProtocolError('CANCELLED', 'Harness event delivery cancelled'));
      context.signal.addEventListener('abort', abort, {once: true});
      timer = setTimeout(() => reject(new ProtocolError('TIMEOUT', 'Harness event delivery expired')), ms);
    });
    try {
      return await Promise.race([Promise.resolve().then(() => {
        if (context.signal.aborted) fail('CANCELLED');
        if (now() >= Date.parse(context.deadline)) fail('TIMEOUT');
        return operation();
      }), stopped]);
    } finally {
      if (timer) clearTimeout(timer);
      context.signal.removeEventListener('abort', abort);
    }
  }
  async function scan(signal: AbortSignal) {
    for (const event of events()) {
      if (signal.aborted || !running()) return;
      const settings = control(), originalKey = key(event), saved = atomic.read(originalKey);
      if (saved) {
        const value = saved.value as Delivery;
        // eventId may differ on a new batch carrying the same version. Payload/change must not.
        if (value.version !== 1 || value.event.payloadDigest !== event.payloadDigest
          || value.event.sourceId !== event.sourceId || value.event.sourceVersion !== event.sourceVersion
          || value.event.change !== event.change) fail('REVISION_CONFLICT');
        if (value.state !== 'pending') continue;
        // Reopening can inspect the existing receipt, but can never send its intent again.
        if (now() < Date.parse(value.anchor.deadline)) {
          const context = {signal, deadline: value.anchor.deadline};
          try {
            if (!isDeepStrictEqual(value.anchor, options.resolveAnchor(structuredClone(value.event)))) fail('REVISION_CONFLICT');
            binding(value.event, value.anchor, context, 'readback');
            const receipt = await bounded(() => delivery.readReceipt({deliveryId: value.deliveryId,
              eventDigest: value.eventDigest, anchor: structuredClone(value.anchor)}, context), context);
            if (receipt && !signal.aborted) confirm(saved, receipt);
          } catch (error) {lastError = error instanceof ProtocolError ? error.code : 'RESULT_UNKNOWN';}
        }
        continue;
      }
      const anchor = structuredClone(options.resolveAnchor(structuredClone(event)));
      const context = {signal, deadline: new Date(Math.min(Date.parse(anchor.deadline),
        Date.parse(host.binding.taskDeadline), event.expiresAt === undefined ? Infinity : Date.parse(event.expiresAt))).toISOString()};
      binding(event, anchor, context);
      const reason = stoppedReason(event, anchor, settings);
      const eventDigest = hash(event), deliveryId = 'harness-event-' + hash([scope, originalKey, eventDigest]);
      const value: Delivery = {version: 1, event, eventDigest, deliveryId, anchor,
        state: reason ? 'suppressed' : 'pending', controlRevision: settings.revision, ...(reason ? {reason} : {})};
      if (!atomic.compareAndSet(originalKey, undefined, value)) {rerun = true; continue;}
      if (reason) continue;
      // Re-read native settings immediately before dispatch; no await between this and intent handoff.
      if (!isDeepStrictEqual(settings, control()) || stoppedReason(event, anchor, settings) || signal.aborted || !running()) continue;
      try {
        const receipt = await bounded(() => {
          if (!isDeepStrictEqual(anchor, options.resolveAnchor(structuredClone(event))) || !isDeepStrictEqual(settings, control())
            || stoppedReason(event, anchor, settings) || !running()) fail('REVISION_CONFLICT');
          binding(event, anchor, context);
          return delivery.consume({deliveryId, eventDigest, anchor: structuredClone(anchor), event: structuredClone(event)}, context);
        }, context);
        if (signal.aborted) return; // A late response cannot settle a stopped consumer.
        const original = atomic.read(originalKey);
        if (!original || !isDeepStrictEqual(original.value, value)) fail('REVISION_CONFLICT');
        confirm(original, receipt);
      } catch (error) {lastError = error instanceof ProtocolError ? error.code : 'RESULT_UNKNOWN';}
    }
  }
  function pump(): Promise<void> {
    rerun = true;
    if (active) return active;
    if (!running()) return Promise.resolve();
    controller = new AbortController();
    const signal = controller.signal, currentGeneration = generation;
    active = (async () => {
      try {
        while (rerun && !signal.aborted && running() && generation === currentGeneration) {
          rerun = false;
          await scan(signal);
        }
      } catch (error) {
        lastError = error instanceof ProtocolError ? error.code : 'RESULT_UNKNOWN';
      } finally {active = undefined; controller = undefined;}
    })();
    return active;
  }
  return {
    start() {
      if (unsubscribe) return pump();
      lifecycle(true); generation++;
      unsubscribe = host.subscribe(() => {void pump();});
      return pump();
    },
    /** Explicit host/native control changes use this; source payloads cannot change settings. */
    flush: pump,
    async stop() {
      lifecycle(false); generation++; unsubscribe?.(); unsubscribe = undefined;
      controller?.abort();
      await active;
    },
    /** A pending delivery has exactly one path: independently inspect its original Runtime receipt. */
    async reconcile(event: Event, context: Context) {
      const saved = atomic.read(key(event));
      if (!saved) return fail('NOT_FOUND');
      const value = saved.value as Delivery;
      if (value.state !== 'pending') return structuredClone(value);
      if (hash(event) !== value.eventDigest) fail('REVISION_CONFLICT');
      if (!isDeepStrictEqual(value.anchor, options.resolveAnchor(structuredClone(value.event)))) fail('REVISION_CONFLICT');
      binding(value.event, value.anchor, context, 'readback');
      const receipt = await bounded(() => delivery.readReceipt({deliveryId: value.deliveryId, eventDigest: value.eventDigest,
        anchor: structuredClone(value.anchor)}, context), context);
      if (context.signal.aborted) fail('CANCELLED');
      if (now() >= Date.parse(context.deadline)) fail('TIMEOUT');
      if (receipt) confirm(saved, receipt);
      return structuredClone(atomic.read(key(event))!.value as Delivery);
    },
    inspect() {return {running: running(), active: active !== undefined, ...(lastError ? {lastError} : {})};},
  };
}
