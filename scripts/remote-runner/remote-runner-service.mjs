#!/usr/bin/env node
/** Headless executor. One job in, one receipt out. It is not a scheduler. */
import {createHmac, createHash, timingSafeEqual} from 'node:crypto';
import {mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const RUNNER_VERSION = '1.0.0';
const KINDS = new Set(['developer-duty', 'async-subagent', 'heartbeat', 'status', 'cancel']);
const MARKER = '<!-- personal-agent:duty-status -->';

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function signJob(message, token) {
  const {signature: _ignored, ...body} = message;
  return createHmac('sha256', token).update(canonical(body)).digest('hex');
}

export function verifyJob(message, token) {
  if (!message || message.v !== 1 || typeof message.signature !== 'string' || !/^[a-f0-9]{64}$/.test(message.signature)) return false;
  const expected = signJob(message, token);
  const left = Buffer.from(message.signature, 'hex');
  const right = Buffer.from(expected, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function redact(value, secrets = []) {
  const patterns = secrets.filter(item => typeof item === 'string' && item.length >= 6);
  const walk = item => {
    if (typeof item === 'string') {
      let text = item;
      for (const secret of patterns) text = text.split(secret).join('[redacted]');
      return text.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted-key]')
        .replace(/ghp_[A-Za-z0-9]+/g, '[redacted-token]')
        .replace(/github_pat_[A-Za-z0-9_]+/g, '[redacted-token]');
    }
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === 'object') {
      const copy = {};
      for (const [key, inner] of Object.entries(item)) {
        if (/token|privateKey|secret|authorization/i.test(key)) continue;
        copy[key] = walk(inner);
      }
      return copy;
    }
    return item;
  };
  return walk(value);
}

function emptyState() {return {version: 1, jobs: {}, cursors: {}, comments: {}, recent: []};}

export function loadRunnerState(file) {
  try {return {...emptyState(), ...JSON.parse(readFileSync(file, 'utf8'))};}
  catch {return emptyState();}
}

export function saveRunnerState(file, state) {
  mkdirSync(dirname(file), {recursive: true});
  writeFileSync(file, JSON.stringify(redact(state)), {mode: 0o600});
}

function receipt(message, extra) {
  return redact({v: 1, jobId: message.id, idempotencyKey: message.idempotencyKey, kind: message.kind, ...extra}, [message.payload?.githubToken]);
}

async function runDuty(state, message, fetchImpl) {
  const payload = message.payload ?? {};
  if (payload.action === 'merge') return receipt(message, {state: 'failed', error: 'merge is forbidden by default', mergeInvoked: false});
  if (!payload.repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(payload.repo)) return receipt(message, {state: 'failed', error: 'repository is invalid'});
  if (payload.action === 'comment') {
    const key = `${payload.repo}#${payload.number}`;
    const previous = state.comments[key];
    if (previous?.outcome === 'unknown') {
      const seen = payload.existing === 'unknown' ? 'unknown' : payload.existing;
      if (seen === 'unknown' || !Array.isArray(seen) || !seen.some(item => String(item.body).includes(MARKER))) {
        return receipt(message, {state: 'unknown', comment: previous, redo: false});
      }
    }
    const body = `${MARKER}\n${String(payload.body ?? '').trim()}`;
    const existing = Array.isArray(payload.existing) ? payload.existing : [];
    const marked = existing.filter(item => String(item.body).includes(MARKER));
    if (marked.length > 1) return receipt(message, {state: 'unknown', error: 'more than one status comment', redo: false});
    const commentId = marked[0]?.id;
    state.comments[key] = {outcome: payload.writeState === 'unknown' ? 'unknown' : 'confirmed', commentId, body};
    if (payload.writeState === 'unknown') return receipt(message, {state: 'unknown', comment: state.comments[key], redo: false});
    return receipt(message, {state: 'succeeded', comment: state.comments[key], redo: false});
  }
  const page = payload.page ?? await fetchEvents(payload, fetchImpl);
  if (!page || page.gap || page.connected === false || page.rateLimited) {
    return receipt(message, {state: 'succeeded', noChange: false, cursor: state.cursors[payload.repo], gap: true});
  }
  const current = state.cursors[payload.repo];
  if (current && page.previousDeliveryId && page.previousDeliveryId !== current.deliveryId) {
    return receipt(message, {state: 'succeeded', noChange: false, gap: true, cursor: current});
  }
  if (page.events?.length && page.next?.deliveryId) {
    state.cursors[payload.repo] = {repo: payload.repo, deliveryId: page.next.deliveryId, basedOnDeliveryId: current?.deliveryId};
  }
  return receipt(message, {state: 'succeeded', noChange: !page.events?.length, gap: false, cursor: state.cursors[payload.repo], events: page.events ?? []});
}

async function fetchEvents(payload, fetchImpl) {
  if (payload.page) return payload.page;
  if (!payload.githubToken || typeof fetchImpl !== 'function') return {connected: false, gap: true, events: []};
  const response = await fetchImpl(`https://api.github.com/repos/${payload.repo}/events?per_page=20`, {
    headers: {Authorization: `Bearer ${payload.githubToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'personal-agent-runner'}});
  if (!response.ok) return {connected: false, gap: true, rateLimited: response.status === 403 || response.status === 429, events: []};
  const body = await response.json();
  const events = Array.isArray(body) ? body.slice(0, 20).map(item => ({id: String(item.id), deliveryId: String(item.id), type: 'pull_request', repo: payload.repo, receivedAt: item.created_at})) : [];
  return {connected: true, gap: false, events, previousDeliveryId: payload.cursor?.deliveryId, next: events.at(-1) ? {deliveryId: events.at(-1).deliveryId} : undefined};
}

function runSubagent(state, message) {
  const command = message.payload?.command;
  if (command) return receipt(message, {state: 'failed', error: 'remote command execution is not enabled in this runner', redo: false});
  return receipt(message, {state: 'succeeded', executor: 'accepted', verification: 'fixture',
    summary: '远端执行器已接收子任务。未配置模型命令，因此没有声称模型已经完成。', goal: message.payload?.goal ?? ''});
}

export async function handleRunnerJob(state, message, options = {}) {
  const token = options.token ?? '';
  const now = options.now ? options.now() : Date.now();
  if (!verifyJob(message, token)) return {v: 1, state: 'rejected', error: 'signature', jobId: message?.id};
  if (!KINDS.has(message.kind) || typeof message.idempotencyKey !== 'string' || typeof message.id !== 'string') {
    return {v: 1, state: 'rejected', error: 'kind', jobId: message.id};
  }
  if (message.payload?.action === 'merge') return receipt(message, {state: 'failed', error: 'merge is forbidden by default', mergeInvoked: false});
  const limit = Number.isInteger(options.maxJobsPerMinute) ? options.maxJobsPerMinute : 30;
  state.recent = (state.recent ?? []).filter(at => now - at < 60_000);
  if (message.kind !== 'heartbeat' && message.kind !== 'status' && state.recent.length >= limit) {
    return receipt(message, {state: 'rejected', error: 'rate_limited'});
  }
  if (message.kind === 'heartbeat') return receipt(message, {state: 'succeeded', heartbeatAt: new Date(now).toISOString()});
  const saved = state.jobs[message.idempotencyKey];
  if (message.kind === 'status' || message.kind === 'cancel') {
    if (message.kind === 'cancel' && saved && saved.state === 'leased') saved.state = 'cancelled';
    return receipt(message, {state: saved?.state ?? 'absent', prior: saved?.receipt});
  }
  if (saved?.state === 'succeeded' || saved?.state === 'failed' || saved?.state === 'cancelled') return saved.receipt;
  if (saved?.state === 'unknown') return {...saved.receipt, redo: false};
  if (saved?.state === 'leased' && saved.leaseUntil > now && saved.jobId !== message.id) {
    return receipt(message, {state: 'leased', error: 'job already running', redo: false});
  }
  state.recent.push(now);
  state.jobs[message.idempotencyKey] = {jobId: message.id, state: 'leased', leaseUntil: now + 60_000, kind: message.kind};
  try {
    const result = message.kind === 'developer-duty' ? await runDuty(state, message, options.fetchImpl) : runSubagent(state, message);
    const terminal = result.state === 'unknown' ? 'unknown' : result.state === 'failed' ? 'failed' : 'succeeded';
    state.jobs[message.idempotencyKey] = {jobId: message.id, state: terminal, kind: message.kind, receipt: result};
    return result;
  } catch (error) {
    const failed = receipt(message, {state: 'unknown', error: 'runner exception', redo: false});
    state.jobs[message.idempotencyKey] = {jobId: message.id, state: 'unknown', kind: message.kind, receipt: failed};
    return failed;
  }
}

export function fingerprintHostKey(hostKey) {
  return createHash('sha256').update(hostKey).digest('hex');
}

async function serve(file, token) {
  const root = dirname(file);
  const inbox = `${root}/inbox`;
  const outbox = `${root}/outbox`;
  mkdirSync(inbox, {recursive: true});
  mkdirSync(outbox, {recursive: true});
  for (;;) {
    for (const name of readdirSync(inbox).filter(item => item.endsWith('.json')).sort()) {
      const message = JSON.parse(readFileSync(`${inbox}/${name}`, 'utf8'));
      const state = loadRunnerState(file);
      const result = await handleRunnerJob(state, message, {token, maxJobsPerMinute: Number(process.env.RUNNER_MAX_PER_MINUTE || 30)});
      saveRunnerState(file, state);
      writeFileSync(`${outbox}/${name}`, JSON.stringify(result), {mode: 0o600});
      unlinkSync(`${inbox}/${name}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

async function main() {
  if (process.argv.includes('--verify')) {
    process.stdout.write(`personal-agent-runner ${RUNNER_VERSION}\n`);
    return;
  }
  const file = process.env.RUNNER_STATE || '/var/lib/personal-agent-runner/state.json';
  const token = process.env.RUNNER_TOKEN || '';
  if (process.argv.includes('--serve')) return serve(file, token);
  const raw = readFileSync(0, 'utf8');
  const message = JSON.parse(raw);
  const state = loadRunnerState(file);
  const result = await handleRunnerJob(state, message, {token, maxJobsPerMinute: Number(process.env.RUNNER_MAX_PER_MINUTE || 30)});
  saveRunnerState(file, state);
  process.stdout.write(JSON.stringify(result));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    process.stderr.write('runner failed\n');
    process.exitCode = 1;
  });
}
