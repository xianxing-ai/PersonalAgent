# F08 原知识出口投影接线

目标 profile：`huawei_ict_agentarts`。现有 Runtime `createTrustedKnowledgeTools` 只允许明确公开的来源/query/configRevision，出口最多五项、每项 excerpt 最多 200 字符，并去除未公布的来源字段。原 F08 直接 N09 工具结果等值出口在长摘录时正确拒绝；不能通过扩大原出口或发送 raw 来消除这个拒绝。

按原节点接线：N09 改为受信知识来源 host，内部固定 `f08.knowledge.source` 调用原知识 child/Policy；N09 只返回原 prepare/project/final accepts 的投影。原 raw 只在本机核验绑定与版本。N07 的固定知识写前/回执前读取也消费原投影策略，但不把完整 raw 交给图或模型。保持 185 节点、不修改通用 worker，不扩大邮箱、知识或图许可。

模板和 F08 配置摘要更新为 `business-20261101-f08-v2`，旧图不得借新摘要恢复；仅原 knowledge descriptor 已明确公开的 sourceId/configRevision/query enum 会在原请求路径中公布。Main 需优先本工厂 N09，并继续注入原 `knowledge.search` 工具、原 availability 与原 `competitionToolExports`。没有改变原知识公开源设置或原知识工具 Schema。

实际图测试改用生产 `createTrustedKnowledgeTools` 与原出口策略，知识来源本身和邮箱仍是 Fixture。合法 raw 摘录为 258 字符，原出口裁剪为 200 字符；测试检查 image 请求、候选上下文与协调结果均不含原始尾部。私有来源与 N09 出口许可期间撤销的测试确认原读取 child 已成功，然后被原出口拒绝，连裁剪前缀也不进入图/模型且没有 SMTP；知识子卡拒绝零读取。首轮误用 338 字符，超过原 raw Schema 的 320 上限，得到正确 output_validation；修正为合法长摘录后再验证投影，未放宽产品 Schema 或断言。

验证：AgentArts 与 Runtime build 通过；F06/F07/F08/F11/F12 实际本地图、业务工厂和原公开出口回归 84/84，知识工具/可选图宿主/F08 业务端口 22/22，AgentArts 242/242，工作流生成一致性与架构门禁 3/3 通过。日志分别为本工作树忽略目录 `.cache/pr531-business/f08-projection-final-business.log`、`f08-projection-ports.log`、`f08-projection-agentarts.log`、`f08-projection-templates.log`、`f08-projection-architecture.log`。当前增量不重复根代理负责的最终全仓 `npm run check`。

实际邮箱/SMTP、真实公开知识源与真实模型/云整图仍须分别验收；缺决定的 F02、来源变化 F03、future unknown 后台核实仍是独立未完成路径。本增量不代表 F08 或 #531 全部完成。
