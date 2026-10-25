# MOD-17 观测完成时间验收（2026-10-25）

目标 profile：`huawei_ict_agentarts`；需求：PA-011。本次只修正已有只读提供者的观测完成时间，
不新增权限、API 或 TraceGuard 能力，不改变接口冻结状态。

## 修复与源码

源码提交：`e09f4b899dea50ab28fa91c798d3f6c6975c842c`；
源码 tree：`4a853b98a6c0adcce056541fd9c2b1429f0b0767`；
分支：`codex/status-mod17-20261025`；隔离树：`.worktrees/status-mod17-20261025`。

旧实现在读取内存之前生成 `capturedAt`，同步内存探针耗时会使其早于实际采集完成。
修复将内存读取移到 `capturedAt` 之前；CPU 的 `sampledUntil` 仍保留独立采样边界。
回归用显式 Fake 探针在最终内存读取时推进注入时钟 100ms，验证这两个时间的不同含义。
公共输出 Schema、Desktop 和 desktop-control 实现均未修改。

## 作者验证

环境：Linux，Node `24.15.0`，npm `11.12.1`；本树独立 `npm ci --ignore-scripts` 与构建产物。

旧实现先执行 contracts/client build，再执行
`node --test packages/windows-client/test/system-observation.test.mjs`：exit 1，12 通过、1 失败。
唯一失败为新增时间回归：实际 `.000Z`、预期 `.100Z`。
原失败日志文件名 `status-mod17-before.log`，SHA-256：
`e7b18fe311e1170b5fbabee09304c2ca1781463578fa4969163d37b7e8903a13`。
旧红日志未单独记录 UTC 起止；不据此补造时间。

修复后于 `2026-10-25T06:09:14Z` 至 `2026-10-25T06:09:25Z` 顺序执行：

```sh
npm run build --workspace=@personal-agent/windows-client
npm run typecheck --workspace=@personal-agent/windows-client
npm run test --workspace=@personal-agent/windows-client
npm run check:architecture
```

全部 exit 0；模块测试 22/22、架构测试 3/3，无跳过。日志
`.cache/mod17-evidence/verification.log` SHA-256：
`069d3b565820f41dd7bf4f8af810338da453f944c2c8dd968f305e0be5759158`。
`git diff --check` 通过。

## 独立验收

验收者在 `.worktrees/next-modules-acceptance-20261025` 从同一基线独立安装依赖并构建 contracts/client，
将修复应用为 `82482ae540797878add3349d1c98a68e37571b51`，tree 与上述源码 tree 完全相同。

`2026-10-25T06:10:01.856882Z` 执行
`node --test packages/windows-client/test/system-observation.test.mjs`：wall 0.421s、exit 0、13/13。
日志 `.cache/next-modules-acceptance-20261025/mod17-3.log` SHA-256：
`df579b64ceef3583b1e077bbf5e44f7eed7255c60569120f2377732b1f461ef2`。

`2026-10-25T06:10:15.351520Z` 独立验收者用 Node ESM 直接调用未注入 probe 的
`createSystemObservationTool({sampleWindowMs: 10})`，使用当前 deadline 与 AbortSignal，
执行 `tool.execute({}, context)`，再经 `validateToolValue(tool.descriptor.outputSchema, result)`
校验输出，并断言 `source === 'node:os'`、`capturedAt >= sampledUntil` 且不晚于当前时间。
wall 0.375s、exit 0；实际输出 `sampledFrom=2026-10-25T06:10:15.700Z`、
`sampledUntil=capturedAt=2026-10-25T06:10:15.712Z`、`actualSampleWindowMs=11.47`。
日志 `.cache/next-modules-acceptance-20261025/mod17-live-linux.log` SHA-256：
`c0459eefa9f34a4ef2473e664ad4730e693bedd88bf8c944b4a2276e19af2375`。

直接采样的可复现命令（与原单行 ESM 命令逻辑相同）：

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {createSystemObservationTool, SYSTEM_OBSERVATION_SCOPE} from '@personal-agent/windows-client';
import {validateToolValue} from '@personal-agent/contracts';
const tool = createSystemObservationTool({sampleWindowMs: 10});
const start = Date.now();
const result = await tool.execute({}, {
  taskId: 'acceptance-system-local', runId: 'acceptance-system-local-1',
  authorizationRef: 'local-review-only', scopes: [SYSTEM_OBSERVATION_SCOPE],
  signal: new AbortController().signal, deadline: new Date(start + 5000).toISOString(),
});
validateToolValue(tool.descriptor.outputSchema, result);
assert.equal(result.source, 'node:os');
assert.ok(Date.parse(result.capturedAt) >= Date.parse(result.sampledUntil));
assert.ok(Date.parse(result.capturedAt) <= Date.now());
console.log(JSON.stringify({source: result.source, capturedAt: result.capturedAt,
  sampledFrom: result.sampledFrom, sampledUntil: result.sampledUntil,
  actualSampleWindowMs: result.actualSampleWindowMs,
  platform: process.platform, verified: 'direct-provider-only'}));
JS
```

此处 context 仅为直接调用参数，不代表已通过生产权限核验。

上述日志为本地忽略产物，未作为源码提交；摘要不保存 CPU/内存数值或设备身份。

## 验证边界

单元测试属于 Synthetic/Fake；额外采样属于真实 Linux `node:os` 直接 provider 验证。
两者均不证明 Windows、普通用户权限、Runtime/Policy/ToolGateway、Desktop、AgentArts 或真实账号完整链通过。
本轮没有 Windows/.NET 实机、云或账号调用，没有据此宣布整个 MOD-17 或 PA-011 完成。
