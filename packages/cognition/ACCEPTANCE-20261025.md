# MOD-28 本地诊断验收记录（2026-10-25）

本轮只复核现有实现，没有确认可复现缺陷，没有 production 改动。
验证源码为 `ad1a045e1ec65f9ef280125d9df78b9cb63b4e51`，所在隔离工作树为
`/workspace/PersonalAgent/.worktrees/cognition-mod28-20261025`。
工具链实测 Node `v24.15.0`；仅复用工具链，依赖和构建产物使用本工作树。

记录整理时环境 UTC 为 `2026-10-25T06:27:51Z`。原始运行未单独记录各命令的
UTC 开始/结束时间或完整 wall time，不补造。测试 runner 原日志报告
`duration_ms 3926.754711`，该值不是整个 npm 命令耗时。

## 范围与结果

- `npm test --workspace=@personal-agent/cognition` 退出 0，339 tests 全部通过，
  无失败、取消或跳过。该 workspace 全量包含 dev-workflows 测试，不能解释成
  339 项独立认知核心测试；本轮没有修改 dev-workflows。
- `npm run typecheck --workspace=@personal-agent/cognition` 退出 0。
- meeting replay、impact evaluation 均退出 0。合成 evaluation 的 16 个决策
  全部符合期望，false positive/false negative 均为 0；naive reference 为 5/16。
  这 16 个决策属于同一 mock 示例结果，不与 workspace tests 或 replay 叠加计数。
- 阅读并追查 `analyzeImpact`、最小依赖修复、Goal/Fact scope、修复预检与 CAS 路径。
  实际消费者包括 `apps/runtime/src/application/proactive-cognition-host.ts` 的 scope
  与候选构建路径，以及 `packages/cognition/src/reviewed-meeting.ts`；这是静态追查，
  不代表本轮单独执行了完整 Runtime 或桌面链路。
- 源码验证结束时工作树 clean，`git diff --check` 退出 0；本报告与 README 链接为随后
  保存的文档，不影响上述源码基线。

## 复现命令

在上述工作树执行，确保依赖已就绪；不要引用其他工作树的 dist：

```bash
export PATH=/workspace/PersonalAgent/.worktrees/image-reliability-integration-20261023/.cache/toolchain/node-v24.15.0-linux-x64/bin:$PATH
node --version
npm test --workspace=@personal-agent/cognition > .cache/cognition-mod28-tests.log 2>&1
npm run typecheck --workspace=@personal-agent/cognition > .cache/cognition-mod28-typecheck.log 2>&1
node packages/cognition/examples/meeting-replay.mjs > .cache/cognition-mod28-replay.log 2>&1
node packages/cognition/examples/impact-evaluation.mjs > .cache/cognition-mod28-evaluation.log 2>&1
```

测试脚本已先构建 goals 与 cognition。示例执行使用其后生成的本工作树 dist。
原始日志保存在上述工作树的被忽略 `.cache/`，没有随文档提交；下列 hash 绑定本轮
原始字节，重新运行时测试时序等变化可能导致不同 hash。

| 原日志 | SHA256 |
| --- | --- |
| `.cache/cognition-mod28-tests.log` | `9142f519fc0f8883fd06e4e06a3a087ea653b9ac7edfb034bd1b08efc2ce7fa0` |
| `.cache/cognition-mod28-typecheck.log` | `6c2962099f1c923ab609e734137109ce63dc3b3657b40d376080e505f90748d4` |
| `.cache/cognition-mod28-replay.log` | `bdfcca9a5d839955a08908311e47f662b9c255a7a14889e7a3e03ac2d0eab179` |
| `.cache/cognition-mod28-evaluation.log` | `8177b748bf08bd943c21af94323b84e7dee763c314f17907753f8bf94519803e` |

## 验收边界与不足

这些结果验证现有版本引用传播、KEEP/RECHECK/REVISE 提案、最小修复与相关本地
失败路径，不构成事件驱动完整计划修复已经生产可用的声明。replay 明确报告
`verification: mock`、`externalActionsExecuted: false`。本轮没有真实云账号调用、
AgentArts 部署、Windows/OS/设备操作或外部工具写入，没有执行完整跨模块 check，
没有新建 SQLite 合成表或声称真实持久恢复端到端验收。源码无修复提交；后续如有
真实输入或新缺陷，应先给出独立复现，再按相应 owner 范围实施。
