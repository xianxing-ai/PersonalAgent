import {createHash, createHmac, randomUUID, timingSafeEqual} from 'node:crypto';
import {ProtocolError} from '@personal-agent/contracts';
import type {RegisteredTool, ToolContext} from '@personal-agent/contracts';
import type {DutyCursor} from '@personal-agent/github';
import type {TaskRuntime} from '../index.js';
import {commitDeveloperDutyStatusComment, ingestDeveloperDutyPoll, type DeveloperDutyPorts} from './developer-duty.js';

export const RUNNER_HOST_ADD = 'runner.host.add';
export const RUNNER_HOST_UPDATE = 'runner.host.update';
export const RUNNER_HOST_REMOVE = 'runner.host.remove';
export const RUNNER_HOST_ENABLE = 'runner.host.enable';
export const RUNNER_HOST_DISABLE = 'runner.host.disable';
export const RUNNER_HOST_LIST = 'runner.host.list';
export const RUNNER_HOST_CONFIRM = 'runner.host.confirm';
export const RUNNER_HOST_TEST = 'runner.host.test';
export const RUNNER_HOST_JOBS = 'runner.host.jobs';
export const RUNNER_TOOL_VERSION = '1.0.0';
const REGISTRY_KEY = 'remote-runner-registry:v1';
const HOST_PREFIX = 'remote-runner-host:';
const PROPOSAL_PREFIX = 'remote-runner-proposal:';
const AUDIT_KEY = 'remote-runner-audit:v1';
const JOB_PREFIX = 'remote-runner-job:';

export type RunnerProvider = 'huawei-ecs' | 'vps' | 'other';
export type RunnerArch = 'x86_64' | 'aarch64';
export interface RemoteHostRecord {
  id: string;
  name: string;
  address: string;
  port: number;
  user: string;
  provider: RunnerProvider;
  os: string;
  arch: RunnerArch;
  limits: {maxConcurrent: number; maxJobsPerMinute: number};
  repos: string[];
  hostKeyFingerprint: string;
  keyRef: string;
  tokenRef: string;
  enabled: boolean;
  version: number;
}
export interface RunnerSecretPort {
  put(ref: string, secret: string): void;
  get(ref: string): string | undefined;
  delete(ref: string): void;
}
export interface RemoteRunnerSession {exec(job: Record<string, unknown>, control?: {signal?: AbortSignal; deadline: string; assertBeforeSend?: (job: Record<string, unknown>) => void}): Promise<Record<string, unknown>>; close(): void}
export interface RemoteRunnerTransport {
  connect(host: RemoteHostRecord, auth: {privateKey: string; runnerToken: string; hostKey: string}): Promise<RemoteRunnerSession>;
}
export interface RemoteJobRequest {
  kind: 'developer-duty' | 'async-subagent';
  idempotencyKey: string;
  taskId: string;
  payload: Record<string, unknown>;
  repo?: string;
  signal?: AbortSignal;
  deadline?: string;
  /** Original Runtime caller guard, never supplied by model arguments. */
  assertCurrent?: () => void;
}
export interface RemoteJobResult {
  accepted: boolean;
  location: 'remote' | 'local';
  hostId?: string;
  reason: string;
  receipt: Record<string, unknown>;
  redo: false;
}

function fail(code: 'INVALID_ARGUMENT' | 'REVISION_CONFLICT' | 'SCOPE_DENIED' | 'NOT_FOUND' | 'UNAUTHORIZED', message: string): never {
  throw new ProtocolError(code, message);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
export function signRunnerJob(message: Record<string, unknown>, token: string): string {
  const body = {...message};
  delete body.signature;
  return createHmac('sha256', token).update(canonical(body)).digest('hex');
}
export function verifyRunnerJob(message: Record<string, unknown>, token: string): boolean {
  const signature = message.signature;
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = signRunnerJob(message, token);
  const left = Buffer.from(signature, 'hex');
  const right = Buffer.from(expected, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
export function redactRunnerText(value: string, secrets: readonly string[] = []): string {
  let text = value;
  for (const secret of secrets) if (secret.length >= 6) text = text.split(secret).join('[redacted]');
  return text.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted-key]')
    .replace(/ghp_[A-Za-z0-9]+/g, '[redacted-token]').replace(/github_pat_[A-Za-z0-9_]+/g, '[redacted-token]');
}
export function reconcileDutyCursor(local: DutyCursor | undefined, remote: {repo?: string; deliveryId?: string; basedOnDeliveryId?: string} | undefined):
  {cursor?: DutyCursor; conflict: boolean} {
  if (!remote?.deliveryId || !remote.repo) return {...(local ? {cursor: local} : {}), conflict: false};
  if (!local?.deliveryId) return {cursor: {repo: remote.repo, deliveryId: remote.deliveryId}, conflict: false};
  if (local.deliveryId === remote.deliveryId || remote.basedOnDeliveryId === local.deliveryId) {
    return {cursor: {repo: remote.repo, deliveryId: remote.deliveryId}, conflict: false};
  }
  return {cursor: local, conflict: true};
}

const HOST_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
function publicHost(input: unknown, secrets: {keyRef: string; tokenRef: string}): Omit<RemoteHostRecord, 'id' | 'version'> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_ARGUMENT', 'Remote host is invalid');
  const raw = input as Record<string, unknown>;
  const allowed = ['name', 'address', 'port', 'user', 'provider', 'os', 'arch', 'limits', 'repos', 'hostKeyFingerprint', 'privateKey', 'runnerToken', 'hostKey', 'enabled'];
  if (Object.keys(raw).some(key => !allowed.includes(key))) fail('INVALID_ARGUMENT', 'Remote host has unknown fields');
  if (typeof raw.name !== 'string' || !HOST_NAME.test(raw.name)) fail('INVALID_ARGUMENT', 'Remote host name is invalid');
  if (typeof raw.address !== 'string' || !raw.address.trim() || raw.address.length > 253) fail('INVALID_ARGUMENT', 'Remote host address is invalid');
  if (!Number.isInteger(raw.port) || (raw.port as number) < 1 || (raw.port as number) > 65535) fail('INVALID_ARGUMENT', 'SSH port is invalid');
  if (typeof raw.user !== 'string' || !/^[a-z_][a-z0-9_-]{0,31}$/.test(raw.user)) fail('INVALID_ARGUMENT', 'SSH user is invalid');
  if (raw.provider !== 'huawei-ecs' && raw.provider !== 'vps' && raw.provider !== 'other') fail('INVALID_ARGUMENT', 'Provider label is invalid');
  if (typeof raw.os !== 'string' || !/^(ubuntu|debian|openeuler|euleros|other)$/.test(raw.os)) fail('INVALID_ARGUMENT', 'OS label is invalid');
  if (raw.arch !== 'x86_64' && raw.arch !== 'aarch64') fail('INVALID_ARGUMENT', 'Architecture must be x86_64 or aarch64');
  const limits = raw.limits as {maxConcurrent?: unknown; maxJobsPerMinute?: unknown} | undefined;
  if (!limits || !Number.isInteger(limits.maxConcurrent) || (limits.maxConcurrent as number) < 1 || (limits.maxConcurrent as number) > 8
    || !Number.isInteger(limits.maxJobsPerMinute) || (limits.maxJobsPerMinute as number) < 1 || (limits.maxJobsPerMinute as number) > 120) {
    fail('INVALID_ARGUMENT', 'Resource limits are outside the runner cap');
  }
  if (!Array.isArray(raw.repos) || raw.repos.length > 32 || raw.repos.some(repo => typeof repo !== 'string' || !REPO.test(repo))) {
    fail('INVALID_ARGUMENT', 'Repository allowlist is invalid');
  }
  if (typeof raw.hostKeyFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(raw.hostKeyFingerprint)) fail('INVALID_ARGUMENT', 'Host key fingerprint must be pinned');
  if (typeof raw.privateKey !== 'string' || !raw.privateKey.includes('PRIVATE KEY')) fail('INVALID_ARGUMENT', 'SSH private key is missing');
  if (typeof raw.runnerToken !== 'string' || raw.runnerToken.length < 32) fail('INVALID_ARGUMENT', 'Runner token is missing');
  if (typeof raw.hostKey !== 'string' || !raw.hostKey.trim()) fail('INVALID_ARGUMENT', 'Host key material is required to pin it');
  if (createHash('sha256').update(raw.hostKey).digest('hex') !== raw.hostKeyFingerprint) fail('UNAUTHORIZED', 'Host key does not match the pinned fingerprint');
  if (typeof raw.enabled !== 'boolean') fail('INVALID_ARGUMENT', 'enabled must be boolean');
  return {name: raw.name, address: raw.address.trim(), port: raw.port as number, user: raw.user, provider: raw.provider,
    os: raw.os, arch: raw.arch, limits: {maxConcurrent: limits.maxConcurrent as number, maxJobsPerMinute: limits.maxJobsPerMinute as number},
    repos: [...raw.repos as string[]], hostKeyFingerprint: raw.hostKeyFingerprint, keyRef: secrets.keyRef, tokenRef: secrets.tokenRef, enabled: raw.enabled};
}

export function createMemoryRunnerSecrets(): RunnerSecretPort {
  const values = new Map<string, string>();
  return {put(ref, secret) {values.set(ref, secret);}, get(ref) {return values.get(ref);}, delete(ref) {values.delete(ref);}};
}

export function createRemoteRunnerService(options: {
  getRuntime: () => TaskRuntime;
  secrets: RunnerSecretPort;
  transport: RemoteRunnerTransport;
  prepareDispatch?: (scope: {host: RemoteHostRecord; taskId: string; message: Record<string, unknown>; signal: AbortSignal;
    deadline: string; assertCurrent: () => void}) => Promise<{assertBeforeSend(): void}>;
  now?: () => number;
  localExecute?: (job: RemoteJobRequest) => Promise<Record<string, unknown>>;
  idFactory?: () => string;
}): {
  tools: RegisteredTool[];
  list(): RemoteHostRecord[];
  propose(kind: 'add' | 'update' | 'remove' | 'enable' | 'disable', input: unknown): {state: 'pending_confirmation'; proposalId: string; digest: string; effect: 'none'; summary: string};
  confirm(proposalId: string, digest: string): RemoteHostRecord | {removed: true; id: string};
  test(hostId: string): Promise<Record<string, unknown>>;
  jobs(): Array<Record<string, unknown>>;
  submit(job: RemoteJobRequest): Promise<RemoteJobResult>;
} {
  const now = options.now ?? Date.now;
  const ids = options.idFactory ?? randomUUID;
  const runtime = () => options.getRuntime();
  const owner = () => {
    const existing = runtime().findTaskByIdempotencyKey(REGISTRY_KEY);
    return existing ?? runtime().submitTask({conversationId: 'remote-runner-registry', goal: '远端执行器登记', idempotencyKey: REGISTRY_KEY});
  };
  const hosts = () => runtime().listCheckpointKeys(owner().taskId).filter(key => key.startsWith(HOST_PREFIX))
    .map(key => runtime().loadCheckpoint(owner().taskId, key) as RemoteHostRecord)
    .filter(host => host && host.id && !('removed' in host && (host as {removed?: boolean}).removed))
    .sort((left, right) => left.name.localeCompare(right.name));
  const readHost = (id: string) => hosts().find(host => host.id === id);
  const audit = (entry: Record<string, unknown>) => {
    const current = runtime().loadCheckpoint(owner().taskId, AUDIT_KEY) as {items?: Array<Record<string, unknown>>} | undefined;
    const items = [...(current?.items ?? []), {...entry, at: new Date(now()).toISOString()}].slice(-200);
    runtime().saveCheckpoint(owner().taskId, AUDIT_KEY, {items});
  };
  const summaryOf = (kind: string, host: Omit<RemoteHostRecord, 'id' | 'version'> | RemoteHostRecord) =>
    `${kind} 远端执行器 ${host.name} ${host.user}@${host.address}:${host.port} ${host.provider} ${host.arch} 仓库 ${host.repos.join(', ') || '无'}`;
  const propose = (kind: 'add' | 'update' | 'remove' | 'enable' | 'disable', input: unknown) => {
    const raw = {...input as Record<string, unknown>};
    const requestedId = typeof raw.id === 'string' ? raw.id : undefined;
    delete raw.id;
    if (kind === 'remove' || kind === 'enable' || kind === 'disable') {
      const id = requestedId ?? '';
      const current = readHost(id);
      if (!current) fail('NOT_FOUND', 'Remote host does not exist');
      const proposalId = ids();
      const digest = createHash('sha256').update(canonical({kind, id, version: current.version})).digest('hex');
      runtime().saveCheckpoint(owner().taskId, PROPOSAL_PREFIX + proposalId, {proposalId, kind, id, digest, baseVersion: current.version,
        summary: `${kind} 远端执行器 ${current.name}`});
      return {state: 'pending_confirmation' as const, proposalId, digest, effect: 'none' as const, summary: `${kind} 远端执行器 ${current.name}`};
    }
    const proposalId = ids();
    const keyRef = `runner-key:${proposalId}`;
    const tokenRef = `runner-token:${proposalId}`;
    const host = publicHost(raw, {keyRef, tokenRef});
    const secretsIn = raw as {privateKey: string; runnerToken: string; hostKey: string};
    options.secrets.put(keyRef, secretsIn.privateKey);
    options.secrets.put(tokenRef, secretsIn.runnerToken);
    options.secrets.put(`runner-hostkey:${proposalId}`, secretsIn.hostKey);
    if (kind === 'update' && !requestedId) fail('INVALID_ARGUMENT', 'Remote host id is required');
    if (kind === 'update' && !readHost(requestedId ?? '')) fail('NOT_FOUND', 'Remote host does not exist');
    const digest = createHash('sha256').update(canonical(host)).digest('hex');
    runtime().saveCheckpoint(owner().taskId, PROPOSAL_PREFIX + proposalId, {proposalId, kind, digest, host, summary: summaryOf(kind, host),
      ...(kind === 'update' ? {id: requestedId, baseVersion: readHost(requestedId ?? '')?.version} : {})});
    return {state: 'pending_confirmation' as const, proposalId, digest, effect: 'none' as const, summary: summaryOf(kind, host)};
  };
  const confirm = (proposalId: string, digest: string) => {
    const proposal = runtime().loadCheckpoint(owner().taskId, PROPOSAL_PREFIX + proposalId) as {kind?: string; digest?: string; host?: Omit<RemoteHostRecord, 'id' | 'version'>; id?: string; baseVersion?: number; summary?: string} | undefined;
    if (!proposal || proposal.digest !== digest) fail('REVISION_CONFLICT', 'Remote host confirmation does not match');
    if (proposal.kind === 'remove' || proposal.kind === 'enable' || proposal.kind === 'disable') {
      const current = proposal.id ? readHost(proposal.id) : undefined;
      if (!current || current.version !== proposal.baseVersion) fail('REVISION_CONFLICT', 'Remote host changed');
      if (proposal.kind === 'remove') {
        runtime().saveCheckpoint(owner().taskId, HOST_PREFIX + current.id, {...current, removed: true, enabled: false, version: current.version + 1});
        options.secrets.delete(current.keyRef);
        options.secrets.delete(current.tokenRef);
        options.secrets.delete(`runner-hostkey:${current.id}`);
        audit({action: 'remove', hostId: current.id});
        return {removed: true as const, id: current.id};
      }
      const next = {...current, enabled: proposal.kind === 'enable', version: current.version + 1};
      runtime().saveCheckpoint(owner().taskId, HOST_PREFIX + current.id, next);
      audit({action: proposal.kind, hostId: current.id});
      return next;
    }
    if (!proposal.host) fail('INVALID_ARGUMENT', 'Remote host proposal is incomplete');
    const id = proposal.kind === 'update' && proposal.id ? proposal.id : ids();
    const previous = proposal.kind === 'update' ? readHost(id) : undefined;
    if (proposal.kind === 'update' && (!previous || previous.version !== proposal.baseVersion)) fail('REVISION_CONFLICT', 'Remote host changed');
    const record: RemoteHostRecord = {...proposal.host, id, version: (previous?.version ?? 0) + 1,
      keyRef: `runner-key:${id}`, tokenRef: `runner-token:${id}`};
    const privateKey = options.secrets.get(proposal.host.keyRef);
    const runnerToken = options.secrets.get(proposal.host.tokenRef);
    const hostKey = options.secrets.get(proposal.host.keyRef.replace('runner-key:', 'runner-hostkey:'));
    if (!privateKey || !runnerToken || !hostKey) fail('UNAUTHORIZED', 'Remote host secrets are unavailable');
    options.secrets.put(record.keyRef, privateKey);
    options.secrets.put(record.tokenRef, runnerToken);
    options.secrets.put(`runner-hostkey:${id}`, hostKey);
    options.secrets.delete(proposal.host.keyRef);
    options.secrets.delete(proposal.host.tokenRef);
    options.secrets.delete(proposal.host.keyRef.replace('runner-key:', 'runner-hostkey:'));
    runtime().saveCheckpoint(owner().taskId, HOST_PREFIX + id, record);
    audit({action: proposal.kind, hostId: id, name: record.name});
    return record;
  };
  const connect = async (host: RemoteHostRecord) => {
    const privateKey = options.secrets.get(host.keyRef);
    const runnerToken = options.secrets.get(host.tokenRef);
    const hostKey = options.secrets.get(`runner-hostkey:${host.id}`);
    if (!privateKey || !runnerToken || !hostKey) fail('UNAUTHORIZED', 'Remote host secrets are unavailable');
    if (createHash('sha256').update(hostKey).digest('hex') !== host.hostKeyFingerprint) fail('UNAUTHORIZED', 'Pinned host key is unavailable');
    return {token: runnerToken, session: await options.transport.connect(host, {privateKey, runnerToken, hostKey})};
  };
  const submit = async (job: RemoteJobRequest): Promise<RemoteJobResult> => {
    if (job.kind !== 'developer-duty' && job.kind !== 'async-subagent') fail('INVALID_ARGUMENT', 'Job kind is not allowlisted');
    if (job.payload.action === 'merge') fail('SCOPE_DENIED', 'Merge stays forbidden');
    if (!job.idempotencyKey || !job.taskId) fail('INVALID_ARGUMENT', 'Job identity is required');
    const requestDigest = createHash('sha256').update(canonical({kind: job.kind, taskId: job.taskId, repo: job.repo ?? null, payload: job.payload})).digest('hex');
    const saved = runtime().loadCheckpoint(owner().taskId, JOB_PREFIX + job.idempotencyKey) as (RemoteJobResult & {requestDigest?: string}) | undefined;
    if (saved) {
      if (saved.requestDigest !== requestDigest) fail('REVISION_CONFLICT', 'Remote job input changed or its original binding is unavailable');
      return {...saved, redo: false};
    }
    const deadlineMs = job.deadline === undefined ? now() + 60_000 : Math.min(Date.parse(job.deadline), now() + 60_000);
    if (!Number.isFinite(deadlineMs)) fail('INVALID_ARGUMENT', 'Job deadline is invalid');
    const assertActive = () => {
      if (job.signal?.aborted) throw new ProtocolError('CANCELLED', 'Remote job was cancelled before dispatch');
      if (now() >= deadlineMs) throw new ProtocolError('TIMEOUT', 'Remote job deadline elapsed');
    };
    assertActive();
    const eligible = hosts().filter(host => host.enabled && (!job.repo || host.repos.includes(job.repo)));
    if (eligible.length && (!options.prepareDispatch || !job.assertCurrent || !job.signal))
      throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Remote dispatch requires original source and exact payload authorization');
    const message = {v: 1, id: ids(), idempotencyKey: job.idempotencyKey, kind: job.kind, deadline: new Date(deadlineMs).toISOString(),
      payload: structuredClone(job.payload), sentAt: new Date(now()).toISOString()};
    const persist = (result: RemoteJobResult) => {
      runtime().saveCheckpoint(owner().taskId, JOB_PREFIX + job.idempotencyKey, {...result, requestDigest});
      return result;
    };
    const pending: RemoteJobResult = {accepted: true, location: 'remote', reason: 'dispatch result is unknown',
      receipt: {v: 1, jobId: message.id, idempotencyKey: message.idempotencyKey, kind: message.kind, state: 'unknown', redo: false}, redo: false};
    // Reserve before the first await. A concurrent call or restart may read, never replay, this operation.
    if (!runtime().saveCheckpointOnce(owner().taskId, JOB_PREFIX + job.idempotencyKey, {...pending, requestDigest})) {
      const original = runtime().loadCheckpoint(owner().taskId, JOB_PREFIX + job.idempotencyKey) as RemoteJobResult & {requestDigest?: string};
      if (original.requestDigest !== requestDigest) fail('REVISION_CONFLICT', 'Remote job input changed');
      return {...original, redo: false};
    }
    let reason = 'no healthy remote host';
    for (const host of eligible) {
      const health = runtime().loadCheckpoint(owner().taskId, `remote-runner-health:${host.id}`) as {at?: number} | undefined;
      if (health?.at && now() - health.at > 120_000) {reason = `${host.name} heartbeat is stale`; continue;}
      let connected: Awaited<ReturnType<typeof connect>>;
      try { connected = await connect(host); }
      catch {
        reason = `${host.name} connection could not be prepared`;
        runtime().saveCheckpoint(owner().taskId, `remote-runner-health:${host.id}`, {at: now(), state: 'down'});
        continue;
      }
      let dispatched = false;
      try {
        const originalHost = canonical(host), originalSignal = job.signal, originalDeadline = job.deadline, originalGuard = job.assertCurrent;
        const assertCurrent = () => {
          assertActive();
          if (canonical(hosts().find(value => value.id === host.id)) !== originalHost || job.signal !== originalSignal
            || job.deadline !== originalDeadline || job.assertCurrent !== originalGuard
            || createHash('sha256').update(canonical({kind: job.kind, taskId: job.taskId, repo: job.repo ?? null, payload: job.payload})).digest('hex') !== requestDigest)
            fail('UNAUTHORIZED', 'Original remote dispatch binding changed');
          const result: unknown = originalGuard!();
          if (result !== undefined) {
            if (result && typeof (result as PromiseLike<unknown>).then === 'function') void Promise.resolve(result).catch(() => {});
            fail('UNAUTHORIZED', 'Remote source guard must be a synchronous trusted assertion');
          }
        };
        assertCurrent();
        const lease = await options.prepareDispatch!({host: structuredClone(host), taskId: job.taskId, message: structuredClone(message),
          signal: originalSignal!, deadline: message.deadline, assertCurrent});
        const signed = {...message, signature: signRunnerJob(message, connected.token)}, sealed = canonical(signed);
        const assertBeforeSend = (actual: Record<string, unknown>) => {
          assertCurrent();
          if (canonical(actual) !== sealed) fail('UNAUTHORIZED', 'Remote payload changed after authorization');
          const result: unknown = lease.assertBeforeSend();
          if (result !== undefined) {
            void Promise.resolve(result).catch(() => {});
            fail('UNAUTHORIZED', 'Remote payload guard must be a synchronous trusted assertion');
          }
        };
        assertBeforeSend(signed);
        persist({...pending, hostId: host.id});
        dispatched = true;
        const response = await connected.session.exec(signed,
          {deadline: message.deadline, signal: originalSignal!, assertBeforeSend});
        if (response?.v !== 1 || response.jobId !== message.id || response.idempotencyKey !== message.idempotencyKey
          || response.kind !== message.kind || !['succeeded', 'failed', 'unknown', 'rejected'].includes(String(response.state))) {
          throw new ProtocolError('RESULT_UNKNOWN', 'Remote receipt did not match the original job');
        }
        runtime().saveCheckpoint(owner().taskId, `remote-runner-health:${host.id}`, {at: now(), state: 'ok'});
        const cursor = response.cursor as {repo?: string; deliveryId?: string; basedOnDeliveryId?: string} | undefined;
        const reconciled = reconcileDutyCursor(runtime().loadCheckpoint(job.taskId, 'developer-duty-cursor:v1') as DutyCursor | undefined, cursor);
        if (reconciled.cursor && !reconciled.conflict) runtime().saveCheckpoint(job.taskId, 'developer-duty-cursor:v1', reconciled.cursor);
        if (response.comment && typeof response.comment === 'object') runtime().saveCheckpoint(job.taskId, 'developer-duty-comment:v1', response.comment);
        const result: RemoteJobResult = {accepted: true, location: 'remote', hostId: host.id, reason: reconciled.conflict ? 'cursor conflict kept the local cursor' : 'remote receipt',
          receipt: response, redo: false};
        persist(result);
        audit({action: 'job', hostId: host.id, idempotencyKey: job.idempotencyKey, state: response.state, location: 'remote'});
        return result;
      } catch (error) {
        if (!dispatched) return persist({accepted:false,location:'remote',hostId:host.id,reason:'Remote dispatch was not authorized; no payload was sent',
          receipt:{v:1,jobId:message.id,idempotencyKey:message.idempotencyKey,kind:message.kind,state:'rejected',verification:'not-sent'},redo:false});
        reason = redactRunnerText(error instanceof Error ? error.message : 'remote failed',
          [options.secrets.get(host.tokenRef), options.secrets.get(host.keyRef)].filter((item): item is string => typeof item === 'string'));
        runtime().saveCheckpoint(owner().taskId, `remote-runner-health:${host.id}`, {at: now(), state: 'down'});
        return persist({...pending, hostId: host.id, reason});
      } finally {connected.session.close();}
    }
    assertActive();
    persist({...pending, location: 'local', reason});
    let localReceipt: Record<string, unknown>;
    try {localReceipt = options.localExecute ? await options.localExecute(job) : {state: 'failed', error: reason, verification: 'fixture'};}
    catch {return persist({...pending, location: 'local', reason: 'local execution result is unknown'});}
    const result: RemoteJobResult = {accepted: true, location: 'local', reason, receipt: localReceipt, redo: false};
    persist(result);
    audit({action: 'job', idempotencyKey: job.idempotencyKey, state: localReceipt.state, location: 'local', reason});
    return result;
  };
  const test = async (hostId: string) => {
    const host = readHost(hostId);
    if (!host) fail('NOT_FOUND', 'Remote host does not exist');
    const {token, session} = await connect(host);
    const message = {v: 1, id: ids(), idempotencyKey: `heartbeat-${host.id}-${now()}`, kind: 'heartbeat', payload: {}, sentAt: new Date(now()).toISOString()};
    let response: Record<string, unknown>;
    try {response = await session.exec({...message, signature: signRunnerJob(message, token)}, {deadline: new Date(now() + 60_000).toISOString()});}
    finally {session.close();}
    runtime().saveCheckpoint(owner().taskId, `remote-runner-health:${host.id}`, {at: now(), state: response.state === 'succeeded' ? 'ok' : 'down'});
    audit({action: 'test', hostId, state: response.state});
    return {hostId, state: response.state, heartbeatAt: response.heartbeatAt};
  };
  const mainOnly = (context: ToolContext) => {
    if (runtime().getTask(context.taskId).conversationId?.startsWith('desktop-subtask:')) fail('INVALID_ARGUMENT', 'Remote hosts are defined from the main conversation');
  };
  const descriptor = (name: string, presence: boolean, input: {[k: string]: unknown}, read = false): RegisteredTool['descriptor'] => ({
    name, version: RUNNER_TOOL_VERSION, inputSchema: input, outputSchema: {type: 'object', additionalProperties: true},
    sideEffect: read ? 'read' : 'local_write', requiredScopes: ['agent:delegate'], idempotencySupport: false, recoverySupport: true, requiresPresence: presence});
  const object = (properties: Record<string, unknown>, required: string[]) => ({type: 'object', additionalProperties: false, properties, required});
  const hostSchema = object({name: {type: 'string'}, address: {type: 'string'}, port: {type: 'integer'}, user: {type: 'string'},
    provider: {type: 'string', enum: ['huawei-ecs', 'vps', 'other']}, os: {type: 'string'}, arch: {type: 'string', enum: ['x86_64', 'aarch64']},
    limits: object({maxConcurrent: {type: 'integer'}, maxJobsPerMinute: {type: 'integer'}}, ['maxConcurrent', 'maxJobsPerMinute']),
    repos: {type: 'array', items: {type: 'string'}}, hostKeyFingerprint: {type: 'string'}, privateKey: {type: 'string'}, runnerToken: {type: 'string'},
    hostKey: {type: 'string'}, enabled: {type: 'boolean'}}, ['name', 'address', 'port', 'user', 'provider', 'os', 'arch', 'limits', 'repos', 'hostKeyFingerprint', 'privateKey', 'runnerToken', 'hostKey', 'enabled']);
  const tools: RegisteredTool[] = [
    {descriptor: descriptor(RUNNER_HOST_LIST, false, object({}, []), true), execute: async (_input, context) => {mainOnly(context); return {hosts: hosts().map(({keyRef: _key, tokenRef: _token, ...host}) => host)};}},
    {descriptor: descriptor(RUNNER_HOST_ADD, false, object({host: hostSchema}, ['host'])), execute: async (input, context) => {mainOnly(context); return propose('add', (input as {host?: unknown}).host);}},
    {descriptor: descriptor(RUNNER_HOST_UPDATE, false, object({id: {type: 'string'}, host: hostSchema}, ['id', 'host'])), execute: async (input, context) => {mainOnly(context); const raw = input as {id?: string; host?: unknown}; return propose('update', {...raw.host as object, id: raw.id});}},
    {descriptor: descriptor(RUNNER_HOST_REMOVE, false, object({id: {type: 'string'}}, ['id'])), execute: async (input, context) => {mainOnly(context); return propose('remove', input);}},
    {descriptor: descriptor(RUNNER_HOST_ENABLE, false, object({id: {type: 'string'}}, ['id'])), execute: async (input, context) => {mainOnly(context); return propose('enable', input);}},
    {descriptor: descriptor(RUNNER_HOST_DISABLE, false, object({id: {type: 'string'}}, ['id'])), execute: async (input, context) => {mainOnly(context); return propose('disable', input);}},
    {descriptor: descriptor(RUNNER_HOST_CONFIRM, true, object({proposalId: {type: 'string'}, digest: {type: 'string'}, summary: {type: 'string'}}, ['proposalId', 'digest', 'summary'])),
      execute: async (input, context) => {
        mainOnly(context);
        const raw = input as {proposalId?: string; digest?: string; summary?: string};
        const proposal = runtime().loadCheckpoint(owner().taskId, PROPOSAL_PREFIX + raw.proposalId) as {summary?: string} | undefined;
        if (!proposal || raw.summary !== proposal.summary) fail('REVISION_CONFLICT', 'Confirmation summary does not match');
        return {state: 'confirmed' as const, record: confirm(String(raw.proposalId), String(raw.digest))};
      }},
    {descriptor: descriptor(RUNNER_HOST_TEST, false, object({id: {type: 'string'}}, ['id'])), execute: async (input, context) => {mainOnly(context); return test(String((input as {id?: string}).id ?? ''));}},
    {descriptor: descriptor(RUNNER_HOST_JOBS, false, object({}, []), true), execute: async (_input, context) => {mainOnly(context); return {jobs: runtime().listCheckpointKeys(owner().taskId).filter(key => key.startsWith(JOB_PREFIX)).map(key => runtime().loadCheckpoint(owner().taskId, key))};}},
  ];
  return {tools, list: hosts, propose, confirm, test, jobs() {return runtime().listCheckpointKeys(owner().taskId).filter(key => key.startsWith(JOB_PREFIX)).map(key => runtime().loadCheckpoint(owner().taskId, key) as Record<string, unknown>);}, submit};
}

export function createLoopbackRunnerTransport(handle: (job: Record<string, unknown>, token: string) => Promise<Record<string, unknown>>): RemoteRunnerTransport {
  return {async connect(host, auth) {
    if (createHash('sha256').update(auth.hostKey).digest('hex') !== host.hostKeyFingerprint) fail('UNAUTHORIZED', 'Host key fingerprint mismatch');
    return {async exec(job) {
      if (job.signature && !verifyRunnerJob(job, auth.runnerToken)) return {v: 1, state: 'rejected', error: 'signature', jobId: job.id};
      return handle(job, auth.runnerToken);
    }, close() {}};
  }};
}

/** Local fallback uses the existing duty comment path. Unknown writes are not posted again. */
export function localDutyFallback(runtime: TaskRuntime, ports: DeveloperDutyPorts) {
  return async (job: RemoteJobRequest) => {
    if (job.kind !== 'developer-duty' || job.payload.action !== 'comment') return {state: 'failed', error: 'local fallback has no remote host', verification: 'fixture', location: 'local'};
    try {
      const attempt = await commitDeveloperDutyStatusComment(runtime, job.taskId, ports, String(job.payload.body ?? ''));
      return {state: 'succeeded', comment: attempt, location: 'local', verification: 'fixture'};
    } catch (error) {
      return {state: 'unknown', redo: false, location: 'local', error: error instanceof Error ? error.message : 'unknown'};
    }
  };
}
