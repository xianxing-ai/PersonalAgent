# 主对话、Live 与镜像接线组合证据

本轮沿现有 PR #406、`codex/live-task-visibility-fix` 交付。比较起点为
`a37cd414280ec76c82f662e58610b1cbc49d215d`；未批准或合并 PR。
分工与逐能力状态见 [自有接线矩阵](../../OWNED_CONVERSATION_WIRING_20261018.md)，
28 图逐项事实见 [镜像目录](../../IMAGE28_CONVERSATION_WIRING_20261018.md)。

## 实际组合

- 主文字与 Live 共用原 Runtime、原 `user-work` 子任务、Policy、Evidence 和结果续答；根任务仍只走原委派。
- Goal、主动责任及原 Scheduler/confirmed 来源消费、开发工作流、F15 同 worker 图执行、系统观察和 Windows-MCP 均通过原工具注册/availability/export 组合。
- `workflow.image.catalog` 公开 F01–F28 的目录和真实接入状态；目录可查询不等于所有图的业务适配器可执行。
- Live 保留完整 schema 分页、同任务审批和等待；重复 goal 与提交结果未知不重开工作。后台完成后可用 `read_context` / `wait_for_task` 续接，尚无可信端口主动播报旧回合完成。
- Windows 原引擎与 MCP 共用可信 F9 和跨引擎控制 lease。未知写结果保留原 reconciliation，不自动重放。
- 开发能力依赖显式部署配置、原工作区和精确资料出机确认；缺配置明确 unavailable，不借用当前机器的 GitHub 登录。

## Root 最后定向验证

Node `24.15.0` / npm `11.12.1`；Linux 本地执行。UTC
`2026-10-18T21:59:13.915150Z` 至 `2026-10-18T21:59:32.447849Z`。
以下五项 exit code 均为 0；测试项合计 **99/99**，无 skip。
这是一组改动范围内的 Local/Synthetic 检查，不是全仓或真实云验收。

| 项目 | 执行范围 | 结果 / wall 秒 | 完整日志 SHA-256 |
| --- | --- | --- | --- |
| 主进程语法 | `node --check apps/desktop/electron/main.js` | 通过 / 0.027 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| 架构边界 | `tests/architecture/dependency-boundaries.test.mjs`、`integration-test-entrypoint.test.mjs` | 3/3 / 0.142 | `f6450d250c2e0e07e4cffc3788736b43f993683d537cc360a5cabec9423779e4` |
| 调用链组合 | 下列九个测试文件 | 41/41 / 15.634 | `c507064564384287cf394dac45155ed143494ee4d2d6874376f6f9c9f39085f0` |
| Live 交接 | `apps/desktop/test/live-voice-host.test.mjs` | 33/33 / 1.090 | `47bb314d8a3e8a0af1636827bca6039af638c12ba8e23bac7403b8b5600f3ebe` |
| 开发部署 | `apps/desktop/test/developer-deployment-config.test.mjs` | 22/22 / 1.637 | `a3b276187119dcdc5875c8242e583c5a8b3e969e2f2d972c0f029615f9964d1a` |

九个组合文件为 Runtime 的 `coding-repair-worker-capability.test.mjs`，以及 Desktop 的
`conversation-pelican-wiring.test.mjs`、`conversation-tool-access.test.mjs`、
`proactive-runtime-pump.test.mjs`、`proactive-confirmed-source-router.test.mjs`、
`voice-runtime-approval-bridge.test.mjs`、`system-observation-conversation.test.mjs`、
`image-workflow-catalog.test.mjs`、`computer-control-lease.test.mjs`。
各项用 `node --test <上述精确路径>` 执行；Runtime/Windows-client 已先构建生产 dist。
机器原始日志及逐文件哈希保存在本次执行缓存，未将缓存、设备数据或凭据加入仓库。

鹈鹕测试走实际父任务 → user-work → 原工具目录/审批 → 临时 SVG 的显式 Synthetic CAS →
真实本地 Node 验证 → 原 Evidence/续答。它不是 Windows 原生补丁、真实云模型或音频验收。
细节见 [鹈鹕证据](../pelican-conversation-wiring-20261018/README.md)。

最大就绪组合的 Synthetic 目录实测：动态 63 tools / 22,863 JSON bytes（原上限 64 / 24,576）；
静态能力 64 tools / 29,720 字符。Live 完整 schema 分两页 31,308 / 8,452 字符，拼回相同目录，
未执行业务工具。该 fixture 的 repository/query/path 枚举各 1 项，不保证任意配置都能放入同一预算。
内部图节点保留原注册，只从普通模型目录隐藏，不删除原图的执行能力。

## 后续处理归属与验收边界

| 剩余项 | 处理方 / 依赖 | 当前事实 |
| --- | --- | --- |
| 实际 Windows-MCP、F9、原生 helper/ACL 和当前应用 | zemeng 的 Windows 设备验收 | Linux 下未通过实体操作；显式配置 Python 3.14+、固定 provider 版本后再验 |
| 实际 Live 麦克风、扬声器、模型质量和时延 | zemeng 的 Live 设备/模型环境 | 未声称达到 GPT Live 同等质量；本轮只有 Local/Synthetic 交接证据 |
| DEV GitHub/CI/Review/Issue 实际账号和规则 | 原 DEV owner 提供规则/provider，zemeng 配置消费 | 不修改他人算法；缺私密配置 unavailable，无真实账号写入验收 |
| 固定云部署、签名 receipt、真实来源 grant | 原云/来源 owner 的可信端口 | 未以配置、HTTP 200 或目录代替远端版本及来源验收 |
| 其余镜像图的业务 host adapters、F23 配置 CAS/验收器 | 按最新分工的各图 owner | 28 图均已列出；缺实际入口或适配器的仍 unavailable，见逐图矩阵 |
| 主动完整业务动作、高级主控消费与关机常驻 | 原动作/控制器/云常驻 owner | 原责任和 poll 已接；缺端口不伪造完成回执或后台运行能力 |
| UI 新 PR #413/#414 | `2511375597-lab` / 非作者审阅者 | 已只读核对，不接管文件，不自行批准或合并 |

未启动 Laya，未跑大规模测试，未调用真实云/账号写操作，未发送邮件。
