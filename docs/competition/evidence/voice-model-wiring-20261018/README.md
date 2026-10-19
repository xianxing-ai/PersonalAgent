# Live 语音原审批与原任务续答（Local / Synthetic）

目标 profile：`huawei_ict_agentarts`。负责人：zemeng5208，CW-10 / MOD-13～15。实现基线：`a37cd414280ec76c82f662e58610b1cbc49d215d`（既有 #406）。本记录只覆盖可信语音 Host，不变更 Renderer、ModelGateway/Provider 或 Runtime/Policy 核心；主进程最终组合在同工作包由根接入。

## 行为与接口

原生 Live 保留 `request_work` 和 `read_context`，新增只读 `wait_for_task({taskId})`。业务执行仍经同一个 Competition 任务、工具目录、Policy 和 ToolGateway。`read_context` 接收主进程审查后的完整工具说明、参数 Schema 与配置状态/原因；Host 超过 32000 字符时先移除最早历史，工具目录仍超限则分页，不截断工具 Schema。注册说明不构成本次可执行或授权证据。

`request_work` 的真实 Client 轮询遇到原任务 `waiting_approval` 或 `waiting_reconciliation` 时立即结束本次语音等待，保留已受理任务与 #406 的工作状态。可信审批组合可以把后者映射为已绑定子任务的当前审批问题；没有匹配问题时如实返回未知结果。等待到期后只读查询原任务，不重派工作。`wait_for_task` 持续读取原任务，不能批准、提交、重试或取消；原父任务的结果仍以原父任务终态为准。

`createLiveVoiceHost` 新增主进程注入：

- `prepareTaskApproval({taskId,conversationId,deadline,signal})`：返回当前审批问题或 `null`。问题包含原审批、当前问题 revision 与 argumentsDigest。
- `authorizeTaskRead({taskId,conversationId})`：只接受严格 `true`。主进程经 Runtime 原持久父子绑定解析当前对话；不得依赖 ID 前缀。当前 Live 会话实际提交得到的 taskId 已在本 Host 绑定。

`createVoiceRuntimeApprovalBridge({readPendingApproval,prepareApproval,readCurrentQuestion,now})` 提供 `prepareTaskApproval` 适配。可信 `readPendingApproval(scope)` 验证原待执行参数与原审批工具/digest，返回 `{taskId,conversationId,approvalId,revision,state,taskState,argumentsDigest,expiresAt}`。若原审批属于请求任务的后代，另返回与 `scope.taskId` 精确一致的 `requestTaskId`，且关系必须来自持久绑定。`prepareApproval` 消费原 `voiceCommandHost.prepareApproval`；重复读相同审批复用当前问题 revision。

用户确认仍只来自既有可信采集的 final `input_audio`，绑定 questionId、revision、digest、期限并拒绝 partial、echo、旧 final。`read_context` 与 `wait_for_task` 最多等待五秒接收同轮已开始的最终语音消费回执，再读取原任务；模型函数本身不成为审批来源。关闭语音保留后台任务。

同一 Host instructions 约束语音与文字自然延续同一对话：新工作简短承接一次，复杂工作后台继续，详细进度留在文字中；打断后读取原任务，不要求用户重述或切换界面。模型只解释当前实际操作参数，已确认不再问；taskId、JSON、工具名及内部状态不朗读。`read_context.handoff` 提供有界的 conversationId、continuity、phase、原任务及当前确认标识，供模型在继续听说时恢复原上下文；工具回执保持事实，不固定最终说法。

## 定向验证

使用官方 SHA 核验的 Node `24.15.0` / npm `11.12.0`，工作树独立执行 `npm ci --ignore-scripts --no-audit --no-fund`，随后仅构建依赖，不运行全仓测试。定向命令：

```sh
node --test apps/desktop/test/live-voice-host.test.mjs apps/desktop/test/voice-runtime-approval-bridge.test.mjs
```

26 项通过，无失败/跳过。关键纵向场景：合成 Live 原生函数事件 → 实际公共 Client 一次 `task.submit` → 实际 Competition 目录与 Schema → 原 Runtime 审批 → 合成可信 final → 原 `authorization.respond` → 实际 Policy/ToolGateway 工具仅执行一次及 Evidence → `wait_for_task` 读取原任务结果。云协调器、模型事件和音频为显式 Synthetic；没有真实云请求、设备或账号操作。

另覆盖父任务待核实但原子任务等审批、跨对话与无绑定子任务拒绝、重复调用不重复提交、当前问题复用、陈旧审批拒绝、历史裁剪保持 Schema 完整、到期原任务读回，以及不合作读请求在停止语音后不再发布结果。保留 #406 的 workRequests/workingCount、打断、播放 drain、历史持久化与迟到结果回归。

新增同会话衔接控制场景验证动态 conversationId、user → 已受理任务 → assistant 的保存顺序、打断期间同一工作保持受理、重放只提交一次及原 taskId 结果续读。该测试验证 Host 控制和提示契约，不验证真实模型语言质量或端到端延迟，也不宣称已达到 GPT Live/GPT 模型的质量。

原始日志、UTC 起止、耗时、退出码和日志 SHA 记录于根忽略缓存 `.cache/wiring-20261018/voice/targeted-test.log`、`validation.json`；依赖构建日志为同目录 `build.log`。最终定向运行 UTC `2026-10-18T21:10:23.932064+00:00`～`21:10:25.594887+00:00`，wall `1.663s`，exit `0`，日志 SHA256 `a9af46ee37046748c6b74a4eb79e132d0d105bd05c59d911b202f5e1841c303c`。首次 25/25 冻结证据以 `.v1` 文件保留。物理麦克风/扬声器、真实 native Live 模型、AgentArts 云及 SIS 经 AA 流桥仍未验证；本记录不提高接口冻结状态，也不宣称整个 CW-10 完成。

## 工具目录分页增量

`read_context` 接受可选 `toolOffset`，必须为非负安全整数且位于当前目录内。默认完整目录能在 32000 字符内返回时保持原形；超过上限先移除最旧的 recentDialogue/messages/tasks，仍超限再返回本页完整 `tools`、全部名称/版本 `toolIndex` 及 `toolDirectory:{offset,total,nextOffset}`。instructions 引导模型用 nextOffset 逐页读取，直至 null；registered 元数据不代表任务就绪或授权。

当前审批、参数问题及 handoff 不裁剪。单项 Schema 或索引加当前确认本身超限时明确拒绝，不截断、不跳过。分页不新增 I/O、checkpoint、Core wire、授权或执行路径。Local/Synthetic 增量覆盖大目录逐页 Schema 精确拼回且无重复/漏项、每页字符上限、当前审批保留、非法/越界参数拒绝、旧小目录形状与超限拒绝，连同原语音闭环共 29/29 通过。

分页验证 UTC `2026-10-18T21:34:39.899283+00:00`～`21:34:41.403705+00:00`，wall `1.504s`，exit `0`；日志 `.cache/wiring-20261018/voice/pagination-test.log`，SHA256 `682623d8df8c9b4ed15f33de4e1a15062b0d20e7ac6c360fa7e74fa94234c685`，元数据 `pagination-validation.json`。原 26/26 冻结与自然语音/审批实现不重做。

## 主文字模型与 Live 的同一实际执行路径

#406 的用户 parent Task 是受信自动派发锚点。`userTaskDelegationPort` 在首次交换直接产生原始 `user-work` 派发，要求原 child 与原 dispatch 回执确认后才允许总结；parent 不先调用模型决定是否派发，也不直接执行业务工具。其仅有 dispatch 的目录不能被误写成实际文字执行模型缺少完整功能接口。

真正处理完整用户请求的文字模型位于原 `user-work` child：`runDefaultSubagentWorker` → 原 Competition Coordination/ModelGateway → `taskCompetitionCatalog` 按原 child 持久冻结工具范围投影完整业务参数 Schema。所有提案仍由当前 availability、原 Schema、Policy 和 ToolGateway 检查；注册目录或旧 child 范围不等于当前全部就绪，也不会因全局新增工具而扩大既有 child 权限。源码位置为 `apps/runtime/src/application/user-task-delegation.ts` 与 `runtime-application.ts`。

Live `request_work` 经公共 Client 向同一 UI conversation 提交 Task，随后进入上述同一个 parent → 原 child 执行路径。Live 自身的 `read_context` 只读查看公开能力/原任务及完整 Schema 分页；实际业务执行交给该原 child。Runtime 的持久父子绑定负责原 UI 归属，语音关闭/打断不取消已受理任务；审批后用 `wait_for_task` 读取原 Task，用户无需重述工作。没有新增根发现阶段、第二对话或直接业务授权入口。

## 同一 Live 会话中完全相同 pending goal 的复用

同一活跃 session 与原 conversation 内，模型改用新 callId 请求完全相同 goal，而原请求仍 submitting/accepted/awaiting_result 时，Host 复用原提交 Promise 或只读等待原 taskId，不再提交。首次提交尚无 taskId 时也只等待原 Promise；已有 taskId 时先读取原终态，确认结束后相同 goal 的新请求仍可创建下一次任务。并发的新 callId 共享同一复用等待，旧 callId 的原结果幂等语义保持不变。

该去重只比较原 goal 字符串，不做语义判断或修改目标；不同 goal 不合并。不覆盖 Live 重启/新 session 或用户改写 goal，后者仍经 `read_context` / `wait_for_task` 接续原任务。未增加 Provider、Core wire、后台执行循环或跨任务库。

Local/Synthetic 仅运行 `--test-name-pattern='exact goal|concurrent requests|Live work shares'` 的 5 项小场景并全部通过：首次 submit 未返回 taskId、新 callId；打断后的 pending 原任务与并发新 callId；原任务读回终态后可重提一次；不同 goal 并发；关闭音频保留原已受理任务。证据在 `.cache/wiring-20261018/voice/exact-goal-test.log`，没有运行真实音频、网络或全仓测试。

## 提交已尝试但受理回执丢失

Host 仅在实际调用公共 Client 的 `task.submit` 前标记提交已尝试。该调用之后失败且没有返回 taskId 时，原请求保留为 `awaiting_result` 和 `submissionUnknown:true`；handoff 明确受理结果未知，不声称已经受理或执行成功。同一活跃会话内新 callId 的完全相同 goal 复用原 Promise，不盲目再次提交。参数校验或消费者在提交前失败仍为 failed，不产生未知受理记录。没有自动重试或推断未知 taskId。

Local/Synthetic 定向 6/6 通过，包含真实 Client→Runtime 已创建一个任务、随后合成回执丢失：不同 callId 相同 goal 只有一次 `task.submit` 和一个实际任务，`read_context` 保留未知记录；并复验调用前参数拒绝、打断后复用及已知终态后的新请求。日志 `.cache/wiring-20261018/voice/submission-unknown-test.log`；未调用真实云、音频或全仓测试。

迟到的原 Client 回执若随后带回真实 taskId，会清除未知受理标记并保留原任务绑定；之后的新 callId 只读该原任务。Local/Synthetic 单独覆盖消费者先结束等待、原回执随后抵达，确认状态从未知转为原任务已受理且仍只有一次提交。
