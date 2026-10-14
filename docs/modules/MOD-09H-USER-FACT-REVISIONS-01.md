# MOD-09H：用户确认的事实更正与撤回首片

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。唯一全局语义决策为自有ARM64镜像内Laya，国内MaaS为执行候选，责任图/并行/后台影子按当前设计；旧DeepSeek全局决策、Laya本机部署和双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；需求：PA-020、PA-024。
- 负责人：`goo122`；非作者消费语义评审：`zemeng`。
- 基线：MOD-09G 分支与 PR #203；本片在 #202、#203 之后集成。
- 状态：`in_progress`；本片不代表整个 MOD-09 完成。

## 范围与语义

可信 Memory 宿主新增 `reviseUserFact`，只接受已有且未进入删除流程、未由公开来源映射拥有的事实。
调用方必须先取得用户授权并提供精确头版本、操作 ID、用户动作来源、时间、有效期、敏感级别和完整新事实。
更正及撤回都形成不可变的 `user_confirmed` 新版本，`corrects` 指向前一精确版本；撤回后旧版不重新成为当前事实。
普通 `append`、MemoryQueryPort 和 FactChangeFeedPort 保持原有语义。

宿主在一个 Memory SQLite 事务内核对头版本、追加事实和 feed 事件、保存不含事实正文的操作回执。
相同操作及内容跨重启重试返回原版本且不重复发事件；同 ID 不同内容和过时头版本拒绝。
注入回执写入失败时，事实、事件、namespace 序号一起回滚。
迁移 4 只新增回执表，不改已有迁移；物理删除事实时同步清除该表对应行。

## 验收与限制

- Memory 包构建、模块全测、根 `npm run check` 和 `git diff --check` 通过。
- 合成数据证明更正、撤回、重启重试、冲突、回滚、来源所有权隔离及删除回执清理。
- 本片不注册用户可调用的 Desktop/wire capability，不提供认证、授权证明、真实私人来源或真实用户数据验收。
- 公开来源拥有的事实不能直接由此入口更改，来源所有权转移与用户确认需独立方案。
- 删除后备份与旧空闲页处理仍按 MOD-09G/ADR-0010 继续；整体 MOD-09 保持 `in_progress`。

## 本地验证（2026-09-28）

- `npm.cmd run build --workspace=@personal-agent/memory`：通过。
- `npm.cmd run test --workspace=@personal-agent/memory`：39/39 通过。
- `npm.cmd run check`：架构、契约、生成类型、全部 workspace 构建/类型/测试和根集成通过。
- feed 更正/撤回增量测试随后通过；`git diff --check` 通过。
- Runtime 定向集成 `node --test apps/runtime/test/sqlite-fact-projection.test.mjs`：6/6 通过；
  其中新增合成用户更正/撤回跨 feed→Goal 精确版本、同节点和重启幂等断言；
  已激活事实删除后再读回 Goal 历史、Memory 历史和用户修订回执均为空，原操作重试幂等。
- 仅合成数据与本地 SQLite；非作者评审、真实授权入口和私人来源仍未验证。
