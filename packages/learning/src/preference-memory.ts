export interface PreferenceNote {
  id: string;
  kind: 'correction' | 'comment';
  text: string;
  about: string;
  at: string;
}

export interface MemoryFactHead {
  id: string;
  revision: number;
  summary: string;
  state: string;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

/** Remember a correction or comment. The same text is not stored twice. */
export function learnPreference(notes: readonly PreferenceNote[], input: {id: string; kind: string; text: string; about?: string; at: string}): PreferenceNote[] {
  if (input.kind !== 'correction' && input.kind !== 'comment') throw new Error('纠正内容无效');
  const kind: 'correction' | 'comment' = input.kind;
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text || text.length > 500) throw new Error('纠正内容无效');
  const about = (input.about ?? '').trim().slice(0, 120);
  const key = normalize(text);
  if (notes.some(note => note.kind === kind && normalize(note.text) === key)) return [...notes];
  return [...notes, {id: input.id, kind, text, about, at: input.at}].slice(-30);
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
