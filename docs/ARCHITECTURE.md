# 系统架构与工程边界

版本：2026-10-14 · 基线：main 3275aa91 · 本轮文档重写，不修改生产协议或运行行为。

## 1. 架构选择

采用事件驱动责任图、唯一语义决策模型、依赖图串行推进（机会并行另验）和后台影子。完整依据见[主架构](design/workflow-architecture-20261013/DESIGN.md)，节点数据见[28工作流](design/workflow-architecture-20261013/WORKFLOWS.md)。

当前实验为本机Laya multilingual有限choice，只有通过独立任务资格验证的站点可直接决定；资格不足、不确定或复杂问题升级原受信teacher。国内执行模型经AgentArts调用；架构未最终定型。代码处理版本、权限、锁、算术和状态，不让每个机械步骤调用云端。模型选择自由配置，不新增限制。

## 2. 进程与事实来源

| 组件 | 所有职责 | 不能越过的边界 |
| --- | --- | --- |
| Electron Renderer | 输入、状态、责任/配置/证据展示 | 不直接调用Provider、Shell、数据库或连接器 |
| Desktop主进程 | 可信配置、凭据适配、IPC、窗口生命周期 | 不复制Runtime执行循环 |
| Runtime Application / TaskRuntime | 受理、分派、持久步骤、取消、恢复、终态 | 模型/UI/连接器不能直接写终态 |
| Coordination / Goal / Cognition | 版本图、影响传播、语义建议消费 | 只通过公开端口读取记忆和提交建议 |
| AgentArts镜像 | Workflow/角色/模型编排、候选与工具提案 | 不持有本机授权或主数据库，不直接控制Windows |
| ModelGateway | Provider能力/配置、调用、取消、期限 | 结构化适配不冒充原生能力 |
| Policy / ToolGateway | 原有授权核验、工具执行与记录 | 模型输出不是授权来源 |
| Knowledge / Memory / Learning | 正文来源、版本事实、可验证流程候选 | 不取代任务库或调度器 |
| Connector / Windows Host | 能力实际执行、目标读回 | 不决定授权、主目标或任务终态 |
| Evidence / Verifier | 实际执行、来源和结果依据 | 模型自报与Schema合法不代表完成 |

当前Desktop是Electron+原生HTML/CSS/JavaScript，Runtime可在主进程装配；文档React查看器不改变产品技术栈。Windows Host与原生Pipe的具体支持范围依实际验收。

## 3. 依赖和端口

apps可依赖packages；packages不反向依赖apps，contracts不依赖内部包，跨包只用exports。具体Provider/连接器仅在可信composition注入。模型统一经过ModelGateway；工具统一经过Runtime/Policy/ToolGateway。

复用CoordinationPort、CloudAgentPort、ModelPort、MemoryQueryPort、FactChangeFeed、KnowledgePort、ToolExecutionPort和已有图存储。类型存在不等于frozen；逐项状态由[接口目录](interfaces/CURRENT_INTERFACE_CATALOG.md)登记。

## 4. 任务与图

F01主对话与事件形成任务；F03找受影响依赖；F27组织上下文；唯一模型选功能与候选；F28分派模型；F24推进就绪分支。F06—F21及F25/F26的具体能力按任务选路，最终经验证汇合。

任务和节点绑定稳定身份、输入/来源/目标revision、配置版本与执行记录。独立只读可并行，同资源写入和桌面输入按现有规则加锁。必需/可选与条件分支分别汇合；恢复只修受影响子图。结果未知先查原操作，不通过重规划重发。

## 5. 责任与语音

沿用已有授权，责任内直接执行，缺范围或关键歧义才问。语音主动播报当前动作摘要；最终转写绑定问题、会话、参数和revision。口头同意走原授权响应，修改使旧确认失效；沉默、回声、旧回答不能放行。停止播报、取消任务和停止新动作不同；本地直接停止不等云端。

## 6. 记忆和上下文

KnowledgePort负责搜索与来源；MemoryQueryPort负责事实版本查询，FactChangeFeed传递变化。原受信判断链参与相关性、写入建议、排序、矛盾与摘要取舍；宿主负责访问范围、版本、实际写入、撤回和恢复。

上下文按目标、责任、活跃节点、来源和未解决副作用组织。F28反馈真实模型窗口/参数配置；F27生成可恢复摘要和引用。缓存绑定输入及所有相关版本，来源变化使依赖结果失效；授权仍实时核验。

## 7. 影子、评估与改进

F22三模式默认后台；主运行只读保护、输出命名空间独立、不消费主授权。缺反事实结果标未知，隔离执行条件与可比性有证据。F23改提示/图/调用配置/模型版本，不直接改MaaS远端权重，不以修改测试制造晋升。

## 8. 云部署和通信

huawei_ict_agentarts为当前唯一实施路径，AgentArts真实承担构建/编排/评估/部署。Local及已授权DEV-WORKFLOWS基线保留，不作为云失败的静默回退。WSS为主、HTTPS备用可见，已发送未知不能盲发备用。云回执restartRecovery:false，自动持久恢复不得承诺。

自有ARM64镜像承载28项模板及依赖/条件/串行推进逻辑；Laya服务与固定权重留在本机，镜像不包含Laya权重、Python或PyTorch。国内执行模型经AgentArts调用；模板目录不等于业务验收。国内可执行需分别验证镜像拉取、模型、语音及各连接器真实端点，不能以npm镜像或查看器离线证明全产品网络可用。

## 9. 迁移与验收

保留公共wire 1.0.0、transport 0.1.0和候选版本的既有语义；新概念字段在实施时映射或经版本化扩展。Laya复用现有本机宿主/端口，资格不足升级原受信teacher；旧fast/world/plan/review保留实际候选与校验职责，具体迁移见[IMPLEMENTATION](design/workflow-architecture-20261013/IMPLEMENTATION.md)。

真实延迟尚未实测，关键路径需分别量受理/首响/工具/完整结果/并发排队。已有固定公开文件云闭环是局部证据；28功能、语音、私人来源、写入、影子和配置晋升分别验收。设计采用见[ADR-0024](adr/0024-unified-decision-workflow-architecture.md)，不新增生产包、任务库或执行循环。

## AgentArts最小真实接入

全部28业务Workflow的分支、分派、恢复与影子仍在自有镜像；平台高代码Runtime托管该镜像。平台通过四个真实能力参与，不另建业务编排或复制本地状态库：

| 能力 | 复用与增量 | 完成依据 |
| --- | --- | --- |
| 推理与MCP网关 | 现有ModelGateway/OpenAI-compatible Provider接国内Inference Target；现有MCP host加远程HTTPS/SSE与协商/发现，直连平台MCP网关，仍经既有ToolGateway/Policy | 目标/版本读回、真实模型请求、tools/list与tools/call及目标读回；平台网关不是本地Runtime入站WSS网关 |
| 原生知识库 | 现有KnowledgePort增加AgentArts Provider，与本地Wiki/Obsidian、自有及第三方知识源并存；平台片段映射现有来源引用，由Laya比较/排序，执行模型组织引用回答 | 实际检索片段、文档身份/版本/位置及回答引用；未完成source映射前不虚造vaultId/path/revision |
| 日志与Trace | 复用镜像JSON stdout、Runtime事件与Evidence、现有ShowOpsTrace读回；先验证Runtime/LTS采集，再加模型/知识/工具/恢复Span及异步OTel出口 | 平台可查看关联task/session/request/operation/version的调用链与失败；Trace不是成功证据，不另建日志库 |
| 后台离线评估 | 复用已有真实结果/参考/检索片段、配对评测和已发布平台评测集；填实际输出、提交平台任务并读回评分，再与配置版本比较 | 平台任务ID、输入与实际输出、评分报告与版本；评测集发布或本地分数不算平台评测完成 |

知识、MCP与Skills均保留平台、本地、自有、GitHub/Gitee及社区来源。仓库URL是代码/资产来源，MCP需部署为真实endpoint或本地进程；Skill需经现有安装/版本/宿主接线。当前本地SKILL.md转发不等于脚本与资源完整执行。无第二套工具注册或Skill宿主，不强制本地工具绕平台。

当前四项为待接线/待真实验收。平台原生在线评估适用范围随版本与账号而变，先交付明确的离线结果集评测，不假设自有Runtime所有在线配置都可用。详见[三方实施交接](modules/AGENTARTS-PLATFORM-HANDOFF-20261014.md)。
