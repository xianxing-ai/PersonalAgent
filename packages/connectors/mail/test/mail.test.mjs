import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  MAIL_CONNECTOR_VERSION,
  FakeMailProvider,
  MailConnector,
  MailService,
  QQMailProvider,
  decodeMailCursor,
  encodeMailCursor,
  messageFromImap,
  messageToItem,
  register,
} from '../dist/index.js';
import {FakeClock, FakeToolHost} from '@personal-agent/testkit';
import {ProtocolError, validateContract} from '@personal-agent/contracts';

const NOW = Date.parse('2026-09-07T02:00:00.000Z');
const ACCOUNT = 'qq-me';

function syntheticQQ({searchResult,fetchUids=[],abortSearch}={}){
  let released=0,fetches=0,searches=0;
  const provider=new QQMailProvider({user:'synthetic@qq.com',authCode:'SyntheticOnly'});
  provider.connect=async()=>({mailbox:{uidValidity:123,exists:5000},
    async getMailboxLock(){return{release(){released++;}};},
    async search(query,options){searches++;assert.deepEqual(query,{uid:'11:*'});assert.deepEqual(options,{uid:true});abortSearch?.();return searchResult;},
    async *fetch(uids,query,options){fetches++;assert.deepEqual(uids,[11,12]);assert.equal(options.uid,true);
      for(const uid of fetchUids)yield{uid,envelope:{subject:'Synthetic public header'},flags:new Set()};}});
  return {provider,input:{folder:'INBOX',cursor:{uidValidity:123,lastUid:10},limit:2},
    stats:()=>({released,fetches,searches})};
}

test('QQ failed UID search never becomes a completed empty page',async()=>{
  const f=syntheticQQ({searchResult:false});
  await assert.rejects(f.provider.fetchPage(ACCOUNT,f.input),{code:'EXTERNAL_FAILURE',message:'Mail UID search did not return a confirmed result'});
  assert.equal(f.input.cursor.lastUid,10);assert.deepEqual(f.stats(),{released:1,fetches:0,searches:1});
});
test('QQ missing or incomplete UID fetch fails without committing a cursor',async()=>{
  for(const fetchUids of [[],[11],[11,11],[11,13]]){
    const f=syntheticQQ({searchResult:[11,12,13],fetchUids});
    await assert.rejects(f.provider.fetchPage(ACCOUNT,f.input),{code:'EXTERNAL_FAILURE',message:'Mail UID fetch did not return the complete requested page'});
    assert.equal(f.input.cursor.lastUid,10);assert.deepEqual(f.stats(),{released:1,fetches:1,searches:1});
  }
});
test('QQ confirmed empty UID search preserves the cursor and completes normally',async()=>{
  const f=syntheticQQ({searchResult:[]}),page=await f.provider.fetchPage(ACCOUNT,f.input);
  assert.deepEqual(page,{messages:[],uidValidity:123,nextCursor:{uidValidity:123,lastUid:10},hasMore:false});
  assert.deepEqual(f.stats(),{released:1,fetches:0,searches:1});
});
test('QQ complete UID page keeps UID ordering and the remaining-page flag',async()=>{
  const f=syntheticQQ({searchResult:[13,12,11],fetchUids:[12,11]}),page=await f.provider.fetchPage(ACCOUNT,f.input);
  assert.deepEqual(page.messages.map(m=>m.uid),[11,12]);assert.deepEqual(page.nextCursor,{uidValidity:123,lastUid:12});assert.equal(page.hasMore,true);
  assert.deepEqual(f.stats(),{released:1,fetches:1,searches:1});
});
test('QQ cancellation still takes precedence over an unconfirmed search result',async()=>{
  const controller=new AbortController(),f=syntheticQQ({searchResult:false,abortSearch:()=>controller.abort()});
  await assert.rejects(f.provider.fetchPage(ACCOUNT,{...f.input,signal:controller.signal}),{code:'CANCELLED'});
  assert.deepEqual(f.stats(),{released:1,fetches:0,searches:1});
});

function makeService(fixtures, options = {}) {
  const provider = new FakeMailProvider(fixtures, options);
  const service = new MailService(provider, {now: () => NOW});
  return {provider, service};
}

test('游标编解码与畸形拒绝', () => {
  const cursor = {uidValidity: 1725686400, lastUid: 42};
  assert.equal(decodeMailCursor(encodeMailCursor(cursor)).lastUid, 42);
  assert.throws(() => decodeMailCursor('abc'), /malformed/i);
  assert.throws(() => decodeMailCursor('1:2:3'), /malformed/i);
});

test('增量分页：首页→次页→取尽；重复 fetch 同游标零新条目', async () => {
  const {service} = makeService();
  const page1 = await service.fetchInbox(ACCOUNT, {limit: 3});
  assert.equal(page1.items.length, 3);
  assert.ok(page1.hasMore);
  const page2 = await service.fetchInbox(ACCOUNT, {cursor: decodeMailCursor(page1.nextCursor), limit: 3});
  assert.equal(page2.items.length, 3);
  const page3 = await service.fetchInbox(ACCOUNT, {cursor: decodeMailCursor(page2.nextCursor), limit: 3});
  assert.equal(page3.items.length, 2);
  assert.equal(page3.hasMore, false);
  const again = await service.fetchInbox(ACCOUNT, {cursor: decodeMailCursor(page3.nextCursor), limit: 3});
  assert.equal(again.items.length, 0, '已消费的 UID 不重复投递');

  const all = [...page1.items, ...page2.items, ...page3.items];
  assert.equal(new Set(all.map(item => item.dedupeKey)).size, all.length, '跨页无重复');
  for (const item of all) validateContract('connectorItem', item);
});

test('条目语义：occurredAt 取 Date 头、缺失回退抓取时刻并标注、sensitivity=private', () => {
  const withDate = messageToItem(
    {uid: 2, folder: 'INBOX', from: 'a@b.c', to: 'me@qq.com', subject: 's', sentAt: '2026-09-05T08:30:00.000Z', seen: false},
    ACCOUNT,
    '2026-09-07T02:00:00.000Z',
  );
  assert.equal(withDate.occurredAt, '2026-09-05T08:30:00.000Z');
  assert.equal(withDate.sensitivity, 'private');
  assert.equal(withDate.externalId, 'INBOX:2');

  const noDate = messageToItem(
    {uid: 5, folder: 'INBOX', from: 'a@b.c', to: 'me@qq.com', subject: 's', sentAt: null, seen: false},
    ACCOUNT,
    '2026-09-07T02:00:00.000Z',
  );
  assert.equal(noDate.occurredAt, '2026-09-07T02:00:00.000Z');
  assert.match(noDate.contentRef, /无 Date 头/);
});

test('uidValidity 变化 → CURSOR_EXPIRED（文件夹重建需从头同步）', async () => {
  const {provider, service} = makeService();
  const page1 = await service.fetchInbox(ACCOUNT, {limit: 2});
  const stale = decodeMailCursor(page1.nextCursor);
  provider.rotateUidValidity();
  await assert.rejects(service.fetchInbox(ACCOUNT, {cursor: stale, limit: 5}), err => err.code === 'CURSOR_EXPIRED');
  const fresh = await service.fetchInbox(ACCOUNT, {limit: 2});
  assert.equal(fresh.items.length, 2, '新游标从头同步');
});

test('mark_seen 幂等且真实生效', async () => {
  const {provider, service} = makeService();
  const first = await service.markSeen(ACCOUNT, {folder: 'INBOX', uid: 2, idempotencyKey: 'k1'});
  const repeat = await service.markSeen(ACCOUNT, {folder: 'INBOX', uid: 2, idempotencyKey: 'k1'});
  assert.deepEqual(first, repeat);
  validateContract('connectorAction', first);
  assert.equal(first.state, 'confirmed');
  const page = await service.fetchInbox(ACCOUNT, {limit: 100});
  const seen = page.items.find(item => item.externalId === 'INBOX:2');
  assert.match(seen.contentRef, /已读/);
  await assert.rejects(service.markSeen(ACCOUNT, {folder: 'INBOX', uid: 999, idempotencyKey: 'k2'}), err => err.code === 'NOT_FOUND');
});

test('发送确认：messageId 进 externalId，幂等键重放返回一致结果且不重发', async () => {
  const {provider, service} = makeService();
  const first = await service.send(ACCOUNT, {to: 'lead@example.com', subject: '周报', text: '内容', idempotencyKey: 's1'});
  assert.equal(first.state, 'confirmed');
  validateContract('connectorAction', first);
  const repeat = await service.send(ACCOUNT, {to: 'lead@example.com', subject: '周报', text: '内容', idempotencyKey: 's1'});
  assert.deepEqual(first, repeat);
  assert.equal(provider.outbox().length, 1, '同幂等键只发一次');
});

test('发送超时 → state unknown（不是失败）：先核对结果，同键重放仍 unknown 不盲重发', async () => {
  const {provider, service} = makeService();
  const timed = await service.send(ACCOUNT, {to: 'lead@example.com', subject: '急', text: 'x', timeoutMs: 0, idempotencyKey: 't1'});
  assert.equal(timed.state, 'unknown');
  assert.equal(timed.externalId, undefined);
  assert.ok(timed.evidenceRefs.some(ref => ref.includes('unconfirmed')), '证据链标注未确认');
  const recheck = await service.send(ACCOUNT, {to: 'lead@example.com', subject: '急', text: 'x', timeoutMs: 30_000, idempotencyKey: 't1'});
  assert.equal(recheck.state, 'unknown', '同键核对不产生第二次发送');
  assert.equal(provider.outbox().length, 1, '只存在一封（可能已发出的）邮件');
});

test('输入校验：非法地址/主题/空幂等键拒绝', async () => {
  const {service} = makeService();
  await assert.rejects(service.send(ACCOUNT, {to: 'not-an-address', subject: 's', text: 'x', idempotencyKey: 'k'}), /email address/);
  await assert.rejects(service.send(ACCOUNT, {to: 'a@b.c', subject: '', text: 'x', idempotencyKey: 'k'}), /1\.\.500/);
  await assert.rejects(service.send(ACCOUNT, {to: 'a@b.c', subject: 's', text: 'x', idempotencyKey: ''}), /idempotencyKey/);
  void ProtocolError;
});

test('搜索与单条读取；不存在返回 NOT_FOUND', async () => {
  const {service} = makeService();
  const found = await service.search(ACCOUNT, '站会', {});
  assert.equal(found.items.length, 1);
  assert.match(found.items[0].contentRef, /站会纪要/);
  const item = await service.getItem(ACCOUNT, 'INBOX', 4);
  assert.equal(item.externalId, 'INBOX:4');
  assert.equal(item.occurredAt, '2026-11-01T05:30:00.000Z', 'Date 头原样保留（含跨 DST 事件）');
  await assert.rejects(service.getItem(ACCOUNT, 'INBOX', 99), err => err.code === 'NOT_FOUND');
});

test('连接器：manifest、健康状态、未连接拒绝、fetchChanges/getItem/performAction 全链路', async () => {
  const {service} = makeService();
  const connector = new MailConnector(service, MAIL_CONNECTOR_VERSION);
  validateContract('connector', connector.manifest);
  assert.equal(connector.manifest.accountTypes[0], 'qq');
  assert.equal(connector.manifest.authentication, 'password');
  assert.equal(connector.manifest.syncStrategy, 'incremental');
  assert.equal(connector.health().state, 'disconnected');
  await assert.rejects(connector.fetchChanges({accountRef: ACCOUNT, limit: 5}), err => err.code === 'UNAUTHORIZED');
  connector.connect();

  const page = await connector.fetchChanges({accountRef: ACCOUNT, limit: 4});
  assert.equal(page.items.length, 4);
  assert.ok(page.hasMore);
  assert.match(page.nextCursor, /^\d+:\d+$/);
  const page2 = await connector.fetchChanges({accountRef: ACCOUNT, cursor: page.nextCursor, limit: 4});
  const overlap = page.items.filter(item => page2.items.some(other => other.externalId === item.externalId));
  assert.equal(overlap.length, 0);

  const direct = await connector.getItem(ACCOUNT, 'INBOX:3');
  assert.equal(direct.externalId, 'INBOX:3');

  const seen = await connector.performAction({accountRef: ACCOUNT, action: 'mark_seen', input: {folder: 'INBOX', uid: 3}, idempotencyKey: 'mk-1'});
  assert.equal(seen.state, 'confirmed');
  const sent = await connector.performAction({accountRef: ACCOUNT, action: 'send', input: {to: 'x@y.z', subject: 't', text: 'b'}, idempotencyKey: 'sd-1'});
  assert.equal(sent.state, 'confirmed');
  await assert.rejects(
    connector.performAction({accountRef: ACCOUNT, action: 'delete', input: {}, idempotencyKey: 'nope'}),
    err => err.code === 'UNSUPPORTED_CAPABILITY',
  );
});

test('messageFromImap：envelope 边界（缺 from/subject/date）映射稳定', () => {
  const full = messageFromImap(7, 'INBOX', {
    from: [{address: 'a@b.c', name: '甲'}], to: [{address: 'me@qq.com'}],
    subject: '标题', date: new Date('2026-09-06T09:00:00.000Z'), messageId: '<m1@x>',
  }, false);
  assert.equal(full.from, 'a@b.c');
  assert.equal(full.fromName, '甲');
  assert.equal(full.sentAt, '2026-09-06T09:00:00.000Z');
  assert.equal(full.messageId, '<m1@x>');

  const empty = messageFromImap(8, 'INBOX', {}, true);
  assert.equal(empty.from, 'unknown@unknown');
  assert.equal(empty.subject, '(无主题)');
  assert.equal(empty.sentAt, null);
  assert.equal(empty.seen, true);
});

test('工具 mail.inbox 经 FakeToolHost 的 schema 与 scope 校验', async () => {
  const clock = new FakeClock(NOW);
  const host = new FakeToolHost(clock.now);
  const provider = new FakeMailProvider();
  const dispose = register(host, {provider, accountRef: ACCOUNT, now: clock.now});
  const context = {taskId: 't', runId: 'r', signal: new AbortController().signal, deadline: '2026-09-07T03:00:00.000Z', authorizationRef: 'test', scopes: ['mail:read']};

  const page = await host.invoke('mail.inbox', {limit: 3}, context);
  assert.equal(page.items.length, 3);
  assert.equal(page.folder, 'INBOX');
  assert.equal(page.account, ACCOUNT, '单账号绑定时省略 account 即默认路由');
  for (const item of page.items) validateContract('connectorItem', item);
  const page2 = await host.invoke('mail.inbox', {cursor: page.nextCursor, limit: 3}, context);
  assert.equal(page2.items.length, 3);
  await assert.rejects(host.invoke('mail.inbox', {}, {...context, scopes: []}), err => err.code === 'SCOPE_DENIED');
  await assert.rejects(host.invoke('mail.inbox', {cursor: 'garbage'}, context), err => err.code === 'INVALID_ARGUMENT');
  assert.throws(() => register(host, {}), /provider must be explicitly configured/);
  dispose();
});

test('多账号：同一实例绑定两个邮箱，游标与幂等键按账号隔离', async () => {
  const {MailAccountRegistry, RegistryMailProvider, MailService} = await import('../dist/index.js');
  const work = new FakeMailProvider();
  const personal = new FakeMailProvider();
  const registry = new MailAccountRegistry();
  registry.bind('work', work, 'work@qq.com');
  registry.bind('personal', personal, 'me@qq.com');
  assert.deepEqual(registry.list().map(a => a.accountRef), ['work', 'personal']);
  assert.equal(registry.bind('work', work, 'work@qq.com').rebound, true, '重复 bind 为换绑');

  const provider = new RegistryMailProvider(registry);
  const service = new MailService(provider, {now: () => NOW});
  const pageWork = await service.fetchInbox('work', {limit: 4});
  const pagePersonal = await service.fetchInbox('personal', {limit: 4});
  assert.equal(pageWork.items.length, 4);
  assert.equal(pagePersonal.items.length, 4);
  assert.equal(new Set([...pageWork.items, ...pagePersonal.items].map(i => `${i.accountRef}:${i.externalId}`)).size, 8, '条目按账号归属');

  // 游标隔离：账号 A 的游标推到 4，账号 B 仍从头
  const personalFirst = await service.fetchInbox('personal', {cursor: undefined, limit: 1});
  assert.ok(personalFirst.items.length === 1);

  // 同一幂等键在不同账号互不影响（各自的提供商实例）
  const w = await service.markSeen('work', {folder: 'INBOX', uid: 2, idempotencyKey: 'same-key'});
  const p = await service.markSeen('personal', {folder: 'INBOX', uid: 3, idempotencyKey: 'same-key'});
  assert.equal(w.state, 'confirmed');
  assert.equal(p.state, 'confirmed');

  await assert.rejects(service.fetchInbox('nobody', {limit: 3}), err => err.code === 'UNAUTHORIZED' && /bound: work, personal/.test(err.message));
  assert.equal(registry.unbind('personal'), true);
  await assert.rejects(service.fetchInbox('personal', {limit: 3}), err => err.code === 'UNAUTHORIZED' && /bound: work/.test(err.message));
  assert.equal(new RegistryMailProvider(registry).verification, 'mock', '全 Fake 绑定时 verification 诚实为 mock');
});

test('多账号工具：mail.inbox 必须指定 account；mail.accounts 列出绑定', async () => {
  const clock = new FakeClock(NOW);
  const host = new FakeToolHost(clock.now);
  const {MailAccountRegistry} = await import('../dist/index.js');
  const registry = new MailAccountRegistry();
  registry.bind('work', new FakeMailProvider(), 'work@qq.com');
  registry.bind('personal', new FakeMailProvider(), 'me@qq.com');
  const dispose = register(host, {provider: new FakeMailProvider(), accountRef: 'main', registry, now: clock.now});
  const context = {taskId: 't', runId: 'r', signal: new AbortController().signal, deadline: '2026-09-07T03:00:00.000Z', authorizationRef: 'test', scopes: ['mail:read']};

  const listed = await host.invoke('mail.accounts', {}, context);
  assert.deepEqual(listed.accounts.map(a => a.accountRef), ['work', 'personal', 'main'], '注册表按绑定插入序列出');

  const toDefault = await host.invoke('mail.inbox', {limit: 2}, context);
  assert.equal(toDefault.account, 'main', '显式默认账号（accountRef）优先');
  const routed = await host.invoke('mail.inbox', {account: 'personal', limit: 2}, context);
  assert.equal(routed.account, 'personal');
  await assert.rejects(host.invoke('mail.inbox', {account: 'ghost', limit: 2}, context), err => err.code === 'UNAUTHORIZED');
  dispose();

  // 默认账号被解绑且剩多个账号时，省略 account 必须报错并列出可选项
  const host2 = new FakeToolHost(clock.now);
  const registry2 = new MailAccountRegistry();
  registry2.bind('a1', new FakeMailProvider(), 'a1@qq.com');
  registry2.bind('a2', new FakeMailProvider(), 'a2@qq.com');
  const dispose2 = register(host2, {provider: new FakeMailProvider(), accountRef: 'main2', registry: registry2, now: clock.now});
  registry2.unbind('main2');
  await assert.rejects(host2.invoke('mail.inbox', {limit: 2}, context), err => err.code === 'INVALID_ARGUMENT' && /a1, a2/.test(err.message));
  dispose2();
});


test('分页验收：limit=4 而提供商每页 3 条，依次返回 1–4、5–8（游标不提前推进）', async () => {
  const {service} = makeService(undefined, {pageSize: 3});
  const page1 = await service.fetchInbox(ACCOUNT, {limit: 4});
  assert.deepEqual(page1.items.map(i => i.externalId), ['INBOX:1', 'INBOX:2', 'INBOX:3', 'INBOX:4']);
  assert.equal(page1.nextCursor, '1725686400:4', '游标推进到实际返回的最后一条，而不是超额取回的第 6 条');
  assert.equal(page1.hasMore, true);
  const page2 = await service.fetchInbox(ACCOUNT, {cursor: decodeMailCursor(page1.nextCursor), limit: 4});
  assert.deepEqual(page2.items.map(i => i.externalId), ['INBOX:5', 'INBOX:6', 'INBOX:7', 'INBOX:8']);
  assert.equal(page2.hasMore, false, '5–8 已取尽；此前游标提前推进时这里会因跳页而误报 false 的反面');
  const page3 = await service.fetchInbox(ACCOUNT, {cursor: decodeMailCursor(page2.nextCursor), limit: 4});
  assert.equal(page3.items.length, 0);
  assert.equal(page3.hasMore, false);
});

test('并发同键发送只调用一次 SMTP（异步 stub，禁止真实发送）', async () => {
  let sendCalls = 0;
  const slowProvider = new FakeMailProvider();
  slowProvider.send = async (accountRef, input) => {
    sendCalls += 1;
    await new Promise(resolve => setTimeout(resolve, 5));
    return {state: 'confirmed', messageId: '<slow-' + input.idempotencyKey + '>'};
  };
  const service = new MailService(slowProvider, {now: () => NOW});
  const [first, second] = await Promise.all([
    service.send(ACCOUNT, {to: 'a@b.c', subject: 's', text: 't', idempotencyKey: 'concurrent-1'}),
    service.send(ACCOUNT, {to: 'a@b.c', subject: 's', text: 't', idempotencyKey: 'concurrent-1'}),
  ]);
  assert.equal(sendCalls, 1, '两次并发只调用一次提供商 sendMail');
  assert.deepEqual(first, second);
  assert.equal(first.state, 'confirmed');
});

test('同幂等键更换收件人/主题/正文 → 参数冲突拒绝', async () => {
  const {service} = makeService();
  await service.send(ACCOUNT, {to: 'a@b.c', subject: 's', text: 't', idempotencyKey: 'kx'});
  await assert.rejects(service.send(ACCOUNT, {to: 'other@b.c', subject: 's', text: 't', idempotencyKey: 'kx'}), err => err.code === 'INVALID_ARGUMENT' && /different recipient/.test(err.message));
  await assert.rejects(service.send(ACCOUNT, {to: 'a@b.c', subject: 's2', text: 't', idempotencyKey: 'kx'}), /different recipient/);
  await assert.rejects(service.send(ACCOUNT, {to: 'a@b.c', subject: 's', text: 't2', idempotencyKey: 'kx'}), /different recipient/);
});

test('两个邮箱的相同 UID 不产生相同 dedupeKey（含账号与 uidValidity）', async () => {
  const {MailAccountRegistry, RegistryMailProvider} = await import('../dist/index.js');
  const registry = new MailAccountRegistry();
  registry.bind('work', new FakeMailProvider(), 'work@qq.com');
  registry.bind('personal', new FakeMailProvider(), 'me@qq.com');
  const service = new MailService(new RegistryMailProvider(registry), {now: () => NOW});
  const work = await service.fetchInbox('work', {limit: 8});
  const personal = await service.fetchInbox('personal', {limit: 8});
  const workKeys = new Set(work.items.map(i => i.dedupeKey));
  for (const item of personal.items) assert.ok(!workKeys.has(item.dedupeKey), '跨账号同 UID 必须不撞 dedupeKey');
  assert.ok(work.items[0].dedupeKey.startsWith('work:'), 'dedupeKey 以账号开头');

  const {provider, service: single} = makeService();
  const before = (await single.fetchInbox(ACCOUNT, {limit: 1})).items[0].dedupeKey;
  provider.rotateUidValidity();
  const after = (await single.fetchInbox(ACCOUNT, {limit: 1})).items[0].dedupeKey;
  assert.notEqual(before, after, 'uidValidity 轮换后同一 UID 的 dedupeKey 改变');
});

const LIVE = process.env.PA_MAIL_LIVE === '1';
const LIVE_SKIP = LIVE ? false : 'set PA_MAIL_LIVE=1, PA_QQ_MAIL_USER and PA_QQ_MAIL_AUTH_CODE to run the real QQ read-back';

test('live QQ mail read-back (read-only, no send)', {skip: LIVE_SKIP}, async () => {
  const {QQMailProvider} = await import('../dist/index.js');
  const provider = new QQMailProvider({user: process.env.PA_QQ_MAIL_USER, authCode: process.env.PA_QQ_MAIL_AUTH_CODE});
  try {
    const folders = await provider.listFolders('live');
    assert.ok(folders.some(folder => folder.role === 'inbox'), `folders: ${JSON.stringify(folders)}`);
    const page = await provider.fetchPage('live', {folder: 'INBOX', limit: 5});
    assert.ok(Array.isArray(page.messages));
    assert.ok(page.uidValidity > 0, 'uidValidity captured for cursor semantics');
  } finally {
    await provider.dispose();
  }
});

test('live QQ mail send (opt-in separately, sends a real message)', {skip: process.env.PA_MAIL_LIVE_SEND === '1' ? false : 'set PA_MAIL_LIVE=1, PA_MAIL_LIVE_SEND=1, PA_QQ_MAIL_USER, PA_QQ_MAIL_AUTH_CODE and PA_QQ_MAIL_TO to send a real test mail'}, async () => {
  const {QQMailProvider} = await import('../dist/index.js');
  const provider = new QQMailProvider({user: process.env.PA_QQ_MAIL_USER, authCode: process.env.PA_QQ_MAIL_AUTH_CODE});
  try {
    const result = await provider.send('live', {
      to: process.env.PA_QQ_MAIL_TO,
      subject: 'PersonalAgent MOD-21 发送链路验证',
      text: '这是 MOD-21 邮件连接器的真实发送验证邮件，可忽略。',
      timeoutMs: 30_000,
      idempotencyKey: `mod21-live-${Date.now()}`,
    });
    assert.equal(result.state, 'confirmed', JSON.stringify(result));
  } finally {
    await provider.dispose();
  }
});

test('指纹无歧义：subject/text 换行拼接的不同 payload 不得撞指纹（goo122 09-13 P1）', async () => {
  const {service} = makeService();
  await service.send(ACCOUNT, {to: 'a@b.c', subject: 'A\nB', text: 'C', idempotencyKey: 'fp-1'});
  await assert.rejects(
    service.send(ACCOUNT, {to: 'a@b.c', subject: 'A', text: 'B\nC', idempotencyKey: 'fp-1'}),
    err => err.code === 'INVALID_ARGUMENT' && /different recipient/.test(err.message),
    '换行歧义碰撞必须被拒绝',
  );
});

test('Provider 层单飞：QQMailProvider 注入假 transporter，并发同键只触发一次 sendMail', async () => {
  const {QQMailProvider} = await import('../dist/index.js');
  const provider = new QQMailProvider({user: 'x@qq.com', authCode: 'code'});
  let sendMailCalls = 0;
  Object.defineProperty(provider, 'transporter', {
    get: () => fakeTransporter,
    set: value => { fakeTransporter = value; },
  });
  let fakeTransporter = {
    sendMail: async mail => {
      sendMailCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return {messageId: '<stub-' + sendMailCalls + '>'};
    },
    close: () => {},
  };
  try {
    const [a, b] = await Promise.all([
      provider.send(ACCOUNT, {to: 'a@b.c', subject: 's', text: 't', timeoutMs: 30_000, idempotencyKey: 'cc-1'}),
      provider.send(ACCOUNT, {to: 'a@b.c', subject: 's', text: 't', timeoutMs: 30_000, idempotencyKey: 'cc-1'}),
    ]);
    assert.equal(sendMailCalls, 1, 'Provider 层并发同键只调一次 sendMail');
    assert.deepEqual(a, b);
    // Provider 层同样绑定输入：同键不同正文拒绝
    await assert.rejects(
      provider.send(ACCOUNT, {to: 'a@b.c', subject: 's', text: 'DIFFERENT', timeoutMs: 30_000, idempotencyKey: 'cc-1'}),
      err => err.code === 'INVALID_ARGUMENT',
    );
  } finally {
    await provider.dispose();
  }
});

test('复合键无歧义：a:b+c 与 a+b:c 在旧拼接下同键，结构化编码后必须独立（goo122 09-14 复审）', async () => {
  let providerSends = 0;
  const provider = new FakeMailProvider();
  const realSend = provider.send.bind(provider);
  provider.send = (accountRef, input) => {
    providerSends += 1;
    return realSend(accountRef, input);
  };
  const service = new MailService(provider, {now: () => NOW});
  // 旧算法 `${accountRef}:${key}`：'a:b'+'c' 与 'a'+'b:c' 都拼成 "a:b:c" —— 真碰撞。
  // 第二次会错误重放第一次的结果（同输入指纹时）或撞指纹拒绝（不同输入时）。
  // 结构化编码 JSON.stringify([accountRef, key]) 后两键不同：两次独立发送、两个不同 externalId。
  const first = await service.send('a:b', {to: 'x@y.z', subject: 's1', text: 't1', idempotencyKey: 'c'});
  const second = await service.send('a', {to: 'x@y.z', subject: 's1', text: 't1', idempotencyKey: 'b:c'});
  assert.equal(first.state, 'confirmed');
  assert.equal(second.state, 'confirmed');
  assert.notEqual(first.externalId, second.externalId, '两个独立请求各有自己的 externalId，不是重放');
  assert.equal(providerSends, 2, 'provider 被调用两次，不是一次（旧算法会错误命中第一次的结果）');
  // 同键同输入重放仍然一致
  const replay = await service.send('a:b', {to: 'x@y.z', subject: 's1', text: 't1', idempotencyKey: 'c'});
  assert.deepEqual(first, replay);
  assert.equal(providerSends, 2, '重放不新增 provider 调用');
});
