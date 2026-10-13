# MOD-09K：Desktop 本机私人记忆逐条确认

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；需求：PA-020、PA-024。
- 负责人：`goo122`；Desktop 消费面非作者评审：`zemeng`。
- 基线：MOD-09J / PR #207；本片在 #202～#207 之后集成。
- 状态：`in_progress`；本片不代表整个 MOD-09 完成。

## 范围与边界

管理后台“记忆”页由用户手动选择本机会话 Vault，主进程以 Knowledge 只读端口检索。
渲染器仅显示转义后的引文和相对路径、提交拟保存摘要；主进程再次读取确切来源，
原生对话框展示引文、路径、摘要和原有摘要。只有确认才调用 MOD-09J 写入或精确版本更正。
相同来源和摘要不重复写入；来源变化、取消、超时均拒绝写入。选择的 Vault 路径不持久化。

真实 Vault 仅允许只读检索。持久写入限定为非安装包、隔离测试 userData 与系统临时
目录内显式合成夹具 Vault 完全匹配的验收进程；渲染器禁用保存按钮，主进程再次拒绝其他写入请求。
原因是用户要求完整删除事实历史与应用管理备份，而当前跨库、旧空闲页及备份保障尚不足。

私人事实单独存于 Desktop userData 的 `private-memory.sqlite`，不与 Runtime 数据库共用迁移，
也不进入当前公开敏感级别的 Goal 投影、AgentArts 请求或公共 wire capability。
仅在 Competition Profile 的管理窗口主框架开放 IPC，Local/Fake 保持不可用。
新依赖只有现有 workspace `@personal-agent/knowledge`，根锁文件由 npm 更新。

## 验收与限制

- 合成 Vault：真实模式及 IPC 绕过均拒绝写入；隔离夹具中拒绝确认零事实；确认后仅私人查询可见；更正形成新版本；重启保持；
  来源变化拒绝旧引文，且完整同源同摘要不重复版本。
- 用户指定的真实 Vault 仅执行只读搜索和明确拒绝确认；不输出正文或保存真实摘要。
- 根 `npm run check`、Desktop 窗口/Runtime Application 冒烟和 `git diff --check` 通过。
- 实机逐条确认、真实持久写入和完整删除尚未验收；本机 OS 会话不构成产品级身份认证。
  独立私人数据库的旧空闲页、应用备份和跨库删除仍需解决。

## 本地验证（2026-09-29）

- 私人控制器与数据路径定向测试：6/6 通过。
- `npm.cmd run check`：架构、类型、工作区测试及根集成通过；根集成 17/17。
- 真实 Vault 只读/拒绝确认：返回 5 条且截断；确认回调拒绝，未写入。
- `npm.cmd run test:smoke --workspace=@personal-agent/desktop` 与
  `npm.cmd run test:runtime-application-smoke --workspace=@personal-agent/desktop`：通过。
- `node apps/desktop/test/private-memory-smoke.cjs`：合成 Competition 窗口中真实模式禁写、
  测试夹具原生确认、首次写入与更正通过；未提交云端任务。
