import {DUTY_STATUS_MARKER, buildPersonalView, interpretGitHubRateLimit} from '@personal-agent/github';

const API = 'https://api.github.com';

function headers(token, etag) {
  return {Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'personal-agent-duty',
    ...(etag ? {'If-None-Match': etag} : {})};
}

function disconnected(reason = 'not connected') {
  return {connected: false, gap: true, events: [], reason, evidenceLevel: 'unavailable'};
}

async function tokenOf(readCredential) {
  try {
    const token = await readCredential?.();
    if (typeof token !== 'string' || token.length < 8 || /[\s\u0000]/.test(token)) return undefined;
    return token;
  } catch { return undefined; }
}

async function call(fetchImpl, token, path, etag) {
  const response = await fetchImpl(`${API}${path}`, {headers: headers(token, etag)});
  const header = name => response.headers?.get?.(name) ?? response.headers?.[name];
  const rate = interpretGitHubRateLimit({status: response.status, headers: {'x-ratelimit-remaining': header('x-ratelimit-remaining'), 'retry-after': header('retry-after'), 'x-ratelimit-reset': header('x-ratelimit-reset')}});
  if (response.status === 304) return {notModified: true, etag: header('etag'), rate};
  if (!response.ok || rate.limited) return {failed: true, rate, status: response.status};
  return {body: await response.json(), etag: header('etag'), rate};
}

function eventOf(repo, item) {
  const type = item.type === 'PullRequestEvent' ? 'pull_request'
    : item.type === 'IssuesEvent' ? 'issue'
      : item.type === 'CheckRunEvent' ? 'check_run'
        : item.type === 'WorkflowRunEvent' ? 'workflow_run' : undefined;
  if (!type || !item.id) return undefined;
  const number = item.payload?.pull_request?.number ?? item.payload?.issue?.number ?? item.payload?.check_run?.pull_requests?.[0]?.number;
  const headSha = item.payload?.pull_request?.head?.sha ?? item.payload?.check_run?.head_sha;
  return {id: String(item.id), repo, type, deliveryId: String(item.id), receivedAt: item.created_at || new Date(0).toISOString(),
    ...(item.payload?.action ? {action: String(item.payload.action)} : {}),
    ...(Number.isInteger(number) ? {number} : {}),
    ...(typeof headSha === 'string' ? {headSha} : {})};
}

/** Read events, open pull requests and recent workflow runs. Any failure is a gap. */
export async function readGitHubDutyPage({repo, cursor, readCredential, fetchImpl = globalThis.fetch}) {
  const token = await tokenOf(readCredential);
  if (!token) return {repo, ...disconnected()};
  let eventsResponse;
  let pullsResponse;
  let runsResponse;
  try {
    [eventsResponse, pullsResponse, runsResponse] = await Promise.all([
      call(fetchImpl, token, `/repos/${repo}/events?per_page=30`, cursor?.etag),
      call(fetchImpl, token, `/repos/${repo}/pulls?state=open&per_page=20`),
      call(fetchImpl, token, `/repos/${repo}/actions/runs?per_page=10`),
    ]);
  } catch { return {repo, ...disconnected()}; }
  if (eventsResponse.failed || pullsResponse.failed || runsResponse.failed) {
    const limited = [eventsResponse, pullsResponse, runsResponse].some(item => item.rate?.limited);
    return {repo, ...disconnected(limited ? 'rate limited' : 'not connected'), ...(limited ? {rateLimited: true} : {})};
  }
  if (eventsResponse.notModified && !pullsResponse.body?.length && !runsResponse.body?.workflow_runs?.length) {
    return {repo, connected: true, gap: false, events: [], previousDeliveryId: cursor?.deliveryId, ...(cursor ? {next: cursor} : {}), reason: 'not modified', evidenceLevel: 'read'};
  }
  const events = [];
  if (!eventsResponse.notModified && Array.isArray(eventsResponse.body)) {
    for (const item of eventsResponse.body) {
      const event = eventOf(repo, item);
      if (event) events.push(event);
    }
  }
  const seen = new Set(events.map(event => event.deliveryId));
  if (Array.isArray(pullsResponse.body)) {
    for (const pull of pullsResponse.body) {
      const deliveryId = `pr-${pull.number}`;
      if (!Number.isInteger(pull.number) || seen.has(deliveryId)) continue;
      seen.add(deliveryId);
      events.push({id: deliveryId, repo, type: 'pull_request', deliveryId, receivedAt: pull.updated_at || new Date(0).toISOString(), number: pull.number, ...(pull.head?.sha ? {headSha: pull.head.sha} : {})});
    }
  }
  if (Array.isArray(runsResponse.body?.workflow_runs)) {
    for (const run of runsResponse.body.workflow_runs) {
      const deliveryId = `run-${run.id}`;
      if (!run.id || seen.has(deliveryId)) continue;
      seen.add(deliveryId);
      events.push({id: deliveryId, repo, type: 'workflow_run', deliveryId, receivedAt: run.updated_at || new Date(0).toISOString(), ...(run.head_sha ? {headSha: run.head_sha} : {}), ...(run.conclusion ? {action: String(run.conclusion)} : {})});
    }
  }
  const newest = events.at(-1)?.deliveryId ?? cursor?.deliveryId;
  const number = events.find(event => Number.isInteger(event.number))?.number;
  const body = events.slice(0, 8).map(event => [event.type, event.number, event.action, event.headSha].filter(Boolean).join(' ')).join('\n');
  return {repo, connected: true, gap: false, events, previousDeliveryId: cursor?.deliveryId,
    ...(newest ? {next: {repo, deliveryId: newest, ...(eventsResponse.etag ? {etag: eventsResponse.etag} : {})}} : {}),
    ...(number && body ? {statusComment: {number, body}} : {}),
    evidenceLevel: 'read'};
}

/** Idempotent marker comment. The token stays in this closure and is not returned. */
export function createGitHubDutyComments({repo, number, readCredential, fetchImpl = globalThis.fetch}) {
  const listPath = `/repos/${repo}/issues/${number}/comments?per_page=100`;
  return {
    async listComments() {
      const token = await tokenOf(readCredential);
      if (!token || !Number.isInteger(number)) return 'unknown';
      try {
        const response = await call(fetchImpl, token, listPath);
        if (response.failed || response.notModified || !Array.isArray(response.body)) return 'unknown';
        return response.body.filter(item => Number.isInteger(item.id) && typeof item.body === 'string').map(item => ({id: item.id, body: item.body}));
      } catch { return 'unknown'; }
    },
    async createComment(body) {
      const token = await tokenOf(readCredential);
      if (!token) return {state: 'unknown'};
      try {
        const response = await fetchImpl(`${API}/repos/${repo}/issues/${number}/comments`, {method: 'POST', headers: {...headers(token), 'Content-Type': 'application/json'}, body: JSON.stringify({body})});
        if (!response.ok) return {state: 'unknown'};
        const created = await response.json();
        return Number.isInteger(created.id) ? {state: 'confirmed', id: created.id} : {state: 'unknown'};
      } catch { return {state: 'unknown'}; }
    },
    async editComment(id, body) {
      const token = await tokenOf(readCredential);
      if (!token) return {state: 'unknown'};
      try {
        const response = await fetchImpl(`${API}/repos/${repo}/issues/comments/${id}`, {method: 'PATCH', headers: {...headers(token), 'Content-Type': 'application/json'}, body: JSON.stringify({body})});
        return {state: response.ok ? 'confirmed' : 'unknown'};
      } catch { return {state: 'unknown'}; }
    },
  };
}

export async function readGitHubPersonalView({readCredential, fetchImpl = globalThis.fetch}) {
  const token = await tokenOf(readCredential);
  if (!token) return {connected: false, reason: 'not connected', items: [], evidenceLevel: 'unavailable'};
  try {
    const user = await call(fetchImpl, token, '/user');
    if (user.failed || typeof user.body?.login !== 'string') return {connected: false, reason: user.rate?.limited ? 'rate limited' : 'not connected', items: [], evidenceLevel: 'unavailable'};
    const login = user.body.login;
    const assigned = await call(fetchImpl, token, '/issues?filter=assigned&state=open&per_page=20');
    const review = await call(fetchImpl, token, `/search/issues?q=${encodeURIComponent(`review-requested:${login} is:pr is:open`)}&per_page=20`);
    if (assigned.failed || review.failed) return {connected: false, reason: 'not connected', items: [], evidenceLevel: 'unavailable'};
    const assignedItems = (Array.isArray(assigned.body) ? assigned.body : []).filter(item => item.pull_request || item.number).map(item => ({repo: item.repository_url?.split('/repos/')[1] ?? '', number: item.number, title: String(item.title ?? ''), url: String(item.html_url ?? '')})).filter(item => item.repo);
    const reviewItems = (Array.isArray(review.body?.items) ? review.body.items : []).map(item => ({repo: item.repository_url?.split('/repos/')[1] ?? '', number: item.number, title: String(item.title ?? ''), url: String(item.html_url ?? '')})).filter(item => item.repo);
    return {connected: true, login, items: buildPersonalView({login, assigned: assignedItems, reviewRequested: reviewItems, failing: []}), evidenceLevel: 'read', marker: DUTY_STATUS_MARKER};
  } catch { return {connected: false, reason: 'not connected', items: [], evidenceLevel: 'unavailable'}; }
}
