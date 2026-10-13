# P8：审批恢复与受信装配

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Profile：`huawei_ict_agentarts`。P8 集成树 `mvp-assembly`，分支 `codex/zemeng/p8-mvp-final-integration`；状态 review，整体 MVP 尚未验收。

## 共享接线

- Runtime Application 公开模型工厂、same-child 恢复与持久子任务汇总；Desktop 注入 `createGateway`，安全存储和 API 管理仅在可信 admin 设置中使用。未知模型不回退旧盘古配置。
- Runtime 在 application-goal 前识别 `subtask-parent`。子任务等待审批时父任务保持 waiting_approval；未知执行保持 waiting_reconciliation。已确认派发的回执绑定原 runId、参数 digest 和版本；所有子任务结束后只重读实际汇总，重放原确认派发回执，再继续原 Competition loop。父任务不提前完成，终态不重开。
- task.cancel 通过 Application 请求停止原父会话下的未终结子任务。配置版本变更由子任务宿主原 deployment binding 拒绝旧提案。
- 正式 Competition 启用既有 repair_candidate 1.0 与 P5 reviewedSource resolver。只有当前许可、精确 review ID、binding 和 intent digest 匹配的 Goal review 修复才进入现 routine Policy 单次授权；Fact 来源仍保持原审批。执行时 P5 在 source lock 内复验真实来源、图版本、Policy、CAS 和回执。
- 日历 P5 端口按已注册工具装配，首次未保存配置也保留端口；每次读取仍检查真实配置。审批控制的 revision 转换为原协议 expectedRevision，没有新增 wire 字段。
- Desktop 声明已有 coordination workspace 依赖，锁由离线 npm 生成，只增加对应依赖项；没有外部依赖或迁移。

## 必要验证

- 当前 cognition、models 与 Runtime 定向 TypeScript 编译通过。首次 Runtime 编译发现旧 models dist 缺 OpenAICompatibleModelProvider 导出，以及本次代码一处 unknown 参数类型；分别构建当前 models 与按已验证输入 Schema 收窄类型后通过。
- `subagent-parent-resume.test.mjs`：1/1。真实 Runtime/SQLite/Policy/ToolGateway，显式 Fake 模型/云；审批前工具零调用，原 child/runId 执行一次，父派发回执仅一条，重新汇总 succeeded=1，再云续接一次，父 Evidence 包含原 child 执行引用，重复终态恢复拒绝。
- `calendar-read-approval.test.mjs`：1/1。真实 Client 协议路径使用 main 同一审批映射，首次未配置→配置后保留端口，审批前零网络请求，允许后一次 Fake fetch 与 confirmed 回执。
- 单架构依赖门禁通过；main/admin 语法与 diff 检查通过。没有重复作者旧 9/12/13 项或全仓 smoke。

验证环境为 PATH Node 26.3/npm 11.16，目标 Node 24.15/npm 11.12 尚待约定基线验证。真实 Provider、系统 safeStorage、正式 admin 渲染、云端新 Goal 包装、原生 F9/语音、日历初始 Fact/目标关联、RSS 多引用、MCP/Skills 和整体验收分别待后续装配或实际验证；不据以上局部结果宣布 MOD 或 MVP done。
