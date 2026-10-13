# MOD-31-LOCAL-EVALUATION-01：本地域影响评估基线

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；负责人 zemeng；非作者评审者 goo122（待评审）。
- 状态：review（本地交付完成，待非作者评审与集成）；基线 main `72cc76b`，不依赖 PR #49 或 #51。
- 工作树：`.worktrees/zemeng-cognition-evaluation`。
- 分支：`codex/zemeng/cognition-evaluation`。
- 范围：`packages/cognition` 的示例、包内命令和 README，本说明。
- 依据：Competition Profile 第 8 节的固定任务集、基线、指标和重复运行要求，
  以及 Golden Demo 的影响传播、无关计划保留；这是本地基线准备，不是云端评估完成。

## 交付边界

复用现有 `runMeetingReplay()` 的合成会议数据，不增加图引擎、调度器、端口或服务。
四个固定观察点为初始、事实改期、仅重绑 Goal、完整显式重绑。预期 RECHECK 分别为
空集、attendance/departure/reminder、departure/reminder、空集。
每个观察点的四个固定对象为 attendance、departure、reminder、reading。

参考策略是显式声明的“对所有对象要求重查”，不是已有 AgentArts 产品或模型的测量结果。
用它比较不必要重查数量；不将重查数量减少转换为耗时、费用或 token 节省。
评分对象是依赖影响分类，不判断合成提醒时间是否语义正确，也不授权执行提醒。

## 指标

- TP / FP / FN / TN：按上述独立预期，RECHECK 为正类；KEEP 为负类。
- precision / recall：分母为零时返回 null，不虚构 100%。
- accuracy：正确分类数除以固定观察数。
- unnecessaryRechecks：FP 数；不是实际执行或节省的操作数。
- 重复运行仅检查确定性，不能视作更多独立样本或统计显著性。

四阶段共 16 个观察，域算法的预期合计为 TP=5、TN=11、FP=FN=0；
全量重查参考策略的预期为 TP=5、FP=11、TN=FN=0。
这些是夹具定义下的预期值，实际结果由运行命令产生，不能用文档代替执行证据。

## 运行与限制

入口：`npm run evaluate --workspace=@personal-agent/cognition`。
命令构建既有依赖后输出 JSON，不保存或上传报告，不访问网络、凭据或用户图谱。
报告固定标注 `verification=mock`、`cloudEvaluation=false`、`externalActionsExecuted=false`。

本工作包不修改公共协议、锁文件、Runtime、数据库迁移或生产行为。
不建立真实 AgentArts 基线，不调用模型，不证明真实工具、Evidence 或 Desktop 闭环。
后续平台评估仍须固定真实任务集、版本、trace、运行结果和独立验收；当前状态不得提升为 done。

## 本次验证

- goals/cognition TypeScript 构建通过；脚本 `node --check` 通过。
- 直接运行 `node packages/cognition/examples/impact-evaluation.mjs`，JSON 输出可解析，
  三次回放稳定；域算法 TP=5/TN=11/FP=FN=0，参考策略 TP=5/FP=11/TN=FN=0。
- 最终 `npm.cmd run evaluate --workspace=@personal-agent/cognition` 包入口也通过。
- 一次定向 API 检查确认返回报告的预期数组被调用方修改后，不污染后续评估。
- `git diff --check` 通过；没有运行全仓测试、启动 GUI 或进行云调用。
- 环境为 Node 26.3.0；仓库指定 Node 24.15.x，目标版本的 CI 结果另行记录。
- 新工作树起初缺少 workspace 链接，离线 npm 安装也因缺少缓存失败。随后只建立指向
  本工作树 goals 包的忽略目录链接，使用既有 TypeScript 工具构建各自的 dist；未改锁文件。
  建立本工作树链接后，完整 evaluate 包命令正常构建并输出报告。
