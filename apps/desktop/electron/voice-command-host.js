import {randomUUID} from 'node:crypto';
import {notificationDigest as digest,createNotificationSettingsDescriptor,assertInterruptionPatch,assertLegacyNotificationPolicy} from '@personal-agent/notifications';
import {validateToolValue} from '@personal-agent/contracts';

const yes = new Set(['同意', '确认', '可以', '好的', '同意本次', '确认本次', '允许本次', '同意这次', '确认设置', '保存设置']);
const no = new Set(['不同意', '不可以', '拒绝', '拒绝本次', '不要', '不允许']);
const normalized = text => text.trim().replace(/[\s。！!，,？?、]/gu, '');
const settingsSchema = createNotificationSettingsDescriptor(['notifications:settings']).inputSchema;

/** Ephemeral current-question binding only. Runtime retains approvals, settings and receipts.
 * Only the trusted live host calls consumeFinal; no renderer-supplied final/source is accepted.
 */
export function createDesktopVoiceCommandHost({notifications, readApproval, respondApproval,
  now = Date.now, idFactory = randomUUID, onUpdate = () => {}}) {
  let question, revision = 0;
  const utterances = new Map();
  const settingsRevision = settings => ('legacyPolicy' in settings
    ? notifications.getLegacyPolicy(settings.scope) : notifications.getInterruptionPolicy(settings.scope)).revision;
  const publish = () => {try {onUpdate();} catch {}};
  const snapshot = () => question ? structuredClone({questionId: question.questionId, revision: question.revision,
    kind: question.kind, summary: question.summary, argumentsDigest: question.argumentsDigest,
    issuedAt: question.issuedAt, expiresAt: question.expiresAt, state: question.state,
    ...(question.kind === 'settings' ? {settings: question.settings} : {approvalId: question.approval.approvalId,
      taskId: question.approval.taskId, toolName: question.approval.toolName, approvalRevision: question.approval.revision})}) : null;
  function replace(value) {
    if (['consuming', 'unknown'].includes(question?.state)) throw Error('原确认已受理，请先读取原 Runtime 审批或设置任务');
    question = {...value, questionId: idFactory(), revision: ++revision, state: 'pending', issuedAt: new Date(now()).toISOString()};
    publish(); return snapshot();
  }
  function approvalMatches(original) {
    const latest = readApproval(original.approvalId);
    return latest && latest.state === 'pending' && latest.taskState === 'waiting_approval'
      && latest.revision === original.revision && latest.taskId === original.taskId
      && latest.toolName === original.toolName && latest.argumentsDigest === original.argumentsDigest
      && latest.expiresAt === original.expiresAt;
  }
  const api = {
    snapshot,
    prepareSettings(settings, {expiresAt}) {
      if (!(Date.parse(expiresAt) > now())) throw Error('设置确认缺少当前问题或期限');
      validateToolValue(settingsSchema, settings);
      const legacy = 'legacyPolicy' in settings;
      if (legacy) {
        if (settings.scope.kind === 'global') throw Error('旧通知策略需要原连接器或职责范围');
        assertLegacyNotificationPolicy(settings.legacyPolicy);
      } else assertInterruptionPatch(settings.patch);
      if (settingsRevision(settings) !== settings.expectedRevision) throw Error('通知设置版本已改变，请重新读取当前参数');
      // Describe the actual mutually exclusive payload, including old Todo digest
      // thresholds; caller text about a different shape cannot hide these values.
      const details = {scope: settings.scope, expectedRevision: settings.expectedRevision,
        ...(legacy ? {legacyPolicy: settings.legacyPolicy} : {patch: settings.patch})};
      return replace({kind: 'settings', settings: structuredClone(settings), summary: `通知设置：${JSON.stringify(details)}。是否确认当前参数？`,
        argumentsDigest: digest(settings), expiresAt});
    },
    prepareApproval({approvalId, expectedRevision}) {
      const approval = readApproval(approvalId);
      if (!approval || approval.revision !== expectedRevision || !approvalMatches(approval)
        || !(Date.parse(approval.expiresAt) > now())) throw Error('原审批已改变或过期');
      return replace({kind: 'approval', approval: structuredClone(approval), argumentsDigest: approval.argumentsDigest,
        summary: `${approval.summary || approval.toolName}；仅允许本次当前参数。是否同意？`, expiresAt: approval.expiresAt});
    },
    cancel() {if (question?.state === 'consuming' || question?.state === 'unknown') throw Error('原确认已受理，须先读取结果'); question = undefined; publish();},
    async consumeFinal(receipt) {
      const binding = question;
      if (!binding || binding.state !== 'pending') return {consumed: false, reason: 'no_current_question'};
      // Source/finality/echo fields are derived by live-voice-host from its gateway,
      // active capture and output lifecycle, never from IPC or a model tool call.
      if (!receipt || receipt.source !== 'live_input_audio' || receipt.phase !== 'final' || receipt.origin !== 'user'
        || receipt.echo !== false || typeof receipt.text !== 'string' || !receipt.text.trim()
        || !receipt.sessionId || !receipt.utteranceId || receipt.signal?.aborted
        || receipt.questionId !== binding.questionId || receipt.questionRevision !== binding.revision
        || receipt.argumentsDigest !== binding.argumentsDigest || receipt.transcriptDigest !== digest(receipt.text)
        || !(Date.parse(receipt.startedAt) >= Date.parse(binding.issuedAt))
        || !(Date.parse(receipt.completedAt) >= Date.parse(receipt.startedAt))
        || Date.parse(receipt.completedAt) > now() || now() >= Date.parse(binding.expiresAt)
        || Date.parse(receipt.expiresAt) > Date.parse(binding.expiresAt) || !(Date.parse(receipt.expiresAt) > now())) {
        return {consumed: false, reason: 'stale_or_untrusted_final'};
      }
      const key = JSON.stringify([receipt.sessionId, receipt.utteranceId]), fingerprint = digest({
        questionId: binding.questionId, revision: binding.revision, argumentsDigest: binding.argumentsDigest, text: receipt.text});
      const previous = utterances.get(key);
      if (previous) return {consumed: false, reason: previous === fingerprint ? 'duplicate_final' : 'utterance_parameters_changed'};
      utterances.set(key, fingerprint);
      const text = normalized(receipt.text), allowed = yes.has(text), denied = no.has(text);
      // Conditions, proposed changes and complex replies keep the question pending.
      if (!allowed && !denied) return {consumed: false, reason: 'requires_explicit_current_answer'};
      const isCurrent = () => question === binding && !receipt.signal?.aborted && now() < Date.parse(binding.expiresAt)
        && (binding.kind === 'settings'
          ? settingsRevision(binding.settings) === binding.settings.expectedRevision
          : approvalMatches(binding.approval));
      if (!isCurrent()) return {consumed: false, reason: 'current_parameters_changed'};
      binding.state = 'consuming'; publish();
      try {
        if (binding.kind === 'settings' && denied) {
          binding.state = 'declined'; publish(); return {consumed: true, state: 'declined'};
        }
        const result = binding.kind === 'settings'
          ? await notifications.configureSettings(binding.settings, {source: 'voice', utteranceId: receipt.utteranceId,
            transcriptDigest: receipt.transcriptDigest, expiresAt: receipt.expiresAt, isCurrent})
          : await respondApproval({approvalId: binding.approval.approvalId, expectedRevision: binding.approval.revision,
            decision: allowed ? 'allow_once' : 'deny'});
        binding.state = result?.state === 'unknown' || result?.state === 'pending' ? 'unknown' : 'confirmed';
        binding.result = result; publish(); return {consumed: true, state: binding.state, result};
      } catch (error) {
        // A failed/unknown reply is not permission to repeat an approval or mutation.
        binding.state = 'unknown'; publish(); return {consumed: true, state: 'unknown', reason: error.message};
      }
    },
    reconcile() {
      if (question?.state !== 'unknown') return snapshot();
      if (question.kind === 'approval') {
        const current = readApproval(question.approval.approvalId);
        if (current && ['allowed', 'denied'].includes(current.state)
          && current.revision === question.approval.revision + 1 && current.argumentsDigest === question.argumentsDigest) {
          question.state = 'confirmed'; publish();
        }
      } else if (question.result?.taskId) {
        const read = notifications.readSettingsTask(question.result.taskId);
        if (read?.state === 'confirmed') {question.state = 'confirmed'; publish();}
      }
      return snapshot();
    },
  };
  return api;
}
