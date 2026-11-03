import {notificationDigest as digest} from '@personal-agent/notifications';

const POLICY_FIELDS = ['mode', 'maxInterruptions', 'windowMinutes', 'silentUntilUtc', 'preferredChannel', 'allowUrgentBreakthrough', 'digestMode', 'quietHours'];
const MAX_FINALS = 1024;
const normalized = text => text.trim().replace(/[\s。！!，,？?、]/gu, '');
/** Exact phrases only. A longer or negated sentence is ordinary input, not a settings change. */
const SILENCE = new Map([
  ['暂停通知', 'silent'],
  ['开启静默', 'silent'],
  ['保持静默', 'silent'],
  ['恢复通知', 'normal'],
  ['取消静默', 'normal'],
]);

function utc(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    && Number.isFinite(Date.parse(value));
}

/**
 * Trusted router for one current Live session final.
 * It does not open a microphone, call authorization.respond, or treat model text as a grant.
 * Silence and resume enter the existing notification settings tool only after an explicit
 * echo:false receipt bound to the current session and policy revision. Business cards stay
 * on the original conversation question. Full access continues to use the existing policy.
 */
export function createVoiceSessionFinalHost({readSession, readPolicy, configureSettings, now = Date.now}) {
  if (typeof readSession !== 'function' || typeof readPolicy !== 'function' || typeof configureSettings !== 'function') {
    throw Error('当前会话语音入口不可用');
  }
  const seen = new Set();
  let ledger = null;
  let currentInput = null;
  const read = reader => {
    try { return reader() ?? null; } catch { return null; }
  };
  const fullLocal = policy => {
    const local = policy?.local;
    return policy?.state === 'configured' && local && typeof local === 'object' && !Array.isArray(local)
      && POLICY_FIELDS.every(key => Object.hasOwn(local, key)) ? local : null;
  };
  const usable = (session, policy, revision) => Boolean(session && !session.pendingQuestion && !session.signal?.aborted
    && typeof session.sessionId === 'string' && session.sessionId.length > 0
    && typeof session.conversationId === 'string' && session.conversationId.length > 0
    && utc(session.deadline) && Date.parse(session.deadline) > now()
    && policy && Number.isSafeInteger(policy.revision) && policy.revision === revision);
  const reject = reason => ({accepted: false, reason});
  return {
    verifyVoiceCommand(command) {
      const entry = ledger;
      const session = read(readSession);
      const policy = read(readPolicy);
      if (!entry || !command || command.source !== 'voice' || command.phase !== 'final' || command.origin !== 'user' || command.echo !== false) return false;
      if (typeof command.utteranceId !== 'string' || command.utteranceId !== entry.utteranceId) return false;
      if (command.transcriptDigest !== entry.transcriptDigest || command.argumentsDigest !== entry.argumentsDigest) return false;
      if (command.settings?.expectedRevision !== entry.controlRevision || command.settings?.patch?.mode !== entry.mode) return false;
      if (!utc(command.expiresAt) || Date.parse(command.expiresAt) <= now()) return false;
      return usable(session, policy, entry.controlRevision)
        && session.sessionId === entry.sessionId
        && session.conversationId === entry.conversationId;
    },
    readCurrentInput() {
      const input = currentInput;
      const session = read(readSession);
      const policy = read(readPolicy);
      if (!input || !usable(session, policy, input.controlRevision) || session.sessionId !== input.sessionId
        || session.conversationId !== input.conversationId || Date.parse(input.expiresAt) <= now()) return null;
      return {
        kind: 'user_input',
        sessionId: input.sessionId,
        conversationId: input.conversationId,
        controlRevision: input.controlRevision,
        utteranceId: input.utteranceId,
        text: input.text,
        transcriptDigest: input.transcriptDigest,
        expiresAt: input.expiresAt,
      };
    },
    async consumeFinal(receipt) {
      const session = read(readSession);
      const policy = read(readPolicy);
      if (!receipt || receipt.source !== 'live_input_audio' || receipt.phase !== 'final' || receipt.origin !== 'user') return reject('stale_or_untrusted_final');
      if (receipt.echo === true) return reject('echo_rejected');
      if (receipt.echo !== false) return reject('echo_unverified');
      if (receipt.signal?.aborted) return reject('cancelled');
      if (typeof receipt.text !== 'string' || receipt.text.trim().length === 0) return reject('silence');
      if (receipt.text.length > 24000 || typeof receipt.sessionId !== 'string' || typeof receipt.utteranceId !== 'string'
        || typeof receipt.conversationId !== 'string' || receipt.transcriptDigest !== digest(receipt.text)) return reject('stale_or_untrusted_final');
      if (!utc(receipt.startedAt) || !utc(receipt.completedAt) || !utc(receipt.expiresAt)
        || Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt)
        || Date.parse(receipt.completedAt) > now() || Date.parse(receipt.expiresAt) <= now()) return reject('expired');
      if (!Number.isSafeInteger(receipt.controlRevision) || receipt.controlRevision < 0) return reject('stale_control_revision');
      if (!session || session.sessionId !== receipt.sessionId || session.conversationId !== receipt.conversationId
        || session.signal?.aborted || !utc(session.deadline) || Date.parse(session.deadline) <= now()) return reject('stale_session');
      if (session.pendingQuestion) return reject('awaiting_card');
      if (!policy || policy.revision !== receipt.controlRevision) return reject('stale_control_revision');
      const id = JSON.stringify([receipt.sessionId, receipt.utteranceId]);
      if (seen.has(id)) return reject('duplicate_final');
      if (seen.size >= MAX_FINALS) return reject('final_capacity');
      seen.add(id);
      const mode = SILENCE.get(normalized(receipt.text));
      if (!mode) {
        currentInput = {
          sessionId: receipt.sessionId,
          conversationId: receipt.conversationId,
          controlRevision: receipt.controlRevision,
          utteranceId: receipt.utteranceId,
          text: receipt.text.trim(),
          transcriptDigest: receipt.transcriptDigest,
          expiresAt: receipt.expiresAt,
        };
        const input = this.readCurrentInput();
        return input ? {accepted: true, ...input} : reject('stale_session');
      }
      const local = fullLocal(policy);
      if (!local) return reject('policy_unconfigured');
      const settings = {
        operationId: 'voice-final-' + digest([receipt.sessionId, receipt.utteranceId]).slice(0, 32),
        expectedRevision: receipt.controlRevision,
        scope: {kind: 'global'},
        patch: {...structuredClone(local), mode, silentUntilUtc: null},
      };
      ledger = {
        sessionId: receipt.sessionId,
        conversationId: receipt.conversationId,
        utteranceId: receipt.utteranceId,
        transcriptDigest: receipt.transcriptDigest,
        controlRevision: receipt.controlRevision,
        argumentsDigest: digest(settings),
        mode,
      };
      const isCurrent = () => {
        const live = read(readSession);
        const currentPolicy = read(readPolicy);
        return usable(live, currentPolicy, receipt.controlRevision)
          && live.sessionId === receipt.sessionId
          && live.conversationId === receipt.conversationId
          && !receipt.signal?.aborted
          && Date.parse(receipt.expiresAt) > now();
      };
      if (!isCurrent()) {
        ledger = null;
        return reject('stale_control_revision');
      }
      let result;
      try {
        result = await configureSettings(settings, {
          source: 'voice',
          utteranceId: receipt.utteranceId,
          transcriptDigest: receipt.transcriptDigest,
          expiresAt: receipt.expiresAt,
          isCurrent,
        });
      } catch {
        return {accepted: false, kind: 'control_command', reason: 'settings_rejected'};
      }
      const confirmed = result?.state === 'confirmed';
      return {
        accepted: confirmed,
        kind: 'control_command',
        command: mode === 'silent' ? 'notification_silence' : 'notification_resume',
        state: result?.state ?? 'pending',
        reason: confirmed ? 'applied' : 'awaiting_existing_authorization',
        ...(typeof result?.taskId === 'string' ? {taskId: result.taskId} : {}),
        controlRevision: receipt.controlRevision,
      };
    },
  };
}
