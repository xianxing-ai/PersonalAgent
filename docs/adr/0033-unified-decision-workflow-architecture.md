# 历史架构方案（原ADR-0024）：统一决策、责任图与后台影子

状态：superseded（2026-10-16实验修订，架构未最终定型） · 原日期：2026-10-14 · profile：huawei_ict_agentarts。

原路径与编号只用于追溯历史架构讨论；主线现行 [ADR-0024](0024-competition-native-reasoning.md) 是 Competition 辅助模型原生思考配置，两者不能混为同一决定。

## 背景

用户确认#347架构并要求重写全项目架构文档。旧方案分散，唯一决策曾被切到MaaS；2026-10-14的镜像内Laya方案作为历史保留；2026-10-16已修订为本机Laya、资格不足升级原受信teacher与镜像串行编排。需区分决策推理、执行模型、平台能力与本地权限，避免重复全局决策、串行等待和设计/实现混淆。

## 决定

采用事件驱动责任图和稳定28功能模板；当前实验为本机Laya multilingual有限候选判断，仅资格验证通过的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用，ModelGateway统一执行模型入口；本地代码负责权限、版本、锁、状态与Evidence。

原受信判断链参与目标、记忆搜索/写入建议、上下文、分派、选路、恢复与影子比较，独立问题合批、依赖图串行推进（机会并行另验）。主动语音同意是现有授权输入方式；责任内直接执行，不增加审批或模型封锁。影子三模式默认后台、独立输出且不消费主授权；MaaS配置改进不称权重训练。

复用TaskRuntime、CloudAgentPort、Policy、ToolGateway、Knowledge/Memory和图存储，不另建调度器/数据库。AgentArts仍真实承担构建、编排、评估和部署；WSS/HTTPS及未知结果语义不变。

## 替代与保留

原镜像内Laya部署与无资格门禁的唯一决策结论已被本机Laya/受信teacher实验修订，不再作为当前要求；Windows常驻、Wiki来源、云/本地边界与ADR-0001—0007、0012、0014/0015的兼容内容继续适用。其余ADR中的来源身份/恢复决定按现有状态保留。旧ADR不删除或改写历史验收。

## 迁移与取舍

复用本机LayaInferencePort和scripts/laya/batch-server.py；镜像不包含Laya权重、Python或PyTorch。fast/world/plan/review保留实际职责，不由文档改动生产实现或公共枚举。领域资格、Desktop长期驻留、设备休眠恢复、本机CPU/内存与真实关键路径分别待验；执行API仍受网络影响。模型品牌、成本与质量不作未经验证保证。

## 验收与复审

按DESIGN/WORKFLOWS/IMPLEMENTATION检查全部功能、版本、确认、未知和影子隔离，并分别取得国内模型/连接器、设备、平台及P50/P95证据。模型能力/质量或国内可用性不满足时复审配置；本ADR不意味着生产能力已frozen或完成。
