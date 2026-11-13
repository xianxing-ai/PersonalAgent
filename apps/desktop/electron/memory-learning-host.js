import {randomUUID} from 'node:crypto';
import {learnPreference, consolidateFacts} from '@personal-agent/learning';

const context = () => ({deadline: new Date(Date.now() + 180_000).toISOString(),
  signal: new AbortController().signal});
const versionView = version => version === null ? null : ({workflowId: version.workflowId,
  revision: version.revision, summary: version.summary, validation: version.validation,
  hasEvidence: Boolean(version.evidenceRef)});

/** Trusted admin composition. The shared main/preload owns sender validation and native dialogs. */
export function createMemoryLearningHost({profile, privateMemory, learningApplication,
  publicErasure, privateErasure, managedPrivateCopies}) {
  if (profile !== 'huawei_ict_agentarts' || !privateMemory) throw Error('需要 Competition 私人记忆宿主');
  // Only the composition owner can supply the actual application-copy inventory.
  // Unknown/existing unsupported managed copies keep production writes disabled.
  const inventory = () => typeof managedPrivateCopies === 'function' ? managedPrivateCopies() : managedPrivateCopies;
  let preferences = [];
  let duplicates = [];
  let lastPlannedAt = '';
  async function refreshDuplicates() {
    if (typeof privateMemory.listSaved !== 'function') { duplicates = []; return; }
    const page = await privateMemory.listSaved();
    const facts = (page?.facts ?? []).map(fact => ({
      id: fact.ref?.id ?? fact.id,
      revision: fact.ref?.revision ?? fact.revision,
      summary: fact.summary,
      state: fact.state,
    })).filter(fact => typeof fact.id === 'string' && Number.isSafeInteger(fact.revision));
    duplicates = consolidateFacts(facts).map(group => ({
      keep: {id: group.keep.id, revision: group.keep.revision},
      drop: group.drop.map(item => ({id: item.id, revision: item.revision})),
    }));
    lastPlannedAt = new Date().toISOString();
  }
  const duplicateTimer = setInterval(() => { void refreshDuplicates().catch(() => {}); }, 24 * 60 * 60 * 1000);
  duplicateTimer.unref?.();
  void refreshDuplicates().catch(() => {});
  const noManagedCopies = () => {const copies = inventory(); return Array.isArray(copies) && copies.length === 0;};
  const writeReady = () => {
    if (privateErasure) return privateErasure.assertReady(inventory());
    if (!noManagedCopies()) throw Error('应用管理副本删除未接通，私人写入保持禁用');
    return privateMemory.prepareWrite();
  };
  return Object.freeze({
    snapshot() {
      let writeEnabled = false;
      let writeState = 'managed_copy_inventory_required';
      if (privateErasure || noManagedCopies()) {
        try { writeReady(); writeEnabled = true; writeState = 'ready'; }
        catch { writeState = 'deletion_maintenance_required'; }
      }
      return {available: true, writeEnabled, writeState,
        configurationRevision: privateMemory.configurationRevision,
        learningAvailable: Boolean(learningApplication), publicErasureAvailable: Boolean(publicErasure),
        privateTaskErasureAvailable: Boolean(privateErasure),
        deletionCoverage: 'active_application_databases', externalCopies: 'not_controlled',
        preferences: preferences.map(note => ({kind: note.kind, text: note.text})),
        duplicateCount: duplicates.reduce((sum, group) => sum + group.drop.length, 0),
        duplicateSuggestions: duplicates.map(group => ({keep: {...group.keep}, drop: group.drop.map(item => ({...item}))})),
        lastPlannedAt};
    },
    planDuplicates: refreshDuplicates,
    close() { clearInterval(duplicateTimer); },
    async recover() {
      // No writes or model calls are retried; public coordinator only follows durable erasure receipts.
      writeReady();
      const privateResult = privateErasure ? await privateErasure.reconcile(context()) : {state: 'not_configured'};
      const publicResult = publicErasure ? await publicErasure.reconcile(context()) : {state: 'not_configured'};
      return {privateResult, publicResult};
    },
    async invoke(name, payload = {}) {
      if (name === 'learning.feedback') {
        preferences = learnPreference(preferences, {id: randomUUID(), kind: payload?.kind === 'comment' ? 'comment' : 'correction',
          text: payload?.text ?? '', about: payload?.about ?? '', at: new Date().toISOString()});
        return {state: 'learned', count: preferences.length};
      }
      if (name === 'learning.consolidate') {
        await refreshDuplicates();
        const suggestions = duplicates.map(group => ({keep: {...group.keep}, drop: group.drop.map(item => ({...item}))}));
        return {state: 'planned', suggestions, duplicateCount: suggestions.reduce((sum, group) => sum + group.drop.length, 0)};
      }
      if (name === 'learning.confirmConsolidate') {
        const ref = payload?.ref;
        if (!ref || typeof ref.id !== 'string' || !Number.isSafeInteger(ref.revision)) {
          throw Error('请选择要确认撤回的重复记忆');
        }
        await refreshDuplicates();
        const allowed = duplicates.some(group => group.drop.some(item => item.id === ref.id && item.revision === ref.revision));
        if (!allowed) throw Error('这条重复记忆已不在整理建议中');
        const target = {id: ref.id, revision: ref.revision};
        const result = await (privateErasure ? privateErasure.withdraw(target) : privateMemory.withdraw(target));
        await refreshDuplicates();
        const suggestions = duplicates.map(group => ({keep: {...group.keep}, drop: group.drop.map(item => ({...item}))}));
        return {state: result?.state ?? 'unknown', revision: result?.revision ?? target.revision, ref: target, suggestions};
      }
      if (name === 'memory.previewSave') { writeReady(); return privateMemory.previewSave(payload.source); }
      if (name === 'memory.save') {
        writeReady();
        if (!payload.baseline || !Object.hasOwn(payload.baseline, 'expectedRevision')
          || !Number.isSafeInteger(payload.baseline.configurationRevision)) throw Error('缺少精确来源配置与记忆基线');
        return privateMemory.save(payload.source, payload.summary, payload.baseline);
      }
      if (name === 'memory.withdraw') return privateErasure ? privateErasure.withdraw(payload.ref) : privateMemory.withdraw(payload.ref);
      if (name === 'memory.delete') {
        writeReady();
        return privateErasure ? privateErasure.erase(payload.ref) : privateMemory.delete(payload.ref);
      }
      if (name === 'memory.boundErase') {
        if (!publicErasure) throw Error('公共事实跨库删除未配置');
        return publicErasure.erase({factId: payload.ref?.id, expectedRevision: payload.ref?.revision,
          operationId: randomUUID(), ...context()});
      }
      if (!name.startsWith('learning.') || !learningApplication) throw Error('流程学习未配置');
      const scope = context();
      if (name === 'learning.read') return {
        version: versionView(learningApplication.readVersion(payload.workflowId, payload.revision)),
        active: versionView(learningApplication.readActive(payload.workflowId)),
      };
      if (name === 'learning.propose') return {state: 'candidate', version: versionView(learningApplication.propose({
        workflowId: payload.workflowId, expectedRevision: payload.expectedRevision,
        summary: payload.summary, path: payload.path, operationId: randomUUID(),
        createdAt: new Date().toISOString(), ...scope}))};
      if (name === 'learning.startValidation') return learningApplication.startValidation({
        workflowId: payload.workflowId, revision: payload.revision, operationId: randomUUID(), ...scope});
      if (name === 'learning.validate') {
        const result = await learningApplication.validate({workflowId: payload.workflowId,
          revision: payload.revision, taskId: payload.taskId, ...scope});
        return result.version ? {...result, version: versionView(result.version)} : result;
      }
      if (name === 'learning.activate') return learningApplication.activate({workflowId: payload.workflowId,
        revision: payload.revision, expectedActiveRevision: payload.expectedActiveRevision,
        operationId: randomUUID(), activatedAt: new Date().toISOString(), ...scope});
      if (name === 'learning.run') return learningApplication.run({workflowId: payload.workflowId,
        revision: payload.revision, operationId: randomUUID(), ...scope});
      if (name === 'learning.stop') return learningApplication.stop({workflowId: payload.workflowId,
        revision: payload.revision, taskId: payload.taskId, ...scope});
      if (name === 'learning.erase') return learningApplication.erase({workflowId: payload.workflowId,
        expectedRevision: payload.expectedRevision, operationId: randomUUID(), ...scope});
      throw Error('不支持的流程学习操作');
    },
  });
}
