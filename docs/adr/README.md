# 架构决策记录

当前主架构采用[ADR-0024](0024-unified-decision-workflow-architecture.md)。它采用Laya镜像内决策并替代旧DeepSeek全局决策和旧设计入口，保留模块化单体、Runtime权限、Wiki来源、WSS及既有恢复语义。ADR的accepted是决定状态，不表示实现/真实验收已完成。

历史ADR保留原日期、内容与状态。后续替代由新ADR说明，不能覆盖旧作者或验收。协作按CONTRIBUTING，一位合资格非作者对当前head有效Approve及检查/冲突/意见门槛，不恢复旧双人本机阅读规则。

- [ADR-0001：采用模块化单体](0001-modular-monolith.md)
- [ADR-0002：依赖方向与应用装配](0002-dependency-direction.md)
- [ADR-0003：Runtime 控制任务与工具执行](0003-runtime-authority.md)
- [ADR-0004：持久授权、工具证据与审批恢复](0004-persistent-tool-approval.md)
- [ADR-0005：采用分层接口冻结与显式不可用状态](0005-layered-interface-freeze.md)
- [ADR-0006：核心认知依赖倒置与 AgentArts 本地信任边界](0006-coordination-and-agentarts-boundary.md)
- [ADR-0007：华为 ICT AgentArts Competition Profile 优先](0007-huawei-ict-agentarts-competition-profile.md)
- [ADR-0008：事实变化消费与投影确认边界](0008-fact-feed-consumption.md)
- [ADR-0009：知识结果的本地持久化与云端出机边界](0009-knowledge-data-boundary.md)
- [ADR-0010：记忆物理删除与派生投影清理](0010-memory-erasure.md)
- [ADR-0011：文字与原生 Live 共用任务执行体系](0011-native-live-voice.md)
- [ADR-0012：自有 AgentArts 镜像](0012-owned-agentarts-image.md)
- [ADR-0013：常驻助手、Wiki 与双通道](0013-resident-agent-wiki-wss.md)
- [ADR-0014：AgentArts WSS 主通道](0014-agentarts-wss-transport.md)
- [ADR-0015：自有镜像 Workflow/Controller 可执行绑定](0015-owned-workflow-controller-bindings.md)
- [ADR-0016：Wiki 写回与记忆投影恢复（proposed）](0016-wiki-write-projection-recovery.md)
- [ADR-0017：Wiki 只读来源监视（proposed）](0017-wiki-source-monitor.md)
- [ADR-0018：应用记忆备份与临时知识索引（proposed）](0018-managed-backups-and-volatile-index.md)
- [ADR-0019：Obsidian 与 Runtime 的本机会话配对](0019-obsidian-runtime-pairing.md)
- [ADR-0020：Obsidian 双进程认证与原生配对](0020-obsidian-authenticated-bridge.md)
- [ADR-0021：配对插件引用与逐条私人记忆](0021-paired-citation-memory.md)
- [ADR-0022：本机 Wiki 页面身份与读取版本（proposed）](0022-wiki-source-identity.md)
- [ADR-0023：本机 Skill 安装与 Competition 使用（proposed）](0023-local-skill-installation.md)
- [历史架构方案（原 ADR-0024，已由本机Laya/teacher实验修订）](0024-unified-decision-workflow-architecture.md)
- [ADR-0024：Competition 辅助模型原生思考配置（proposed）](0024-competition-native-reasoning.md)
