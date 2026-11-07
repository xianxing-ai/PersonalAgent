#!/usr/bin/env node
// 在线 Web Demo 静态服务器（零依赖，Node ≥22）。
// - 服务 docs/demo/web-demo/public/ 下的静态页
// - 暴露只读 JSON 接口（数据来自 build-demo-data.mjs 产出的 demo-data.json）
// - 数据未构建时接口返回 503 unavailable，绝不返回编造数据
// 用法：node docs/demo/web-demo/demo-server.mjs [--host 127.0.0.1] [--port 8080] [--data <demo-data.json 路径>] [--public <静态目录>] [--repo-root <path>]

import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA = join(here, 'demo-data.json');
const DEFAULT_PUBLIC = join(here, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export function parseArgs(argv) {
  const args = { host: '127.0.0.1', port: 8080, data: DEFAULT_DATA, public: DEFAULT_PUBLIC, repoRoot: resolve(join(here, '..', '..', '..')) };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--host') args.host = argv[++i];
    else if (argv[i] === '--port') args.port = Number(argv[++i]);
    else if (argv[i] === '--data') args.data = resolve(argv[++i]);
    else if (argv[i] === '--public') args.public = resolve(argv[++i]);
    else if (argv[i] === '--repo-root') args.repoRoot = resolve(argv[++i]);
  }
  if (!['127.0.0.1', '0.0.0.0'].includes(args.host)) throw new Error('host 只支持 127.0.0.1 或 0.0.0.0');
  return args;
}

async function loadJson(path) {
  try {
    const text = await readFile(path, 'utf8');
    return { loaded: true, data: JSON.parse(text) };
  } catch (err) {
    return { loaded: false, error: err instanceof SyntaxError ? 'INVALID_JSON' : ['ENOENT', 'EACCES'].includes(err.code) ? err.code : 'READ_ERROR' };
  }
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': status === 200 ? 'no-cache' : 'no-store',
  });
  res.end(text);
}

/**
 * 启动 Demo 服务器。返回 { server, url, close }，供测试复用。
 * 所有接口均为只读；数据缺失时明确 503，不编造。
 */
export function startDemoServer(options = {}) {
  const { host = '127.0.0.1', port = 8080, dataFile = DEFAULT_DATA, publicDir = DEFAULT_PUBLIC } = options;
  if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('host 只支持 127.0.0.1 或 0.0.0.0');

  const server = createServer(async (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      sendJson(res, 400, { error: 'invalid_url' });
      return;
    }

    // 只允许 GET/HEAD
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method_not_allowed', message: 'Demo 服务器只提供只读接口' });
      return;
    }

    try {
      // API：只读 JSON
      if (pathname === '/api/health') {
        const data = await loadJson(dataFile);
        sendJson(res, 200, {
          ok: true,
          dataLoaded: data.loaded,
          ...(data.loaded ? { profile: data.data.profile, generatedAt: data.data.generatedAt } : { detail: data.error }),
        });
        return;
      }
      if (pathname === '/api/demo-data') {
        const data = await loadJson(dataFile);
        if (!data.loaded) sendJson(res, 503, { error: 'data_unavailable', message: 'demo-data.json 尚未构建。请运行 node docs/demo/web-demo/build-demo-data.mjs 后重试。', detail: data.error });
        else sendJson(res, 200, data.data);
        return;
      }
      if (pathname === '/api/workflows') {
        const data = await loadJson(dataFile);
        if (!data.loaded) {
          sendJson(res, 503, { error: 'data_unavailable', message: 'demo-data.json 尚未构建。' });
          return;
        }
        sendJson(res, 200, {
          profile: data.data.profile,
          stats: data.data.stats,
          workflows: data.data.workflows.map(({ nodes, ...rest }) => ({ ...rest, nodeCount: rest.nodeCount ?? nodes.length })),
        });
        return;
      }
      const workflowMatch = /^\/api\/workflows\/(F[0-9]{2})$/.exec(pathname);
      if (workflowMatch) {
        const data = await loadJson(dataFile);
        const wf = data.loaded ? data.data.workflows.find((w) => w.workflowId === workflowMatch[1]) : null;
        if (!wf) sendJson(res, data.loaded ? 404 : 503, { error: data.loaded ? 'workflow_not_found' : 'data_unavailable' });
        else sendJson(res, 200, wf);
        return;
      }
      if (pathname === '/api/capabilities') {
        const data = await loadJson(dataFile);
        if (!data.loaded) {
          sendJson(res, 503, { error: 'data_unavailable', message: 'demo-data.json 尚未构建。' });
          return;
        }
        sendJson(res, 200, {
          snapshotDate: data.data.stats.snapshotDate,
          globalRule: data.data.globalRule,
          capabilities: data.data.workflows.map((w) => ({ workflowId: w.workflowId, name: w.name, status: w.status })),
        });
        return;
      }
      if (pathname === '/api/highlights') {
        const data = await loadJson(dataFile);
        if (!data.loaded) {
          sendJson(res, 503, { error: 'data_unavailable' });
          return;
        }
        sendJson(res, 200, data.data.highlights);
        return;
      }

      // 静态文件（防目录穿越）
      const root = await realpath(publicDir);
      let filePath = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      const withinRoot = (path) => {
        const rel = relative(root, path);
        return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
      };
      if (!withinRoot(filePath)) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
      }
      filePath = await realpath(filePath).catch((err) => {
        if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
        throw err;
      });
      if (filePath && !withinRoot(filePath)) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
      }
      let fileStat = filePath ? await stat(filePath) : null;
      if (fileStat?.isDirectory()) {
        filePath = await realpath(join(filePath, 'index.html')).catch((err) => {
          if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
          throw err;
        });
        if (filePath && !withinRoot(filePath)) {
          sendJson(res, 403, { error: 'forbidden' });
          return;
        }
        fileStat = await stat(filePath).catch(() => null);
      }
      if (!fileStat) {
        sendJson(res, 404, { error: 'not_found', path: pathname });
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      sendJson(res, 500, { error: 'internal_error' });
    }
  });

  return new Promise((resolveStart) => {
    server.listen(port, host, () => {
      const address = server.address();
      const url = `http://${address.address}:${address.port}`;
      resolveStart({ server, url, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

async function main(argv) {
  const args = parseArgs(argv);
  const { url, close } = await startDemoServer({ host: args.host, port: args.port, dataFile: args.data, publicDir: args.public });
  console.log(`[web-demo] Demo 服务器已启动：${url}`);
  console.log('[web-demo] 数据接口：/api/health /api/demo-data /api/workflows /api/workflows/F01 /api/capabilities /api/highlights');
  const shutdown = () => {
    close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv);
}
