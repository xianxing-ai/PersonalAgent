# 显式版本化候选：云适配消费

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

负责人 zemeng（A，MOD-04B/29/30/32）；目标 huawei_ict_agentarts；状态 review，
真实验收未完成。公共类型和严格 parser 归 B，依赖提交 `6d3234315057292971959f3fbafac4bda12c486e`。
字段定义与预算的唯一依据为 [MOD-30-REPAIR-CANDIDATE-01](../../../docs/modules/MOD-30-REPAIR-CANDIDATE-01.md)，
适配器不另建 DTO、Schema、校验规则或本地写入入口。

## 可信配置

```ts
{
  responseMode: 'tool-proposal-json',
  repairCandidateVersion: '1.0'
}
```

两项都必须显式开启。text 与 candidateVersion 同时配置、未知版本和未知mode在构造
阶段拒绝；已有默认text行为不变。即使公共结果union认识repair_candidate，未开启
candidateVersion的JSON适配也明确拒绝它，不允许公共parser扩展静默改变已有部署能力。
配置由构造器复制，外部对象后续变更不能启用候选。续接仍要求B的同步beforeSend门禁。
真实Desktop第二次调用曾把纯`{"continuation":...}`交给现有云应用，平台返回合法但
不符合本地DTO的应用自定审核JSON，Runtime正确拒绝且未写图。因此只有显式启用
候选版本的续接query会在原受限DTO外附一段适配器固定的候选输出契约；
`beforeSend`仍验证原DTO，不读回原goal或完整工具结果，不改变8192字节DTO预算。
缺合法图谱上下文时指令要求输出`kind:'text'`说明不足，不准猜NodeRef。
此续接查询修复目前仅通过离线合成测试；独立的真实候选探针是首次调用，不能充当
第二次云调用或Desktop闭环的成功证据，须等D2真实E2E读回。

云端对象只允许 `kind:'repair_candidate'`、`candidateVersion:'1.0'` 和 B定义的
candidate。适配先拒绝任意云verification，再补host固定unverified并交公共parser；
旧版本、额外Evidence/权限/task字段、非法revision或图变更均拒绝。收到候选不写图、
不执行工具、不表示已完成本地修复。Runtime显式启用、typed checkpoint/read和合法
本地提交由B负责，D不从resultSummary抽取隐藏协议。

## 云端最终节点增量约束（仅启用本版本时）

只有可信宿主提供了本次实际graph snapshot的baselineGraphRevision、允许目标NodeRef、
当前依赖NodeRef及必要合成事实后，云才可输出候选。不能用假定版本、示例id或模型
推断替代本地引用。当前只有会议时间的投影不足以生成候选，必须返回text说明输入缺失。
Fact/Evidence与允许目标的映射属于宿主，云JSON不得携带这些权威绑定。
可信宿主可在targets中提供requestedSummary/requestedDependencies，须从本地实际
快照与合成目标约束导出，并递增exportPolicyVersion；候选续调固定指令要求云端
逐字采用这些目标字段，reason仍由云解释。适配器不硬编码合成计划文本或签发权限。
手动候选探针同时识别旧三字段target与新增requested字段的严格形状；新增字段须与
本地实际引用和允许依赖链一致，否则在读取凭据和网络请求前拒绝。

输出使用B示例形状：

```json
{"kind":"repair_candidate","candidateVersion":"1.0","candidate":{"expectedGraphRevision":6,"changes":[{"node":{"id":"prepare","revision":1},"summary":"Prepare at 16:00","reason":"Meeting moved to 17:00","dependencies":[{"id":"meeting","revision":2}]}]}}
```

数值和id只是合成形状示例，实际输出必须逐项来自本次提供的可信快照引用。
保持与事件无关的计划不变。没有合法修复或缺少引用时用原有kind/text返回原因，
不返回空changes伪装候选，不把最后的ALLOW/REJECT替代完整建议，也不伪称已执行。
所有建议必须经过本地parser、目标范围/Fact版本绑定、只读preview和显式批准，
最终提交经既有Policy/ToolGateway执行CAS，云端不能直接取得该权限。

## 验证

在A工作树合入上述精确B依赖后，Node24.15编译通过；公共parser4项、adapter候选4项、
提案/续接/最终门禁13项，共21/21通过，git diff --check通过。
没有改动B公共parser/Runtime实现；上述离线验收时尚未运行云端、Desktop、本地写图或整个产品验收。
此记录不替代B/D组合验证、CI和goo122等已登记非作者批准；接口仍provisional。

2026-09-24后续真实云候选验证：在用户批准的仅合成投影范围内，A从D2本地可信
SQLite/Graph快照生成的忽略文件读取graphRevision、FactRef、三个目标NodeRef及允许
的新依赖引用，前置校验后仅发送必要字段。现有published AgentArts应用未改全局prompt，
通过query级约束进行一次付费调用（11:20:50Z—11:22:37Z），HTTP 200、完整SSE
495820字节；显式`tool-proposal-json`和`repairCandidateVersion:'1.0'`适配返回
`repair_candidate`，本地主机补`verification:'unverified'`。候选图版本、三个目标、
精确摘要和各唯一新依赖引用与本地投影逐项匹配。无自动重试、Local回退、审批或写图；
没有保存原始云响应和凭据。脱敏结构报告保留在本工作树忽略目录
`.cache/agentarts-candidate/`。这验证云候选格式与引用，不代替Desktop可信preview、
用户批准后Policy/ToolGateway的CAS写入、Evidence及同库重启验收。
