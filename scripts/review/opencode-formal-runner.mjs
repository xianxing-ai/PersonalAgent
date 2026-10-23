import {readFile, writeFile, mkdtemp, mkdir, rm, appendFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {bundleFor, eligible, promptFor, validateDecision, publishReview, MODELS, REPOSITORY, REVIEWER} from './opencode-formal-review.mjs';

export function isolatedEnv(root, model) {
  if (!MODELS.includes(model)) throw Error('Model outside free allowlist');
  return {PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_DATA_HOME: path.join(root, 'data'), XDG_STATE_HOME: path.join(root, 'state'), XDG_CACHE_HOME: path.join(root, 'cache'),
    TMPDIR: root, CI: 'true', NO_COLOR: '1', OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true',
    OPENCODE_DISABLE_CLAUDE_CODE: 'true', OPENCODE_DISABLE_LSP_DOWNLOAD: 'true', OPENCODE_PERMISSION: '{"*":"deny"}',
    OPENCODE_CONFIG_CONTENT: JSON.stringify({enabled_providers: ['opencode'], model, small_model: model,
      compaction: {auto: false, prune: false}, share: 'disabled', permission: {'*': 'deny'},
      agent: {reviewer: {mode: 'primary', description: 'Tool-free review of supplied source', steps: 1,
        permission: {'*': 'deny'}, tools: {'*': false}}}})};
}

export function extractOutput(stdout) {
  let raw = ''; let completed = false;
  for (const line of stdout.split('\n').filter(Boolean)) {
    const event = JSON.parse(line);
    if (event.type === 'error' || event.type === 'tool_use') throw Error('Model error or forbidden tool use');
    if (event.type === 'text' && typeof event.part?.text === 'string') raw += event.part.text;
    if (event.type === 'step_finish' && event.part?.reason === 'stop') completed = true;
  }
  if (!completed || !raw.trim()) throw Error('No completed model decision');
  return raw.trim();
}

export async function runModel(bundle, cli, {execute = spawnSync, now = Date.now, diagnostic} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'opencode-formal-'));
  await mkdir(path.join(root, 'work'));
  const attempts = []; const deadline = now() + 240_000;
  try {
    for (const model of MODELS) {
      const remaining = deadline - now(); if (remaining <= 0) break;
      const result = execute(cli, ['run', '--pure', '--format', 'json', '--title', 'PR code review', '--agent', 'reviewer', '--model', model],
        {cwd: path.join(root, 'work'), env: isolatedEnv(root, model), input: promptFor(bundle), encoding: 'utf8',
          timeout: Math.min(80_000, remaining), maxBuffer: 2_000_000, killSignal: 'SIGKILL'});
      if (result.error || result.status !== 0) {
        diagnostic?.({model, exitCode: result.status, errorCode: result.error?.code, signal: result.signal,
          stdout: result.stdout?.slice(0, 4000), stderr: result.stderr?.slice(0, 4000)});
        attempts.push({model, status: 'unavailable'}); continue;
      }
      try {
        const raw = extractOutput(result.stdout); const decision = validateDecision(bundle, raw);
        attempts.push({model, status: decision.verdict === 'INSUFFICIENT' ? 'insufficient' : 'reviewed'});
        // A completed insufficient judgment must not be retried until a model approves.
        return {status: decision.verdict === 'INSUFFICIENT' ? 'insufficient' : 'reviewed', model, raw, bundleDigest: bundle.digest, attempts};
      } catch (error) {
        diagnostic?.({model, validationError: error.message, stdout: result.stdout?.slice(0, 4000), stderr: result.stderr?.slice(0, 4000)});
        attempts.push({model, status: 'invalid-output'});
      }
    }
    return {status: 'unavailable', attempts};
  } finally { await rm(root, {recursive: true, force: true}); }
}

export async function collectBundle(pr, api) {
  if (!eligible(pr)) throw Error('PR not eligible');
  const comparison = await api(`compare/${pr.base.sha}...${pr.head.sha}`);
  const mergeBase = comparison?.merge_base_commit?.sha;
  if (!/^[a-f0-9]{40}$/.test(mergeBase ?? '')) throw Error('Verified comparison merge base missing');
  const changed = [];
  for (let page = 1; page <= 2; page++) {
    const batch = await api(`pulls/${pr.number}/files?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw Error('Invalid changed-file response');
    changed.push(...batch);
    if (changed.length > 40) throw Error('Changed-file count exceeds complete review limit');
    if (batch.length < 100) break;
  }
  const files = [];
  let bytes = 0;
  for (const file of changed) {
    if (!['added', 'modified', 'removed'].includes(file.status) || typeof file.filename !== 'string') throw Error('Unsupported changed file');
    const read = async sha => {
      const route = `contents/${file.filename.split('/').map(encodeURIComponent).join('/')}?ref=${sha}`;
      const item = await api(route);
      if (item?.type !== 'file' || item.encoding !== 'base64' || typeof item.content !== 'string' || item.size > 400_000)
        throw Error('Complete regular text file required');
      const buffer = Buffer.from(item.content, 'base64');
      if (buffer.length !== item.size) throw Error('Truncated source response');
      bytes += buffer.length; if (bytes > 400_000) throw Error('Complete source bundle too large');
      const source = new TextDecoder('utf-8', {fatal: true}).decode(buffer);
      // Conservative preflight, not a guarantee that arbitrary secrets are detectable.
      if (/-----BEGIN [^-]*PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/.test(source))
        throw Error('Potential credential material; source not sent to model');
      return source;
    };
    files.push({path: file.filename, status: file.status, before: file.status === 'added' ? '' : await read(mergeBase),
      after: file.status === 'removed' ? '' : await read(pr.head.sha)});
  }
  const latest = await api(`pulls/${pr.number}`);
  if (latest.head?.sha !== pr.head.sha || latest.base?.sha !== pr.base.sha) throw Error('PR changed during source collection');
  return bundleFor(pr, files, mergeBase);
}

// The caller must supply only the GitHub-managed workflow token, not a PAT.
// Identity is bound by the trusted workflow's explicit github.token wiring;
// its actual reviewer login/type are independently checked in POST readback.
export function workflowApi(env = process.env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== REPOSITORY || !env.GITHUB_TOKEN ||
      env.GITHUB_WORKFLOW_REF !== `${REPOSITORY}/.github/workflows/opencode-formal-review.yml@refs/heads/main`)
    throw Error('Trusted main-branch GitHub workflow context required');
  return async (route, {method = 'GET', body} = {}) => {
    if (route === 'identity') return {login: REVIEWER, type: 'Bot'};
    if (!/^(pulls\/\d+(?:\/reviews(?:\/\d+)?|\/files)?(?:\?per_page=100&page=\d+)?|contents\/[^?]+\?ref=[a-f0-9]{40}|compare\/[a-f0-9]{40}\.\.\.[a-f0-9]{40})$/.test(route))
      throw Error('API route outside scoped PR review');
    if (method !== 'GET' && !(method === 'POST' && /^pulls\/\d+\/reviews$/.test(route))) throw Error('API method outside review scope');
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/${route}`, {method, redirect: 'error',
      headers: {Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'},
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000)});
    if (!response.ok) throw Error(`GitHub ${method} HTTP ${response.status}; no automatic retry`);
    return response.json();
  };
}

async function main() {
  const [mode, file, cli] = process.argv.slice(2);
  const api = workflowApi();
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const number = event.pull_request?.number ?? Number(event.inputs?.pr_number);
  if (!Number.isSafeInteger(number) || number < 1) throw Error('Trusted PR number missing');
  if (!event.pull_request && event.inputs?.pr_number !== String(number)) throw Error('Canonical decimal PR number required for concurrency binding');
  const pr = await api(`pulls/${number}`);
  if (mode === 'review') {
    const bundle = await collectBundle(pr, api);
    const result = await runModel(bundle, path.resolve(cli));
    await writeFile(file, JSON.stringify({bundle, result}));
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `ready=${result.status === 'reviewed'}\n`);
    console.log(JSON.stringify({status: result.status, attempts: result.attempts, head: bundle.head, digest: bundle.digest}));
  } else if (mode === 'publish') {
    const {bundle, result} = JSON.parse(await readFile(file, 'utf8'));
    if (bundle.number !== number || result.status !== 'reviewed') throw Error('Artifact target or result mismatch');
    const outcome = await publishReview({bundle, result, api, collect: collectBundle});
    console.log(JSON.stringify({status: outcome.status, review: outcome.review.html_url, state: outcome.review.state, head: outcome.review.commit_id}));
  } else throw Error('Expected review or publish');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
