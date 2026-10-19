# BUSINESS-CONSUMERS 镜像全链路 Evidence（2026-10-19）

[Issue #354](https://github.com/zemeng5208/PersonalAgent/issues/354) 缺口 5 首批交付：独立调用已部署的自有镜像运行时，为本工作包业务模块保存真实 Evidence。采集入口 `tests/manual/agentarts/business-consumers-cloud-e2e.cjs`（显式 `PA_MANUAL_BUSINESS_CLOUD_E2E=1` 选择加入；凭据只经本机 DPAPI 加密的受信配置副本加载，不经环境变量正文、不入任何报告）。

## 链路构成（两场景相同）

桌面完整组合（非合成 MVP）→ 用户目标 → AgentArts 网关（`defaultgw-gztdqobzmm…`，运行时 `pa-owned-bindings-0dae0ff5-api`，endpoint Latest）→ 镜像内编排提出工具提案 → 本地 Runtime 派发子任务（`subagent.dispatch` confirmed）→ ToolGateway/Policy 以 automatic-read-tool（读类免人工审批，符合预授权设计）执行业务工具 → 真实外部 Provider 读回 → 续答 → 任务 `succeeded`。工具执行与 Evidence 落 `runtime.sqlite`，本目录 JSON 为读回快照。

## 场景结果

| 场景 | 工具（版本） | 执行 | 外部 Provider 实调 | 结果要点 |
| --- | --- | --- | --- | --- |
| F11 天气（weather） | `weather.forecast` (0.1.0-alpha.1) | confirmed / allow | Open-Meteo geocoding（zh+en 各一次）+ forecast（北京 39.9075,116.39723），均 HTTP 200 | 结果摘要含核实口径：6.9–18.2°C 局部多云、同名地点歧义如实披露、数据时间戳与缓存 TTL；不宣称未提供的信息 |
| F10 研究（research） | `research.search` (0.1.0-alpha.1) | confirmed / allow | OpenAlex 检索 | 检索结果经确认后续答，任务 succeeded |

另：裸 CloudAgentPort 探针一次（`.cache`，goal=北京天气）：镜像诚实回答"当前没有可用的天气查询工具"——裸调用不带业务工具目录，不编造天气，反向印证目录消费依赖桌面组合下发，与本链路互补。

## 边界（不宣称）

- 未行使写路径模块（F08 邮件真实调用本轮明令禁止；日历写/通知实机送达待用户配合验收）。
- `notifications.events`/`developer.*`（含 #423 的 `developer.test_locate`）已有各自单元/集成验收；其云端消费 Evidence 待镜像侧对应图接线后按同法采集。
- 每场景一次真实模型调用（deepseek，费用已发生）；失败迭代记录保留于 `.cache`（未入仓），首次失败仅断言位置问题（执行记录在子任务），链路本身一次即通。
