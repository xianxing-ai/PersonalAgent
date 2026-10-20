# Desktop 原生 Harness 组合

目标 Profile 为 `huawei_ict_agentarts`。本增量复用原 Runtime Application、TaskRuntime、工作区、模型配置、开发工具和持续工作流。主对话处理交互、澄清与汇总，实际任务继续使用原 `user-work` 及受限执行子智能体。本文件记录实际源码组合，不代表真实模型、云平台、账号或设备验收。

## 设置与下一任务生效

原「模型」设置页挂载 `harness-controls.js` 与 H4 `developer-controls.js`。Harness 配置沿原 `model-api-config.json` safeStorage 信封的可选字段保存；缺省关闭，显式模型版本与预算由用户填写。H4 GitHub/Git/工作流配置沿自己的原加密设置宿主与原 deployment 校验器保存，不读入或迁移旧环境变量凭据。普通对话只消费原安全状态投影，完整管理快照及 configure/toggle IPC 限原 admin/mainFrame。

Main 只注册一次 H4 稳定工具代理，使用 `readDeveloperWorkflows(scope)` 同步读取当前任务钉住的原配置；保存不重建 Runtime 或任务库。Harness 使用 `readDeveloperHarnessConfiguration()` 同步绑定原工作区 `bindingId`、原工作区许可 generation、设置 revision 和明确执行总步骤预算；变更使旧任务失效，下一任务使用新配置。设置成功、模型已绑定均不等于工具获权或真实运行成功。

上下文摘要的独立 Gateway/fetch 闭包、逐段精确出机许可、来源/模型版本最终复核及 restart digest 限制详见 `docs/modules/HARNESS_CONTEXT_COMPACTION_20261020.md`。

## 来源事件与原会话

`main.js` 在 startup classification 之前仅构造原 proactive wrapper、confirmed source router 和 Harness native adapter。纯持久读取使用公开 `readPersistedRuntimeProactiveWorkflow` / `readPersistedHarnessOriginalDelivery`，不创建原 host、不调用 describe、不发网络请求、不启动 worker。原 session 实际 bind 后的 `onSession` 将 consumer 挂到原 host；consumer 在 startup 分类完成后启动。原 Runtime 的 `onHarnessEventProgress` 只触发 receipt flush，不增加轮询或第二调度器。

`harness-events-host.js` 核原责任的 `sourceQuotes`：任务 ID、原 goal 原文 SHA256、quoteRef、原会话、原子任务父链和私人撤回标记。新持续任务的 conversation 使用原结构解析的用户会话；来源若为 `user-work`，保留其真实 source ID 与原父链，而不把内部子会话当作新的用户会话。

Feed 事件仅接受原 confirmed source router 的 exact invocation 证明。路由器保留原 task/run/参数/receipt/grant 绑定，重读原 ToolGateway 的 confirmed/Policy/Evidence、原公开且无凭据 transport receipt、当前来源配置和原 tracking grant。`eventSink.persist()` 在 ack 之前同步通知订阅者，因此读口同时支持调用前已持久化的原 pending 身份；ack 后保留相同身份。旧条目缺该元数据时保持不可用，不靠 event 文本推测权限。

Wake 事件核原 workflow schedules、原 signed proposal/参数摘要、原 Scheduler 的 fired schedule/idempotency 身份和原 confirmed Policy/tool result；新 deadline 不超过原 host、原 lease 或事件期限。不复用历史已结束 root 的期限，也不延长已过期许可。事件内容、source ID、工具声明或设置开关均不签发权限。

默认关闭与静默是 native 偏好。原 core 持久记录 suppressed 事件，恢复后不补发；已存在 pending 只读原结果，不自动重发。真实发送和工具执行由原 Runtime 最终 gate 再同步调用 `assertHarnessEventCurrent`，撤回、配置漂移和原责任失效均拒绝。正常退出先停止并释放 consumer，再关闭原 Runtime。

## 原 UNKNOWN 核实与启动恢复

主对话的「核实并结束」仍通过原 surface/任务状态门禁。原编码试验 UNKNOWN 由 `readHarnessCandidateRecoveryAvailable` 解析 canonical `user-work`/合法 plan peer，用户不必猜子任务 ID。实际 action 核原 revision，再调用 `reconcileHarnessCandidateTask`；复用从原 Windows readback 提取的 `withNativeReadbackScope`。这是当前只读观察窗口，随原窗口关闭/用户 signal 中止，不延长旧执行授权、不重跑命令、不把 `clear` 当作试验验证成功。原 UNKNOWN 事实不被改写；任务能否终结只由原 Runtime 根据真实读回决定。native 对话框显示实际读回分类与原任务当前状态。

Main 在 register/client/原恢复任务泵之前 await 原 `createRuntimeStartupRecovery(...).recover()`，使用真实 single-instance ownership 与原 transport 的 durable WSS 标识。缺原 factory 或原 resume port 时报告 unavailable，不另建 fallback。事件 root/child 恢复还必须重读原 delivery ledger、原责任/来源/控制与当前 Harness/工作区配置 fence。UNKNOWN 和可能写入任务保持原分类，不能以缺少内存 active 标志推断未发送。

H3 的 workflow identity 使用当前受信钉版 `deploymentVersion`，标签为 `agentarts-deployment:<version>`；拒绝 latest/current/default 别名。Runtime identity 使用公开 `readRuntimeBuildIdentity()` 的实际已加载 dist JS 路径/字节摘要，缺失或运行中变化返回 unavailable。两者不以 Desktop 分发版本或协议号替代；`real_host` 只在实际 Competition 非 Fake/非 Synthetic 组合提供，身份本身不证明真实平台执行。

## 开发经验管理

Main 在原 `workflow-learning.sqlite` 的 `SqliteLearningHost` 创建后调用 `configureHarnessExperience`。Runtime 原 owner/plan、四个原 run、采用/重新验证/发布回执与稳定配置仍由 Runtime 校验；Desktop 仅提供 `readHarnessExperienceCurrentSync()` 的当次完整工作区元数据和真实版本，以及原 native 激活确认。不拼接异步缓存或由 UI 构造 Runtime scope，也不新增经验库。

`createHarnessExperienceAdminHost` 读取公开 `runtimeApplication.harnessExperience`；四个 `harness.experience.*` 动作限定原 admin/mainFrame，列表拒绝多余字段，具体版本/active revision 沿原 host 严格检查。每次变更在独立 native 用户操作 scope 中执行，结束后重新读权威状态。验证通过与启用分别呈现，启用须 native 明确确认。原模型设置 root 为控件分配独立容器；离页 dispose、返回重新挂载并只读刷新、关闭释放。Renderer 只接收版本/验证/启停元数据，不接收原 patch、源正文、工作区路径、凭据或权限。

## 当前检查

遵循先实现全部源码再统一验证的顺序。目前已保存分阶段 Runtime 与 Desktop WIP，执行过必要语法与差异检查。`node --test apps/desktop/test/harness-events-host.test.mjs` 的两个最小 Synthetic 用例通过：实际 user-work 结构父链解析/分类前不启动，以及原 source/config/ledger 撤销后的 fence 拒绝。该次 shell 为 Node 26.3.0，Runtime/core/source 为显式 Fake，不能作为仓库钉版 Node 24.15.0 或最新真实 core/Provider 的验收。

新增原 sink 通知/ack 竞态的单例已保存在 `proactive-confirmed-source-router.test.mjs`。一次定向尝试在 import 时因 `@personal-agent/feeds/dist/index.js` 缺失而退出，未进入用例；没有补安装或扩大构建，状态为 not_run。后续按根 `.node-version` 的 Node 24.15.0，在统一依赖构建后执行。

完整组合、最新源码的联合构建/回归、实际管理 UI 渲染与真实服务验收待主控统一执行。不能据这些源码或历史阶段通过把整体 Harness、云或实体设备标为完成。
