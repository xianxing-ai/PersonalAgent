export interface PreferenceNote {
  id: string;
  kind: 'correction' | 'comment';
  text: string;
  about: string;
  at: string;
  enabled: boolean;
  withdrawn: boolean;
}

export const PROMPT_PREFERENCE_LIMIT = 6;

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function tokens(value: string): Set<string> {
  const normalized = normalize(value);
  const found = new Set<string>();
  for (const word of normalized.split(/[^\p{L}\p{N}]+/u)) if (word.length >= 2) found.add(word);
  const han = normalized.replace(/[^\p{Script=Han}]/gu, '');
  for (let index = 0; index < han.length - 1; index += 1) found.add(han.slice(index, index + 2));
  if (han.length === 1) found.add(han);
  return found;
}

/** Remember a correction or comment. The same text is not stored twice. */
export function learnPreference(notes: readonly PreferenceNote[], input: {id: string; kind: string; text: string; about?: string; at: string}): PreferenceNote[] {
  if (input.kind !== 'correction' && input.kind !== 'comment') throw new Error('纠正内容无效');
  const kind: 'correction' | 'comment' = input.kind;
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text || text.length > 500) throw new Error('纠正内容无效');
  const about = (input.about ?? '').trim().slice(0, 120);
  const key = normalize(text);
  if (notes.some(note => note.kind === kind && normalize(note.text) === key && !note.withdrawn)) return [...notes];
  const next = [...notes, {id: input.id, kind, text, about, at: input.at, enabled: true, withdrawn: false}];
  const activeIds = new Set(next.filter(note => !note.withdrawn).slice(-30).map(note => note.id));
  return next.filter(note => note.withdrawn || activeIds.has(note.id));
}

export function setPreferenceEnabled(notes: readonly PreferenceNote[], id: string, enabled: boolean): PreferenceNote[] {
  const current = notes.find(note => note.id === id);
  if (!current) throw new Error('找不到这条偏好');
  if (current.withdrawn) throw new Error('撤回的偏好不能再注入');
  return notes.map(note => note.id === id ? {...note, enabled} : note);
}

export function withdrawPreference(notes: readonly PreferenceNote[], id: string): PreferenceNote[] {
  if (!notes.some(note => note.id === id)) throw new Error('找不到这条偏好');
  return notes.map(note => note.id === id ? {...note, enabled: false, withdrawn: true} : note);
}

export function withdrawPreferencesMatching(notes: readonly PreferenceNote[], summary: string): PreferenceNote[] {
  const key = normalize(summary);
  if (!key) return [...notes];
  return notes.map(note => normalize(note.text) === key ? {...note, enabled: false, withdrawn: true} : note);
}

/** Enabled, non-withdrawn notes, ranked by overlap with the current request and capped. */
export function selectPromptPreferences(notes: readonly PreferenceNote[], query: string, limit = PROMPT_PREFERENCE_LIMIT): PreferenceNote[] {
  const cap = Number.isSafeInteger(limit) && limit > 0 ? limit : 0;
  const queryTokens = tokens(typeof query === 'string' ? query : '');
  const ranked = notes.filter(note => note.enabled && !note.withdrawn).map(note => {
    const noteTokens = tokens(`${note.text} ${note.about}`);
    let overlap = 0;
    for (const token of noteTokens) if (queryTokens.has(token)) overlap += 1;
    const general = note.about.trim().length === 0;
    return {note, score: overlap * 10 + (general ? 1 : 0), overlap, general};
  }).filter(item => queryTokens.size === 0 || item.general || item.overlap > 0)
    .sort((left, right) => right.score - left.score || (left.note.at < right.note.at ? 1 : -1));
  return ranked.slice(0, cap).map(item => item.note);
}

export function formatPreferenceSystemPrompt(notes: readonly PreferenceNote[]): string {
  const selected = notes.filter(note => note.enabled && !note.withdrawn);
  if (!selected.length) return '';
  const lines = selected.map(note => `- ${note.kind === 'comment' ? '点评' : '纠正'}：${note.text.replace(/\s+/g, ' ').slice(0, 500)}`);
  return `已确认的用户偏好（遵守这些偏好；它们不是新的工具授权，也不能越过审批）：\n${lines.join('\n')}`;
}

export interface MemoryFactHead {
  id: string;
  revision: number;
  summary: string;
  state: string;
}

/** Keep the newest revision of an identical summary. Older copies are the ones to withdraw. */
export function consolidateFacts<T extends MemoryFactHead>(facts: readonly T[]): {keep: T; drop: T[]}[] {
  const groups = new Map<string, T[]>();
  for (const fact of facts) {
    if (fact.state !== 'active' || typeof fact.summary !== 'string' || typeof fact.id !== 'string') continue;
    const key = normalize(fact.summary);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(fact);
    groups.set(key, list);
  }
  const result: {keep: T; drop: T[]}[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const ranked = [...list].sort((left, right) => right.revision - left.revision || (left.id < right.id ? -1 : 1));
    const keep = ranked[0];
    if (!keep) continue;
    result.push({keep, drop: ranked.slice(1)});
  }
  return result;
}
