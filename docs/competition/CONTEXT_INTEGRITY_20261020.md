# 会话上下文完整性修缮与评估（2026-10-20）

状态：review；profile：`huawei_ict_agentarts`。隔离工作树 `27bb/Personal Agent`，原分支 `codex/fix-chat-continuation`，随 `codex/connect-existing-tools` 提交 PR。保留既有修改、原始数据和待核实任务。用户已授权提交和推送本轮修复；交付提交与审查状态以 Git/PR 记录为准，尚未合并主分支。

## 已实施

1. **历史与状态分开**：host-only 事件截面读取按当前任务创建序列重建历史。失败、取消、未完成或无回答摘要的任务仍保留用户原文；未来才完成的回答不倒灌。冻结 Core wire 和旧 `readConversationHistory()` 不变。
2. **共享编译**：Competition 不再固定截取20条。普通对话保留全部用户原文、当前目标和来源；超16,000字符时仅允许省略助手历史并列出 `omittedAssistantIds`。用户原文仍超预算则明确拒绝。Skill、私人消费及确认预检保持严格完整预算。检查点只增加选择数量、身份/内容散列及预算。
3. **原文取回**：同一 Runtime/Policy/ToolGateway 上新增只读 `conversation.read_history`，只读取当前任务会话与 cutoff 内的已知消息引用，最多8条/64KB，不接受其他 conversationId。原文不截断并附内容散列；最终导出重新校验可读性和内容。接口为 provisional，注册不构成真实云验收。
4. **通用续接**：受信配置 `continuationContext:'goal'` 显式携带编译目标和最多32个前序已投影回执；默认旧行为不变，完整 query 超1,100,000字节拒绝。前序回执在实际端口前及异步凭据读取后重新校验权限。旧宽策略下的只读结果只能被相同工具/版本/参数的新读结果替代，不借此替代写入或重放未知执行。
5. **撤销贯穿历史**：旧助手回答复核原工具策略与当前许可，并追溯子任务来源；不能通过旧回答、overlay 或原文工具恢复撤销/删除/修改的来源。公开用户原问题可保留并标记 `answerWithheld`。私人/Skill 消费许可不继承到新任务。
6. **长正文与 Live**：子任务不再静默截断到4,096字符；仍受16,384字符字段及64KB整体限制，超限保留本地结果并拒绝导出。Live 启动和 read_context 使用同一编译器，不截掉用户尾部与早期条件；历史读失败或关键内容超预算时阻止不完整发送，未保存转写仍可本地恢复。
7. **回答完整性**：源码 `owned-1.7` 增加补充信息承接、更正、失败需求、来源省略和逐项覆盖检查；模型自查不构成正确性证明，保存、实际发送和最终回答分别验收。

## 兼容与启用

见 [ADR](../adr/CONTEXT_INTEGRITY_20261020.md)。无新依赖、数据库迁移或第二套任务/长期记忆库。需求状态首先由带来源的用户原文和执行状态重建，不用关键词猜测，也不把模型摘要当用户事实。

新版通过 `createAgentArtsRuntimeApplication({continuationContext:'goal', ...})` 启用；Desktop 可设置受信宿主环境 `PA_AGENTARTS_CONTINUATION_CONTEXT=goal`。必须先部署兼容 owned runtime 并验证，再启用。默认不改变旧协议，不静默切换 Local/Fake。

用户恢复 Docker 后，已确认引擎29.7.2可用，构建 ARM64 镜像并上传 SWR，远端架构与摘要读回一致：`sha256:e99a48652f0dc58c6235775ef2577ead81362857e8b722c9eb18a0b4f9b1c004`。固定版本 `arm64-context-1-7-1020` 已部署，控制台 Latest 随保存新版本指向候选。隔离验收通过后，确认原桌面无运行任务，正常退出并保留原数据库、凭据及待核实任务；现已固定新版本，当前启动进程显式设置 `PA_AGENTARTS_CONTINUATION_CONTEXT=goal`。未修改系统环境变量，其他启动入口若未设置该值仍走兼容旧协议。发布记录 `.cache/verification-20261019/context-release/release.json`，其中 `built:false` 指脚本复用了此前单独构建的镜像。

## 实际验证

### 真实服务基线：7/7

独立数据目录 `.cache/context-integrity-baseline-user-data`，固定 `arm64-chat-1-6-1020`、真实 AgentArts、无 Fake。先建立27条明确标注的**合成历史夹具**，再经真实 Electron 输入框调用模型；不能冒充27轮真实模型生成，也不能代替新1.7协议验收。

| 用例 | 实际结果 |
|---|---|
| 超20条后的早期设定 | 青石-7429、500元、靛蓝 |
| 失败任务的用户限制 | 保留“不推荐皮革” |
| 更正 | 改350元、琥珀，其他条件保留 |
| 精确回忆 | 四项当前设定，不混用旧颜色 |
| 重启 | 仍为350元、琥珀、不推荐皮革 |
| 会话隔离 | 新会话只答“不知道” |
| 穿衣→青岛 | 保留无皮革与外套/内搭/裤子/鞋子四项，不再定位辽宁 |

记录 `.cache/verification-20261019/integrity-real-baseline.json`。天气回答仍有验证措辞，不把本轮记为全部表达风格或所有业务验收通过。

### 自动化与失败记录

- 上下文、工具续接、原文消费、来源撤销、Live 历史/恢复/启动和 Skill 预算均有 workspace 回归测试。
- 最终 Desktop 完整回归1318通过/8跳过；集成测试51/51通过。
- 整仓检查曾暴露4个 Skill 预算用例及旧投影回放用例，修正后定向通过，失败记录保留。F15 默认并行原生图3项失败，同一文件单独执行28/28通过，未放宽断言。
- 最终 `npm run check` 非全绿：Desktop1317通过/8跳过，Runtime856通过/3失败，失败仍为 F15 图执行/审批恢复；架构、生成检查及类型检查通过。其后同一 Runtime 全部测试串行执行859/859通过，未修改断言；保留默认并行失败，不能仅据此断言根因。日志分别为 `.cache/verification-20261019/integrity-check-final.log` 与 `integrity-runtime-serial.log`。

### 新1.7真实消费：通过

- `.cache/context-integrity-candidate-user-data` 使用固定1.7、WSS、无 HTTPS fallback、无 Fake，显式启用新协议。27条合成历史之后进行7轮真实输入：早期设定与失败限制、更正、精确回忆、重启、会话隔离、穿衣需求、补充青岛，全部通过。天气追问实际回答四项无皮革穿搭。证据 `.cache/verification-20261019/integrity-real-candidate.json`。
- `.cache/context-integrity-history-user-data` 种入明确合成长助手答复，预算选择省略该正文。真实模型经 `subagent.dispatch` 调用 `conversation.read_history`，两项执行均为 Policy allow/confirmed，最终正确回答仅存在于原文末尾的“松涛-6281”。证据 `.cache/verification-20261019/integrity-real-history.json`，任务 `7faddc32-6d57-4ec6-8c45-23c4013989bb`。首次结果读回脚本误把 Application 方法当 Runtime 方法，修正脚本后从同一持久记录读回；没有重复真实调用或改写任务结果。
- 原桌面已重启到固定1.7；真实“哈喽”任务 `35c85d02-4c25-499e-a7c4-5e2a5341be1c` 成功，回答“哈喽！有什么我可以帮你的吗？”。启动与对话证据 `.cache/verification-20261019/real-chat-startup.json`、`chat-json-release/promoted-dialogue.json`。该启动入口打开新的“开始对话”，旧会话保留。
- 以上证明实际文字链路、历史取回和上下文承接；多工具回执全历史与撤销组合有自动化覆盖，不冒充所有真实工具和语音设备逐项通过。

## 边界与继续入口

有限上下文无法同时容纳无限历史。本轮保证原文可追溯、用户需求不静默消失、旧副本不能绕过来源权限；不自动生成语义摘要或升级长期记忆。确切 tokenizer 未注入时仍记为 `unmeasured`；字符/字节预算不是完整 provider token 预算。真实语音设备、全部业务工具及无限历史不在上述真实验收覆盖中。

后续独立事项：定位默认并行 F15 不稳定；真实语音设备验收；如需所有启动入口默认启用新协议，单独评估持久配置与兼容迁移。当前修复已本地接线并部署验证，本次按用户授权提交和推送，不据此将全部 Memory 能力标为 done/frozen；PR 审核及主线合并单独记录。
