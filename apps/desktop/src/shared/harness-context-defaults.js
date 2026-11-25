export const DEFAULT_CONTEXT_CHARACTERS = 1_000_000;
export const DEFAULT_CONTEXT_OUTPUT_TOKENS = 2048;

export const DEFAULT_CONTEXT_POLICY = Object.freeze({
  triggerCharacters: DEFAULT_CONTEXT_CHARACTERS * 0.75,
  targetCharacters: DEFAULT_CONTEXT_CHARACTERS * 0.5,
  maxCharacters: DEFAULT_CONTEXT_CHARACTERS,
  retainMessages: 0,
  retainTurns: 4,
  maxSourceMessages: 2000,
  segmentCharacters: 32000,
  maxSummaryCharacters: 4000,
});
