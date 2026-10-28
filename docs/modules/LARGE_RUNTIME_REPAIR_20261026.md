# Runtime 长任务与启动恢复增量（2026-10-26）

目标 profile：`huawei_ict_agentarts`。工作树：`<source-worktree>/.worktrees/large-runtime-20261026`，分支：`codex/large-runtime-repair-20261026`。本包由 Astra High 接续原代理交付，主代理负责集成；本树未提交、推送或创建 PR。状态为 `review`，不代表整仓集成或真实云验收完成。

基线为主代理提供的 A10 已通过组合源码及独立物理 dist 副本，Git HEAD `b2fb20dd094743c411656b7e7703c8aae7571a8e` 不是完整 A10 内容身份。原基线的 234 份未提交文件按 `.cache/subagent-baseline-20261026.json` 的源码 hash 区分；本包仅有两份生产文件、两份测试文件与本文的增量，不应提交整棵工作树差异。

## 行为变化与边界

`startup-recovery.ts` 原先每次检查一个任务，为寻找其直属子任务会分页读取全部任务人口，再按 `desktop-subtask:<taskId>` 过滤。在全量启动检查中，对多个未完成任务重复该工作；本包改为给原 `TaskRuntime.listTasks` 传精确 `conversationId`，仍读取全部子任务页、传递固定 `snapshotSequence` 并防御性核对归属。恢复入口首次全局人口枚举保留。

未增加缓存、索引或状态机；没有截断历史、回执、终态、unknown、审批或完整子任务集合。原恢复接管前后的事实比较不变，检查期间新子任务会使原接管事实失效。每次读取仍是当前 Runtime 数据；查询异常不被转为空列表。该变化复用现有接口，无 Core wire、公共 Schema、数据库迁移或调用方接线变化。

`execution-capacity.ts` 原有进展扫描在发现首个新动作或首个重复动作后提前结束，可能漏查后续相同 `proposalId` 但参数不同的矛盾。现在动作去重计算可以跳过，但提案身份仍扫描；已有新进展不会被后续重复动作抹掉。未添加无界 Map 或第二份历史，原取消、期限、用户显式预算和确认状态不变。`coordination.ts` 的实际执行入口原已有独立提案身份冲突拒绝，因此这是防御性一致性修复，不能据本组反例宣称生产授权绕过或真实重复执行。

## 原失败与验证

- 容量新增反例在原源码下为 31 pass / 2 fail，原失败均是未抛出预期 `REVISION_CONFLICT`；原代理修复后 33/33。本次构建后的组合聚焦再次包含全部 33 项。
- 恢复人口新增测试在原 A10 dist 为 1 pass / 2 fail：251 总任务检查返回 251 行、3 次全局查询；131 子任务检查返回 132 行、2 次全局查询。失败为查询范围过宽，不是子任务漏读；迟到新子任务守卫原已通过。
- 修复后恢复人口 3/3：前者返回 0 行、1 次精确查询；后者返回完整 131 行、2 次精确查询，第二页使用同一水位，最旧未完成子任务仍阻止恢复；迟到新子任务仍使原恢复接管失败，父子均保持 created，零工具执行。
- Runtime build 与 typecheck 均 exit 0；5 份现有/新增聚焦测试合计 68/68，包括 72 次真实临时文件动作、完整 SQLite 回执、扩窗、显式限制、旧任务、确认读/写、unknown、审批、取消与接管事实变更。协调器为显式合成实现，无真实模型或云调用。
- 首次 `npm run build --workspace=@personal-agent/runtime` 因 Windows 命令解析报 `tsc is not recognized`，原日志保留。依赖中的 TypeScript 5.9.3 存在，随后固定 Node 直接运行本树同一 `typescript/bin/tsc -p apps/runtime/tsconfig.json`，没有重新安装或修改依赖。

固定执行环境：Windows x64、Node 24.15.0，`<source-worktree>/.cache/toolchains/node-v24.15.0-win-x64/node.exe`；PowerShell `C:/Program Files/PowerShell/7/pwsh.exe`。以下命令均在本包工作树执行，重型步骤与其他工作包串行：

```text
node --expose-gc .cache/large-runtime-startup-benchmark-20261026.mjs before
node node_modules/typescript/bin/tsc -p apps/runtime/tsconfig.json
node node_modules/typescript/bin/tsc -p apps/runtime/tsconfig.json --noEmit
node --test --test-concurrency=1 apps/runtime/test/execution-capacity.test.mjs apps/runtime/test/large-runtime-startup-population.test.mjs apps/runtime/test/startup-recovery.test.mjs apps/runtime/test/startup-recovery-core.test.mjs apps/runtime/test/progressive-development.test.mjs
node --expose-gc .cache/large-runtime-startup-benchmark-20261026.mjs after
```

## 同脚本 before / after 测量

真实 SQLite 内存库，人口均为合成非终态任务；目标任务没有子任务，其余为无关任务。每组预热一次，随后单任务 inspect 25 次，分位数用向上取整秩；原始样本全部保留。表中行数为 `listTasks` API 返回的任务行数，不是 SQLite 内部扫描计数。

| 总任务数 | P50 ms（前→后） | P95 ms（前→后） | max ms（前→后） | 25 次返回行（前→后） | 25 次查询（前→后） |
| --- | --- | --- | --- | --- | --- |
| 250 | 3.464 → 0.224 | 4.536 → 0.677 | 4.630 → 0.728 | 6,250 → 0 | 75 全局 → 25 精确 |
| 1,000 | 11.860 → 0.178 | 13.321 → 0.269 | 13.534 → 0.441 | 25,000 → 0 | 250 全局 → 25 精确 |
| 5,000 | 131.221 → 0.186 | 157.156 → 0.438 | 175.327 → 0.531 | 125,000 → 0 | 1,250 全局 → 25 精确 |

250 人口单次完整 recover：874.098 → 65.637 ms；返回行 63,000 → 250；查询 756 次全局 → 3 次全局加 251 次精确。两次均返回 250 个 retained 项，worker 启动为 0。其他两种人口未测完整 recover，不外推其耗时。

| 总任务数 | 采样最大 RSS bytes（前→后） | 采样最大 heapUsed bytes（前→后） |
| --- | --- | --- |
| 250 | 118,009,856 → 106,053,632 | 26,997,664 → 13,239,688 |
| 1,000 | 119,136,256 → 108,335,104 | 27,901,736 → 13,162,440 |
| 5,000 | 169,336,832 → 115,150,848 | 49,807,856 → 13,170,096 |

内存只在每次操作之后采样，包含进程已有对象及各人口组的进程内影响，不是进程全局峰值或独立人口的内存上限。before 和 after 为独立 Node 进程的一次本机运行；没有磁盘数据库、跨设备、事件循环、IPC、DOM 或正式平台性能验收，不宣称普遍 SLO 或任意大型项目完成保证。

## 源码绑定与交接

| 文件 | A10 SHA-256 | 修复后 SHA-256 |
| --- | --- | --- |
| startup-recovery.ts | `c8cd1c6bba51bd34440df8080a858b7b09c767c2a0d8a2eaa86d9912c97b66a5` | `b01d7fc3dfdef44be4a618b4999ab2bbc52fffcae686c9258c397dfaaa50b99f` |
| execution-capacity.ts | `59fc8c5f43260be90eb7610b5986c360bcffa7afc2c719734d461fb9ac401808` | `891e5efe04d702a53bef1c23fd2c42b2ae1d0dc5490e4169dd005586ca2f3a71` |
| execution-capacity.test.mjs | `51c7e41312ec4fa56f0fc435ddc7e1a52ab2986bee718a7a390f28e3aa06f3e7` | `5cce61ee6117d2b4bffc8fca63c51896d2004b999e0e5c1f6c93cb1d2c1f0adc` |

before 恢复 dist：`d6be4859104be608cbb70f0478dd2d1af900d2722a70989f7b7cf615a7f762a4`；after：`bf72e43291900834c3af55636c23baf35babd5b5ddb5526ea07e4a90a6721d03`。两次 `dist/index.js` 均为 `702e932cd8819bea295dd961f503f90641ea932497bd55c2e58e6c27fad3bd08`。

原始数据、日志、退出码和同脚本位于本树 `.cache/large-runtime-*20261026*`；其中 `large-runtime-startup-benchmark-before-20261026.json`、`...-after-20261026.json` 含所有原始耗时样本、查询和内存采样。`.cache/large-runtime-delivery/manifest.json` 绑定交付文件及证据 hash；`delta.patch` 仅包含相对 A10 的 5 文件增量，主代理应核对目标 before hash 再应用。缓存证据保持本地可审查，不包含模型正文、真实账号或密钥。

本包未跑整仓 `npm run check`，Runtime 集成的最终必要全检交由主代理在串行集成后完成；未验证 Electron、真实云/模型、设备或正式部署。本文和聚焦证据均不升级接口冻结状态，不以历史真实回执代替本次源码的真实服务验收。
