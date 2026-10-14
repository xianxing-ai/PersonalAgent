# MOD-09J：逐条确认的私人来源写入

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。唯一全局语义决策为自有ARM64镜像内Laya，国内MaaS为执行候选，责任图/并行/后台影子按当前设计；旧DeepSeek全局决策、Laya本机部署和双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；需求：PA-020、PA-024。
- 负责人：`goo122`；非作者评审者：`zemeng`。
- 基线：MOD-09I / PR #205；本片在 #202～#205 之后集成。
- 状态：`in_progress`；本片不代表整个 MOD-09 完成。

## 范围与语义

用户选择只让逐条确认的 Vault 摘录或更正成为长期记忆。受信 Runtime 宿主读取一条只读
Vault 引文，把引文和拟写入摘要交给注入的真实用户确认入口。拒绝则不写；确认后再次读取
同一来源，内容变化则拒绝。首次写入调用 Memory `createUserFact`，更正调用现有
`reviseUserFact`，只形成 `private`、`user_confirmed` 事实。

Memory 迁移 5 增加无正文创建回执。首次事实、feed 事件与回执同一事务提交；同操作与
内容跨重启重试不产生新版本，改变请求或复用 Fact ID 被拒。物理事实删除同步移除回执。
此 API 仅供受信宿主调用，不认证用户、不注册 Desktop/wire capability，也不允许私人
Vault 内容出机。没有用户确认 UI 前，不能对真实笔记执行持久写入。

## 验收

- 合成 Vault：拒绝确认零写入；确认后仅私人查询可见；来源在确认期间变化拒绝写入。
- SQLite 重启后精确重试幂等；改变重试、过时修订、回执写入失败均不污染事实或 feed。
- 事实删除清除创建回执，保留无关事实；模块测试、集成测试、根 `npm run check` 通过。

## 证据与限制

此前对用户指定 Vault 只做了只读检索和内存数据库往返，未持久保存真实摘录。本片的
持久测试只使用合成笔记和临时 SQLite。确认回调仍需可信 UI/身份与逐条用户操作接入；
文件在第二次读取之后仍可能变化，Memory 与 Vault 无跨资源原子事务。真实私人数据的
生产验收、授权/出机控制、跨图删除和备份清除尚未完成，不能据此将 MOD-09 标为完成。

## 本地验证（2026-09-28）

- `node --test tests/integration/confirmed-private-source.test.mjs`：1/1 通过。
- Memory 定向 SQLite 测试：17/17 通过。
- `npm.cmd run check`：架构、类型、工作区测试及根集成测试通过；根集成 17/17。
- `git diff --check`：通过。
- 以上均为合成持久写入证据；用户指定的真实 Vault 仍只有只读及易失往返证据。
