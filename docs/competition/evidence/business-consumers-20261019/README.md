# BUSINESS-CONSUMERS 镜像全链路 Evidence（2026-10-19）

[Issue #354](https://github.com/zemeng5208/PersonalAgent/issues/354) 缺口 5 首批交付：独立调用已部署的自有镜像运行时，为本工作包业务模块保存真实 Evidence。采集入口 `tests/manual/agentarts/business-consumers-cloud-e2e.cjs`（显式 `PA_MANUAL_BUSINESS_CLOUD_E2E=1` 选择加入；凭据只经本机 DPAPI 加密的受信配置副本加载，不经环境变量正文、不入任何报告；报告内本机绝对路径已脱敏为 `<local-userdata>`）。

## 链路构成（两场景相同）

桌面完整组合（非合成 MVP）→ 用户目标 → AgentArts 网关（`defaultgw-gztdqobzmm…`，运行时 `pa-owned-bindings-0dae0ff5-api`，endpoint Latest）→ 镜像内编排提出工具提案 → 本地 Runtime 派发子任务（`subagent.dispatch` confirmed）→ ToolGateway/Policy 以 automatic-read-tool（读类免人工审批，符合预授权设计）执行业务工具 → 真实外部 Provider 读回 → 续答 → 任务 `succeeded`。工具执行与 Evidence 落 `runtime.sqlite`，本目录 JSON 为读回快照。

**镜像版本绑定（如实声明）**：调用经平台 Latest endpoint，调用时该 Runtime 的 Latest 指向自有 ARM64 镜像系列（10-12 记录为 `sha-194799c6…`，其后或有 v3/v4 预览替换）；**本 smoke 未做调用时刻的 digest 读回固定**，列为遗留项——后续采集需在报告中记录 `GET bindings`/平台读回的确切 deployment 与镜像 digest。

## 场景结果

| 场景 | 工具（版本） | 执行 | 外部 Provider 实调 | 结果要点 |
| --- | --- | --- | --- | --- |
| F11 天气（weather） | `weather.forecast` (0.1.0-alpha.1) | confirmed / allow | Open-Meteo geocoding（zh+en 各一次）+ forecast（北京 39.9075,116.39723），均 HTTP 200 | 结果摘要含核实口径：6.9–18.2°C 局部多云、同名地点歧义如实披露、数据时间戳与缓存 TTL；不宣称未提供的信息 |
| F10 研究（research） | `research.search` (0.1.0-alpha.1) | confirmed / allow | OpenAlex 检索 | 检索结果经确认后续答，任务 succeeded |

**已知事实错误（保留原始输出，不计为可靠回答）**：research 场景的模型续答把「文献发表距今多年」误述为「缓存已陈旧多年」（混淆了发表时间与缓存年龄）。原始回答保存在 `business-e2e-research.json`；该错误属云端续答质量，不否定工具执行与读回证据本身。

**调用计数口径**：报告中的 `fetchInfo`/`agentartsCalls` 是脚本在应用内拦截的 **fetch 尝试计数（含 Provider 直连）**，不能作为「恰好 N 次云端模型调用」的证明；云端调用面以 publishedEndpoint=Latest 与续答存在性为准。

另：裸 CloudAgentPort 探针一次（`.cache`，goal=北京天气）：镜像诚实回答"当前没有可用的天气查询工具"——裸调用不带业务工具目录，不编造天气，反向印证目录消费依赖桌面组合下发，与本链路互补。

## 边界（不宣称）

- 未行使写路径模块（F08 邮件真实调用本轮明令禁止；日历写/通知实机送达待用户配合验收）。
- `notifications.events`/`developer.*`（含 #423 的 `developer.test_locate`）已有各自单元/集成验收；其云端消费 Evidence 待镜像侧对应图接线后按同法采集。
- 真实模型调用费用已发生；失败迭代记录保留于 `.cache`（未入仓），首次失败仅断言位置问题（执行记录在子任务），链路本身一次即通。

## 汇总验收（缺口 4，2026-10-19；声明按实测范围收窄）

`tests/manual/business-consumers-acceptance.mjs`（公开合成数据，无凭据/网络/云端调用）以六项检查覆盖**已实测的语义**，结果快照 `acceptance-checks.json`（6/6 通过）。注意：以下为合成宿主上的分层验证，不代表真实生产写队列或真实断网重放故障已被观察到：

| 场景族（收窄后） | 检查 | 结果 |
| --- | --- | --- |
| 事件去重 | 同 dedupeKey 重复投递只裁一次，事件读回仅一条 | PASS |
| 同资源写回 CAS（过期修订拒绝） | todo 保存路径旧 revision 拒绝（Revision must increase），无丢失更新；**不含并发交错** | PASS |
| 批次部分确认（一交付一待办） | 两批次仅确认其一，另一分支不阻塞；**非多工作流分支失败场景** | PASS |
| 旧快照版本续页拒绝（分页层修改失效） | 写入推进快照版本后，旧 snapshotRevision 续页得 changed 空页（#391 协议）；**不含审批撤销语义** | PASS |
| 取消终态语义（定向用例） | `--test-name-pattern cancel` 定向运行 `apps/runtime/test/runtime.test.mjs`，断言目标用例执行且通过（取消到达运行中 worker）；**不等于四种取消结果全覆盖** | PASS |
| 未知结果不自动重试（定向用例） | 按名定向运行 ci-fix 套件的 `unknown patch is persisted and never automatically retried`，断言其执行且通过；**不含真实断网模拟** | PASS |
