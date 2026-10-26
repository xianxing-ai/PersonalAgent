# 快照回执与资源边界修复（2026-10-26）

目标：`huawei_ict_agentarts` Competition Profile 的现有 Desktop 显示投影。工作树 `<source-worktree>/.worktrees/large-control-20261026`，分支 `codex/large-control-repair-20261026`，基线 `b2fb20dd094743c411656b7e7703c8aae7571a8e`。本记录只证明本地合成收发链；Runtime、真实 Electron、设备及 AgentArts 验收由主集成方另行处理。

## 故障与补丁

原链路在 Renderer 连续两次渲染异常时卡住：Renderer 仅立即请求一次 `snapshot.resync`，而第二次失败没有 ACK，Publisher 永久占用该窗口唯一 `inFlight`。即使 Runtime 的任务已经从 `running` 变为 `waiting_reconciliation` 且审批状态变化，后续 `mark` 也不能向可见窗口投影。原失败用例保持在 `.cache/xhigh-snapshot-20261026/before-render-recovery.log`：`0 pass / 1 fail`，断言读到旧 `running`，预期 `waiting_reconciliation`。

仅在 `snapshot-receiver.js` 的渲染异常路径回传精确 delivery token 加 `applied:false`，保留原渲染错误及上一个已提交基线；成功 ACK 仍只有 `generation` 和 `revision`。`snapshot-publisher.js` 只接受当前窗口当前代当前修订的这份负回执，释放占位、标记完整投影待发送。它不把失败视为渲染成功，也不因负回执自行热循环：已有更晚 `mark` 则按原节流发送，否则等待下一次真实 `mark` 或显式 resync。隐藏、重开、销毁及旧代回执仍按原生命周期处理。

这是 Desktop Main/Preload/Renderer 既有 `desktop:snapshot-ack` 私有宿主通道的可选失败回执；`preload.cjs` 原样转发 token，Main 只接受已登记窗口主 frame，未增加公共 Runtime/ToolGateway/Contracts 字段、依赖或迁移。旧两字段成功回执保持兼容。`applied:true`、多余字段、错代、错修订、重复或已销毁窗口的负回执都被拒绝。Renderer 原有一次立即 resync 不变。任务、审批、unknown 状态和 Evidence 的权威来源仍是 Runtime；资源策略不删除历史或活动任务，也不改变授权。

精确前后源码补丁：`.cache/xhigh-snapshot-20261026/snapshot-render-recovery.patch`，SHA-256 `b6381024adc09ad755b2e4ce3181b45713ca4bc96a35bce8bb11aa3ff7c82c6b`；它只包含两个生产文件、原测试断言及新增回归测试。当前 Windows 文件换行下，`git apply --reverse --check` 对补丁返回 0。原 `resource-policy.js`、`render-budget.js` 未修改。

| 文件 | 修复前 SHA-256 | 当前 SHA-256 |
| --- | --- | --- |
| `electron/snapshot-publisher.js` | `2ac4ab38dbfc01d271d42a642c20fe72ca16e0f3ac142c7b667bdd2a9774adb8` | `6c942f8aa6aab938a71dbe92df2e1a557ed64f8cb6b5b84ae4586b1a4e8f0258` |
| `src/shared/snapshot-receiver.js` | `992d917d13dd05889b8971c36d02ba9db85a1a15d4164bcb42cb75d1779c767b` | `c6df4db4b7ac0e33486e7fe0514c02b6715f54518c96c267a1011a094e78e376` |
| `test/snapshot-publisher.test.mjs` | `26716c88a3ff2173ddee6a637ba90a7db1c7a474e434240611f96eece75452f2` | `4b23a3c804b8d6cf4313c72d95d4bb763320c4c4b1bf46517c6c67df7a34c84f` |
| `test/xhigh-snapshot-render-recovery.test.mjs` | 新增 | `6e90789b81f161e57abc9e2752d9d2d90a32bec1d0133c1fb9a211571113b0a9` |
| `electron/resource-policy.js` | `7d2f0ba1a032205f83ee1c75b4674e152e1608655bf119e4451c91f249618c73` | 同左 |
| `src/shared/render-budget.js` | `d87aa51f1413517866d03557e3c3e934312d154e635609f62bf5d8b4caa6560e` | 同左 |

## 定向验证

使用固定 Node `<source-worktree>/.cache/toolchains/node-v24.15.0-win-x64/node.exe`，对当前源码运行：

```text
node --test --test-reporter=spec apps/desktop/test/xhigh-snapshot-render-recovery.test.mjs apps/desktop/test/snapshot-publisher.test.mjs apps/desktop/test/resource-policy.test.mjs apps/desktop/test/audio-level-publish.test.mjs
17 pass / 0 fail，exit 0
```

新增测试通过 TypeScript AST 抽取当前 `renderer.js` 的生产订阅回调，配合真实 Publisher/Receiver 与显式 Fake 投影：初始成功、连续两次失败、随后任务与审批恢复，最终没有 `inFlight` 或脏 topic；1 万次 `mark` 合并为一次发送，持续失败时空闲无定时热循环；慢回执、旧代、额外字段、关闭窗口、失败时基线与原始异常均有断言。修复后的首轮日志 `.cache/xhigh-snapshot-20261026/after-render-recovery.log` 为 `8 pass / 0 fail`；扩展定向日志 `.cache/xhigh-snapshot-20261026/focused-validation.log` 为 `19 pass / 0 fail`，其中包含音量与资源相关用例。计数有重叠，不能累加。

原资源性能记录 `apps/desktop/docs/MEMORY_RENDERING_20261024.md` 的 Node/SQLite/Electron 数据对应旧工作包，不能充当本补丁的 Electron 性能或真实设备回执。本轮未进行大构建、整仓 `npm run check`、Electron/真实桌面、低内存实体机、真实模型或 AgentArts 验收；主集成方在唯一重型时段合并后核验。当前补丁未提交、未推送、未创建 PR。
