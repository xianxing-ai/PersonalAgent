import {ProtocolError} from '@personal-agent/contracts';

const fail = (code: 'INVALID_ARGUMENT' | 'UNAUTHORIZED' | 'RESULT_UNKNOWN', message: string): never => {
  throw new ProtocolError(code, message);
};

/** REST 评论请求。token 只放在 Authorization 头，不进入 URL 或错误文本。 */
export function githubCommentRequest(input: {apiBase: string; token: string; method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; path: string; json?: unknown}): {url: string; method: string; headers: Record<string, string>; body?: string} {
  if (!input.apiBase.trim() || input.path.includes('..') || !input.path.startsWith('/')) fail('INVALID_ARGUMENT', 'GitHub comment path is invalid');
  if (!input.token || input.token.length > 4096 || /[\r\n\x00]/.test(input.token)) fail('UNAUTHORIZED', 'GitHub credential unavailable');
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'personal-agent-developer-direction',
  };
  if (input.json !== undefined) headers['Content-Type'] = 'application/json';
  return {url: `${input.apiBase.replace(/\/$/, '')}${input.path}`, method: input.method, headers, ...(input.json === undefined ? {} : {body: JSON.stringify(input.json)})};
}

export interface GitHubCommentHttpResponse {ok: boolean; status: number; json: () => Promise<unknown>}

/** 用调用方注入的 fetch 访问评论 API。测试可以指向本机 mock 服务器。 */
export function createGitHubCommentHttpPort(options: {fetchImpl: (url: string, init: {method: string; headers: Record<string, string>; body?: string}) => Promise<GitHubCommentHttpResponse>; token: string; repo: string; number: number; apiBase?: string}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repo) || !Number.isInteger(options.number) || options.number < 1) fail('INVALID_ARGUMENT', 'GitHub comment target is invalid');
  const apiBase = options.apiBase ?? 'https://api.github.com';
  const send = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, json?: unknown) => {
    const request = githubCommentRequest({apiBase, token: options.token, method, path, ...(json === undefined ? {} : {json})});
    return options.fetchImpl(request.url, {method: request.method, headers: request.headers, ...(request.body === undefined ? {} : {body: request.body})});
  };
  return {
    writeAvailable: true as const,
    async listComments() {
      const response = await send('GET', `/repos/${options.repo}/issues/${options.number}/comments?per_page=100`);
      if (!response.ok) return 'unknown' as const;
      const body = await response.json();
      if (!Array.isArray(body) || body.some(item => !item || typeof item !== 'object' || !Number.isInteger((item as {id?: unknown}).id) || typeof (item as {body?: unknown}).body !== 'string')) return 'unknown' as const;
      return body.map(item => ({id: (item as {id: number}).id, body: (item as {body: string}).body}));
    },
    async createComment(body: string) {
      const response = await send('POST', `/repos/${options.repo}/issues/${options.number}/comments`, {body});
      if (!response.ok) return {state: 'unknown' as const};
      const created = await response.json() as {id?: unknown};
      return Number.isInteger(created.id) ? {state: 'confirmed' as const, id: created.id as number} : {state: 'unknown' as const};
    },
    async editComment(id: number, body: string) {
      const response = await send('PATCH', `/repos/${options.repo}/issues/comments/${id}`, {body});
      return {state: response.ok ? 'confirmed' as const : 'unknown' as const};
    },
    async deleteComment(id: number, _body: string) {
      const response = await send('DELETE', `/repos/${options.repo}/issues/comments/${id}`);
      if (!response.ok && response.status !== 204) return {state: 'unknown' as const};
      return {state: 'confirmed' as const};
    },
  };
}
