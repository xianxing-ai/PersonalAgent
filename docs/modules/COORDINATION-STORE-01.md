# COORDINATION-STORE-01：图谱持久化首片

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：huawei_ict_agentarts；负责人 goo122；消费方与非作者评审者 zemeng（PR #38 已批准）。
- 状态：done；基线 main `41ea79d`（PR #37）；PR #38 已由 `zemeng5208` 非作者批准，并于 2026-09-12 合并为 `87ee444`。
- 范围：MOD-27 的 namespace-bound CoordinationStorePort、Fake、Runtime SQLite 适配及原子版本提交。
- 不在范围：AgentArts、MemoryQueryPort、FactChangeFeed、桌面接线、真实私人数据、物理删除及完整认知闭环。

## 公开接口与信任边界

`@personal-agent/goals/store` 提供 provisional 的 `CoordinationStorePort`：

- `read(revision?)`：返回隔离副本，省略版本读最新，指定版本读历史。
- `append(expectedRevision, node)`：追加一个合法节点版本；旧版本报 REVISION_CONFLICT，无部分写入。
- `FakeCoordinationStoreHost.provision(namespace)/bind(namespace)` 供离线开发。
- Runtime 可信宿主通过 `provisionCoordinationStore(namespace)` 显式初始化空图；
  重复初始化保留数据。`bindCoordinationStore(namespace)` 不建图，缺失图的读写报 NOT_FOUND。

只有可信宿主可以选择 namespace。交给消费者的对象只含 read/append，不能选择另一个 namespace；
这不是进程安全沙箱，也未实现用户身份授权系统。不能将 TaskRuntime 或 Fake host 暴露给不可信消费者。
未增加 wire operation、handshake capability 或云端 DTO，不向 AgentArts 发送图谱内容。
GraphError 保留 INVALID_ARGUMENT/REVISION_CONFLICT；损坏、关闭或不可用的 SQLite 统一报
STORAGE_UNAVAILABLE，不将损坏数据变成空图，也不回显存储内容。

本片为同步端口，不启动异步任务、重试或云调用。SQLite 沿用 5 秒 busy_timeout；
事务等待会阻塞调用线程，不承诺可取消或满足 Agent 的异步 deadline。
接入执行循环前需由宿主安排调用及预算边界，不能把该端口当成长任务执行入口。

## 存储与升级

沿用 Runtime 数据库、WAL 与唯一迁移序列，新增 migration 5 的 coordination_graphs 表。
BEGIN IMMEDIATE 事务内读当前图、检查 expectedRevision、追加和提交，跨进程同旧版本仅一方成功。
暂存完整 JSON 历史，沿用领域校验和复制语义，适合合成小图验证；未验收大图吞吐与容量。
历史不能覆盖，撤回是新版本，不等于物理删除，也不能撤销外部副作用。

升级前备份已关闭应用的数据库，或使用 SQLite 一致性备份，不能只复制活跃 WAL 数据库主文件。
旧迁移 1～4 不变；旧版本应用检测到 schema 5 会拒绝打开，不能通过删表/清库降级。
回退只能恢复升级前的一致性备份，升级后新增数据不会自动回迁。

## 验收

测试文件：apps/runtime/test/coordination-store.test.mjs；全部为临时合成数据。
覆盖 Fake/SQLite 行为一致、显式初始化、历史副本、撤回、非法输入回滚、命名空间隔离、
旧任务数据升级保留、拒绝降级、独立进程重启读回、两进程同版本竞争、损坏/关闭错误脱敏。
2026-09-10 验证：Node 24.15.0 / npm 11.12.1，`npm run check` 完整退出 0。
架构、生成类型、全 workspace 构建与类型检查通过；含架构检查共 203 项，
199 通过、4 项真实天气门控跳过、0 失败。新增存储测试 8/8，Runtime 共 46/46。
首次新增测试暴露 Windows 临时目录先于数据库关闭的清理错误，修正关闭顺序后完整复跑通过。
较早的一轮输出工具在 120 秒超时，不计为通过；以上是随后完整运行结果。
`git diff --check` 通过。锁文件仅新增 Runtime 对已有 goals workspace 的依赖，无第三方升级。
未调用模型、AgentArts 或真实账号，未运行 Electron smoke；本片已完成非作者评审和集成，不代表 MOD-27/28 整体完成或接口冻结。

2026-09-12 合并后回归：在 main `87ee444` 的独立工作树使用 Node 24.15.0 /
npm 11.12.1 干净安装依赖，`npm run check` 完整退出 0。含架构门禁共 203 项，
199 通过、4 项真实天气门控跳过、0 失败；Runtime 46/46，存储测试仍为 8/8。
本次未执行真实外部服务、AgentArts 或 Electron 实机验收。

下一步：由 zemeng 将会议变更消费者改为仅接收已评审的绑定端口，
补充“读取持久图→影响分析→显式候选修订→冲突后重新分析”的消费者验收。
Memory/变更订阅、真实数据删除及 AgentArts Golden Path 单独交付，不据此标记 MOD-27/28 整体 done。
