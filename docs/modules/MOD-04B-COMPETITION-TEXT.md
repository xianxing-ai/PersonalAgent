# MOD-04B：Competition 文字协调消费实现

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- 负责人：zemeng；待非作者评审。状态：review（本地实现已验证，待评审与集成）。
- Profile：huawei_ict_agentarts；实现基线：PR #38 / `87ee444`；已同步 PR #39 /
  `188f925`。
- 工作树：`.worktrees/zemeng-mod04b-coordinator`；分支：`codex/zemeng/mod04b-coordinator`。
- 修改范围：`packages/coordination`、本说明及 ROADMAP 的继续入口。
- 复用 #36 的 provisional CoordinationPort / CloudAgentPort；原有请求、结果形状不变。

## 交付

CompetitionCoordinator 将 Runtime 的一次文字请求交给显式注入的 CloudAgentPort，
验证输入与返回值，传递 revision/deadline，转发取消，截止时间到达时中止等待。
只允许现有文字结果，不接受工具、授权、Evidence 或任务终态字段。
UnavailableCloudAgentPort 明确返回不支持；任意适配器异常不回显私密消息，
provider 自报的 `CANCELLED`/`TIMEOUT` 也按 `EXTERNAL_FAILURE` 处理，生命周期码只由
协调器根据调用方 signal/deadline 产生。
既有 FakeCloudAgentPort 可直接注入，无重复 Fake、Local fallback 或第二套任务库。

提交幂等、持久状态和重启恢复仍由 Runtime 管理。取消不能强制终止不配合的
第三方代码，但协调器不会交付迟到结果。本包未建立网络连接或使用账号。

## 边界与继续入口

- goo122 的 Runtime、contracts、Policy/ToolGateway、根配置和锁文件保持原样。
- MOD-29 后续实现 AgentArts 适配；真实连接需要受信宿主出机授权和已确认的 API。
- deployment/version/trace、usage、工具提案及执行结果需要后续契约增量，不能塞入
  当前会拒绝额外字段的文字结果，或用 resultSummary 尾缀建立隐式协议。
- MOD-30 的工具执行与 MOD-32 的云端证据尚未交付；本增量不完成整个 MOD-04B。

## 验证

新增测试覆盖 Fake 消费、非法/越权输入、预先取消/过期、运行中取消、
不响应中断的适配器超时、Unavailable、异常脱敏及伪造结果拒绝。

- `npm.cmd run typecheck --workspace=@personal-agent/coordination` 通过。
- 2026-09-13 同步 PR #39 / `188f925` 后，按要求复跑
  `npm.cmd test --workspace=@personal-agent/coordination`；本机 Node 测试隔离子进程
  因 `spawn EPERM` 失败，不能计为 npm 测试通过。刷新忽略的 `dist` 后，以
  `node --test --test-isolation=none test/coordinator.test.mjs test/ports.test.mjs`
  运行等价测试，14/14 通过（新增 12 项）。
- 根 `npm.cmd run check` 的既有记录曾通过：架构、生成类型、构建、全 workspace
  类型检查和测试；真实天气 4 项按默认门控跳过。本次只重跑受影响 workspace，未把
  该历史记录当作本次 hardening 后的全量证据。
- 通过公开 package exports 运行 Client → Runtime → CompetitionCoordinator →
  FakeCloudAgentPort，确认只调用一次、文字结果持久化、Evidence 为空；关闭并重开
  Runtime 后经 `task.list` 读回同一成功任务。隔离数据库保留在 `.cache/mod04b/`。
- `git diff --check` 通过。未运行真实 AgentArts 或 Electron UI 验收；本包无云端和界面改动。
- 环境 Node 26.3.0 / npm 11.16.0；仓库指定 Node 24.15.x / npm 11.12.x，
  指定版本环境尚未验证。锁文件未改动，未升级依赖。
- 尚未推送、创建 PR 或发送非作者评审请求；端口继续 provisional。
