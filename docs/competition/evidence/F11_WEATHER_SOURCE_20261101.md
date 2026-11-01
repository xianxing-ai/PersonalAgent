# F11 原天气预报来源与日历计划绑定

目标 profile：`huawei_ict_agentarts`。在保留完整显式日历方案分支的基础上，接入原 `weather.forecast`；不新增气象/交通警报能力，不编造风险阈值，不推断用户位置。

## 方案与兼容

原请求继续可用，新增可选 `weather:{eventId,query}`。query 必须明确地点、日期与单位；eventId 必须是原日历读取中精确匹配的目标事件。当前 `calendar.events` 的公共 ConnectorItem 未提供结构化地点，因此地点关联来自这次显式请求，不解析展示字符串猜测地址。

F11 原 N01 输入入口装配为受信来源 host，不增加节点；显式天气请求经原 ToolGateway/Policy 调用 `weather.forecast`，无天气参数时返回明确的纯显式计划来源。N03 保留原 N02 日历依赖，并直接消费原 N01 确认回执；N05 写入前再以固定 child action 只读核对同一预报。检查原记录/参数、cache 时效、预报覆盖区间与原日历事件、预报内容版本；过期、替换或覆盖不足拒绝。各写入仍分别经过原日历/Todo 审批，天气回执不是写入授权。

原 weather 结果出口会裁剪 record；完整原记录只留本机用于时效/覆盖校验，N01 只返回原 prepare/project/final accepts 允许的公开投影。不把外层图许可当作原业务出口许可，也不放宽其他业务动作的原结果等值出口要求。

模板与配置摘要变化，配置为 `business-20261101-f11-v2`，使用原生成器更新派生文件，目录仍为 185 节点；无 Core wire、迁移、新模型入口或调度器。缺天气 descriptor/原结果出口时拒绝天气分支，保留原纯显式计划分支；缺地点/决定仍保留原补问缺口。

Main 需把实际 public connector 的 `weather.forecast` 工具及原 `competitionToolExports` 加入业务 composition；新公开工厂为 `createRuntimeF11WeatherSourceHost`。原 N01 host 优先采用本工厂，不与通用占位同名宿主重复注册。生产天气 Provider、策略/工具版本及原部署绑定仍由原 Main 配置管理，未新增位置推测或账号配置。

## 验证状态

初轮原 PublicConnector 组合正确拒绝 `verification:mock` 的 FakeWeatherProvider；随后测试使用实际 OpenMeteoProvider/解析器及原 PublicConnector 投影，明确注入 HTTP response Fixture。未改 Provider verification 或放宽产品真实来源门禁。实际 Runtime/SQLite/Policy/审批卡组合首批 **17/17**，包括原纯显式方案兼容、原预报/原投影被 N03 消费、stale/过期/覆盖不足/事件替换/预报变更/出口拒绝/子卡拒绝；模型上下文不出现原 weather record/contentRef。最终回归另含取消和 unknown，结果见下。

真实只读探针：`node tests/manual/f11-weather-source-probe.mjs --allow-public-read`，2026-11-01T05:29:34.281Z～05:29:36.497Z，公开合成地点 `Beijing`、日期 `2026-11-02`、单位 `metric`。真实 OpenMeteo 读取成功，source=`open-meteo`、cache=`fetched`、原 TTL=600000ms，覆盖 `2026-11-01T16:00:00.000Z/2026-11-02T16:00:00.000Z`，`publishedTimeKind=coverage_start`，没有声称服务给出了预报签发时间。完整公开产物 `.cache/pr531-business/f11-weather-live-2026-11-01T05-29-34.281Z.json`；普通沙箱 fetch 失败也保留在 05:29:21.862Z 文件，授权原 HTTPS 后同一脚本成功。

上述真实服务探针只验证 Provider 读取，显式记录 `policyGraphVerified:false/calendarAccountVerified:false/cloudGraphVerified:false`。预报读取和原写前复核遵循 Provider 声明的缓存 TTL，不是跨天气/CalDAV 与审批等待的原子事务；后验来源失效保留已发生的日历效果并拒绝成功出口。真实 CalDAV、真实模型/云整图、官方警报、交通来源、缺地点/决定补问仍未验或未接；不能据此宣布 F11 全功能完成。

最终受影响验证：F11 实际图 **19/19**，连同 F06/F07/F08/F12、工厂与原 PublicConnector 出口回归 **80/80**；AgentArts **242/242**；AgentArts/Runtime 构建、原模板生成检查、185 节点计数、架构 **3/3**、diff 检查通过。日志 `.cache/pr531-business/f11-weather-final-business.log`、`f11-weather-agentarts.log`、`f11-weather-build.log`、`f11-weather-templates.log`、`f11-weather-architecture.log`；根统一运行最终全仓 check，本增量未重复全仓。
