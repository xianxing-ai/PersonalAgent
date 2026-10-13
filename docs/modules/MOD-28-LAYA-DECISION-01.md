# MOD-28-LAYA-DECISION-01：本地主动介入判断首片

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；关联 MOD-04B、MOD-28 / PA-025。
- 负责人：zemeng 委派的 Laya 执行者；Git 身份 `zemeng5208`；状态：`review`，待非作者评审与集成。
- 分支：`codex/zemeng/laya-decision-mvp`；基线 `main@c5c4ada`。
- 文件所有权：`packages/cognition/src/proactive-decision.ts`、`laya-decision.ts`、`projected-fact-decision.ts`、最小公开入口、对应定向测试和本文。Runtime、Desktop、`packages/goals`、contracts 和根装配由整合者协调。

## 目的与边界

PR #92 的[设计文档](https://github.com/zemeng5208/PersonalAgent/pull/92)标记为 Proposed；PR 当前状态未通过 GitHub API 读回。本片建立 provisional `DecisionPort`、有界事件决策服务、Laya typed-choice 适配和受限回环 HTTP transport。后续增加了 `@personal-agent/cognition` 的最小公开导出和 Fact 投影消费适配；生产 Runtime/Desktop 接线尚未发生，因此不能通过握手公布能力，也不能把本片称作已运行的主动服务。

确定性规则先在一次最多四项的事件批次中合并相同 source、eventId、FactRef、Goal/Plan 版本和授权状态；同一事件身份出现不同版本或正文时拒绝。模型只收到不超过 200 字的观测摘要、不超过 100 字的目标摘要、引用 ID 与版本、Plan 版本；授权状态只在可信服务内参与去重，不进入模型请求。一次 Laya 请求给每项事件一个 `choice` 问题，答案严格限于 `IGNORE/MERGE/DEFER/REMIND/REQUEST_DECISION/EXECUTE/ESCALATE_AGENTARTS`。结果保留 source 与 eventId，并只使用本地已验证的引用；模型不能发明引用。

本片的低置信度、未知或故障结果升级为 `ESCALATE_AGENTARTS`。Laya 官方模型卡明确指出基础 checkpoint 的目标式零样本准确度接近随机且概率偏过度自信；在缺少本任务独立校准集之前，即使模型高置信度给出 `IGNORE/MERGE/DEFER/EXECUTE`，也统一升级，不做静默压制或自动动作。`REMIND` 和 `REQUEST_DECISION` 也仅是建议；本片不触发提醒、不创建审批、不调用工具、不改变 TaskRuntime 或图谱终态。真正执行仍由 Runtime/Policy/ToolGateway 和目标读回决定，复杂计划修复仍交 AgentArts。

## Laya 身份与部署准备

官方 [模型卡](https://huggingface.co/convaiinnovations/laya)说明 Laya 是 Convai Innovations 的 Apache-2.0 非自回归 typed-decision 模型。中文优先只加载 `convaiinnovations/laya` 的 `multilingual` 子目录（mmBERT-base，322M 参数，权重约 647 MB）；其 Python SDK 和 `laya[serve]` 提供 `POST /v1/systemone`。官方给出的约 32.8ms 单问题延迟来自 Tesla T4，不能当成本机指标。安装前项目与 `D:\MODELS` 均未发现 Laya 权重或运行入口。

按用户要求，Python 3.12 隔离虚拟环境、Hugging Face 权重和 pip 缓存已放在被 Git 忽略的 `D:\PersonalAgent\.cache\laya\` 下。官方 CPU wheel 索引与 pip dry-run 后安装 `laya[serve]==0.3.20`、`torch==2.14.0+cpu` 和 `transformers==5.17.0`，无 CUDA 依赖。实测磁盘：venv 863,158,424 字节、单 multilingual 权重缓存 678,214,360 字节、pip 缓存 185,935,914 字节，合计约 1.73 GB。服务使用 `LAYA_HOST=127.0.0.1`、`LAYA_MODELS=multilingual`、`LAYA_DEVICE=cpu` 和一次性进程环境 `LAYA_API_KEY`；官方默认 `0.0.0.0` 且无鉴权，不直接采用。HTTP 客户端拒绝重定向，避免 307/308 把摘要和引用转发到其他主机。密钥未写入仓库、提示、日志或测试夹具。

单服务预加载这一 checkpoint，避免逐事件冷启动；请求最多四项，保留 deadline/取消。一次合成样本实调：首次含下载和 CPU 预加载到 `/health` 就绪为 52.5 秒，缓存模型再次启动为 12.2 秒；`/health` 读回 `loaded=["multilingual"]`、`device=cpu`。首个真实 `POST /v1/systemone` 经本地适配耗时 437.4 ms，随后两次为 221.2 ms、200.1 ms；模型原始输出 `MERGE`、confidence 0.1446，服务按低置信度升级为 `ESCALATE_AGENTARTS`，没有触发动作。实际 Python worker PID 38360 的加载后 RSS 为 1652.9 MiB；测量后 launcher PID 36380 与 worker 均已停止，回环端口读回不可达。数字仅对应本机单次启动与三次合成调用，不能证明稳态 P95 或决策质量。正式启用前仍需独立标注集测准确度、漏报、误提醒和校准。

## 接线与验收

整合者可在明确的可信 composition 中注入 `ProactiveDecisionService(new LayaDecisionModel(new LocalLayaHttpTransport(port, getApiKey)))`。现有 `MemoryProjectionApplication.consume` 返回的 `.projection` 与 `PendingImpactApplication.process` 返回的同一 graph revision `ImpactReport`，可在可信宿主的既有事件处理流程中传给 `decideProjectedFactImpact(decision, {graphNamespace, projection, impact, deadline, signal})`。`graphNamespace` 必须由绑定投影存储的可信宿主提供，并与报告 namespace 一致；因果项的 `currentRevision` 还须与投影 Fact 节点 revision 一致，不能仅凭节点 ID 将旧投影误认为当前变化。它只在当前 Fact 节点引起 `RECHECK` 时生成无摘要原文的有界事件，调用真实 `DecisionPort.decide`；缺少服务明确给出 `ESCALATE_AGENTARTS/model_unavailable`。无关或空批次不发起模型请求，但仍校验取消与期限。超过四个 Fact 关联的批次明确拒绝，宿主需拆批或按既有升级路径处理，不能静默丢事件。本适配不确认 feed、不轮询、不启动服务、不创建审批或动作。`source` 含图谱 namespace；授权一律为 none/revision 0，后续动作须由 Runtime/Policy 独立核验。服务生命周期归可信宿主，不能默认常驻占用约 1.65 GiB RAM。AgentArts 不可用时不能用 Laya/Fake 冒充比赛云端成功。

一次合成 Fact 投影收据及 RECHECK 报告经此适配调用本机真实 multilingual Laya：缓存模型启动到 `/health` 就绪 12.4 秒，worker RSS 从 1661.2 MiB 到 1680.1 MiB；单次消费 385.5 ms，最终建议 `ESCALATE_AGENTARTS/low_confidence`，confidence 0.3024；服务和 worker 均读回已停止。可复现输入和调用保留在 `packages/cognition/examples/projected-fact-laya-probe.mjs`：先在可信本地会话启动绑定回环且启用一次性密钥的服务，再将 `LAYA_PORT`、`LAYA_API_KEY` 仅传给此进程执行该脚本。这个收据是合成的结构化宿主输出；本 PR 的模块验证不证明 Desktop 生产入口、决策质量或云端闭环。Desktop 接线及其服务生命周期由独立整合工作包验证。

定向验证使用合成数据：通过本机现有 TypeScript 编译器严格检查 cognition 全部源码并单独编译三个新增源文件；`node --test --test-isolation=none packages/cognition/test/laya-decision.test.mjs packages/cognition/test/projected-fact-decision.test.mjs` 通过 14/14，覆盖重复合并、不同 source 同名事件归因、版本冲突、未校准标签升级、模型失败脱敏、deadline/取消、typed-choice 形状与回环鉴权、307 转发目标零命中，以及 Fact 因果关联、旧投影 revision 拒绝、namespace 对齐、空/无关事件生命周期和图谱 revision 拒绝。普通 `node --test` 在当前 Windows 沙箱因测试隔离子进程 `spawn EPERM` 失败，不能计作测试失败或通过。另有上述真实模型的合成接口与资源读回；未运行真实 AgentArts、全仓检查或桌面验收，没有公共接口冻结或迁移。

## 有界响应拒绝后的流取消（2026-10-08 续接）

旧公开 chooser 对超过65536字节的本地HTTP响应已返回abstain/unavailable/eligibleForRuntime=false，但超过原deadline及caller abort后流仍继续写入。仅在readSmallJson读取/大小错误路径发起不等待的reader.cancel，取消的同步异常或异步拒绝不替换原错误，finally releaseLock保持；批次共用同一读者。原65536限制、正常JSON、HTTP/模型/候选/授权/截止时间不变。

冻结source002269ce/test1ee33346，manifest4209dade6d0b73c1f669ed80312c6aa72861da0081ba80798315b38c21a88b7f，25与原6 artifacts逐hash/bytes核实。原正式9项1通过8失败（包含父项汇总），实际12837/c024c0/1；修后原三个受影响文件47962/c26293/0，26/26，固定Node24.15启动。fresh真实回环HTTP公开服务97550/a1ceda/0保持同样弃权结果，返回时仍未立即关闭，截止时间观察closed=true、累计67585字节/ticks2后保持，允许在途写入。没有真实模型/云/Task/设备验收。独审A5b955679与De7154f38均通过；旧68fb完整检查不覆盖此增量。

## 邮件标签配置摘要的跨语言稳定性（2026-10-08 续接）

合法自定义ASCII大小写标签i-work/I-work在en-US与tr-TR排序不同，原相同邮件和持久checkpoint重开再次infer1；默认小写内置标签没有该已证后果。仅configDigest的标签tuple排序改用精确codeunit比较，不改大小写/描述、模型候选原顺序、criteriaDigest、策略、阈值、事务/cursor或截止时间。旧mixedcase checkpoint不迁移；升级时旧顺序不同的配置可能每条邮件一次cache miss/新分类，旧记录仍保留，不能冒作升级无重复推理。

source1231220b/test28acbae1，manifest76be03ab04187bbc2998802498463a9b63c4771adcb20a5af9d0f6daa59eaf95，18+原7 artifacts核实。固定Node24.15原formal52588/4c0fb3/1，calls1 expected0；受影响三个完整文件51343/b2b0bb/0，32/32。fresh独立Node进程公开JSON checkpoint en-US→tr-TR b1d9bb/0，后一进程infer0/cache1/new0且全result/cache一致、仅1key；显式原生Intl.Collator隔离，不是OS系统语言切换。原bad2key checkpoint保留；Fake inference/合成邮件，不构成真实邮箱、Task、通知、云或账户验收。必要最终固定源码完整检查另记。
