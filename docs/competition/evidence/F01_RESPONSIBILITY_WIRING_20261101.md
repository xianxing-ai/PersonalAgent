# F01 原责任生命周期接线

目标 profile 为 `huawei_ict_agentarts`。本工作包从 `d9209664` 的独立 `pr531-f01` 工作树推进；不替换原责任库、TaskRuntime、调度或 Policy。

## 当前整体接线

已交付 `createConfiguredDesktopF01WorkflowPorts` 并接入 Main：原公开 Fact 精确选择、原责任会话、真实 AgentArts 目录声明、统一 worker、原 `subagent.dispatch`、原知识检索、补问卡与生命周期权威。最多派发 3 个独立子任务，派生任务不能递归开启 F01；补问与扩充返回 `awaiting_replan`，不猜测新计划。

实际 Engine 派发关键检查 1/1、原补问 CAS/跨会话检查 1/1、Renderer 原回答检查 1/1。责任状态比较只保留生命周期元数据与摘要，不复制私有正文。可选分支、原生交互及真实云整图仍待验。

## 原 N09 增量记录

N09 的生命周期目标只能来自原 F01 配置输入，来源指令只能来自该图的原用户父任务。原 host 的 descriptor、参数、Policy allow、executionStarted、任务/会话/期限与配置必须一致，才能调用现有 `recordResponsibilityLifecycle`。`explicit_instruction`、候选文字和来源引用本身不授予激活权限。Desktop 仅代理同一原用户会话中的既有 proactive session；不自动创建 session 或扫描任意历史。

原生命周期 CAS 与 commandId 保持不变。增加只读原命令结果和原责任快照；重复请求与未知结果重开只读原 commandId/digest 的记录，不重新 commit。当前责任被撤销/更新不会擦除旧命令已发生的证据。缺少原操作记录时保持 unknown，不能由当前状态反推原操作成功。

新端口为 host-only provisional，无 wire、数据库或配置迁移。N09 先独立验证，N02 来源及完整九节点工厂随后推进；未具备节点仍 unavailable。实际 Runtime/Policy/SQLite 与 Synthetic 模型/用户点击/云传输分别记录，代码、构建与本机测试不替代真实平台、真人或整图验收。

N02 增量：`readF01ContextBinding` 只读原配置图、用户父任务、执行模型选择与非秘密出机目的地；原 root/graph 配置、模型替换、取消均失效。Desktop `createF01ContextSelectionHost` 从原输入 `context={fact:{id,revision},responsibilitySession:{taskId,sessionId}}` 读取唯一公开 Fact 和同会话既有责任会话，经 `reference.source` 原生精确卡留下原 Runtime decisionRecorded 记录，再写既有 `createF01QueryBinding`。重复准备只读原选择，缺/未知/撤销不重发。正文 export 仍单独确认。

`createF01WorkflowContextPorts` 消费原 publicMemory、同步公开 Fact head、proactive readResponsibility 及当前 `agentArtsModels`；无 lifecycle 的责任不伪装 active。原模型目录新增可辨别 `agentarts_catalog` 形状，仅声明已选模型的 profile/effort/route，始终 conditional，旧 gateway 形状兼容。最终同步检查核对 Fact、责任 lifecycle/原引用与当前模型，不跨 await 缓存有效性。N02 提供者尚须由唯一 F01 worker 组合，不能单独登记为整图完成。

N02 必要验证：模型/配置与旧 F01 定向 20/20 已通过；新增精确原生选择检查 1/1（实际 Runtime/Intent/Policy/SQLite/proactive 存储，Synthetic Fact/图绑定/点击），覆盖重复不新增授权任务和撤回后拒绝。无真实云或真人验收结论。

唯一总工厂 `createConfiguredDesktopF01WorkflowPorts` 现返回 tools/configuredWorkflowWorkerPorts/authority/questions。N04 复核原有限候选，N05 绑定原模型目录，N06 经固定业务桥与原 `subagent.dispatch` 独立 Policy 建立至多三个独立任务并读回真实状态；不宣称支持依赖边执行。普通子任务仍看不到 dispatch；F01 严格要求原用户委派关系，派生执行任务不可再次开启 F01。N07 使用原 knowledge child 的 Policy 投影（最多五项、200 字摘录）和受控来源同步读回，N08 原问题/回复 CAS 不授予动作权限，N09 原 lifecycle CAS 只容许本图精确命令造成的状态差异。其余状态变化仍拒绝。补问/扩充回执为 awaiting_replan，不伪装已建立任务或暗中重跑 feedback。

模板维持 28 图/185 节点，N07 改为原来源 host，三个可选节点均加原 guard，N06 等待其实际回执/跳过；旧模板摘要部署须更新。无新任务库/调度/授权/数据库迁移。AgentArts/Runtime 必要编译通过，唯一 Engine 主路径检查 1/1（实际 SQLite/Policy/子任务创建与派生 F01 拒绝）；主线程补问关键检查 1/1（精确回答 CAS/跨会话/失效拒绝）。来源/模型/点击为 Synthetic；各可选分支和 Main/云整图仍须实际组合验收，尚不提升整图完成或 frozen。

本图自身 lifecycle CAS 的比较仅保存原 lifecycle 引用元数据和其余 application state/operation 摘要，不复制责任 session 的 entry 私有正文。缺少此新摘要格式的旧未完图须保持 unavailable，不能自动重做原写入。

## N09 首包与组合入口

`createRuntimeF01LifecycleHost` 读取原 configured graph 的 `input.lifecycle`，只接受与该输入相同的 N09 host 参数；当前 descriptor 由原 configured binding 复核，原运行还须 Policy allow、executionStarted 和完整输入匹配。工具参数的 `expectedLifecycleRevision:0` 表示尚无记录，进入原 CAS 时映射为 `null`，避免扩大现有公开工具目录的 Schema 类型。原 task→原用户父任务决定 `sourceTaskId`，模型不能替换。write 与 CAS 后的 guard 均复核；后置校验失败保留 RESULT_UNKNOWN。

Desktop `createF01WorkflowLifecyclePorts({getApplication,getProactiveHost})` 返回 `tools`、`authority` 和 `readOriginalOperation(localTaskId,{deadline,signal})`。既有 `createDesktopProactiveWorkflowApplication` 注入 `responsibilityLifecycleAuthority:()=>bundle.authority`，再经原 session 的 `recordResponsibilityLifecycle` 执行。新增 `readResponsibility(target,reference,sourceTaskId,scope)` 和 `readResponsibilityLifecycleOperation(target,command,scope)` 仅取精确既有会话，不扫描历史、不自动创建责任或 session。部署、用户会话解析、来源隐私撤销、目标取消及期限均重验；生命周期 `explicit_instruction` 标签不授予权限。这里尚未提供完整 F01 配置 worker，Main 组合及图调用方待后续工厂完整交付。

原责任库新增 `readResponsibility` 与 `readResponsibilityLifecycleOperation`，共享原 command 校验；后者只认原命令 digest 的持久记录，未知仍 unknown，不以当前 active/revoked 推断历史效果。副作用已发生后丢响应的测试使用实际 CAS，再显式抛 Synthetic RESULT_UNKNOWN；SQLite 重开后两次只读核实均未再次调用 commit，图仍 waiting_reconciliation，不自行 resume。撤销和后续责任 revision 不擦除旧命令回执。

本树独立离线 npm ci、初始全仓 build、变更后 Runtime build、架构 3/3 通过。联合旧 proactive/F01/桌面套件 44 项中 43 通过，1 项本机 HTTP 在沙箱中被阻断；新独立夹具在允许 loopback 的环境重跑旧 HTTP 文件 2/2 通过。最终 N09 7/7 通过：激活/撤销、拒绝、参数替换、外来 session、CAS 前部署撤销/目标取消、实际 CAS 后 unknown 跨 SQLite 重开；无 skip。模型/image frontier/用户点击及未运行的持续工作流网络端口为明确 Synthetic，测试不代表九节点 Engine 完成或真实 AgentArts/真人验收。
