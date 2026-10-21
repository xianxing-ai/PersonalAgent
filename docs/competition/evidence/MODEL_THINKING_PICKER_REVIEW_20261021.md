# 模型与思考选择器：固定基线追线（2026-10-21）

本记录基于 `ac28a58e0e8045a859d2f1b4d20b0db9f4afcfc2` 的源码只读追线。旧 `f6c0dcc0` 工作树中的选择器仍由移交方更新，本树尚未复制该稿、修改模型入口或运行产品验收；下文不是最终新实现通过声明。

- Desktop `agentarts-model-settings.js` 的 `readCatalog` 消费当前受信 deployment 的 published 请求结果；catalog revision 与 gateway/runtime/deployment 绑定。仅完整目录中的可用文本项可供选择，`unverified` 仍不能表示真实模型验证通过。
- `readExecutionModel('primary')` 使用配置中的 defaultModelId/reasoningEffort；`readExecutionModel('subagent')` 使用 defaultSubmodelId/submodelReasoningEffort。`conversation.model` 显式 executionModel/manual modelId 只覆盖该对话的主执行选择，空 modelId 恢复配置默认。
- 现有 `thinking.update` 只保存 depth/fast，Runtime 将它们转成 task-thinking 与步骤预算，不会将执行深度冒充模型原生 reasoningEffort。因此旧稿默认滑块只更新 depth，不能证明默认主/子模型原生强度联动。
- Runtime 根任务在原 `execution-model` checkpoint 保存选择；user-work 委派明确继承该选择。其他未明确指定模型的子任务经 `readDefaultExecutionModel('subagent')` 取默认子模型。该 host-only callback 在本基线仅接收 role，没有 task/conversation；不能从 Main 当前 active conversation 读取临时偏好，进而影响另一个并行任务。
- AgentArts registry 只接受当前 revision、公开 modelId 与该项公布的 reasoningEfforts；省略 reasoningEffort 意味着供应商默认，不得由提示词或 caller 填充旧强度。真正 Provider 仍由既有 ModelGateway/registry 选择，不新增路由器。
- 授权集成固定 `55235143` 的 `readAuthorizationQuestionDestination` 绑定原 execution-model/task-model-preference/subtask-model-binding 与 coordination 配置。新选择器必须最终传播到实际原执行绑定，不能只改变展示或以当前 UI 状态替代已开始任务的目的地。

最终交接后重点核对：默认组合与 manual 的真实语义、主/子各自的 published 强度映射与省略默认、队列部分保存/失败后提交隔离、会话与目录变化、原模型 checkpoint/恢复身份、授权出机目的地，以及 actual Electron 初始化到控件的消费。移交方旧 44 项与 renderer-result 仅为历史合成桥证据，不代替本树最终实现与 Runtime/IPC 验收。

## 最终源码接手

独立工作树 `.worktrees/model-thinking-picker`、分支 `codex/model-thinking-picker` 已正常同步 main `a1063e2637db73f42fd9e8b1ba93d554c787320b`。只提取移交树的 12 个已跟踪 picker 相关文件补丁及 5 个新增文件；没有复制 Gemini 提示词、旧 Runtime 授权修正或整份旧 Main。目标为 Competition Profile。

新增 shared 默认选择函数及 Main 三处小接线让默认模式在执行时按原 conversationId 解析，最低两档使用已配置子模型，其余使用已配置主模型。只取实际发布的原生枚举，无法公布强度时省略该字段。手动模式保留显式选择，默认模式不固定模型 ID、不改全局模型配置。Conversations 的可选字段和首次启用备份、私有 IPC 兼容边界已登记接口目录。

静态追线：Main 的 readConversationPreference 使用 Runtime 传入的 conversationId；Runtime 受理时将解析结果写入原 execution-model，再将该模型/强度显式写入原 user-work 委派。执行子任务核对与父任务的原模型 checkpoint 相等，主对话汇总仍读原选择。因此之后切换活动会话或更改默认配置不会重绑已受理任务；目录变化仍由原 guard 拒绝。其他没有显式模型的专业子任务继续原默认子模型语义，本包未新增跨会话的全局临时偏好。

移交方最终旧树 74 项与 actual product result 保留为历史证据；其修复旧 Runtime dist 的两个授权类型 hunk 未混入本包。Browser 插件技能未提供，本轮使用项目已有 Playwright/Electron 脚本；没有调用真实模型、麦克风或账号。

## 本树实际验证

固定 head `bff0688008afa681d1b8e0e27643d4fb398b3dc7` 是正常合并最新 main `178c9e8e` 后的源码；Node 24.15.0、npm 11.12.1、TypeScript 5.9.3、Electron 44.2.0。使用本树独立依赖与本树新构建产物，未借其他工作树的 dist。详细命令输入、源码散列、截图尺寸及散列见[安全回执](MODEL_THINKING_PICKER_20261021.receipt.json)。

| 检查 | 实际结果与边界 |
| --- | --- |
| 独立依赖安装 | npm ci --ignore-scripts，201 包，锁文件未变。首轮沙箱 DNS 对锁定公共 registry 返回 ENOTFOUND；同一命令普通用户重试成功。未改代理、账户、全局配置或 registry/锁。 |
| 必要构建 | 按 Desktop 生产依赖闭包顺序构建 30 个 workspace，全部通过；未构建镜像、原生 helper、模型或安装包。 |
| 定向行为 | 11 个文件共 72 个独立测试。首轮 71 通过、1 个默认备份夹具在 AppContainer TEMP 原子 rename 报 EPERM；仅该文件用独立仓库外 TEMP 普通用户重试 4/4。最终覆盖 72 项，无剩余失败/skip，不将重复项累计成 75 项。 |
| 目录与原任务 | 默认六档、manual low 和无原生参数共 8 个 Synthetic AgentArts 请求；断言实际请求与原 execution-model checkpoint 相等。包括恢复备份、草稿保留、配置变更、非法参数、目录/会话替换拒绝及保存失败/部分保存。 |
| 类型与边界 | Desktop typecheck、14 个变更 JS/MJS/CJS 语法检查、架构 3/3 和 diff --check 通过。 |
| 真实产品组合 | 实际 Electron Main/Preload/Runtime + 面板/工作区脚本通过。manual high 的 user-work 与 parent 汇总各一请求；默认轻度档的已配置 qwen/max 各一请求，共 4 次，默认配置未改、外部请求 0、页面/控制台错误 0。 |
| 补充渲染 | 真实面板/工作区源码 + 显式 Synthetic desktop bridge：目录扩展模型、搜索、默认恢复、单滑块、provider-managed 提示、保存失败/重试、Escape 焦点及 251px 深浅主题通过。此脚本没有运行 Runtime。 |

已经实际查看产品默认/窄窗口/工作区与 Renderer 深浅主题截图：滑块与菜单在视口内，标题/档位可读，无空白页或错误覆盖层；每个表面只有一个滑块。251px 证据覆盖滑块弹层，展开搜索证据来自较宽窗口，不冒称所有宽度的展开列表已验。脚本自有 Electron/浏览器与服务均在 finally 关闭；不影响用户其他应用。

最小复现：在独立树按仓库 Node/npm 版本运行 `npm ci --ignore-scripts`；按安全回执 `build.workspaces` 的顺序逐一执行 `npm run build --workspace=<name>`；执行回执 `focused.files` 的 `node --test --test-concurrency=1`、Desktop typecheck 与 check:architecture。临时目录使用独立仓库外路径。实际 UI 复验使用 `node apps/desktop/test/native-reasoning-slider-smoke.cjs`，通过 PA_SLIDER_TEST_ELECTRON 指定已有 Electron 44.2.0、PA_PICKER_TEST_OUTPUT 指定独立输出目录；补充布局脚本为 `node apps/desktop/test/model-thinking-renderer-smoke.cjs`。

本包没有部署或真实供应商推理质量验收，也没有用本分支的旧 Main 冒称新统一授权 PR 的组合验证。新授权分支的目的地仍绑定原 execution-model/task-model-preference/subtask-model-binding；本包只沿原入口提供选择，不增加授权、路由器或第二执行器。常规合并、真人审查及 CI 状态以 PR 的最新 head 为准。
