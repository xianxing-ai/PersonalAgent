# ADR-0025：Competition 编译上下文版本与预算绑定

- 日期：2026-10-14
- 负责人：goo122
- 状态：proposed，待非作者评审与集成
- 目标：`huawei_ict_agentarts`，沿用 ADR-0010/0018/0021/0023/0024

## 背景

私人记忆消费已绑定事实版本、摘要/来源摘要、配置和逐任务确认；Skill 已绑定安装代次、内容摘要、会话及期限。Runtime 已统一编译任务、准备输入和最多 20 条历史，校验最终 16000 字符限制，并在读取凭据后再次执行受信宿主门禁。此前缺少整个编译输入的持久版本比较。

## 决定

1. 在现有 `coordinationInput` 路径第一次发送前，用原 TaskRuntime 的 `competition-context:v1` 检查点绑定任务、对话、期限、Competition 配置、公开/准备/最终输入摘要、消息身份与正文摘要、既有私人事实绑定摘要和预算。所有输入正文仍只在内存中使用。Skill 摘要在既有公开任务包装中；来源引用及版本在既有输入或私人绑定中，不另造 DTO。
2. 同一任务后续发送与恢复必须匹配该版本；内容、来源修订、配置或预算变化要求新任务。恢复比较摘要不构成重新授权；私人记忆和 Skill 的原确认、有效期、来源门禁继续执行。已有确认工具回执保留，拒绝云端继续发送后进入原协调恢复路径，不重做工具。
3. 硬字符限制继续使用最终序列化字符串的 JavaScript `length`，即 UTF-16 code units，包含 JSON 转义和包装。超限明确拒绝，不截断授权、来源参数或自动生成摘要。
4. 新增 host-only、provisional 的 `CoordinationInputHooks.goalTokenBudget`：`tokenizerRef`、`contextTokens`、`reservedOutputTokens`、同步 `countTokens(compiledGoal)`。计数必须是可信确定性 tokenizer 的实际结果；`inputTokens <= contextTokens - reservedOutputTokens`。首次发送、发送门禁与凭据读取后的门禁均复测并比较版本。无计数器时记录 `unmeasured`，不从字符数估算。
5. 此预算仅覆盖编译 goal 与宿主指定的输出预留。工具目录、继续回执、传输包装及平台额外提示不在计数范围；它不证明真实模型完整上下文窗可用，不替代 ModelGateway 的输出预算或 Agent 的累计 usage 预算。Desktop 暂无已验证 tokenizer，保持 `unmeasured`；合成计数器仅用于测试端口行为。
6. 发送门禁还校验引用的历史任务未转为 withheld，以及既有私人绑定未变化。新增内存记录只含摘要和关联任务 ID，释放、关闭及逐事实删除时一并丢弃。新增持久检查点按原 `eraseTaskCopies` 的非白名单正文清理处理；匹配事实的父/子任务被清理，无关任务保留。此增量不增加持久私人正文副本。

## 兼容与迁移

不新增 wire capability、Schema、依赖、数据库迁移或第二个存储。既有检查点表支持版本记录，Local 路径不扩展。旧任务第一次经过该路径时建立绑定，不能据此证明升级前的输入版本；原私人/Skill 重启拒绝策略保持有效。外部副本、未知执行和整篇 Wiki 备份继续保持原 pending/withheld 语义。

## 替代方案与复审

不按字符比例伪造 token 数，不为上下文新建数据库，也不持久化可压缩的私人摘要。本阶段选择绑定并拒绝漂移；后续确定具体模型 tokenizer 与完整请求编译入口后，再评审全请求 token 计量、确定性历史选择及摘要副本管理。真实云端验证另行授权。
