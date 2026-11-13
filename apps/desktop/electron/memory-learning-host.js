import {randomUUID} from 'node:crypto';
import {mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {learnPreference, consolidateFacts, setPreferenceEnabled, withdrawPreference, withdrawPreferencesMatching, selectPromptPreferences, formatPreferenceSystemPrompt} from '@personal-agent/learning';

export function filePreferenceStore(file) {
  return {
    load() {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        return Array.isArray(parsed?.notes) ? parsed.notes : [];
      } catch { return []; }
    },
    save(notes) {
      mkdirSync(path.dirname(file), {recursive: true});
      const temporary = `${file}.tmp`;
      writeFileSync(temporary, JSON.stringify({version: 1, notes}));
      renameSync(temporary, file);
    },
  };
}

const context = () => ({deadline: new Date(Date.now() + 180_000).toISOString(),
  signal: new AbortController().signal});
const versionView = version => version === null ? null : ({workflowId: version.workflowId,
  revision: version.revision, summary: version.summary, validation: version.validation,
  hasEvidence: Boolean(version.evidenceRef)});

/** Trusted admin composition. The shared main/preload owns sender validation and native dialogs. */
function preferenceNote(value) {
  if (!value || typeof value.id !== 'string' || typeof value.text !== 'string') return null;
  const withdrawn = value.withdrawn === true;
  return {id: value.id, kind: value.kind === 'comment' ? 'comment' : 'correction', text: value.text,
    about: typeof value.about === 'string' ? value.about : '', at: typeof value.at === 'string' ? value.at : '',
    enabled: value.enabled !== false && !withdrawn, withdrawn};
}

export function createMemoryLearningHost({profile, privateMemory, learningApplication,
  publicErasure, privateErasure, managedPrivateCopies, preferenceStore}) {
  if (profile !== 'huawei_ict_agentarts' || !privateMemory) throw Error('需要 Competition 私人记忆宿主');
  // Only the composition owner can supply the actual application-copy inventory.
  // Unknown/existing unsupported managed copies keep production writes disabled.
  const inventory = () => typeof managedPrivateCopies === 'function' ? managedPrivateCopies() : managedPrivateCopies;
  let preferences = [];
  try {
    const loaded = preferenceStore?.load?.();
    if (Array.isArray(loaded)) preferences = loaded.map(preferenceNote).filter(Boolean);
  } catch { preferences = []; }
  const persistPreferences = () => preferenceStore?.save?.(preferences);
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
      drop: group.drop.map(item => ({id: item.id, revision: item.revision, summary: item.summary})),
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
        preferences: preferences.map(note => ({id: note.id, kind: note.kind, text: note.text, about: note.about,
          enabled: note.enabled, withdrawn: note.withdrawn, active: note.enabled && !note.withdrawn})),
        duplicateCount: duplicates.reduce((sum, group) => sum + group.drop.length, 0),
        lastPlannedAt};
    },
    planDuplicates: refreshDuplicates,
    preferencePrompt(goal) {
      return formatPreferenceSystemPrompt(selectPromptPreferences(preferences, typeof goal === 'string' ? goal : ''));
    },
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
        persistPreferences();
        return {state: 'learned', count: preferences.length, preferences: this.snapshot().preferences};
      }
      if (name === 'learning.preference.disable' || name === 'learning.preference.enable' || name === 'learning.preference.withdraw') {
        const id = typeof payload?.id === 'string' ? payload.id : '';
        preferences = name === 'learning.preference.withdraw' ? withdrawPreference(preferences, id)
          : setPreferenceEnabled(preferences, id, name === 'learning.preference.enable');
        persistPreferences();
        return {state: name === 'learning.preference.withdraw' ? 'withdrawn' : 'updated', preferences: this.snapshot().preferences};
      }
      if (name === 'learning.consolidate') {
        await refreshDuplicates();
        const pending = duplicates.flatMap(group => group.drop);
        const dropped = [];
        for (const fact of pending) {
          const result = await (privateErasure ? privateErasure.withdraw({id: fact.id, revision: fact.revision}) : privateMemory.withdraw({id: fact.id, revision: fact.revision}));
          if (result?.state === 'withdrawn' && fact.summary) preferences = withdrawPreferencesMatching(preferences, fact.summary);
          dropped.push({id: fact.id, revision: fact.revision, state: result?.state ?? 'unknown'});
        }
        persistPreferences();
        await refreshDuplicates();
        return {state: 'consolidated', dropped};
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
