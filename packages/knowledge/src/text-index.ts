import {KnowledgeError} from './index.js';
import type {KnowledgeSearchResult} from './index.js';

type Page = {path: string; revision: string; content: string};
type Entry = {revision: string; lines: readonly {text: string; lower: string}[]};

/** Bounded, volatile line index. Callers must finish a fresh scoped scan before every query. */
export function createTextIndex(vaultId: string) {
  let entries = new Map<string, Entry>();
  return Object.freeze({
    clear() {entries.clear();},
    search(pages: readonly Page[], query: string, limit: number, check: () => void): KnowledgeSearchResult {
      const next = new Map<string, Entry>();
      let bytes = 0;
      try {
        for (const page of pages) {
          check();
          bytes += Buffer.byteLength(page.content, 'utf8');
          if (bytes > 8 * 1024 * 1024) throw new KnowledgeError('LIMIT_EXCEEDED');
          const previous = entries.get(page.path);
          next.set(page.path, previous?.revision === page.revision ? previous : {
            revision: page.revision,
            lines: page.content.split(/\r?\n/).map(text => ({text, lower: text.toLowerCase()})),
          });
        }
        const hits = [];
        let truncated = false;
        for (const [path, entry] of next) {
          for (const [line, indexed] of entry.lines.entries()) {
            check();
            const offset = indexed.lower.indexOf(query);
            if (offset < 0) continue;
            if (hits.length === limit) {truncated = true; continue;}
            hits.push({source: {vaultId, path, line: line + 1, revision: entry.revision},
              excerpt: indexed.text.slice(Math.max(0, offset - 80), Math.max(0, offset - 80) + 320)});
          }
        }
        check(); entries = next;
        return {hits, truncated};
      } catch (error) {entries.clear(); throw error;}
    },
  });
}
