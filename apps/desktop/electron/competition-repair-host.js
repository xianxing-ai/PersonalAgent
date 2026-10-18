import {isDeepStrictEqual} from 'node:util';
import {openSqliteMemoryHost} from '@personal-agent/memory/sqlite';
import {createMemoryProjectionApplication, createPendingImpactApplication} from '@personal-agent/runtime/application';
import {decideProjectedFactImpact} from '@personal-agent/cognition';
import {projectSyntheticMeetingResult} from './competition-synthetic-workspace.js';
import {projectSyntheticRepairContext, projectSyntheticRepairWire, SYNTHETIC_REPAIR_EXPORT_POLICY} from './competition-repair-context.js';

const namespace = 'mvp-synthetic-meeting';
const consumerKey = 'mvp-cognition';
const bindingKey = 'mvp-synthetic-repair-binding-v2';
const sourceTool = Object.freeze({name: 'workspace.read_text', version: '1.0.0',
  arguments: {path: 'meeting-update.json'}});
const fail = () => { throw Error('Synthetic repair source unavailable'); };
const readContext = signal => ({limit: 10, deadline: new Date(Date.now() + 60_000).toISOString(), signal});
const node = (id, kind, summary, dependencies, validFrom, validUntil) => ({
  id, kind, summary, dependencies, sourceRef: 'synthetic/mvp/explicit-plan',
  validFrom, validUntil, sensitivity: 'private', state: 'active', reason: 'Explicit synthetic fixture',
});
const same = (a, b) => a?.id === b?.id && a?.revision === b?.revision;

/** Explicit Competition development fixture; its memory store never becomes a general user data source. */
export function createSyntheticRepairHost(memoryPath, {decision} = {}) {
  const memoryHost = openSqliteMemoryHost(memoryPath);
  memoryHost.provision(namespace);
  const memory = memoryHost.bind(namespace, {allowedSensitivities: ['private']});
  const feed = memoryHost.bindFeed(namespace, {consumerId: consumerKey, allowedSensitivities: ['private']});
  let runtime;
  let projection;
  let graph;
  let memoryApp;
  let impacts;
  let lockTail = Promise.resolve();
  const adviceControllers = new Set();
  let closed = false;

  async function withSourceLock(work) {
    const previous = lockTail;
    let release;
    lockTail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await work(); } finally { release(); }
  }

  function requireBound() {
    if (!runtime || !projection || !graph || !memoryApp || !impacts) fail();
  }
  function requireExactSyntheticCandidate(taskId, binding) {
    const wrapped = runtime.loadCheckpoint(taskId, 'competition-repair-candidate');
    const candidate = wrapped?.candidate;
    if (wrapped?.kind !== 'repair_candidate' || wrapped.candidateVersion !== '1.0'
      || candidate?.expectedGraphRevision !== binding.graphRevision
      || !Array.isArray(candidate.changes) || candidate.changes.length !== 3) fail();
    const byId = new Map(candidate.changes.map(change => [change.node?.id, change]));
    if (byId.size !== 3) fail();
    const current = Object.fromEntries(binding.allowedTargets.map(item => [item.id, item]));
    const expected = [
      ['attend', 'Attend meeting at 17:00', binding.node],
      ['prepare', 'Prepare one hour before 17:00 meeting', {id: 'attend', revision: current.attend?.revision + 1}],
      ['preparation', 'Prepare at 16:00', {id: 'prepare', revision: current.prepare?.revision + 1}],
    ];
    for (const [id, summary, dependency] of expected) {
      const change = byId.get(id);
      if (!change || !same(change.node, current[id]) || change.summary !== summary
        || change.dependencies.length !== 1 || !same(change.dependencies[0], dependency)) fail();
    }
  }
  const host = {
    memory,
    localRepair: {
      graphNamespace: namespace,
      bindingVersion: SYNTHETIC_REPAIR_EXPORT_POLICY,
      sourceTool,
      withSourceLock,
      memory,
      resolveBinding({sourceTaskId, evidenceId}) {
        requireBound();
        const saved = runtime.loadCheckpoint(sourceTaskId, bindingKey);
        if (!saved || saved.evidenceId !== evidenceId || saved.sourceTaskId !== sourceTaskId) fail();
        requireExactSyntheticCandidate(sourceTaskId, saved.binding);
        return structuredClone(saved.binding);
      },
      matchesSource({result, fact, node: projected}) {
        try {
          const approved = projectSyntheticMeetingResult(result);
          return approved.meetingId === 'mvp-meeting' && approved.revision === 2
            && approved.start === '17:00' && approved.timezone === 'Asia/Shanghai'
            && fact.ref.id === 'meeting/time' && fact.ref.revision === 2
            && fact.summary === 'Synthetic meeting starts at 17:00'
            && projected.revision === 2;
        } catch { return false; }
      },
    },
    async initialize(boundRuntime) {
      if (runtime) fail();
      runtime = boundRuntime;
      projection = runtime.provisionFactProjectionStore(namespace);
      graph = runtime.bindCoordinationStore(namespace);
      memoryApp = createMemoryProjectionApplication({consumerKey, memoryNamespace: namespace, feed,
        memory, projection, confirmation: {confirm: request => memoryHost.confirmFeedBatch(namespace, consumerKey, request)}});
      impacts = createPendingImpactApplication({coordination: graph, projection});
      const existing = graph.read();
      if (existing.revision >= 5) {
        if (existing.history[0]?.kind !== 'fact' || existing.history[0].summary !== 'Synthetic meeting starts at 15:00'
          || existing.history[0].sourceRef !== 'synthetic/mvp/baseline'
          || existing.history.length < 5) fail();
        return;
      }
      if (existing.revision !== 0 && existing.revision !== 1) fail();
      const signal = new AbortController().signal;
      const current = await memory.listCurrent({...readContext(signal), at: new Date().toISOString(), factId: 'meeting/time'});
      let initial = current.facts[0];
      if (!initial) {
        const now = Date.now();
        initial = memoryHost.append(namespace, {ref: {id: 'meeting/time', revision: 1},
          summary: 'Synthetic meeting starts at 15:00', sourceRef: 'synthetic/mvp/baseline',
          observedAt: new Date(now).toISOString(), validFrom: new Date(now - 60_000).toISOString(),
          validUntil: new Date(now + 24 * 60 * 60_000).toISOString(),
          sensitivity: 'private', state: 'active', confirmation: 'external_observation'});
      }
      if (initial.ref.revision !== 1 || initial.sourceRef !== 'synthetic/mvp/baseline') fail();
      let factRef;
      if (existing.revision === 1) {
        const baseline = existing.history[0];
        if (existing.history.length !== 1 || baseline?.kind !== 'fact'
          || baseline.summary !== initial.summary || baseline.sourceRef !== initial.sourceRef
          || baseline.revision !== 1) fail();
        factRef = {id: baseline.id, revision: baseline.revision};
      } else {
        const projected = await memoryApp.consume(readContext(signal));
        if (projected.projection.links.length !== 1 || projected.projection.links[0].fact.revision !== 1) fail();
        factRef = projected.projection.links[0].node;
      }
      impacts.process({...readContext(signal), at: new Date().toISOString()});
      graph.appendBatch(graph.read().revision, [
        node('attend', 'goal', 'Attend meeting at 15:00', [factRef], initial.validFrom, initial.validUntil),
        node('prepare', 'decision', 'Prepare one hour before meeting', [{id: 'attend', revision: 1}], initial.validFrom, initial.validUntil),
        node('preparation', 'plan', 'Prepare at 14:00', [{id: 'prepare', revision: 1}], initial.validFrom, initial.validUntil),
        node('unrelated', 'plan', 'Unrelated plan remains at 18:00', [], initial.validFrom, initial.validUntil),
      ]);
    },
    async projectConfirmed(input) { return withSourceLock(() => projectConfirmedLocked(input)); },
    close() {
      closed = true;
      for (const controller of adviceControllers) controller.abort();
      memoryHost.close();
    },
    readGraph() { requireBound(); return graph.read(); },
    readBinding(taskId) {
      requireBound();
      const saved = runtime.loadCheckpoint(taskId, bindingKey);
      if (saved) requireExactSyntheticCandidate(taskId, saved.binding);
      return saved ? {evidenceId: saved.evidenceId, binding: structuredClone(saved.binding)} : undefined;
    },
  };

  async function projectConfirmedLocked({taskId, result, meeting, signal}) {
      requireBound();
      if (signal.aborted) fail();
      if (!isDeepStrictEqual(projectSyntheticMeetingResult(result), meeting)) fail();
      const records = runtime.readToolExecutions(taskId).filter(item => item.toolName === sourceTool.name
        && item.toolVersion === sourceTool.version && item.state === 'confirmed'
        && item.policyDecision === 'allow' && item.executionStarted);
      if (records.length !== 1) fail();
      const evidenceId = records[0].evidenceId;
      const previous = await memory.listCurrent({...readContext(signal), at: new Date().toISOString(), factId: 'meeting/time'});
      const current = previous.facts[0];
      if (!current) fail();
      if (current.ref.revision === 1 && current.summary === 'Synthetic meeting starts at 15:00') {
        memoryHost.append(namespace, {...current, ref: {id: 'meeting/time', revision: 2},
          summary: 'Synthetic meeting starts at 17:00', sourceRef: 'tool-evidence:' + evidenceId,
          observedAt: new Date().toISOString(), corrects: current.ref});
      } else if (current.ref.revision !== 2 || current.sourceRef !== 'tool-evidence:' + evidenceId
        || current.summary !== 'Synthetic meeting starts at 17:00') fail();
      const projectionReceipt = await memoryApp.consume(readContext(signal));
      const snapshot = graph.read();
      const context = projectSyntheticRepairContext(snapshot, projectionReceipt.projection);
      const reports = impacts.process({...readContext(signal), at: new Date().toISOString()});
      const report = reports.find(item => item.graphRevision === context.expectedGraphRevision);
      if (!report || context.targets.some(target => !report.items.some(item =>
        same(item.node, target.node) && item.action === 'RECHECK'))) fail();
      const binding = {fact: context.fact, node: context.projectedFact,
        graphRevision: context.expectedGraphRevision,
        allowedTargets: context.targets.map(item => item.node),
        allowedDependencies: context.allowedDependencies};
      const existing = runtime.loadCheckpoint(taskId, bindingKey);
      const receipt = {sourceTaskId: taskId, evidenceId, binding};
      if (existing && !isDeepStrictEqual(existing, receipt)) fail();
      if (!existing) runtime.saveCheckpoint(taskId, bindingKey, receipt);
      // Advice consumes this immutable receipt after the source lock is released.
      // It cannot delay the AgentArts continuation or authorize a graph write.
      if (decision && !closed) {
        const controller = new AbortController();
        adviceControllers.add(controller);
        const onAbort = () => controller.abort();
        signal.addEventListener('abort', onAbort, {once: true});
        runtime.saveCheckpoint(taskId, 'mvp-local-impact-advice',
          {graphRevision: context.expectedGraphRevision, status: 'pending'});
        setImmediate(() => {
          void decideProjectedFactImpact(decision, {
            graphNamespace: namespace, projection: projectionReceipt.projection, impact: report,
            deadline: new Date(Date.now() + 15_000).toISOString(), signal: controller.signal,
          }).then(suggestions => {
            if (!closed) runtime.saveCheckpoint(taskId, 'mvp-local-impact-advice',
              {graphRevision: context.expectedGraphRevision, status: 'ready', suggestions});
          }).catch(error => {
            if (!closed) runtime.saveCheckpoint(taskId, 'mvp-local-impact-advice',
              {graphRevision: context.expectedGraphRevision, status: 'unavailable',
                reason: ['CANCELLED', 'TIMEOUT'].includes(error?.code) ? error.code : 'model_unavailable'});
          }).finally(() => {
            adviceControllers.delete(controller);
            signal.removeEventListener('abort', onAbort);
          });
        });
      }
      // Export only selected synthetic plan context; Evidence identity stays local.
      return {...meeting, ...projectSyntheticRepairWire(snapshot, projectionReceipt.projection)};
  }
  return host;
}
