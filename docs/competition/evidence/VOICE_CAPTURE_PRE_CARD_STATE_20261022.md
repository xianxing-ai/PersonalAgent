# Live 麦克风卡前状态序列化故障

目标为 Competition Desktop 的原麦克风用途授权；工作树为 `.worktrees/pelican-real-completion`。
主控修复 native host，本增量负责原麦克风/Intent/SQLite 全链回归及 question host 首因诊断。

按明确授权，仅以 SQLite readOnly + query_only 读取两个指定失败任务的固定元数据：
原 host tool 均为 `desktop.authorization.intent`，action 均为 `voice.capture`。
原 invocation、question binding anchor、参数摘要和期限已持久化；其后审批被系统撤销，
task 为 failed / REVISION_CONFLICT、executionStarted=false，原卡数组为空。
SQL 对照源码白名单匹配到固定终态字面量“原授权请求已失效，本次操作未执行；请在当前对话重新提出。”。
该字面量来自 Runtime 的 `invalidatePendingApproval`，并非 Illegal task transition。
没有读取目标、摘要、原 payload、凭据或私人正文；这里不公开用户任务 ID、摘要值或数据库副本。

修复前，以生产 `MicrophoneCaptureHost` → 原授权 Intent → 实际 Competition Runtime/Policy/SQLite
→ 生产 native execution host（尚未 verified）构造独立 Synthetic 夹具，捕获到：

```text
preparationCode: INVALID_ARGUMENT
preparationReason: state_not_lossless_json
taskCode: REVISION_CONFLICT
taskReason: question_invalidated_before_execution
questionCount: 0
executionStarted: false
```

初始错误为 `Host state must be bounded lossless JSON`。未验证的 native host 返回含 undefined 的
available/enforced/bindingDigest；授权状态的原严格 JSON CAS 拒绝它，Runtime 再把 pending approval
撤销成通用 REVISION_CONFLICT。隔离复现约 50ms，日志 `.cache/microphone-native-before.log`。
这证明真实装配中的共用缺陷和覆盖原异常的链路；旧真实任务未保存首次异常，不能补造该字段。

主控提交 `d0e25f65` 将 native readiness 改为严格 Boolean，并在未 verified 时省略 bindingDigest。
合入后相同核心调用链通过：原 read-only 卡能持久化并等待用户决定，allow_once 之后原 Intent task succeeded，
原精确 grant 仅消费一次。Synthetic 夹具未启动物理麦克风、外部 helper、模型、网络服务或应用。
外部 required 的 native 执行仍保持不可用时拒绝；没有修改用户实际沙箱选择。

question host 新增本地私有 `authorization-question-diagnostic:v1:<runId>`，在原异常向 Runtime 传播前
只保留首个固定 code/reason/stage 和原 task/run/工具版本/参数摘要/期限；不保存自由 message、stack、
payload 或 native 配置，不授予工具或出机权限。诊断持久化失败仍抛出原错误。
显式坏端口反例证明先保存 INVALID_ARGUMENT / state_not_lossless_json，再出现通用失效终态。

必要验证：question host、authorization Runtime integration、native readiness 三文件 9/9，
0 fail、0 skip、0 cancelled，日志 `.cache/microphone-question-focused.log`；修后原麦克风链单项 1/1。
语法和差异检查通过。用户正在运行的实例没有被关闭、点击、重启或改写数据库；
本增量不宣称其已加载新代码，也不代替真实物理采集/听辨验收。
