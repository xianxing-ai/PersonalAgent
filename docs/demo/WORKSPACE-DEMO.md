# 现实演示：知识笔记、工作台任务、天气与订阅

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Profile：`huawei_ict_agentarts`。本包基线：`3ed9751`，2026-09-30。
负责人：zemeng 演示资料工作包；正式装配归 P8，非作者评审由主控安排。
本包交付合成资料和操作旅程，不新增 Runtime、Renderer、连接器或正式配置。
模块归属仍以 [MODULE_ASSIGNMENTS](../MODULE_ASSIGNMENTS.md) 为准。

## 1. 准备与当前限制

[示例 Vault](../../apps/desktop/fixtures/demo-vault/README.md) 含四篇 UTF-8 Markdown。
所有人物、项目与会议信息均为 synthetic；天气与订阅没有预造的成功数据。
每次演示使用新副本，不改跟踪中的原始夹具，也不覆盖用户笔记。

当前基线的 `apps/desktop/electron/main.js` 仍通过旧目录配置装配
`knowledge.search@0.1.0-alpha.1`，管理页也是只读检索。
虽然 [知识包](../../packages/knowledge/README.md) 已提供受信选库和受控写入端口，
此基线未在主入口调用 `createTrustedKnowledgeTools`。
因此“主对话自己更新知识库”在本包中仍待 P8 接线和正式验收。
不能通过直接调用下方隔离检查替代 Runtime / Policy 审批或云端工具闭环。

P8 需将隔离副本绑定到已有 `createKnowledgeSourceConfig`，选定 `meeting.md`，
确认读权限、写权限与本会话出机许可，并组合公开 Runtime 工厂。
绑定由受信宿主产生的 `sourceId/configRevision`，不要手写正式配置或复制凭据。
重启后写入和出机许可须按现有宿主规则重新取得；来源文字不构成许可。
正式进程由主控管理，本指南不要求自动重启、迁移数据库或改现有用户配置。

## 2. 操作者逐条输入

在正式工作台的主对话依次执行；每一步读回后再继续。出现未配置、403、超时或
`waiting_reconciliation` 时记录该状态，不能用模型回答填补工具证据。

| 步骤 | 可直接输入的任务 | 验收依据 |
| --- | --- | --- |
| 读取 | 在我选定的星河演示知识库中查找“会议时长”，告诉我当前时长，并附笔记引用。 | `meeting.md` 命中“会议时长：30 分钟。”；记录实际行号和 revision。 |
| 小增量 | 仅在选定的 meeting.md 中，将“会议时长：30 分钟。”改为“会议时长：20 分钟。”，将“整理状态：待确认会议时长。”改为“整理状态：已按演示要求更新。”；保留其余内容。先给出差异，按审批流程执行，再重新读取。 | 仅两处替换；frontmatter、链接、块 ID 与其余字节保留；实际哈希匹配回执。 |
| 再读 | 重新检索“会议时长”，引用当前笔记，说明改了什么。 | 结果为 20 分钟；引用使用新 revision；旧引用应失效，不复述旧缓存。 |
| 工作台任务 | 请为星河项目整理一份三项演示准备清单：知识库读写、北京市当天天气、已配置订阅读取。报告哪些已验证、哪些仍缺条件，不替我标记完成。 | 工作台产生 taskId；用 task.get / task.list 读回状态和结果，与界面一致。 |
| 天气 | 查询北京市今天的天气，使用摄氏度，说明实际解析地点、预报日期、来源、获取时间及缓存状态。 | `weather.forecast` 实际结果；地点和日期正确，低置信度不得当作北京天气。 |
| 订阅目录 | 列出我已配置的订阅名称和标识；如果未配置，明确告诉我。 | `feeds.subscriptions` 实际返回；空目录不编造条目。 |
| 订阅条目 | 从刚才返回的目录中选择我指定的一项，读取最新 3 条，给出标题、来源链接与来源时间；没有更新就说明没有更新。 | `feeds.collect` 返回的条目、collection.state 和分页信息；HTTP 成功不等于有新条目。 |

“自己更新”指 Agent 根据上述明确任务提出补丁，经现有 Policy 和审批执行并读回。
本包没有新增无人值守循环、自动索引或自主发布。另一次修改必须重新读基线。
工作台提交是产品内任务，不是创建 Codex 聊天；单个 taskId 也不证明多 Agent 分派。
若需展示多 Agent，另取当前实际分派工具和父子任务记录，不能用清单文字冒充执行。

## 3. 公开消费入口

先按当前 Runtime 握手检查 operation，再按实际工具目录检查工具及版本。
下列工具入参交给既有 AgentArts / ToolGateway 链，不直接从 Renderer 导入模块。

| 接口 | 入参或消费方式 |
| --- | --- |
| `knowledge.search@0.1.0-alpha.1` | 当前旧只读入口：`{"query":"会议时长","limit":5}`。不能给它加 v1 字段。 |
| `knowledge.search@1.0.0` | P8 接线后：上述入参加宿主返回的 `sourceId`、`configRevision`。 |
| `knowledge.apply_note_patch@1.0.0` | `sourceId/configRevision/path/expectedSha256/edits`；精确两段替换见上表，hash 取当前字节，path 为 `meeting.md`。 |
| `@personal-agent/knowledge/filesystem` | 宿主 `openReadOnlyVault`：`search`、`readNote`、`readCitation`；引用包含 path/line/revision。 |
| `@personal-agent/knowledge/write` | 宿主 `openControlledVaultWriter` / `createKnowledgeWriteTool`；不自行签发权限。 |
| `weather.forecast@0.1.0-alpha.1` | `{"location":"北京市","locationQuery":"Beijing","units":"metric"}`；省略 date 取解析地点当地今天。 |
| `feeds.subscriptions@0.1.0-alpha.1` | `{}`；先取已有订阅 id。 |
| `feeds.collect@0.1.0-alpha.1` | `{"subscriptionId":"替换为实际返回的id","limit":3}`；分页使用原样 nextCursor，不解析或伪造。 |

任务入口为 `@personal-agent/client` 的既有 `Client.call`，经已连接的受信 transport。
以下是宿主调用片段，`client` 必须来自现有装配，不是浏览器控制台命令：

```js
// connect() 已完成握手；为这一次用户意图生成并保留 idempotencyKey。
const accepted = await client.call('task.submit', {
  goal: '请为星河项目整理知识库读写、天气与订阅读取的三项演示准备清单。',
  conversationId: 'workspace-demo-synthetic'
}, {idempotencyKey: crypto.randomUUID(), timeoutMs: 180000});
const task = await client.call('task.get', {taskId: accepted.taskId});
// 非终态沿原事件/查询入口继续跟进；不把 accepted 当作 succeeded。
```

订阅由现有 Desktop 订阅设置添加操作者选定的公开 RSS / Atom；本包不替用户订阅。
`feeds-host.js` 的配置在 prepare 时绑定，变更若显示 requiresRestart，交主控安排重载。
本会话读取及云端汇总许可开启后才调用；缺目录、未许可、失效或 HTTP 错误均如实显示。
天气使用已装配的真实提供者；本包不联网查询，也不提供密钥或模型调用脚本。

## 4. 隔离文件路径复验

下面只验证真实本地文件适配器，不经过云端、Runtime 或正式用户数据。
检查会在 `.cache/workspace-demo-*` 下创建新副本与独立 recovery，保留读回报告和备份。
测试上下文只用于此合成副本，不能用于正式产品授权或宣称 Policy 已验收。

仓库根目录、Windows PowerShell 7 中，使用仓库要求的 Node/npm。若缺依赖，执行：

```powershell
npm ci --workspace=@personal-agent/knowledge --include-workspace-root --ignore-scripts --no-audit --no-fund
npm run build --workspace=@personal-agent/contracts
npm run build --workspace=@personal-agent/coding-tools
npm run build --workspace=@personal-agent/knowledge
```

将下方唯一的 `js` 检查块提取到被忽略目录并运行；不更改初始 Vault：

```powershell
New-Item -ItemType Directory -Force .cache | Out-Null
$demoText = Get-Content docs/demo/WORKSPACE-DEMO.md -Raw -Encoding utf8
$demoBlock = [regex]::Match($demoText, '(?s)```js\r?\n// ISOLATED-VAULT-CHECK\r?\n(.*?)```')
if (-not $demoBlock.Success) { throw '未找到隔离检查' }
Set-Content .cache/check-workspace-demo.mjs $demoBlock.Groups[1].Value -Encoding utf8
$env:PA_TEST_POWERSHELL = (Get-Command pwsh -ErrorAction Stop).Source
node .cache/check-workspace-demo.mjs
if ($LASTEXITCODE -ne 0) { throw '隔离检查失败，保留现场，不继续演示写入' }
```

```js
// ISOLATED-VAULT-CHECK
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {cp, mkdir, mkdtemp, readFile, readdir, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {openReadOnlyVault} from '@personal-agent/knowledge/filesystem';
import {openControlledVaultWriter, createKnowledgeWriteTool, KNOWLEDGE_WRITE_SCOPES} from '@personal-agent/knowledge/write';

assert.equal(process.platform, 'win32');
assert.ok(process.env.PA_TEST_POWERSHELL, '需要 PowerShell 7 绝对路径');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
    : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const originalRoot = resolve('apps/desktop/fixtures/demo-vault');
const names = ['README.md', 'meeting.md', 'project.md', 'sources.md'];
assert.deepEqual((await readdir(originalRoot)).sort(), names);
const originals = new Map();
for (const name of names) {
  const bytes = await readFile(join(originalRoot, name));
  const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  assert.match(text, /^---\r?\ndata_class: synthetic\r?\nfixture_version: 1\r?\n---/);
  for (const match of text.matchAll(/\]\(([^)]+\.md)\)/g)) {
    await readFile(resolve(originalRoot, match[1]));
  }
  for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
    assert.ok(names.includes(match[1] + '.md'));
  }
  originals.set(name, bytes);
}
await mkdir('.cache', {recursive: true});
const base = await mkdtemp(resolve('.cache/workspace-demo-'));
const root = join(base, 'vault'), recovery = join(base, 'recovery');
await cp(originalRoot, root, {recursive: true, errorOnExist: true, force: false});
await mkdir(recovery);
const vault = await openReadOnlyVault({vaultId: 'synthetic-workspace-demo', rootPath: root});
const active = () => ({signal: new AbortController().signal, deadline: new Date(Date.now() + 30000).toISOString()});
const before = await vault.readNote({path: 'meeting.md', ...active()});
const search = await vault.search({query: '会议时长：30 分钟。', limit: 5, ...active()});
assert.equal(search.hits.length, 1);
const oldCitation = search.hits[0].source;
assert.equal(oldCitation.path, 'meeting.md');
assert.equal(await vault.readCitation({source: oldCitation, ...active()}), '会议时长：30 分钟。');
const edits = [
  {oldText: '会议时长：30 分钟。', newText: '会议时长：20 分钟。'},
  {oldText: '整理状态：待确认会议时长。', newText: '整理状态：已按演示要求更新。'}
];
let expected = before.content;
for (const edit of edits) {
  assert.equal(expected.split(edit.oldText).length, 2);
  expected = expected.replace(edit.oldText, edit.newText);
}
const input = {sourceId: 'synthetic-workspace-demo', configRevision: 1,
  path: 'meeting.md', expectedSha256: hash(originals.get('meeting.md')), edits};
const writer = openControlledVaultWriter({rootPath: root, recoveryRootPath: recovery,
  powerShellPath: process.env.PA_TEST_POWERSHELL, sourceId: input.sourceId,
  configRevision: 1, allowedNotePaths: ['meeting.md'], bindingCurrent: () => true});
const context = () => ({taskId: 'synthetic-isolated-check', runId: randomUUID(),
  authorizationRef: 'synthetic-test-only', argumentsDigest: hash(canonical(input)),
  scopes: [...KNOWLEDGE_WRITE_SCOPES], ...active()});
const tool = createKnowledgeWriteTool(writer);
await assert.rejects(tool.execute(input, {...context(), scopes: []}), error => error.code === 'SCOPE_DENIED');
assert.deepEqual(await readFile(join(root, 'meeting.md')), originals.get('meeting.md'));
const receipt = await tool.execute(input, context());
assert.equal(receipt.state, 'verified');
assert.equal(receipt.changed, true);
const after = await vault.readNote({path: 'meeting.md', ...active()});
assert.equal(after.content, expected);
assert.equal(after.revision, receipt.afterSha256);
assert.deepEqual(await readFile(join(recovery, receipt.backupId)), originals.get('meeting.md'));
await assert.rejects(vault.readCitation({source: oldCitation, ...active()}), error => error.code === 'SOURCE_CHANGED');
await assert.rejects(tool.execute(input, context()), error => error.code === 'REVISION_CONFLICT');
assert.equal((await vault.readNote({path: 'meeting.md', ...active()})).content, expected);
const updated = await vault.search({query: '会议时长：20 分钟。', limit: 5, ...active()});
assert.equal(updated.hits.length, 1);
const citation = updated.hits[0].source;
assert.equal(citation.revision, receipt.afterSha256);
assert.equal(await vault.readCitation({source: citation, ...active()}), '会议时长：20 分钟。');
for (const name of names) {
  assert.deepEqual(await readFile(join(originalRoot, name)), originals.get(name));
  if (name !== 'meeting.md') assert.deepEqual(await readFile(join(root, name)), originals.get(name));
}
const report = {profile: 'huawei_ict_agentarts', dataClass: 'synthetic',
  checkedAt: new Date().toISOString(), node: process.version,
  verification: 'isolated-filesystem-only', receipt, citation,
  checks: ['utf8-and-links', 'missing-scope-rejected', 'two-edits-only', 'backup-readback',
    'old-citation-rejected', 'stale-baseline-rejected', 'new-citation-readback', 'originals-unchanged'],
  notVerified: ['Runtime/Policy', 'Desktop', 'AgentArts', 'weather', 'feeds']};
await writeFile(join(base, 'readback.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({report: join(base, 'readback.json'), ...report}, null, 2));
```

## 5. 验收与交接记录

2026-09-30 22:29（Asia/Shanghai）已执行上述隔离检查，八项检查全部通过。
`meeting.md:8` 从 30 分钟更新为 20 分钟，写后 revision 为
`a1f28927fa894ea0306c35f7e246374a8e806c134ff203eee6c17f9703521e84`。
contracts、coding-tools、knowledge 三个依赖构建通过，未运行全套测试或启动应用。
实际环境为 Node 26.3.0 / npm 11.16.0，安装时出现 EBADENGINE：仓库要求
Node 24.15.x / npm 11.12.x。本结果不证明仓库指定版本兼容性，未为本包升级依赖。
本轮完整报告位于本机 `.cache/workspace-demo-dS1xhI/readback.json`；重复执行会产生新目录。
本轮隔离检查结果也见本次 Git 交付说明与本机 `.cache/workspace-demo-*/readback.json`；
这些本机回执不上传云端，也不提交 Git。未执行上方命令时不得预先记录通过。
每次正式演示另记代码提交、profile、来源配置版本、实际 taskId、工具运行标识、
任务终态、文件/天气/订阅读回，以及匹配的 AgentArts trace。
不要在公开记录保存密钥、绝对私人路径、订阅私密参数或原始私人 Evidence。

P8 后续验收：同一个选定来源贯穿设置、主对话检索、补丁写入与引用刷新；
工作台任务持久读回；真实天气；订阅许可、目录和实际条目；云端编排与本地记录对应。
本包不修改公共 Schema、数据库、锁文件或接口状态，不将上述场景标记整体完成。
