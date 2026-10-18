# ADR-0030：本机 Laya、镜像串行工作流与外部宿主接口

<!-- current-design-alignment-20261015 -->
> 当前适用性：本机 Laya 已由 Owner 确定为 Competition 产品路径的运行方案；外部接口仍 provisional，其余接线与验收单独核实。
> 当前详细行为、历史替代与实际验收见[当前设计](../design/CURRENT_DESIGN_20261015.md)、
> [28项状态](../design/WORKFLOW_STATUS_20261015.md)与[全部历史导航](../design/README.md)。
> SWR 发布、目录或两条公开 fixture 通过不等于 28 业务全部验收、全局决策资格或外部比赛资格已获认可。

> 状态（2026-10-17 更新）：Owner 已确认本机 Laya 选型；以下保留此前实验候选与测试实现的历史背景，
> 不把代码存在、镜像构建或本机目录通过当作其余设计已定稿、接口已集成或真实验收完成。

- 2026-10-15；Owner 明确决定，接口实现仍为 provisional，待独立审查及集成。
- 本决定取代本开发分支的“镜像内嵌 Laya”默认部署。保留旧 Evidence 的原版本和验收范围。

## 运行边界

28 项工作流的节点、依赖、候选制备、条件和推进逻辑在 AgentArts 自有 Node 镜像。
同时保留原图决策要点、模型分工、汇合标记、恢复和验收要求；catalog 公布设计摘要用于逐图核验。
一个工作流串行推进，未收到原操作的真实回执不启动下一分支。
DeepSeek通过现有ModelGateway与AgentArts新模型代理生成候选/接管；平台底层MaaS来源如实记录，客户端不直连fallback。
本机Laya只在封存候选中选择；未合格站点、复杂/不确定或重要抑制必须升级DeepSeek，不能宣称全局已合格决策。
不把本机 Laya 端口暴露公网，也不在云容器安装 Python、PyTorch 或模型权重。

镜像发出 `decision.choose_candidate` 工具提案，本地 Runtime 经 Policy/ToolGateway 执行判断，
由现有 HostBridge 将原始执行和 Evidence 签成回执。镜像核对签名、operationId、inputDigest、revision
和封存候选后继续。判断完成只代表已选择候选；实际读写另有 operationId 和独立回执。

宿主节点发布为 `workflow.host.fXX_nXX` 工具，条件检查发布为 `workflow.guard.fXX_nXX` 工具。
协作者使用现有 ToolGateway 注册实现及输入输出 Schema。没有适配器时明确 unavailable，
不生成假工具回执，不把用户确认、知识来源或外部写入当成代码内部已完成的动作。

## 本机性能

150 ms 为本机真实环境下的目标，不是已经取得的 SLA。工作流保持串行；独立判断的并发提交、
CPU 线程数、合批以及本机显卡作为单独基准比较。无 CPU/内存云配额限制，不缩短或缓存判断来填充结果。
维持原模型权重；实际加速路径必须记录设备、输入长度、完整性和实际耗时。性能不证明判断质量。
SDK 的 CUDA 默认使用 BF16 autocast；原权重未变不代表 FP32 算术。
原始业务正反质量尚不足以取得直接决定/抑制资格；两案例的6次真实Laya判断约182–618ms，150ms目标未达。
后续Wukong和Pelican第二轮已完成本机同版镜像+本机Runtime/Policy/工具/Laya+远端AA代理的真实主/影子及单CAS交付，
合计41条工具Evidence；各案例3处裁决均升级DeepSeek。分支父成功、协调锚点created，首轮Pelican partial保留。
不能把本地完整执行表面写成精确云版本已执行两条全链，也未证明训练、减少高级模型调用或28业务全验收。

## 兼容与交付

高级影子开关须并入已有判断，主任务优先，按真实机会资源/收益选择，未知交DeepSeek。
双方案择优任务才等双方，其他任务可先交已验证主结果；这是当前设计差额。
目前真实runner仍顺序await main/shadow，没有证明机会并行或普通任务先交主结果。

- 对外仍使用现有 workflowVersion 1.0.0 的 advance/proposal/receipt，新增工具走既有工具目录。
- checkpoint 增加执行配置摘要。旧嵌入式 checkpoint 留在原版本核实和收尾；不在新配置下重放未知操作。
- 不改本地 wire 冻结集合，无数据库迁移、第二任务库或第二调度器。
- 后续已获明确发布授权：SWR `local-laya-v3-244ca434`，digest `sha256:244ca4340ae5c0f0ee62df98b2e86cddc16a543cb6d1eb5f7abbf163528d96e1`；云指定版本 `arm64-local-v3-244ca434` 目录与关联日志已读回。[发布回执](../competition/evidence/test-image-v3-20261015/owned-release.json)保留独立事实，旧暂不发布指令不再概括当前状态。
- 28 图和显式 Fake 接口回归通过，不等于 28 项真实账号业务验收；真实验收逐项列出。

接口和协作者入口见 [本机 Laya 与工作流接线](../competition/LOCAL_LAYA_WORKFLOW_WIRING.md)。
