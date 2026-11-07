/**
 * Pure keyword evaluation and false-trigger suppression logic for MOD-15 wake sessions.
 *
 * This module does not access a microphone, initialize hardware, or call external services.
 * In environments lacking audio capture hardware or installed recognizers, hardware-dependent
 * paths remain unavailable.
 */

export type WakeKeywordSuppressionReason =
  | 'playback_active'
  | 'cooldown_active';

export interface WakeKeywordEvaluationInput {
  readonly phrase?: unknown;
  readonly lexicon?: readonly string[] | unknown;
  readonly cooldownUntilMs?: number | null;
  readonly nowMs?: number;
  readonly playbackActive?: boolean;
}

export interface WakeKeywordEvaluationResult {
  /**
   * True if and only if the candidate phrase matched a wake keyword in the lexicon
   * and was not suppressed (i.e. accepted wake hit).
   */
  readonly hit: boolean;
  /** Whether the candidate phrase matched a keyword in the lexicon (regardless of suppression). */
  readonly matched: boolean;
  /** True if the candidate phrase matched the lexicon but was suppressed by cooldown or playback. */
  readonly suppressed: boolean;
  /** True if the wake hit is accepted (alias for hit, equivalent to matched && !suppressed). */
  readonly accepted: boolean;
  /** The specific suppression reason if suppressed; undefined otherwise. */
  readonly reason?: WakeKeywordSuppressionReason;
}

export interface WakeHardwareAvailabilityResult {
  readonly available: boolean;
  readonly reason?: 'hardware_unavailable' | 'engine_unavailable';
}

/**
 * Normalize a single candidate phrase:
 * - Trims leading and trailing whitespace
 * - Folds casing to lowercase
 * - Collapses consecutive whitespace characters (spaces, tabs, newlines, full-width spaces) to a single ASCII space
 */
export function normalizeWakePhrase(phrase: unknown): string {
  if (typeof phrase !== 'string') return '';
  return phrase
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, ' ');
}

/**
 * Normalize and deduplicate a wake keyword lexicon.
 * Filters out non-string and empty items, returning a frozen array of unique normalized keywords.
 */
export function normalizeWakeLexicon(lexicon: unknown): readonly string[] {
  if (
    !lexicon
    || typeof lexicon !== 'object'
    || (!Array.isArray(lexicon) && typeof (lexicon as Iterable<unknown>)[Symbol.iterator] !== 'function')
  ) {
    return Object.freeze([]);
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of lexicon as Iterable<unknown>) {
    if (typeof item !== 'string') continue;
    const normalized = normalizeWakePhrase(item);
    if (normalized.length > 0 && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return Object.freeze(result);
}

/**
 * Check whether a candidate phrase matches any entry in the wake lexicon.
 * Matching is case-insensitive and whitespace-normalized.
 * Also accommodates CJK / continuous phrases where internal spaces may differ between
 * speech-to-text outputs (e.g. "你好 小派" vs "你好小派").
 */
export function matchesWakeKeyword(phrase: unknown, lexicon: unknown): boolean {
  const normPhrase = normalizeWakePhrase(phrase);
  if (normPhrase.length === 0) return false;

  const normLexicon = normalizeWakeLexicon(lexicon);
  if (normLexicon.length === 0) return false;

  const phraseNoSpace = normPhrase.replace(/\s+/g, '');

  for (const keyword of normLexicon) {
    if (normPhrase === keyword) return true;
    if (phraseNoSpace === keyword.replace(/\s+/g, '')) return true;
  }
  return false;
}

/**
 * Returns true if the current timestamp is within the active cooldown window.
 */
export function isCooldownSuppressed(cooldownUntilMs: unknown, nowMs?: unknown): boolean {
  if (typeof cooldownUntilMs !== 'number' || !Number.isSafeInteger(cooldownUntilMs) || cooldownUntilMs <= 0) {
    return false;
  }
  const current = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
  return current < cooldownUntilMs;
}

/**
 * Returns true if audio playback is currently active, suppressing wake detection.
 */
export function isPlaybackSuppressed(playbackActive: unknown): boolean {
  return playbackActive === true;
}

/**
 * Evaluate a candidate wake keyword hit against the configured lexicon and active suppression rules.
 *
 * Evaluation order:
 * 1. Keyword lexicon match (case- and whitespace-normalized).
 * 2. If matched, evaluate false-trigger suppression:
 *    a. playbackActive: active playback suppresses wake to prevent acoustic self-trigger.
 *    b. cooldown: active cooldown window suppresses rapid re-triggering.
 *
 * Returns an immutable evaluation result indicating hit, matched, suppressed, accepted, and reason.
 */
export function evaluateWakeKeywordHit(input?: WakeKeywordEvaluationInput): WakeKeywordEvaluationResult {
  const matched = matchesWakeKeyword(input?.phrase, input?.lexicon);
  if (!matched) {
    return Object.freeze({
      hit: false,
      matched: false,
      suppressed: false,
      accepted: false,
    });
  }

  if (isPlaybackSuppressed(input?.playbackActive)) {
    return Object.freeze({
      hit: false,
      matched: true,
      suppressed: true,
      accepted: false,
      reason: 'playback_active',
    });
  }

  if (isCooldownSuppressed(input?.cooldownUntilMs, input?.nowMs)) {
    return Object.freeze({
      hit: false,
      matched: true,
      suppressed: true,
      accepted: false,
      reason: 'cooldown_active',
    });
  }

  return Object.freeze({
    hit: true,
    matched: true,
    suppressed: false,
    accepted: true,
  });
}

/**
 * Boundary check for wake hardware / recognizer availability.
 * Pure logic: does not attempt device enumeration or engine invocation.
 * When hardware capture device or recognition engine is unverified/absent,
 * reports unavailable with a sanitized reason.
 */
export function checkWakeHardwareAvailability(options?: {
  readonly hasCaptureDevice?: boolean;
  readonly hasRecognizerEngine?: boolean;
}): WakeHardwareAvailabilityResult {
  if (!options?.hasCaptureDevice) {
    return Object.freeze({available: false, reason: 'hardware_unavailable'});
  }
  if (!options?.hasRecognizerEngine) {
    return Object.freeze({available: false, reason: 'engine_unavailable'});
  }
  return Object.freeze({available: true});
}
