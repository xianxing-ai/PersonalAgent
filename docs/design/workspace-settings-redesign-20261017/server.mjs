#!/usr/bin/env node
/**
 * PersonalAgent 设计提案站 · 本地预览服务器
 *
 * 零依赖 Node HTTP 静态服务器：
 *   node server.mjs                 # 默认 127.0.0.1:4173
 *   node server.mjs --port 5000
 *   node server.mjs --selftest      # 自检：随机端口 GET 全部路由，输出 JSON 回执
 *
 * 仅服务本目录内的静态文件，不做任何转发、写入或网络出站请求。
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 4173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

/** 允许的静态清单；路径遍历与其他文件一律 404（不需要读盘判断）。 */
async function walk(dir, root = dir, out = []) {
  const entries = await readdirSafe(dir);
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const info = await stat(full);
    if (info.isDirectory()) {
      await walk(full, root, out);
    } else {
      out.push("/" + path.relative(root, full).split(path.sep).join("/"));
    }
  }
  return out;
}

async function readdirSafe(dir) {
  const { readdir } = await import("node:fs/promises");
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function createHandler() {
  let allowed = null;
  let allowedReady = null;

  async function resolveAllowed() {
    if (!allowedReady) {
      allowedReady = walk(HERE).then(
        (list) => {
          allowed = list;
        },
        (error) => {
          allowed = [];
          error.reported = false;
          console.error("[server] 静态清单扫描失败：", error.message);
        }
      );
      await allowedReady;
    }
    await allowedReady;
    return allowed;
  }

  return async function handler(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      // 畸形百分号编码（如 /%zz）：直接 400，不得把 URIError 变成未处理异常
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("400 bad request");
      return;
    }
    if (pathname === "/") pathname = "/index.html";
    if (pathname === "/api/health") {
      sendJson(res, 200, { ok: true, site: "workspace-settings-redesign-20261017" });
      return;
    }
    if (pathname === "/api/proposals") {
      try {
        const raw = await readFile(path.join(HERE, "proposals.json"), "utf8");
        sendJson(res, 200, JSON.parse(raw));
      } catch (error) {
        sendJson(res, 200, { proposals: [] });
      }
      return;
    }

    if (!pathname.startsWith("/")) {
      res.writeHead(400).end();
      return;
    }
    if (pathname.includes("..")) {
      // 辨识性响应体：遍历拒绝与 allowlist 未命中在此可区分（第三轮：审查者建议的可辨识断言）
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("404 not found (traversal rejected)");
      return;
    }

    const list = await resolveAllowed();
    const key = pathname.replace(/\/+$/, "") || "/";
    const match = list.includes(key) ? key : null;
    if (match == null) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("404 not found");
      return;
    }

    try {
      const body = await readFile(path.join(HERE, "." + match));
      res.writeHead(200, {
        "content-type": MIME[path.extname(match).toLowerCase()] || "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("404 not found");
    }
  };
}

async function selftest() {
  const routes = [
    "/", "/proposals.json", "/api/health", "/api/proposals",
    "/proposals/01-editorial-light/index.html",
    "/proposals/02-crt-terminal/index.html",
    "/proposals/03-material3-suede/index.html",
    "/proposals/04-neo-brutalist/index.html",
    "/proposals/05-soft-clay/index.html",
    "/proposals/06-fluent-light/index.html",
    "/README.md",
  ];
  const handler = createHandler();
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const results = [];
  let failures = 0;

  for (const route of routes) {
    try {
      const res = await fetch(base + route, { redirect: "manual" });
      const text = await res.text();
      results.push({ route, status: res.status, bytes: text.length });
      if (res.status !== 200 || text.length < 32) failures += 1;
    } catch (error) {
      results.push({ route, error: error.message });
      failures += 1;
    }
  }

  // 404 与路径遍历防护（审查跟进 2026-10-17：fetch/URL 解析会先做规范化——
  // 纯 "/../.." 与完整 "%2e" 点段都会被客户端归一化，不能冒充“服务端拒绝遍历”的断言；
  // 真正命中拒绝路径必须用“段内编码斜杠”形态：服务端 decode 后出现 .. → includes('..') 拒绝。
  // 第三轮（审查者复核建议）：guard 分支响应体含 "traversal rejected"，与 allowlist 未命中
  // （精确匹配下同样 404）可区分——assertBody 断言拒绝通道本身生效，移除 guard 即断言失败）
  const mustFail = [
    { route: "/no-such-file.xyz", expect: 404, note: "普通缺失文件 404", assertBody: "404 not found" },
    { route: "/../../package.json", expect: 404, note: "fetch 先归一化为 /package.json → allowlist 未命中（回退语义）", assertBody: "404 not found" },
    { route: "/deep/%2e%2e/%2e%2e/package.json", expect: 404, note: "%2e 完整点段被 URL 解析器归一化 → allowlist 未命中（回退语义）", assertBody: "404 not found" },
    { route: "/..%2fpackage.json", expect: 404, note: "段内编码：decode 出 /../package.json → guard 拒绝（可辨识通道）", assertBody: "traversal rejected" },
    { route: "/deep/%2e%2e%2f..%2fpackage.json", expect: 404, note: "段内编码变体：decode 出 /deep/../package.json → guard 拒绝", assertBody: "traversal rejected" },
    { route: "/..%2findex.html", expect: 404, note: "段内编码指向存在文件 index.html：仅 guard 生效才可能 404", assertBody: "traversal rejected" },
    { route: "/..%2fnonexistent.html", expect: 404, note: "段内编码指向不存在文件：guard 拒绝（非 allowlist 未命中）", assertBody: "traversal rejected" },
    { route: "/%zz", expect: 400, note: "畸形百分号编码 → 400（decode 容错）", assertBody: "400 bad request" },
  ];
  for (const item of mustFail) {
    try {
      const res = await fetch(base + item.route, { redirect: "manual" });
      const text = await res.text();
      results.push({
        route: item.route,
        status: res.status,
        expect: item.expect,
        bodyCheck: item.assertBody ? (text.includes(item.assertBody) ? "ok" : "MISMATCH") : undefined,
      });
      if (res.status !== item.expect) failures += 1;
      if (item.assertBody && !text.includes(item.assertBody)) failures += 1;
    } catch (error) {
      results.push({ route: item.route, error: error.message });
      failures += 1;
    }
  }

  const proposalsRaw = await readFile(path.join(HERE, "proposals.json"), "utf8");
  const proposals = JSON.parse(proposalsRaw).proposals || [];
  if (!Array.isArray(proposals) || proposals.length < 5) {
    failures += 1;
    results.push({ check: "proposals>=5", ok: false });
  } else {
    for (const proposal of proposals) {
      if (!proposal.id || !proposal.title || !proposal.slug) {
        failures += 1;
        results.push({ check: "proposal-fields", ok: false, proposal });
      }
    }
  }

  server.close();
  const receipt = {
    when: new Date().toISOString(),
    node: process.version,
    routesChecked: results.length,
    failures,
    ok: failures === 0,
    results,
  };
  console.log(JSON.stringify(receipt, null, 2));
  process.exit(failures === 0 ? 0 : 1);
}

const args = process.argv.slice(2);
if (args.includes("--selftest")) {
  await selftest();
} else {
  const portIndex = args.indexOf("--port");
  const port = portIndex >= 0 ? Number(args[portIndex + 1]) || DEFAULT_PORT : DEFAULT_PORT;
  const server = createServer(createHandler());
  server.listen(port, "127.0.0.1", () => {
    console.log(`[workspace-settings-redesign-20261017] http://127.0.0.1:${port}${port === DEFAULT_PORT ? "" : " (--port 覆盖)"}`);
    console.log("停止：Ctrl+C。仅本机回环访问。");
  });
}
