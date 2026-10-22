# #474：每轮可信时间与能力授权引导

目标 Profile：`huawei_ict_agentarts`。独立分支 `codex/fix-harness-time-context-474`，实施基线 `e7d4e0c6`。不扩 Local Profile，不调用真实模型或账号，不创建真实日历或待办。

## 缺口与接线

原 Competition 目标只编入用户目标、已许可的历史/私人内容，缺少当前设备时钟和时区。待办工具虽然注册，缺会话许可时原目录过滤器将其排除，模型无法区分“未装配”与“需要授权”。本次保留目录/执行守卫，增加安全环境元数据，而不把不可用工具放进可调用目录。

- Main `readDesktopRequestContext` 复用 `conversationToolAccess.resolveConversation`，只对原用户主对话及其合法子任务提供环境；内部或未知任务不额外获得这些数据。
- 纯 `createConversationEnvironmentContext` 每次调用重新读取宿主时钟，输出 UTC instant、IANA 设备时区、该瞬间 offset 和本地日期时间。未知 IANA 时明确标记 offset-only；不静默假定 UTC/上海，不用当前 offset 计算未来 DST。明确用户指定的时区优先于设备默认。
- `todoHost.readConversationGuidance` 只返回 registered、availability、固定 reasonCode，不枚举待办正文、不创建任务许可。缺操作许可、缺配置和宿主不可用分别说明；相对分钟提示使用原 `todo.create.remindInMinutes`，由本地工具在实际执行时解析。
- `CoordinationInputHooks.readRequestContext(scope)` 是可选、同步、host-only 的 provisional 扩展。内容通过已有获准 goal 出口作为环境数据发送，不成为 system 指令、工具目录或授权。旧调用不配置此项时保持原目标与检查逻辑。
- 环境快照在每次普通对话实际 `executeCoordination` 临时采样；原 typed proactive-teacher 载荷不加此前缀，保留其解析契约。稳定历史 binding/checkpoint 不保存时钟正文，避免 continuation 因时间改变产生历史漂移；本次发送 lease 精确绑定实际目标，预算对完整最终串计量。替换 hook、改变计量/配置、取消、deadline、来源撤回及原出机守卫仍可拒绝。

没有 frozen Core wire、公共 Schema、数据库、调度器、模型入口或依赖变更。上下文新增字符仍受原字符/token 预算，不能扩大预算或丢弃私人/Skill 门禁来容纳元数据。没有新增云端日志或私人 prompt 存储。

## 用户本轮修订：统一授权提问卡

授权引导已按当前要求改为在原对话请求实际公布的提问卡，本次/永久选择由用户决定，不再指引去设置重复勾选一次。卡不能替代账号、凭据或未装配的真实配置。

统一卡的后台挑战与持久许可由 #475 工作包负责。本包已实现原生 HTML 提问卡及安全页规则管理，并挂接实际 Renderer 主面板/工作区；卡仅提交问题 id、revision 与决定，等待可信宿主状态，不把提交当操作成功。按 conversationId 过滤，不向其他对话展示问题；一次/永久/拒绝、禁重复、键盘焦点、过期/取消/stale 和脱敏错误反馈均有控件回归。显示内容统一转义，模型或工具文字不能成为 HTML/URL 指令。

设置中移除 Todo/Feeds/Mail/Workspace 的旧会话允许开关及 Calendar 的重复确认按钮；保留账号/凭据、目录和运行组件配置、原业务入口及撤销。安全页只读/切换可信可用沙箱和查看/撤销规则，不签发执行授权。旧工作区“勾选后应用”交互用例随这个有意行为替换为“配置不能授权、读取真实就绪状态和撤销”检查，保留等待/失败/重试/焦点与取消的原边界。

正式 connector consumer 已接 #475 的 prepare/currentRequirement/authorizeExport：Todo、Feeds 和原 Mail/Calendar 对话工具的目录只公布可提出精确挑战的已配置能力，preflight 登记原 task/proposal/run/tool/version/args/期限；执行和最终投影必须有对应真实回执，不能把目录可见或准备步骤当许可。Feeds 的分页提供者在原异步执行上下文逐次检查。原凭据/游标脱敏、结果大小、原模型出口和 Policy 门保留；最终投影 hash 也参与 final gate。

永久规则资源 generation 仅用 #475 原 Runtime `trusted_host_state` 的 host-only get-or-create/CAS 口，不新建授权存储或持久 allowed。正常 close 不轮转；显式撤销/配置变更轮转，旧任务和旧规则无法借相同 task/run 重生。缺少这个实际端口不会假装永久有效。

手动 Calendar 原 host-tool 通过 `prepareAuthorization` 登记固定单事件读取；工具 wrapper 的异步上下文供 Main 的实际 fetch 包装在凭据等待之后同步再验。Mail 配置保存不再授予读权限；其 `batchAuthorization` 与原 mail-triage 使用原 sessionId、单次 nonce、固定账户/INBOX/查询 digest、真实每页 limit 和原期限。首次卡允许后，后续每页仅由 #475 正式 `deriveMailBatch` 结合原 session membership 和首条已确认回执派生精确授权；分类只读断言已消费回执。无总页/条目预算时明确总量未知，不冒充每页 100 为总量；结束、取消、配置/资源变更或到期失效，不成为后台无限许可。

工作区目录/Node/npm 配置与执行许可分开：配置 getters 不能授权操作；原 task/run/args、目录/可执行文件/固定 recipe 与持久资源 generation 必须匹配。应用内卡不要求先配置 Node/PSEC；外部命令仍必须由 Main 注入的可信 native factory 实际实施隔离。有 question 而缺该工厂时命令不装配，不能回退裸执行。所有命令入口（含 git、原开发 alias 与隔离 repair）传同工厂，原固定 Node recipes 加 `--preserve-symlinks`/`--preserve-symlinks-main`，模型不能改 argv。原依赖封存/复制/校验仍在实际获许可后由可取消 worker 证明，不在同步经验 scope 扫 node_modules。

F15 的元数据和源码只消费原 Runtime 提供的 `authorization:{taskId,runId}` 与阶段，不能从 Renderer 或已结束 localTask 猜身份。初始、已确认 read 及最终摘要各用执行前已登记的精确 export requirement；`authorizeConsumedExport` 不产生新执行许可。固定脱敏 schema 排除源码/诊断正文/绝对路径，实际返回投影供 Runtime 发送，本地 raw receipt/Evidence 保留。源码仍走原 PUBLIC candidate/config/source-version/digest/bytes/撤回 proof；原已确认 readTaskId/runId 加入关联，不新增 PRIVATE 全文出机分支或第二卡。固定 schema helper 仅展开公开 ConnectorItem/ConnectorAction 元数据引用，未知引用拒绝。

统一卡以正式 `sourceApprovalId` 精确去重原 pending，不能因同 taskId 隐藏另一个审批。卡/安全页分别展示应用内 Policy 与真实 native backend available/enforced；“不启动外部进程”不冒充 OS 隔离。安全页不签发本操作许可。

最终由 #475 整合为一个完整 PR，Main/Runtime/Renderer 联合卡验证完成前不标记完整交付。当前没有像素一致的参考证据，仅按已确认的提问交互自实现；真实受影响渲染尚未执行。Browser plugin not available，后续复用原有 Electron/Playwright 隔离 Synthetic 流程。

## 验证记录

使用 Node 24.15.0 与固定时钟、Synthetic 数据，不调用真实或付费模型/账号。

| 检查 | 当前结果 |
| --- | --- |
| 纯环境 helper：重新采样、上海跨日、纽约 DST、offset-only、无效时钟、授权状态与脱敏 | 本树 Node24 构建后 3/3 通过，包含 Calendar 配置缺项 |
| 实际 Main callback → 原 canonical conversation resolver → 强制 Competition 子任务 → 工具 continuation → 主控汇总 | 本树真实调用方 Synthetic 用例通过；三轮分别重新采时、跨日、保留强制委派与私人过滤；未创建真实待办/日历 |
| 临时上下文超预算/async拒绝、凭据等待期间 reader/计量漂移最终发送拒绝 | 本树 dist 定向回归通过，摘要/稳定 binding 不保存时钟正文 |
| 原 context binding/conversation/delegation/teacher/todo 回归 | 连同上述共 8 份文件 70/70 通过；未运行全仓 check/真实服务 |
| 单卡/规则设置及旧前置控件迁移 | 18/18 Synthetic 控件检查通过；实际 Electron、Main+Runtime 统一卡尚未验 |
| Todo/Feeds/对话 Mail 精确 consumer | 4 个 Synthetic 回执用例均已取得通过：初次 2/4，2 个夹具修正后仅失败例复跑 2/2；不是实际统一卡或持久规则验收 |
| Calendar 原 Runtime/ToolGateway → 卡 consumer → 凭据等待 → final fetch guard | 2/2 Synthetic 用例通过；正常读取可达，撤回卡许可后零 fetch；不访问真实日历 |
| Mail 配置/单批次/派生/完成撤销 helper | 1/1 Synthetic 回执检查通过；未开网络、未授权真实邮箱 |
| Workspace 无旧会话许可、精确执行/投影、正常重启资源/撤销、可信工厂与 native argv | 3 个 Synthetic 用例均已取得 pass；沙箱 native realpath 首次 EPERM 后经平台最小授权执行，2 个夹具原缺 path 修正后仅失败例复跑 2/2；没有真实执行命令/native 沙箱资格声明 |
| 固定 Node native recipes / F15 元数据初始与 summary helper / ConnectorItem/Action 固定字段 / exact approval 去重与 native 状态 | 分别 1/1、1/1、1/1、2/2 小回归通过；F15 使用显式 Synthetic question/Runtime 元数据，不等于实际 Main+Runtime graph 验收 |
| mail-triage readiness/逐页消费的新可选 Runtime port | 源码与定向用例完成，等待 #475 整合后新 Runtime 构建；旧 dist 不充作这项证据 |
| 统一授权卡消费及本次/永久 | 待 #475 正式端口与实际组合验证；未伪造卡回执 |
| 真实盘古/AgentArts 采用时间与引导、真实提醒/日历 | 未授权执行，`not_run`；Synthetic 发送载荷验证不提升平台或模型资格 |

本树原始日志与测试生成物放 ignored `.cache/issue-474-*`。公开 Evidence 只记录 Synthetic/固定元数据及检查结论，不包含账号、凭据、来源正文或私人 availability reason。

第一轮环境：Node 24.15.0 / npm 11.12.0；本树 `npm ci --ignore-scripts --no-audit --no-fund`，从 Runtime/Productivity/Client 的已声明内部依赖串行构建，未借用其他工作树生产 dist。重资源槽在 70/70 后释放，无后台模型或测试进程。
