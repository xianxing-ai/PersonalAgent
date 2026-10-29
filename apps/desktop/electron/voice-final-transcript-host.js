/**
 * Host-only F02_N03 voice.final_transcript options for Competition Desktop composition.
 * Requires a trusted final-only reader (phase=final, origin=user, echo=false, digest match).
 * Incomplete input returns undefined so the Runtime adapter stays unregistered; never invents Fake ASR.
 *
 * Enable in main.js by passing a complete host binding into
 * resolveDesktopVoiceFinalTranscript({port, requiredScopes?}), then spreading into
 * createAgentArtsRuntimeApplication({...(options?{voiceFinalTranscript:options}:{})}).
 */
export function resolveDesktopVoiceFinalTranscript(binding) {
  if (binding === undefined || binding === null) return undefined;
  if (typeof binding !== 'object' || Array.isArray(binding)) return undefined;
  const {port, requiredScopes, now} = binding;
  if (typeof port?.readFinal !== 'function') return undefined;
  if (requiredScopes !== undefined) {
    if (!Array.isArray(requiredScopes) || requiredScopes.length === 0
      || !requiredScopes.every(scope => typeof scope === 'string' && scope.length > 0)) {
      return undefined;
    }
  }
  if (now !== undefined && typeof now !== 'function') return undefined;
  return Object.freeze({
    port,
    ...(requiredScopes ? {requiredScopes: Object.freeze([...requiredScopes])} : {}),
    ...(now ? {now} : {}),
  });
}
