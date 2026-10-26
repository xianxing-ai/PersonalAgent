# PR #503 合入已实际合并的 #511 / #519

2026-10-26 UTC；Profile `huawei_ict_agentarts`。本轮沿唯一写入 worktree
`.worktrees/pr503-main521-integration-20261026`，从已保存普通 merge
`e5709c1159680f2326ba99f8af6d2d7ce335f9a3` 正常合并实际 main
`a3e9d51d331f3ddc1b42a12962b8397137f7a91c`。开始时两者与远端核对一致，#503
远端仍是 `6dd4b9794b8b5f927c31b656c2c19f02b3bc3971`，本树干净。
main 的真实 Git 历史包含 #511、#519 和 #521；不是提前纳入 #511 source 或队列模拟树。
AGENTS、CONTRIBUTING、CODEOWNERS 无变化。旧 worktree、e570 Evidence 和日志原样保留。

## 精确解决及保留边界

唯一文本冲突仍是 `apps/runtime/src/application/coordination.ts` 三块；本轮手工源码修改
只解决它们，没有整侧覆盖或新增功能：

1. 同时导入 `AgentArtsBeforeInvokeError` 与 `formatAgentArtsFailureDetail`。
2. `markCompetitionCloudUnknown` 保留 `export`、原 receipt 参数和 `safeSuffix = ''`，
   原 inflight/received 身份校验、unknown checkpoint 和不重发语义不变。#503 邮件消费方
   仍可用默认空后缀调用，#511 普通任务可保留经过验证的安全诊断后缀。
3. catch 同时保留 `competition-coordination-failure` 结构化 checkpoint 和
   `detail`/`suffix` 投影；原 terminal 精确回执、unknown 状态与原身份核对继续生效。
   不把安全错误详情变成重试、授权或任务成功依据。

仅在 #511 原 `cloud-transport-diagnostics` 四个 case 内补断言：WSS 1011 unknown、
HTTP 401/429、普通伪造异常的同一任务，同时保留 #503 固定诊断 checkpoint 与 #511
安全错误投影。原单请求、零 HTTPS 回退、原 request identity、unknown hold、无私人内容
断言全部保留并加强；没有删除测试或放宽预期。

其余路径自动合并自实际 main，含 #519 observability reader、#511 能力/错误投影、
只读邮件历史卡片及原 CI workflow；本轮没有手改这些逻辑或 workflow。

逐文件核对 e570 的 18 个预算、摘要/授权、邮件/Laya、panel/weather 测试与样式文件，
字节均相同。Main 和 workspace 文件正常合入 #511，故整文件哈希会变化；另精确核对
`pumpEvents`、`refresh`、`applyEvent`、`action`、`confirmDeveloperExport`、
`askWeatherCity`、`connectorDestination` 七个函数/变量的 AST 原文哈希，均与 e570 一致。
保留 1800 秒新任务预算、摘要审批/单次模型请求的 180 秒限制、原绝对期限、
只读状态补读/旧 revision 保护及 #509 天气读回边界；未重跑先前已过的 114 项。

## 最小构建与真实执行范围

复用本树独立 npm 依赖与先前 dist；固定 Node 24.15.0 / npm 11.12.1，只重建实际变更
且为消费链所需的 contracts、coordination、agents、agentarts、tool-gateway、runtime
六个 workspace，exit 0。未重新 npm ci，未借其他树产物，未执行全仓 build/check。

四组定向命令均为 `node --test --test-concurrency=1`，精确 argv 在各同名 JSON 回执：

| 组 | 文件/精确选择 | 实际结果 |
| --- | --- | --- |
| `shared-diagnostics` | Runtime `coordination` 的 3 个 adapter 诊断 case；`cloud-transport-diagnostics` 4 个原 case；Coordination `agentarts-failure-detail` 2 个 case | 9/9，0 skip |
| `mail-runtime` | Runtime `mail-review-task` 仅选 `failed cloud attempt stays durable`、`cancellation during credential wait`、`production WSS mail composition` | 5/5（含 WSS 两个子例），0 skip |
| `mail-consumers` | Desktop `mail-history-card`、`mail-review-host` | 16/16，0 skip |
| `safe-display` | Desktop `tool-error-display-pipeline` 仅选 `every public Error code`、`error display distinguishes`；`tool-error-hostile-boundary` 的两个 case | 26/26（含 hostile read/write 子例），0 skip |

合计 **56 个 Node 实际 case，0 fail / 0 skip**。未选 case 不计通过；没有启用需额外
条件的浏览器 UI case。通过真实本地 Runtime/Policy/ToolGateway/SQLite、回环 HTTP/WS、
合成凭据/邮件/工件和明确 fixture 验证错误消费与无重发，不构成真实云、邮箱或设备验收。
邮件 orphan 重建仍为 structuredClone fixture；其他 SQLite mail case 未注入该崩溃窗口。
getter/Proxy 测试中的 canary 均为合成材料。

## 固定源码与日志

测试在普通 merge commit 前完成；其后只新增本 Evidence，不为 commit 机械重复执行。
每条命令都保存前后 HEAD、完整 tracked 文件 SHA 清单（仅排本 Evidence 自引），
源码/测试/原文档 fingerprint 均为
`1a4c910db48a86a9dc05daf6bd2d78473f87105dc9aed48dada5200aba0a5f71`。
最终实际 head、双父、tree、干净状态与该已测文件集的一致性在本树忽略目录
`.cache/pr503-main511-integration/final-head.json` 绑定；不将提交前验证声称为提交后重跑。

原日志及完整 argv/UTC/wall/exit 回执在 `.cache/pr503-main511-integration/`：

| 日志 | UTC 起止 | wall / exit | SHA256 |
| --- | --- | --- | --- |
| `changed-dependencies.log` | 06:57:19–06:57:39 | 20.179s / 0 | `9e4a39afe54bf3e90f81ed244780a854c533d75f7d96beb92aad13f9faffc087` |
| `preserved-boundaries.log` | 06:57:58–06:57:58 | 0.569s / 0 | `183fbe920703d33c876b96ce753cd15a9c1f2cf51ff0fa001b7e3aeb9ca20a00` |
| `shared-diagnostics.log` | 06:58:30–06:58:33 | 3.075s / 0 | `a95a69843434db857654d0b8778019f35a042e4921833e732fd59022dc59744c` |
| `mail-runtime.log` | 06:58:30–06:58:32 | 1.676s / 0 | `4c60c9f86e2b3e03a9ceb8267457846a62e9fac142abaaba480bb6cf91410a71` |
| `mail-consumers.log` | 06:58:30–06:58:32 | 1.670s / 0 | `0464dfc39608c2422bda95a59ae4c501bb848b5e6c2c8509fb5ac0c9409da047` |
| `safe-display.log` | 06:58:30–06:58:31 | 1.610s / 0 | `b3a9b626db5cef6d9fab8d4c3f27f7293d715e0ffc32a97dc4417424cbf06e9c` |
| `syntax-diff.log` | 06:59:23–06:59:24 | 1.132s / 0 | `319ca8408c48287c2ea08fb02994f96185601f2c29dfaa14e3240cf54f85e6ef` |

18 个整文件和七个 AST 文本的逐项 hash 清单为 `preserved-boundaries.json`，SHA256
`d7ef39e33e31b90fb83bab1800edbfb2e96fc7ed8a06ade616997ddff36a9b57`。
本轮没有新增失败或据此声称先红后绿；e570 的原兼容 red 与前置缺失日志仍独立保留。
变更 JavaScript 语法、冲突标记及 staged/unstaged diff 检查通过。

本轮没有真实模型请求、账号/设备操作、新镜像或部署、窗口渲染或实体音频验收，
不提升接口冻结或整模块完成等级。未 push、改 PR、重跑 CI 或批准；root 统一复核发布。
旧 6dd/e570 或 main 的检查不替代最终整合 head 的正式必需 CI。
