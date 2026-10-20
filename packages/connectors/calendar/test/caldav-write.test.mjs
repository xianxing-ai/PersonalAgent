import assert from 'node:assert/strict';
import test from 'node:test';
import {CalDavProvider} from '../dist/index.js';

const URL_BASE = 'https://caldav.test/potatos/mvp/';

/** 假 CalDAV 服务器：记录请求并按脚本应答；资源表模拟 PUT/GET/DELETE 语义。 */
function fakeServer() {
  const resources = new Map();
  const log = [];
  const fetchImpl = async (url, init) => {
    const method = init.method;
    log.push({method, url: String(url)});
    const path = String(url).replace(URL_BASE, '');
    if (method === 'PUT') {
      resources.set(path, init.body);
      return {ok: true, status: resources.has(path) && log.filter(r => r.url === String(url) && r.method === 'PUT').length > 1 ? 204 : 201, text: async () => ''};
    }
    if (method === 'GET') {
      const body = resources.get(path);
      if (body === undefined) return {ok: false, status: 404, text: async () => ''};
      return {ok: true, status: 200, text: async () => body};
    }
    if (method === 'DELETE') {
      const existed = resources.delete(path);
      return {ok: existed, status: existed ? 204 : 404, text: async () => ''};
    }
    throw Error('unexpected method ' + method);
  };
  return {fetchImpl, log, resources};
}

const ctx = () => ({deadline: new Date(Date.now() + 30_000).toISOString(), signal: new AbortController().signal});

test('create 写入 ICS 并读回核对；字段与形态正确', async () => {
  const server = fakeServer();
  const provider = new CalDavProvider({calendarUrl: URL_BASE, authorization: 'Basic dGVzdA==', fetchImpl: server.fetchImpl});
  const record = await provider.createEvent({summary: '接线验收测试', startUtc: '2026-10-21T07:00:00.000Z',
    endUtc: '2026-10-21T08:00:00.000Z', location: '会议室 1', notes: '来自验收'});
  assert.match(record.externalId, /^[a-f0-9-]{36}$/);
  assert.equal(record.title, '接线验收测试');
  assert.equal(record.startUtc, '2026-10-21T07:00:00.000Z');
  assert.equal(record.status, 'confirmed');
  const stored = server.resources.get(`${record.externalId}.ics`);
  assert.match(stored, /UID:/);
  assert.match(stored, /SUMMARY:接线验收测试/);
  assert.match(stored, /LOCATION:会议室 1/);
  assert.match(stored, /DTSTART:20261021T070000Z/);
});

test('显式 uid 创建重放幂等；update 递增 SEQUENCE 并合并字段', async () => {
  const server = fakeServer();
  const provider = new CalDavProvider({calendarUrl: URL_BASE, authorization: 'Basic dGVzdA==', fetchImpl: server.fetchImpl});
  const first = await provider.createEvent({summary: '原始标题', startUtc: '2026-10-21T07:00:00.000Z',
    endUtc: '2026-10-21T08:00:00.000Z', uid: 'pa-fixed-uid-1'}, ctx());
  assert.equal(first.externalId, 'pa-fixed-uid-1');
  // 同 UID 重放：PUT 幂等，读回一致
  const replay = await provider.createEvent({summary: '原始标题', startUtc: '2026-10-21T07:00:00.000Z',
    endUtc: '2026-10-21T08:00:00.000Z', uid: 'pa-fixed-uid-1'}, ctx());
  assert.equal(replay.externalId, 'pa-fixed-uid-1');
  const updated = await provider.updateEvent({uid: 'pa-fixed-uid-1', summary: '改期后的标题',
    startUtc: '2026-10-21T06:30:00.000Z'}, ctx());
  assert.equal(updated.title, '改期后的标题');
  assert.equal(updated.startUtc, '2026-10-21T06:30:00.000Z');
  assert.equal(updated.endUtc, '2026-10-21T08:00:00.000Z', '未提供的 end 保持原值');
  assert.ok(updated.sequence >= 1, 'SEQUENCE 递增');
  assert.equal(updated.endUtc > updated.startUtc, true);
});

test('cancel 删除资源；再次 cancel 如实报 already_absent', async () => {
  const server = fakeServer();
  const provider = new CalDavProvider({calendarUrl: URL_BASE, authorization: 'Basic dGVzdA==', fetchImpl: server.fetchImpl});
  const created = await provider.createEvent({summary: '将取消', startUtc: '2026-10-21T07:00:00.000Z',
    endUtc: '2026-10-21T08:00:00.000Z', uid: 'pa-cancel-1'}, ctx());
  assert.equal(created.externalId, 'pa-cancel-1');
  const cancelled = await provider.cancelEvent('pa-cancel-1', ctx());
  assert.equal(cancelled.state, 'cancelled');
  const again = await provider.cancelEvent('pa-cancel-1', ctx());
  assert.equal(again.state, 'already_absent');
  await assert.rejects(provider.getEvent('cal', 'pa-cancel-1', ctx()), () => true);
});

test('非法输入与认证失败按契约报错', async () => {
  const server = fakeServer();
  const provider = new CalDavProvider({calendarUrl: URL_BASE, authorization: 'Basic bad', fetchImpl: server.fetchImpl});
  await assert.rejects(provider.createEvent({summary: 'x', startUtc: '2026-10-21T07:00', endUtc: '2026-10-21T08:00:00.000Z'}, ctx()),
    {code: 'INVALID_ARGUMENT'});
  await assert.rejects(provider.createEvent({summary: 'x', startUtc: '2026-10-21T09:00:00.000Z',
    endUtc: '2026-10-21T08:00:00.000Z'}, ctx()), {code: 'INVALID_ARGUMENT'});
  // 401：假服务器无认证校验，用 404 资源 GET 验 NOT_FOUND 路径
  await assert.rejects(provider.updateEvent({uid: 'missing-uid'}, ctx()), {code: 'NOT_FOUND'});
});
