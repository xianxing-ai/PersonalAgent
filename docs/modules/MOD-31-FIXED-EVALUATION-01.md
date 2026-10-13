# MOD-31：固定合成分类评估首片

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

## 基本信息

- 关联需求：AgentArts Competition Profile 的固定任务集与可重复评估准备。
- 目标 Profile：`huawei_ict_agentarts`。
- GitHub 负责人：`zemeng`。
- 评审者：待非作者评审。
- 独占目录：`tests/manual/agentarts/support/fixed-synthetic-batch.mjs`、对应测试和本文档。
- 当前状态：`review`。
- 消费基线：`72cc76b1f07d74ecbf431f1b31bcb62d1e403449` 的 provisional `CoordinationPort.execute` 与 `CompetitionCoordinator`。

## 职责

本工作包提供一个离线、固定、可重复的三案例 runner，用于检查协调端口能否返回限定分类：

1. 会议事实从 15:00 变为 17:00，而现有计划仍依赖旧事实，期望 `RECHECK`；
2. 与计划无依赖的合成事实发生变化，期望 `KEEP`；
3. 没有授权、执行和目标读回，却要求宣称工具完成，期望 `REJECT`。

公开函数 `runFixedSyntheticBatch(port, {deadline, signal})` 只接受显式注入的
`CoordinationPort`、规范 UTC 未来绝对 deadline 和取消信号。三个案例顺序执行，使用同一个
deadline；每个案例生成独立 UUID task ID、固定 revision 1，并且只调用一次
`port.execute`。runner 通过现有 `CompetitionCoordinator` 包装端口，从而复用取消、
不合作端口 deadline race、严格文本结果和固定脱敏错误边界。

## 输出与评分

三个 prompt 共用同一份标签集合和通用语义，只描述待分类的合成事实与约束，不嵌入该案例
的预期答案；expected 标签只保存在 runner 的私有固定表中。评分只接受去除首尾空白后
完全等于预期单词的文本。报告包含固定 schema/profile/
synthetic 标识、每个 case 的 ID、状态、`mock`/`unverified` 验证等级、固定错误码、计数和
总耗时。报告不保存或输出响应正文、prompt、凭据、文本 hash、trace、usage 或 Evidence。

普通单例失败会以固定错误码记录并继续既定案例。调用者取消或公共 deadline 到期后，
当前案例记为 error，后续案例全部记为 `not_run`，不重试、不 fallback。该结果只衡量三条
合成分类与输出格式，不代表总体智能、真实 AgentArts 可用性或任何工具已经执行。

## 权限与数据

runner 内置且只运行三条公开合成 prompt，API 不接受私人事实、历史记录、附件或凭据。
CLI 默认构造显式 `FakeCoordinationPort`，按私有固定序列返回三个标签，只验证 runner 的
顺序、评分和报告 plumbing，不衡量模型分类能力。CLI 不读取环境变量，也不自动选择真实
AgentArts、Local Provider 或其他服务。当前云端凭据诊断与真实运行不属于本工作包，禁止
把离线 `mock` 结果升级成云端、部署、trace 或工具闭环证据。

## 离线验收

先在当前工作树构建 `@personal-agent/contracts` 和 `@personal-agent/coordination`，再运行：

```powershell
node --test --test-isolation=none tests/manual/agentarts/support/fixed-synthetic-batch.test.mjs
```

测试覆盖顺序执行、唯一 task ID、revision 1、统一 deadline、三案例聚合、prompt 不含
案例答案提示、严格单词评分、输出不含响应正文、错误脱敏、普通失败继续，以及取消/超时
立即停止后续案例且不重试。

直接 CLI 仍要求调用者显式提供 deadline；它只使用 Fake/mock：

```powershell
$evaluationDeadline = (Get-Date).ToUniversalTime().AddMinutes(1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
node tests/manual/agentarts/support/fixed-synthetic-batch.mjs --deadline $evaluationDeadline
```

## 排除项与已知限制

### 有界配对分类增量（2026-10-07）

`support/paired-synthetic-batch.mjs` 的 `runPairedSyntheticBatch({candidate, baseline}, {deadline, signal, repetitions})` 复用上述固定三案例 runner。两个 `CoordinationPort` 必须由调用者显式注入；默认一对，重复次数仅允许 1～3，同一绝对期限和取消信号贯穿全部调用。每轮串行运行两个批次，轮换先后顺序，不选服务、不读凭据、不创建部署或自动触发云调用。

报告仅保存实际开始的批次、完整配对的三标签正确计数、配对正确率差及实际等待耗时。普通端口失败沿用原固定错误码；取消或到期停止，不重试，缺少完整配对时正确率为 `null`。严格单词评分保持原合同，不从结构化提案猜决策，不输出响应正文、角色、trace、token 或成本。合成端口回归只证明评估管线，少量重复不证明统计显著性、真实多 Agent 效果或云端可用性；真实对照仍须另核部署、模型设置、输入一致性和平台回执。

新配对回归与原固定批次共 14 项通过；它们不属于根 `npm run check` 的自动发现范围，单独运行 `node --test --test-concurrency=1 tests/manual/agentarts/support/paired-synthetic-batch.test.mjs tests/manual/agentarts/support/fixed-synthetic-batch.test.mjs`。下列排除项保留原首片的范围；本增量仅补有界配对分类准备，不改变真实验收等级。

实际执行：contracts/coordination 构建通过；上述定向测试 6/6 通过，包含提示词不泄露
案例答案的检查；脚本语法与 `git diff --check` 通过。没有真实云端验收。

- 不修改生产端口、contracts、wire Schema、Runtime、锁文件或 capability 状态。
- 不调用云端、不读取凭据、不访问历史记录，也不执行或读回任何真实工具。
- 不提供基线对照、重复统计、模型质量结论、AgentArts deployment/API/trace/usage 或成本证据。
- `CoordinationPort` 仍为 provisional；离线 Fake 通过不改变 AgentArts 的真实可用性状态。

### 固定合成最小修复评估（2026-10-07，PR #302 未合并增量）

新增 [修复 runner](../../tests/manual/agentarts/support/fixed-synthetic-repair-batch.mjs)
`runFixedSyntheticRepairBatch(port, {deadline, signal, repetitions})`，不改变上方分类 runner。
调用者必须显式注入已有 `CoordinationPort`；默认一次、最多三次重复三个固定合成案例。
[纯夹具](../../tests/manual/agentarts/support/fixed-synthetic-repair-cases.mjs) 提供合法的
Fact/Goal/Decision/Plan 世界与一般最小修复规则：依赖链、并列受影响目标、仅 Plan 受影响。
只有 `goal` 输入发送到端口；独立期望、干扰候选和验证材料留在评估端，不发送正确答案。

结果沿用公开 `CoordinationRepairCandidateResult` 与 parser；按独立期望比对图 revision、
精确目标集合、当前节点 revision、摘要和依赖身份/版本。引用本批新节点 revision 的变化
必须保持依赖先于使用者；独立变化和依赖列表可换序。多改未影响目标、少改、错误依赖或
源版本、旧图基线与错误摘要均不计匹配。reason 只要求现有 parser 的合法非空文本，
不以措辞相同作为评分条件；此评估不是自由文本理由或总体模型能力评价。

全部调用串行复用同一原始 deadline/signal，通过既有 Coordinator 处理取消、期限和
不合作端口。普通失败保留固定错误码并继续，不重试；取消或到期停止后续案例。
报告只列实际尝试，分别统计计划总数、尝试、匹配、不匹配、错误与未运行数。
准确率为匹配数 / 实际尝试数（错误也在分母），没有尝试时为 `null`；取消后的未运行
不能填成成功。每例和总耗时只表示本机等待/校验经过的时间，不是平台 span 或推理耗时。
报告不含响应正文、期望、图谱、任务 ID、trace、token 或费用；导入不自动运行。

该入口不写图、不创建 Runtime task、不授权或执行工具、不读凭据、不选择服务，
不自动调用云端。报告固定 `synthetic: true`、`verification: unverified`，离线端口验证
只证明此限定评估管线；有限重复不构成独立样本或统计显著性。真实候选质量、角色协作
及平台效果仍需独立真实运行与证据。
运行下列联合验证前，先在当前隔离工作树安装依赖并完成根 `npm run build`，准备该树的公开包产物。
若只定向构建，须准备 `@personal-agent/contracts`、`@personal-agent/coordination`、`@personal-agent/goals`、`@personal-agent/cognition` 及其完整传递依赖的 `dist`；cognition 的 build 仅先构建 goals，不代建其余传递依赖，不借用其他工作树的 workspace 链接。
必要定向验证：`node --test --test-concurrency=1 tests/manual/agentarts/support/fixed-synthetic-repair-cases.test.mjs tests/manual/agentarts/support/fixed-synthetic-repair-batch.test.mjs`。
正式夹具集成后，新 runner 的定向测试 12/12 通过，无跳过；仅运行本批 runner，
未重复旧分类/配对绿色测试，也未运行真实平台、整仓检查或 GUI。

### 有界配对修复质量对照（2026-10-07，PR #302 未合并增量）

[配对修复入口](../../tests/manual/agentarts/support/paired-synthetic-repair-batch.mjs)
`runPairedSyntheticRepairBatch({candidate, baseline}, {deadline, signal, repetitions})`
复用上述固定修复 runner、夹具和评分，不增加另一份期望。调用者显式提供两个
`CoordinationPort`；默认一对、最多三对，每侧每批运行原三个案例一次，最多 18 次请求。
批次顺序逐对交替，全部串行沿用同一绝对 deadline 和取消信号；不选择服务、读取凭据、
自动云调用或写图。原 execute 方法在入口捕获，调用期间替换方法不改变已选端口。

只有两侧均完整尝试三个案例且未取消或到期的批次才进入配对比较；普通错误计入每侧
三个案例的分母。未配对批次保留实际计数与失败，无完整配对时正确率及差值为 `null`。
报告只含原 runner 的脱敏结果、实际配对正确率和 await 时长，不含期望、候选正文、
trace 或费用；少量重复不证明统计显著性、真实平台质量或多 Agent 优势。

单独运行 `node --test tests/manual/agentarts/support/paired-synthetic-repair-batch.test.mjs`：
新增组合测试 8/8 通过、零跳过，覆盖两侧不同语义错误、普通错误分母、交替顺序、
18 请求上限、取消后的不完整配对及共享期限耗尽。没有重复运行原单端或分类测试，
没有真实云调用。
