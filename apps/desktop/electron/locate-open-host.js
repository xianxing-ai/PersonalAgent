import path from 'node:path';
import {existsSync, realpathSync, statSync} from 'node:fs';
import {spawn} from 'node:child_process';

function resolveInsideRoot(root, relativeFile) {
  if (typeof root !== 'string' || !root.trim()) throw Error('定位根目录不可用');
  if (typeof relativeFile !== 'string' || !relativeFile.trim() || relativeFile.length > 500) {
    throw Error('源码路径无效');
  }
  const normalized = relativeFile.replace(/\\/g, '/');
  if (normalized.includes('\0') || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)
    || normalized.split('/').some(part => !part || part === '.' || part === '..')
    || !/^[A-Za-z0-9._/-]+$/u.test(normalized)) {
    throw Error('源码路径越界');
  }
  const rootReal = realpathSync(root);
  const candidate = path.resolve(rootReal, ...normalized.split('/'));
  const relative = path.relative(rootReal, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('源码路径越界');
  const real = realpathSync(candidate);
  const fromRoot = path.relative(rootReal, real);
  if (!fromRoot || fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) throw Error('源码路径越界');
  if (!statSync(real).isFile()) throw Error('源码不是普通文件');
  return real;
}

function editorUri(scheme, file, line, column) {
  const posix = file.replace(/\\/g, '/');
  const withLine = Number.isSafeInteger(line) && line > 0
    ? `${posix}:${line}${Number.isSafeInteger(column) && column > 0 ? `:${column}` : ''}`
    : posix;
  return `${scheme}://file/${withLine}`;
}

function editorCommands(file, line, column) {
  const target = Number.isSafeInteger(line) && line > 0
    ? `${file}:${line}${Number.isSafeInteger(column) && column > 0 ? `:${column}` : ''}`
    : file;
  const candidates = [];
  if (process.env.PA_LOCATE_EDITOR) {
    candidates.push({command: process.env.PA_LOCATE_EDITOR, args: ['-g', target]});
  }
  candidates.push(
    {command: 'cursor', args: ['-g', target]},
    {command: 'code', args: ['-g', target]},
  );
  return candidates;
}

function trySpawnEditor(spawnImpl, candidate) {
  return new Promise(resolve => {
    try {
      const child = spawnImpl(candidate.command, candidate.args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: process.platform === 'win32',
      });
      let settled = false;
      const done = ok => { if (!settled) { settled = true; resolve(ok); } };
      child.once('error', () => done(false));
      child.once('spawn', () => {
        child.unref?.();
        done(true);
      });
      // Some platforms emit neither quickly; treat as started if no immediate error.
      setTimeout(() => done(!child.killed), 50);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Open a located workspace-relative file in Cursor/VS Code when available,
 * otherwise fall back to the OS default association via shell.openPath.
 */
export function createLocateOpenHost({getRoot, openPath, openExternal, spawnImpl = spawn} = {}) {
  return {
    async open(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('打开定位参数无效');
      if (Object.keys(input).some(key => !['file', 'line', 'column'].includes(key))) {
        throw Error('打开定位不接受额外字段');
      }
      const root = typeof getRoot === 'function' ? getRoot() : undefined;
      const absolute = resolveInsideRoot(root, input.file);
      const line = input.line === undefined ? undefined : input.line;
      const column = input.column === undefined ? undefined : input.column;
      if (line !== undefined && (!Number.isSafeInteger(line) || line < 1 || line > 1_000_000)) {
        throw Error('行号无效');
      }
      if (column !== undefined && (!Number.isSafeInteger(column) || column < 1 || column > 1_000_000)) {
        throw Error('列号无效');
      }
      if (typeof openExternal === 'function') {
        for (const scheme of ['cursor', 'vscode']) {
          try {
            await openExternal(editorUri(scheme, absolute, line, column));
            return {opened: true, method: scheme, file: path.basename(absolute), line, column};
          } catch {
            // try next
          }
        }
      }
      for (const candidate of editorCommands(absolute, line, column)) {
        if (await trySpawnEditor(spawnImpl, candidate)) {
          return {opened: true, method: 'editor', command: candidate.command, file: path.basename(absolute), line, column};
        }
      }
      if (typeof openPath !== 'function') throw Error('本机没有可用的编辑器打开方式');
      const errorMessage = await openPath(absolute);
      if (errorMessage) throw Error(errorMessage);
      return {opened: true, method: 'shell', file: path.basename(absolute), line, column};
    },
  };
}

export function pathExistsInsideRoot(root, relativeFile) {
  try {
    return existsSync(resolveInsideRoot(root, relativeFile));
  } catch {
    return false;
  }
}
