import {mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, existsSync, statSync} from 'node:fs';
import path from 'node:path';

/** Host-only optional recovery cache. P8 passes a trusted userData path.
 * Single writer; contains no secrets/audio/Runtime state. Rename failure never
 * falls back to overwriting the committed cache. Portable queue owns validation.
 */
export function createLiveHistoryFileStore(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw Error('Live 历史缓存路径无效');
  return {
    read() {
      if (!existsSync(file)) return [];
      if (statSync(file).size > 8 * 1024 * 1024 + 1024) throw Error('Live 历史缓存超过容量');
      const envelope = JSON.parse(readFileSync(file, 'utf8'));
      if (envelope.version !== 1 || !Array.isArray(envelope.messages)) throw Error('Live 历史缓存格式无法读取');
      return envelope.messages;
    },
    write(messages) {
      const serialized = JSON.stringify({version: 1, messages});
      try {
        mkdirSync(path.dirname(file), {recursive: true});
        const temporary = `${file}.pending`;
        const fd = openSync(temporary, 'w', 0o600);
        try {writeFileSync(fd, serialized, 'utf8'); fsyncSync(fd);}
        finally {closeSync(fd);}
        renameSync(temporary, file);
      } catch (error) {
        // A failed refresh does not invalidate an identical committed cache.
        // Independently read the destination, never the uncommitted .pending
        // file. Different or unreadable content keeps the original write error.
        try {if (readFileSync(file, 'utf8') === serialized) return;} catch {}
        throw error;
      }
    },
  };
}
