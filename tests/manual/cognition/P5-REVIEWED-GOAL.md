# P5 纯 Goal：统一真实验收准备

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

此文件是准备记录，不是成功验收。目标 profile 为 `huawei_ict_agentarts`。#255 的 `44bc117` 接口保持不变；本增量仅添加手动场景消费者，不修改 shared main、Runtime、Policy 或 Laya 阈值。

## 当前已核对

- 本工作树通过 `discoverLocalLaya(projectRoot)` 和 Git common root 发现既有 Python、模型目录、batch-server；文件存在均为 true。仅读取元数据，没有加载 Python、重新哈希权重或下载模型。核对时 8766 listener 为 0；不据此宣称模型 ready。
- 单例公开入口是 `createLocalLayaHost` 返回的 `snapshot/start/stop/choose/classify/readClassifierIdentity`。最终由 P8 的统一重服务槽显式启动一次，手动消费者不调用 start/stop、不读取 loopback Key。
- `choose` 经既有 `LocalLayaHttpTransport` / `LayaActionChoiceService`；固定 probability 0.70、margin 0.15，当前三选项为 recheck/defer/revise。不确定选择保留真实 receipt 并停止修复验收。
- 旧 `p5-local-laya.mjs` 覆盖邮件吞吐、缓存和设备，不复跑。旧 `run-candidate-probe.mjs` / `desktop-synthetic-e2e.cjs` 固定 Fact/会议/预期文案，不能当本次纯 Goal 入口。

## 可复用手动入口

`p5-reviewed-goal.mjs` 导出两函数，import 不启动模型、创建 Runtime、读取凭据或调用云。

1. `createReviewedGoalChoiceAudit(layaHost)`：创建透明 chooser。每次调用必须已有 ready 的 owned host/稳定 identity；原请求原样委派 `layaHost.choose`、原结果原样返回。记录本地候选与真实结果，不修改分数、选项、描述、阈值或 selected。P8 构造隔离正式会话时将 `audit.chooser` 放进既有 chooser 端口；禁止以 chooser-double 替换。
2. `runReviewedGoalAcceptance({application,goalHost,proactiveHost,namespace,choiceAudit,reopen,signal,deadline})`：消费 P8 已装配的生产公开端口。要求新隔离 namespace 的图 revision 0；不能指向用户数据库。`reopen()` 由 P8 先关闭旧隔离实例，再用原 SQLite/目录/namespace 和同一个 `audit.chooser` 重新构造，返回 `{application,proactiveHost}`；不启用新许可、不再次启动模型。恢复后的 chooser 也必须经过同一 audit，count=1 才覆盖整个恢复阶段。

调用形态（session 与 reopen 来自 P8 的现有正式装配，不是新增生产 factory）：

```js
import {createReviewedGoalChoiceAudit,runReviewedGoalAcceptance} from './p5-reviewed-goal.mjs';
const audit=createReviewedGoalChoiceAudit(existingOwnedLaya);
// P8 将 audit.chooser 注入此隔离 session 的既有 proactive chooser 参数。
const result=await runReviewedGoalAcceptance({
  application:session.application,goalHost:session.goalHost,
  proactiveHost:session.proactiveHost,namespace:session.namespace,
  choiceAudit:audit,reopen:reopenTheSameSessionDatabase,
  signal:acceptanceSignal,deadline:acceptanceDeadline,
  onProgress:saveRedactedProgressInIgnoredProjectCache,
});
```

最小合成输入是无 Fact 的三个显式 baseline 节点：Goal“三页项目汇报”、Decision“三个章节”、Plan“每章一页”。设置后经真实 `goals.revise` 将 Goal 改为“五页，objective/method/findings/risks/next steps 各一页”。baseline append 只是新图夹具设置，不产生工具成功声明或 Fact Evidence；Goal 修改结果必须来自真实 GoalHost/Runtime 工具回执。

先允许本地分析、保持云分析关闭，真实 Laya 在三合法选项中选择一次并与持久 review.selection 精确匹配。只有 eligible selected REVISE 才按当前许可开启云分析，使用原 project 包装/opaque refs/summary 基线，读取严格 `competition-repair-candidate`，消费同一个 `cognition.commit_repair@1.0.0`。手动入口不调用 authorization.respond 或 Policy.grant；缺合法 autonomous/current scope 时原样返回 waiting_approval，不制造成功。

修复后预期 graph 4→6、Decision/Plan revision 1→2，真实 confirmed/allow/started Evidence，两 verification 为 true。随后 P8 重开原 SQLite：task ID、图 snapshot、回执一致，无新 inference、无重复写入、云许可为 false。保留实际 source/review/repair task ID、selection 分数/receipt、model identity、candidate digest、updatedSummaries 和 Evidence refs。

`semanticTextChanged` 只检查云候选是否改变 baseline 文案，不能判断五页计划语义正确。`cloudSourceVerified` 固定 false：P8 还必须把同次真实云调用的公开请求/trace 与实际 published source/deployment 读回关联，并审阅 updatedSummaries 与五页要求；不能将 candidate checkpoint 当绑定证明。缺语义改变返回 semantic_text_unchanged，不重复请求云来“刷成功”。失败/取消/未知审批均保留原任务，不重放。

`onProgress` 在得到 Goal/review/source/repair task ID 时同步交付脱敏进度。调用方可落 ignored cache，断言、deadline 或取消异常也能结合原 SQLite 继续读回。signal/deadline 只中止本消费者轮询，不等于 Runtime 工具已取消；调用方须通过已有公开端口关闭或撤销隔离会话，并读回真实任务状态、收集实际云失败，不新增重试。调用方不能把消费者退出写成已取消或已停止执行。

## P8 仍需的前提

- 准确的新 Review/router source 完成发布、整链 deployment/API 绑定读回。云唯一作者报告的独立 Plan entity `65236810-db21-41cb-928b-39af691c4cfa` / source `1790761689353` 仅为中间预览；Review/router 仍接线中，不能作为整链就绪。
- 包含 #255 reviewedSource/current resolver 与 formal repair guard 的准确统一 head，现有 repairCandidateVersion 1.0、tool-proposal-json、goal-with-tools-json。本消费者没有第二套装配。
- 生产 GoalHost tools/hostUserNamespace 和已授权 autonomous/current scope，透明真实 chooser 已注入；`proactiveHost` 为 P8 已有公开 configure/tick/applyCognitionDecision/readRepairBinding 端口。
- 一个重服务槽、已有模型 singleton ready、稳定 classifier identity、足够内存；本场景只做一次 Goal 选择，不能运行旧吞吐批次或启动第二模型。
- 新隔离 SQLite/用户目录、同路径 reopen 与失败后 cleanup；已有 TaskRuntime deadline/取消保持。所有输出落项目忽略缓存，不含 credential/原始HTTP内容。
- P8 的实际 Desktop 展示与公开云绑定 read-back：本脚本只消费 trusted host，不能代替窗口验收。

尚未运行推理、云、审批或 SQLite 场景；准备阶段仅对新增 JS 做语法/import 检查与差异校对。
