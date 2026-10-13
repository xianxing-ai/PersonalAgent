# MOD-04/05 验收工作包

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- 历史工作包负责人：goo122；评审者：zemeng 或 Potatos498。后续按 MOD-04A（ModelGateway/Provider，goo122）与 MOD-04B（主 Agent/认知编排，zemeng）分工，历史提交归属不追溯改写。
- 分支：`codex/mod-04-05-acceptance`；工作树：`.worktrees/mod-04-05-acceptance`。
- 基线：`0f7dc1e`，包含已合并的 ARCH-03（PR #24）。
- 范围：Model/Agent、Policy/ToolGateway、Runtime Application 与必要存储适配及测试。
- 状态：本地离线验收通过；PR #26 已由非作者评审并合并为 `29bf54a`。真实模型工具调用未验证，相关 Model/Agent/Tool 接口为 `provisional`，不在 Core Runtime Profile 1 冻结集合中。
- Profile：本工作包是可选 Local Profile 的历史 baseline，不是 Huawei ICT AgentArts Competition Profile 的完成证据；现有代码保留，当前不优先扩展。

| 验收项 | 初始证据 | 本轮结果 |
| --- | --- | --- |
| 模型与 Agent 有界循环 | 原有主循环 | 通过：预算、错误、强制超时取消、显式 JSON 工具提案 |
| 授权持久化及一次性消费 | 原内存 Map | 通过：SQLite 迁移、重启消费、撤销、参数绑定 |
| 工具执行证据持久化 | 原无执行记录 | 通过：成功/失败/未知记录、Policy 决策、标准 Evidence 查询和错误脱敏 |
| 审批与重启恢复 | 原缺少实现 | 通过：拒绝、过期、revision 冲突、重复审批、原提案恢复 |
| Fake 模型到工具完整链路 | 原独立测试 | 通过：Application→Agent→审批→Gateway→Fake Weather→回答 |
| 真实盘古及只读工具验收 | 尚未调用 | 等待本地配置与授权 |

离线工作包已完成评审和集成；MOD-04/05 整体仍保持 review，直到真实验收及剩余能力边界分别完成。准确接口状态见[当前接口目录](../interfaces/CURRENT_INTERFACE_CATALOG.md)。

当前比赛主线改为 Runtime → CoordinationPort → CloudAgentPort → AgentArts → 本地 Policy/ToolGateway。本文记录的 `Application→Agent→Fake Weather` 只用于复用 Runtime、授权和工具底座，不能替代 AgentArts 构建、编排、部署、trace 或评估。

## 本轮验证

环境：Node 24.15.0、npm 11.12.1。实现提交 `d748b3c`（模型/Agent）、`76030ea`（权限/Runtime）、`8f444ce`（集成测试与真实验收入口）。

- `npm run check`：通过架构门禁、生成类型检查、严格类型检查和全工作区测试；3 项真实天气测试显式跳过。
- `node --test apps/runtime/test/mod-04-05-acceptance.test.mjs packages/agents/test/agents.test.mjs packages/models/test/structured-tools.test.mjs`：18/18 通过，包含后补的旧数据库迁移和 Agent 预算测试。
- `npm run test:text-smoke --workspace=@personal-agent/desktop`：通过，Fake 文字提交与回复、显示和复制行为正常。
- `npm run test:smoke --workspace=@personal-agent/desktop`：通过；本轮未复现旧记录中的拖动边界失败。
- `node --check tests/manual/mod-04-05-live.mjs`：通过；关闭真实开关时脚本输出 SKIPPED，未访问真实服务。
- 仓库未配置独立 lint 命令，不宣称执行了 lint。

## 后续真实验收

以下盘古步骤仅在 Local Profile 被明确启用时执行，不阻塞当前 Competition Profile。比赛真实验收改由 `tests/manual/agentarts/` 记录 AgentArts deployment/API/trace、工具提案、本地授权、读回和最终结果。

由用户在本地进程环境中配置 `PANGU_BASE_URL`、`PANGU_MODEL`、`PANGU_API_KEY`，不要提交或将密钥贴入聊天。用户授权后再设置 `PA_MODEL_LIVE=1`，在仓库根目录执行 `node tests/manual/mod-04-05-live.mjs`。

该脚本会进行一次文字连接检查，再请求北京当天天气，并只允许一次 `weather.forecast`；模型调用受 Agent 步骤、token 和截止时间限制。日志输出状态和计量，不输出密钥或完整对话。真实服务仍可能拒绝或返回不符合提案协议的内容，必须按实测结果记录。

桌面手动联调：`npm run start --workspace=@personal-agent/desktop -- --weather-tools`，在现有模型设置中配置盘古后提交天气问题，在后台授权页允许一次，再检查回答。该天气桌面链路的真实人工验收尚未执行。

## 剩余范围

- MOD-04A：Pangu Provider 声明 `toolCalling=false`，未验证原生 function calling；文字 JSON 提案适配只通过 Mock/Fake，真实盘古→审批→工具→读回→回答闭环待验收。
- MOD-04B：Competition Coordination 尚未完成 CloudAgentPort、ToolExecutionPort 与 CoordinationPort 依赖倒置；现有 Local Agent/ModelPort 为可选保留，PA-012 的 AgentArts 多 Agent 尚未实现。
- MOD-05：本轮完成任务级持久授权、审批和证据；跨任务持续授权管理、真实 Windows SecretStore 和真实写操作恢复仍需对应工作包。
- 任意工具的 confirmed 表示工具返回通过 Schema 校验，不等于外部业务已独立读回验证；Evidence 保留 conditional 等级。
- 本离线增量已通过 PR #26 集成；不得据此将整个 MOD-04/05 标为 done。

交付 PR：#26，标题 `feat(runtime): MOD-04/05 离线审批与工具执行闭环`。已记录参数绑定授权、恢复与幂等行为、18 项定向测试和桌面 smoke 结果；真实模型、完整持续授权和 PA-012 仍未验收。
