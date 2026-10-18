# 开发工具主对话与语音消费接线（2026-10-18）

目标 profile 为 `huawei_ict_agentarts`，基线为 #406 `a37cd414`。本包是必要组合接线，不改变 MOD-33/36/37 归 goo122、MOD-34/35/38 归 Potatos498 的长期分工，不改他们的业务实现。MOD-37 仍未实现。所有本轮验证为本机 Synthetic；没有云、真实账号写入、Windows 实机、麦克风或 Laya 验收。

## 断点与当前消费路径

| 功能 / ID | 原断点 | 本包消费方式与限制 |
| --- | --- | --- |
| 文件读取 `workspace.read_text` | 已注册；源码有独立原生逐内容出机确认 | 沿用原路径、SHA 与确认，不旁路 |
| 目录 `workspace.list_entries` / 补丁 preview、stage、apply | 已执行，但云投影仅返回有限确认信息 | 保留原安全投影；文件名、路径、SHA、补丁正文不因旧会话开关成为 PUBLIC |
| 固定命令 `workspace.run_allowed_command` | Desktop 只有固定无参数 alias | `readDeveloperConfiguration().command.tool` 消费原原生 Node/Job helper、原固定 recipe 与原项目脚本许可；不接自由 shell |
| Git `workspace.git.head/commit/push` | 只有独立 Local 工厂注册；在场未接 | 新可信 host 消费公开 `createGitTools`；保留原分支、远端、allowPaths、验证收据与在场要求 |
| 测试定位 `workspace.locate_test_failures` | 只有 `locateTestFailures` 函数/CLI | 新只读工具有严格输入 Schema；在宿主创建的空解析目录调用原函数，不读取源码 snippets；输出仍需独立 export policy |
| GitHub `github.*` | 已有公开 register，但默认 Desktop 没有提供者与注册 | 可信 host 消费公开 `register`；需显式提供者、仓库 allowlist、受限凭据读取器与 export policies；不读取 ambient gh/ChatGPT token |
| CI / review / issue `developer.ci_list/ci_fix/code_review/issue_list/issue_triage` | 原 `createDevWorkflowsRuntime` 为独立 Local TaskRuntime，不能充当 Competition 子工具 | 原 `CoordinationWorkerCapabilityPort` 在当前原 child 的 `WorkerContext` 执行公开 workflow；不创建新任务、Runtime 或执行循环 |
| 工具结果续答 | 原 child 恢复只寻找外层工具审批，找不到 workflow 内审批 | 原工具端口持久精确输入；worker 原 proposal digest/config/deadline 与 nested approval 一致后复用原 child worker恢复；已确认工具不重做 |

## Main 组合端口

`createDesktopDeveloperToolsHost()` 返回 `tools`、`competitionToolAvailability`、`competitionToolExports`、`runtimeOptions`、`unavailable`、`bind(application)` 与 `close()`。将前三数组并入同一 RuntimeApplication，展开 `runtimeOptions`，构造后 `bind()`；关闭时释放 host。默认没有配置时仅返回逐项 unavailable。

参数全部由主进程注入，不接受 Renderer/模型配置：

- `githubModule`：`@personal-agent/github` 的公开 namespace；`github:{provider,available,publicEnumPaths?}`。生产 provider 必须为 conditional；测试替身不静默当真实服务。
- `git:{options,available}`：公开 `GitToolsOptions` 去掉 `readVerification`。host 只从同 Application 的已确认固定命令、前后相同 HEAD/文件指纹产生该收据；普通成功结果不能冒充验证。
- `command:{tool,rootPath,available,publicEnumPaths?}`：优先消费工作区配置的原固定工具；也可显式注入公开 factory 的 `options`。模型只能给 `recipeId`。工作区 getter仅公布固定公共 recipeId，私有 enum 不默认出机。
- `testLocate:{cacheRootPath,available}`：主进程先创建 cache 根；host 管理其中独立空解析目录。输入上限 64 KiB、结果上限 128 KiB，没有源码 snippet 出口。
- `exports`：每个普通工具独立的原 `CompetitionToolExport`。没有结果许可就不进入模型动态目录。
- `workflows`：原 Runtime 的 `RuntimeDeveloperWorkflowsOptions`，见下节。

`codingWorkspace.readDeveloperConfiguration()` 是 Main-only 只读组合 getter，返回 `bindingId/rootPath/available/assertCurrent/metadataExportAllowed:false/command?`。旧会话开关仅保持原本地 scope，getter不授予 metadata 或正文出机；Git 仓库/分支/远端/作者/allowPaths/凭据也不能从“选了目录”推导。原配置或会话许可变更后旧任务 lease 失效。

## Runtime 的原工作流与可信配置

`developerWorkflows` 提供 `bindingId`、`repositories`、`maxSteps/maxTokens`、`available(kind,scope)`、同步 `assertCurrent(scope)`，以及可选 `model:ModelPort`、受信 `reviewRules`、公开 `ciFix` 配置、Issue 标签与置信门槛、`failedRunForIssue`。模型调用仍经过 `ModelGateway`。

`authorizeModelRequest(ModelRequest,scope)` 必须核准此次完整 messages 中的源码、日志、diff 与 Issue 数据；`projectResult(result,scope)` 仅返回明确获准的结果，`assertCurrent` 在发送与续答前复核当前 lease。缺模型/完整请求出机许可时不发布分类、预审或 CI 修复；缺规则不发布 review，缺受信 patch preview/recovery 不发布 CI 修复。CI/Issue 列表不需要模型。缺专门原生许可保持 unavailable；`cloudExportAllowed` 不等于这些许可。

五个 workflow 的 schema 包含仓库与具体请求字段，不允许模型提供审查规则、源码 allowlist、命令 argv、凭据、branch/remote 或授权引用。Issue 修复只使用宿主绑定的原失败 run 或 source revision；Issue 内容不能增加修复权限。发表、标签、提交、推送仍通过原 ToolPort 逐操作审批；原 descriptor 的 `requiresPresence` 保持不变。

Runtime 的 `isUserPresent(taskId)` 来自可信主进程；目录选择、提案校验和原 Gateway 实际执行均检查，在场缺失或异常按 false。外部写不会进入自动授权名单。原 Gateway 仍负责一次性授权与执行记录。

工作流内补丁复用原 `DevWorkflowPatchRecovery`、公开 preview/apply 和同一个受信 workspace marker port。`reconcileDeveloperWorkflowPatch(taskId,runId)` 只读回原 marker/source；只有得到原 applied/confirmed receipt 后才能显式 `resumeConfirmedDeveloperWorkflowPatch(taskId,receipt)`。unknown 不自动重试，not_applied 不能冒充已应用。

## 对话与语音只读摘要

`readConversationToolCapabilities()` 返回经原 safeSchema 清洗的注册/export/availability 交集及 worker schema，状态固定为 `registered_requires_task_authorization`，不调用 readiness、不保存 checkpoint、不授权。私有 enum/const 的值默认删除，只有明确 `publicEnumPaths` 可公开。开放 object 保持原泛型形状；本机最终参数仍使用原 Schema 校验。

`readToolConversation(taskId)` 复用原持久父子/追加会话身份 reader，返回原 UI conversation；历史终态不丢归属，损坏或跨源 binding 返回 undefined。身份读回不能恢复执行许可、deadline 或已撤销的内容出机 lease。

`readPendingToolInvocation(taskId,approvalId)` 仅在原 pending 审批、task、descriptor、scope、原参数 digest 与 deadline 全一致时向可信宿主返回精确参数。它同时覆盖 workflow 内部操作；仅有工具名或任意 allowed 审批不能构成语音确认依据。

## 本机验证

固定 Node 24.15 / npm 11.12，仅构建依赖与 Runtime、运行定向测试。新增行为覆盖五种公开 workflow→原 child→nested审批→原结果续答、无模型 unavailable、真实在场 callback、防模型伪造在场、原生工作区 lease、空目录日志解析与源码隔离。实际公开 coding/F15/Git/GitHub schema 切片为 35 项、11,769/24,576 字节；没有扩大 64 项/24 KiB 协议上限。最终 Desktop 其它业务工具全 ready 时的总目录需由 Main 组合另行核对，切片容量不代表整机容量。

没有新依赖、Core wire、数据库迁移、账号权限或源码出机授权；没有为本包创建 PR、推送或合并。原模块完整真实验收与比赛云端整图仍未由本轮 Synthetic 回归完成。
