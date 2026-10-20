import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ProtocolError} from '@personal-agent/contracts';
import type {ProactiveInputEvent, ProactiveResponsibility} from '@personal-agent/agentarts';
import type {TaskRuntime} from '../index.js';
import {createRuntimeAtomicStatePort} from '../atomic-host-state.js';
import type {RuntimeProactiveWorkflowHost} from './proactive-workflow-application.js';
import {readPersistedRuntimeProactiveWorkflow} from './proactive-workflow-application.js';
import type {HarnessEventOrigin} from './harness-event-delivery.js';

type Event = Omit<ProactiveInputEvent, 'proof'>;
type Context = {signal: AbortSignal; deadline: string};
export interface HarnessEventReceipt {
  deliveryId: string; eventDigest: string; taskId: string; parentTaskId: string; receiptRef: string;
}
export interface HarnessEventCancellation {
  origin: HarnessEventOrigin; parentTaskId: string; revision: number; state: 'cancelled_before_dispatch';
  /** Re-read exact original task/activity/attempt evidence immediately before ledger settlement. */
  assertCurrent(): void;
}
export interface HarnessEventAnchor {
  sourceTaskId: string; parentTaskId: string; deadline: string;
  responsibility: Omit<ProactiveResponsibility, 'proof'>;
}
export interface HarnessOriginalDelivery {
  origin: HarnessEventOrigin; ledgerState: 'pending' | 'confirmed'; ledgerRevision: number;
  lifecycleRevision: number; lifecycleRunning: boolean;
  event: Event; anchor: HarnessEventAnchor; control: {enabled: boolean; quiet: boolean; revision: string}; deadline: string;
  /** Synchronous recheck immediately before H1 resumes the same original created root. */
  assertCurrent(): void;
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
    /** Pure synchronous local read; never infers cancellation from a rejected promise or AbortSignal. */
    readCancellation?(input: {deliveryId: string; eventDigest: string; anchor: HarnessEventAnchor}): HarnessEventCancellation | undefined;
  };
  now?(): number;
}
export type PersistedHarnessDeliveryOptions = Omit<RuntimeHarnessEventsOptions, 'host' | 'delivery'> & {taskId: string; sessionId: string};
/** Pre-client startup reader. Uses only original saved state and current host authorization/control readers. */
export function readPersistedHarnessOriginalDelivery(options: PersistedHarnessDeliveryOptions, origin: HarnessEventOrigin): HarnessOriginalDelivery | undefined {
  const inspect = () => readPersistedRuntimeProactiveWorkflow(options.runtime, options.taskId, options.sessionId);
  const saved = inspect();
  if (!saved?.session) return undefined;
  const host = {
    taskId: options.taskId, sessionId: options.sessionId,
    get binding() {const current=inspect();if(!current)fail('NOT_FOUND');return current.application.state.binding;},
    inspect() {const current=inspect();if(!current?.session)fail('NOT_FOUND');return {...current,session:current.session};},
    subscribe(_listener: () => void): () => void {return fail('UNSUPPORTED_CAPABILITY');},
  };
  const unavailable = async (): Promise<never> => fail('UNSUPPORTED_CAPABILITY');
  // Constructing this reader never calls start, delivery callbacks, session bind or a source producer.
  return createRuntimeHarnessEvents({...options, host, delivery:{consume:unavailable,readReceipt:unavailable}}).readOriginalDelivery(origin);
}
interface Delivery {
  version: 1; event: Event; eventDigest: string; deliveryId: string; anchor?: HarnessEventAnchor;
  state: 'pending' | 'confirmed' | 'suppressed'; controlRevision: string;
  reason?: 'disabled' | 'quiet' | 'expired' | 'cancelled' | 'authorization_denied' | 'control_unavailable'; receipt?: HarnessEventReceipt;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'cancelling']);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const fail: (code: string) => never = code => {throw new ProtocolError(code, 'Original harness event delivery: ' + code);};
const safeCodes = new Set(['INVALID_ARGUMENT', 'UNAUTHORIZED', 'SCOPE_DENIED', 'NOT_FOUND', 'UNSUPPORTED_CAPABILITY',
  'REVISION_CONFLICT', 'CANCELLED', 'TIMEOUT', 'RESULT_UNKNOWN', 'EXTERNAL_FAILURE']);
const errorCode = (error: unknown) => error instanceof ProtocolError && safeCodes.has(error.code) ? error.code : 'RESULT_UNKNOWN';

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
  let activeGeneration = 0;
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
  function validate(event: Event) {
      if (!event || !['connector', 'wake'].includes(event.entry)) fail('INVALID_ARGUMENT');
      if (![event.eventId, event.sourceId, event.entityRef, event.sourceVersion, event.payloadRef, event.payloadDigest].every(text)
        || !Number.isFinite(Date.parse(event.observedAt)) || event.expiresAt !== undefined && !Number.isFinite(Date.parse(event.expiresAt))
        || !['upsert', 'delete', 'retract', 'correction'].includes(event.change)
        || !['important', 'normal', 'unknown'].includes(event.priority)
        || !Array.isArray(event.evidenceRefs) || !event.evidenceRefs.length || !event.evidenceRefs.every(text)
        || ![event.anchorRefs, event.responsibilityRefs, event.goalRefs].every(refs => Array.isArray(refs) && refs.every(text))) fail('INVALID_ARGUMENT');
  }
  function suppress(event: Event, revision: string, reason: Delivery['reason'], anchor?: HarnessEventAnchor) {
    const originalKey = key(event), old = atomic.read(originalKey);
    // A previous side effect intent is never converted into a denial or a fresh dispatch.
    if (old) return;
    const eventDigest = hash(event);
    const value: Delivery = {version: 1, event, eventDigest,
      deliveryId: 'harness-event-' + hash([scope, originalKey, eventDigest]),
      state: 'suppressed', controlRevision: revision, reason, ...(anchor ? {anchor} : {})};
    if (!atomic.compareAndSet(originalKey, undefined, value)) rerun = true;
  }
  function rejectEntry(entryId: string, code: string) {
    const rejectedKey = 'rejected:' + hash([scope, entryId]);
    if (!atomic.read(rejectedKey)) atomic.compareAndSet(rejectedKey, undefined,
      {version: 1, state: 'rejected', reason: code});
  }
  function confirm(saved: {revision: number; value: unknown}, receipt: HarnessEventReceipt) {
    const value = saved.value as Delivery;
    const anchor = value.anchor;
    if (!anchor) fail('REVISION_CONFLICT');
    if (!receipt || receipt.deliveryId !== value.deliveryId || receipt.eventDigest !== value.eventDigest
      || !text(receipt.taskId) || !text(receipt.receiptRef)) fail('REVISION_CONFLICT');
    const child = runtime.getTask(receipt.taskId);
    const dispatch = runtime.loadCheckpoint(child.taskId, 'subtask-parent') as {parentTaskId?: string} | undefined;
    if (!text(receipt.parentTaskId) || dispatch?.parentTaskId !== receipt.parentTaskId
      || options.resolveUserConversation(child.taskId) !== anchor.responsibility.conversationId
      || options.resolveUserConversation(receipt.parentTaskId) !== anchor.responsibility.conversationId) fail('SCOPE_DENIED');
    if (receipt.parentTaskId !== anchor.parentTaskId) {
      // A terminal controller is never reopened. H1 may create a new original conversation round.
      const origin = runtime.loadCheckpoint(receipt.parentTaskId, 'harness-event-origin');
      if (!isDeepStrictEqual(origin, {deliveryId: value.deliveryId, eventDigest: value.eventDigest,
        sourceTaskId: anchor.sourceTaskId, originalParentTaskId: anchor.parentTaskId})) fail('SCOPE_DENIED');
    }
    if (!atomic.compareAndSet(key(value.event), saved.revision, {...value, state: 'confirmed', receipt: structuredClone(receipt)})) fail('REVISION_CONFLICT');
  }
  function settleCancelled(saved: {revision: number; value: unknown}): boolean {
    const value = saved.value as Delivery, anchor = value.anchor;
    if (value.state !== 'pending' || !anchor || !delivery.readCancellation) return false;
    const cancellation = delivery.readCancellation({deliveryId: value.deliveryId, eventDigest: value.eventDigest, anchor: structuredClone(anchor)});
    if (!cancellation) return false;
    const origin = {deliveryId: value.deliveryId, eventDigest: value.eventDigest,
      sourceTaskId: anchor.sourceTaskId, originalParentTaskId: anchor.parentTaskId};
    if (cancellation.state !== 'cancelled_before_dispatch' || !isDeepStrictEqual(cancellation.origin, origin)
      || !text(cancellation.parentTaskId) || !Number.isSafeInteger(cancellation.revision)
      || typeof cancellation.assertCurrent !== 'function') fail('REVISION_CONFLICT');
    const root = runtime.getTask(cancellation.parentTaskId);
    if (root.state !== 'cancelled' || root.revision !== cancellation.revision
      || !isDeepStrictEqual(runtime.loadCheckpoint(root.taskId, 'harness-event-origin'), origin)) fail('REVISION_CONFLICT');
    cancellation.assertCurrent();
    if (!atomic.compareAndSet(key(value.event), saved.revision, {...value, state: 'suppressed', reason: 'cancelled'})) fail('REVISION_CONFLICT');
    return true;
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
    const snapshot = host.inspect().application.state;
    for (const [entryId, entry] of Object.entries(snapshot.entries)) {
      if (signal.aborted || !running()) return;
      let event: Event;
      if (atomic.read('rejected:' + hash([scope, entryId]))) continue;
      try {
        event = structuredClone(entry.event);
        if (event && !['connector', 'wake'].includes(event.entry)) continue;
        validate(event);
      } catch (error) {lastError = errorCode(error); rejectEntry(entryId, lastError); continue;}
      try {
      const originalKey = key(event), saved = atomic.read(originalKey);
      if (saved) {
        const value = saved.value as Delivery;
        // eventId may differ on a new batch carrying the same version. Payload/change must not.
        if (value.version !== 1 || value.event.payloadDigest !== event.payloadDigest
          || value.event.sourceId !== event.sourceId || value.event.sourceVersion !== event.sourceVersion
          || value.event.change !== event.change) fail('REVISION_CONFLICT');
        if (value.state !== 'pending') continue;
        if (settleCancelled(saved)) continue;
        const anchor = value.anchor;
        if (!anchor) fail('REVISION_CONFLICT');
        // Reopening can inspect the existing receipt, but can never send its intent again.
        if (now() < Date.parse(anchor.deadline)) {
          const context = {signal, deadline: anchor.deadline};
          try {
            if (!isDeepStrictEqual(anchor, options.resolveAnchor(structuredClone(value.event)))) fail('REVISION_CONFLICT');
            binding(value.event, anchor, context, 'readback');
            const receipt = await bounded(() => delivery.readReceipt({deliveryId: value.deliveryId,
              eventDigest: value.eventDigest, anchor: structuredClone(anchor)}, context), context);
            if (receipt && !signal.aborted) confirm(saved, receipt);
          } catch (error) {lastError = errorCode(error);}
        }
        continue;
      }
      // Preference suppression is not an authorization decision. Persist it without asking
      // an expired source grant to "allow" an event that must never be dispatched.
      let settings: ReturnType<typeof control>;
      try {settings = control();}
      catch (error) {lastError = errorCode(error); suppress(event, 'unavailable', 'control_unavailable'); continue;}
      const hostTask = runtime.getTask(host.taskId);
      const nativeReason: Delivery['reason'] = hostTask.cancelRequested || terminal.has(hostTask.state) ? 'cancelled'
        : now() >= Date.parse(host.binding.taskDeadline) || event.expiresAt !== undefined && now() >= Date.parse(event.expiresAt) ? 'expired'
        : !settings.enabled || snapshot.lastResult?.mode === 'paused' ? 'disabled' : settings.quiet ? 'quiet' : undefined;
      if (nativeReason) {suppress(event, settings.revision, nativeReason); continue;}
      let anchor: HarnessEventAnchor;
      let context: Context;
      try {
        anchor = structuredClone(options.resolveAnchor(structuredClone(event)));
        const deadlineMs = Math.min(Date.parse(anchor.deadline), Date.parse(host.binding.taskDeadline),
          event.expiresAt === undefined ? Infinity : Date.parse(event.expiresAt));
        if (!Number.isFinite(deadlineMs)) fail('INVALID_ARGUMENT');
        context = {signal, deadline: new Date(deadlineMs).toISOString()};
        const reason = stoppedReason(event, anchor, settings);
        if (reason) {suppress(event, settings.revision, reason, anchor); continue;}
        binding(event, anchor, context);
      } catch (error) {
        lastError = errorCode(error);
        suppress(event, settings.revision, lastError === 'TIMEOUT' ? 'expired' : lastError === 'CANCELLED' ? 'cancelled' : 'authorization_denied');
        continue;
      }
      const eventDigest = hash(event), deliveryId = 'harness-event-' + hash([scope, originalKey, eventDigest]);
      const value: Delivery = {version: 1, event, eventDigest, deliveryId, anchor,
        state: 'pending', controlRevision: settings.revision};
      if (!atomic.compareAndSet(originalKey, undefined, value)) {rerun = true; continue;}
      let attempted = false;
      try {
        const receipt = await bounded(() => {
          if (!isDeepStrictEqual(anchor, options.resolveAnchor(structuredClone(event))) || !isDeepStrictEqual(settings, control())
            || stoppedReason(event, anchor, settings) || !running()) fail('REVISION_CONFLICT');
          binding(event, anchor, context);
          attempted = true;
          return delivery.consume({deliveryId, eventDigest, anchor: structuredClone(anchor), event: structuredClone(event)}, context);
        }, context);
        if (signal.aborted) return; // A late response cannot settle a stopped consumer.
        const original = atomic.read(originalKey);
        if (!original || !isDeepStrictEqual(original.value, value)) return fail('REVISION_CONFLICT');
        confirm(original, receipt);
      } catch (error) {
        lastError = errorCode(error);
        if (!attempted) {
          // Only this process's proven unsubmitted intent may become suppressed.
          const old = atomic.read(originalKey);
          if (old && isDeepStrictEqual(old.value, value)) {
            let reason: Delivery['reason'] = 'authorization_denied';
            try {reason = stoppedReason(event, anchor, control()) ?? reason;} catch {/* Fixed denial only. */}
            if (!atomic.compareAndSet(originalKey, old.revision, {...value, state: 'suppressed', reason})) fail('REVISION_CONFLICT');
          }
        }
      }
      } catch (error) {lastError = errorCode(error); rejectEntry(entryId, lastError);}
    }
  }
  function originalDelivery(origin: HarnessEventOrigin): Omit<HarnessOriginalDelivery, 'assertCurrent'> | undefined {
    if (!origin || Object.keys(origin).sort().join(',') !== 'deliveryId,eventDigest,originalParentTaskId,sourceTaskId'
      || !Object.values(origin).every(text)) fail('INVALID_ARGUMENT');
    const lifecycle = atomic.read(lifecycleKey);
    const lifecycleValue = lifecycle?.value as {version?: number; taskId?: string; sessionId?: string; running?: boolean} | undefined;
    if (!lifecycle || lifecycleValue?.version !== 1 || lifecycleValue.taskId !== host.taskId
      || lifecycleValue.sessionId !== host.sessionId || typeof lifecycleValue.running !== 'boolean') return undefined;
    const settings = control();
    if (!settings.enabled || settings.quiet || host.inspect().application.state.lastResult?.mode === 'paused') return undefined;
    for (const entry of Object.values(host.inspect().application.state.entries)) {
      let event: Event;
      try {event=structuredClone(entry.event);if(!event||!['connector','wake'].includes(event.entry)||hash(event)!==origin.eventDigest)continue;}
      catch {continue;}
      // No new source query or writes: the exact original host entry and atomic ledger are the evidence.
      validate(event);
      const saved = atomic.read(key(event));
      if (!saved) return undefined;
      const value = saved.value as Delivery, anchor = value.anchor;
      if (value.version !== 1 || !anchor || !['pending', 'confirmed'].includes(value.state)
        || value.deliveryId !== origin.deliveryId || value.eventDigest !== origin.eventDigest
        || value.controlRevision !== settings.revision
        || !isDeepStrictEqual(value.event, event) || anchor.sourceTaskId !== origin.sourceTaskId
        || anchor.parentTaskId !== origin.originalParentTaskId) return undefined;
      if (!isDeepStrictEqual(anchor, options.resolveAnchor(structuredClone(event))) || stoppedReason(event, anchor, settings)) return undefined;
      const deadlineMs = Math.min(Date.parse(anchor.deadline), Date.parse(host.binding.taskDeadline),
        event.expiresAt === undefined ? Infinity : Date.parse(event.expiresAt));
      if (!Number.isFinite(deadlineMs) || deadlineMs <= now()) return undefined;
      const deadline = new Date(deadlineMs).toISOString();
      binding(event, anchor, {signal: new AbortController().signal, deadline}, 'dispatch');
      return {origin: structuredClone(origin), ledgerState: value.state as 'pending' | 'confirmed', ledgerRevision: saved.revision,
        lifecycleRevision: lifecycle.revision, lifecycleRunning: lifecycleValue.running,
        event, anchor: structuredClone(anchor), control: settings, deadline};
    }
    return undefined;
  }
  function pump(): Promise<void> {
    rerun = true;
    if (active) {
      // A restart must wait for the cancelled generation to release its pump,
      // then scan durable entries with a fresh signal. Never resend pending work.
      if (activeGeneration !== generation) return active.then(() => running() ? pump() : undefined);
      return active;
    }
    if (!running()) return Promise.resolve();
    controller = new AbortController();
    const signal = controller.signal, currentGeneration = generation;
    activeGeneration = currentGeneration;
    active = (async () => {
      try {
        while (rerun && !signal.aborted && running() && generation === currentGeneration) {
          rerun = false;
          await scan(signal);
        }
      } catch (error) {
        lastError = errorCode(error);
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
    /** Host-only durable provenance reader; never submits, consumes, mutates or fetches a source. */
    readOriginalDelivery(origin: HarnessEventOrigin): HarnessOriginalDelivery | undefined {
      const current = originalDelivery(origin);
      if (!current) return undefined;
      return {...structuredClone(current), assertCurrent() {
        if (!isDeepStrictEqual(current, originalDelivery(origin))) fail('REVISION_CONFLICT');
      }};
    },
    async stop() {
      lifecycle(false); generation++; unsubscribe?.(); unsubscribe = undefined;
      controller?.abort();
      await active;
    },
    /** A pending delivery has exactly one path: independently inspect its original Runtime receipt. */
    async reconcile(event: Event, context: Context) {
      if (context.signal.aborted) fail('CANCELLED');
      const saved = atomic.read(key(event));
      if (!saved) return fail('NOT_FOUND');
      const value = saved.value as Delivery;
      if (value.state !== 'pending') return structuredClone(value);
      if (hash(event) !== value.eventDigest) fail('REVISION_CONFLICT');
      if (settleCancelled(saved)) return structuredClone(atomic.read(key(event))!.value as Delivery);
      const anchor = value.anchor;
      if (!anchor) fail('REVISION_CONFLICT');
      if (!isDeepStrictEqual(anchor, options.resolveAnchor(structuredClone(value.event)))) fail('REVISION_CONFLICT');
      binding(value.event, anchor, context, 'readback');
      const receipt = await bounded(() => delivery.readReceipt({deliveryId: value.deliveryId, eventDigest: value.eventDigest,
        anchor: structuredClone(anchor)}, context), context);
      if (context.signal.aborted) fail('CANCELLED');
      if (now() >= Date.parse(context.deadline)) fail('TIMEOUT');
      if (receipt) confirm(saved, receipt);
      return structuredClone(atomic.read(key(event))!.value as Delivery);
    },
    inspect() {return {running: running(), active: active !== undefined, ...(lastError ? {lastError} : {})};},
  };
}
