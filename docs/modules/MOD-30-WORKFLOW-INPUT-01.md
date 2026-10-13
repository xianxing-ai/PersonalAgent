# MOD-30-WORKFLOW-INPUT-01：显式 Workflow 目标输入映射

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：huawei_ict_agentarts；负责人 zemeng；非作者评审 goo122。
- 基于 PR #51 `82c7c0e`；状态 review；不解除其真实诊断阻断。

## 依据与实现

2026-09-17 核对华为官方 [InvokeRuntime](https://support.huaweicloud.com/api-agentarts/InvokeRuntime.html)
（页面更新日期 2026-09-14）：单/多智能体使用 query；Workflow 使用 inputs，键名由开始节点配置。
响应示例包含 event=message 和 data.text；现有适配器已经支持这种结构，本片不重复改解析器。

可信宿主新增可选 `workflowGoalInput`。未设置保持原 query 请求；设置后只发送该变量对应的
inputs 目标字符串。变量名在构造时校验并复制，支持 ASCII 标识符 1–128 字符；这只是本地
首片支持范围，不把它说成平台限制。Runtime Application 工厂透传，不增加 Renderer 写入口。
不增加任意 inputs 或 plugin_configs，不自动猜变量、补必填项或失败后换协议重试。
跨入后续 Competition 工具契约时，当前文本适配器明确拒绝非 undefined 的 continuation，
不得只发送 goal 而静默丢弃工具结果。此项拒绝在授权读取或网络调用之前发生。

## 验收边界

此项仅解决单目标变量的请求形状，沿用已有有限文本响应与取消/期限边界。输出仍 unverified。
不代表部署成功、真实 Workflow 输出已核验、原生 function calling 或同次 run 暂停/恢复可用。
两阶段自定义工具协议尚未采纳或实施；不能把普通云端文本转为本地可执行工具。
没有真实账号操作、凭据恢复、费用调用、数据迁移或新增 wire capability。

## 验证

Node 24.15.0 下 coordination、goals 依赖和 Runtime 构建通过。适配器目标测试 4/4：
缺省 query、显式 inputs、构造后配置隔离、非法变量在 I/O 前拒绝及特殊键保真。
Runtime 工厂定向测试 2/2：原 agent 与显式 Workflow 请求都经真实本地工厂和合成 fetch，
任务不静默回退，返回仍 unverified、没有 Evidence。测试使用 `--test-isolation=none`。
追加 continuation 拒绝定向回归 1/1 通过，确认授权读取和传输均为零；未重跑前述不变用例。
本地 Runtime 依赖解析起初缺 goals，补本树被忽略的依赖链接并构建后通过；没有改共享依赖。
未重复旧适配器全套、未跑本地全仓、没有真实云验收。合成 fetch 不证明实际 Workflow 可用。
