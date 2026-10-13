# MOD-29：AgentArts Runtime Application 可信装配

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；负责人：zemeng；状态：in_progress。
- 工作树：`.worktrees/zemeng-agentarts-runtime-integration`；基线：PR #39 /
  `188f925`。
- 依赖：MOD-04B CompetitionCoordinator 与 MOD-29 AgentArts HTTP Adapter 完成评审。
- 范围：`apps/runtime` 的唯一 Competition composition factory，以及 Desktop
  主进程的显式 profile/部署配置；不扩公共 wire Schema。

下列行为与验收保留原工作包记录；2026-10-07 的源码状态及剩余项见末节。

## 行为与边界

`createAgentArtsRuntimeApplication` 只接受 HTTPS gateway、runtime 名称、
`debug`/`published` 模式、受信授权提供者和测试用 fetch seam。它将
`AgentArtsCloudAgentPort` 包在 `CompetitionCoordinator` 后注入既有
`RuntimeApplication`，没有第二套任务库、Local/Fake fallback 或 Renderer 云调用。

Desktop 仅在受信进程环境明确设置
`PA_RUNTIME_PROFILE=huawei_ict_agentarts` 时选择该工厂；gateway、runtime 和完整
Authorization header 均由主进程读取。缺配置时 Runtime 明确保持未连接。凭据不进入
任务正文、Renderer snapshot、日志或仓库；后续持久配置必须使用系统加密存储。
显式空 profile/invoke mode 和 Competition + fake-model 组合均被拒绝；只有 profile
变量完全缺失时才沿用既有 Local 默认，显式 `--fake-runtime` 仍优先进入离线测试。

本工作包只接通文字调用。AgentArts 输出固定为 `unverified`，不能携带工具、
Evidence 或任务终态。工具提案 → 本地 Policy/Approval/ToolGateway → 目标读回 →
Evidence 是后续独立契约增量。

## 验收

- Runtime 纵向测试使用注入的合成 HTTP 响应，验证
  Client → RuntimeApplication → Coordinator → AgentArts adapter，以及无 Local
  fallback、授权只读取一次、请求正文最小化、结果无 Evidence。
- 非法 HTTP gateway 必须在创建数据库前拒绝。
- 依赖提交合入后，`npm.cmd run check` 已通过：架构门禁、生成类型、全 workspace
  类型检查与测试全部通过；其中 coordination 38/38、runtime 48/48、Desktop 6/6。
  `test:runtime-application-smoke` 也通过（7 次模型请求、2 次取消）。
  运行环境为 Node 26.3.0 / npm 11.16.0，仓库指定 Node 24.15.x / npm 11.12.x
  尚需由 CI 覆盖。
- 真实部署只使用合成事实；另行记录 deployment/version、runtime、trace、usage、
  取消/超时和失败语义。未获得真实读回前不得标记 available。

## 2026-10-07 源码完成矩阵

只读基线为 main `4b5ec61`；[PR #302](https://github.com/zemeng5208/PersonalAgent/pull/302)
的新增补丁尚未合并，不计入该 main 的能力。历史云回执不变，本轮没有账户绑定、云调用、
部署修改或真实云验收。

| 接线 | main 已有实现 | #302 未合并增量 |
| --- | --- | --- |
| 唯一 Competition 工厂 | [agentarts.ts](../../apps/runtime/src/application/agentarts.ts) 将公开 CloudAgentPort/Coordinator 注入原 Runtime；支持显式 Workflow 输入、JSON 提案、repair candidate 与初始工具目录，无自动 fallback | 捕获候选模式一次并纳入启用模式的持久 configurationRef；保留外部发送 guard 返回值，让 raw adapter 的同步 void 校验生效 |
| Desktop profile | [runtime-profile.js](../../apps/desktop/electron/runtime-profile.js) 默认选择 Competition；显式 Fake 使用 Local，并拒绝 Competition/Fake 混用。原文的 Local 默认是历史行为 | 不改变 profile 选择 |
| 宿主输入与最终发送检查 | [Runtime Application](../../apps/runtime/src/application/runtime-application.ts) 已准备受信 goal、保留 ephemeral 绑定，并在凭据等待后的发送前重新调用宿主检查；私有派生回复不写入历史正文 | 输入 beforeCoordinationSend 的非 void 返回立即拒绝，消费迟到 rejection，保留同步发送顺序与固定错误 |
| 原任务生命周期 | Coordinator、Runtime 与默认子任务沿用原 task、deadline、审批、checkpoint 和 confirmed 执行回执 | direct cloud call 的日期/信号错误边界；confirmed 子任务重放保留父取消；proactive prepare 获得私有 context 副本 |

候选模式绑定有兼容影响：升级 #302 后，旧启用候选模式的未完成子任务需重新提交；
disabled 模式的历史 configurationRef 保持。同步发送 guard 原合同不变，错误返回 Promise
或数值的宿主实现会被拒绝，不等待该返回值完成。

本轮输入 hook 增量完成 Runtime 构建及 74 项受影响 Runtime/Desktop 定向测试；这不是
全 #302 检查、Windows/Electron UI 或真实云运行结论。请求级 deployment/version、
平台 trace/usage、真实取消效果与当前部署健康仍须各自读回，不能用本地配置 hash 替代。
