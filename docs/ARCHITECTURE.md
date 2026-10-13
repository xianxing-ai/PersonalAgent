# 系统架构与工程边界

版本：2026-10-13 · 基线：main 3275aa91 · 本轮文档重写，不修改生产协议或运行行为。

## 1. 架构选择

采用事件驱动责任图、唯一语义决策模型、真实依赖并行执行和后台影子。完整依据见[主架构](design/workflow-architecture-20261013/DESIGN.md)，节点数据见[28工作流](design/workflow-architecture-20261013/WORKFLOWS.md)。

默认决策配置通过华为云国内MaaS调用DeepSeek-V4.1-Flash；执行模型候选优先国产。一个生效配置负责所有最终语义取舍，模型池生成候选。代码处理版本、权限、锁、算术和状态，不让每个机械步骤调用云端。模型选择自由配置，不新增限制。

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

KnowledgePort负责搜索与来源；MemoryQueryPort负责事实版本查询，FactChangeFeed传递变化。唯一模型参与相关性、写入建议、排序、矛盾与摘要取舍；宿主负责访问范围、版本、实际写入、撤回和恢复。

上下文按目标、责任、活跃节点、来源和未解决副作用组织。F28反馈真实模型窗口/参数配置；F27生成可恢复摘要和引用。缓存绑定输入及所有相关版本，来源变化使依赖结果失效；授权仍实时核验。

## 7. 影子、评估与改进

F22三模式默认后台；主运行只读保护、输出命名空间独立、不消费主授权。缺反事实结果标未知，隔离执行条件与可比性有证据。F23改提示/图/调用配置/模型版本，不直接改MaaS远端权重，不以修改测试制造晋升。

## 8. 云部署和通信

huawei_ict_agentarts为当前唯一实施路径，AgentArts真实承担构建/编排/评估/部署。Local及已授权DEV-WORKFLOWS基线保留，不作为云失败的静默回退。WSS为主、HTTPS备用可见，已发送未知不能盲发备用。云回执restartRecovery:false，自动持久恢复不得承诺。

镜像装业务代码、SDK、固定版本和配置引用，默认国内API推理；本机不强制加载权重。国内可执行需分别验证镜像拉取、模型、语音及各连接器真实端点，不能以npm镜像或查看器离线证明全产品网络可用。

## 9. 迁移与验收

保留公共wire 1.0.0、transport 0.1.0和候选版本的既有语义；新概念字段在实施时映射或经版本化扩展。Laya代码是待迁移实现，旧fast/world/plan/review收敛最终裁决入口，具体迁移见[IMPLEMENTATION](design/workflow-architecture-20261013/IMPLEMENTATION.md)。

真实延迟尚未实测，关键路径需分别量受理/首响/工具/完整结果/并发排队。已有固定公开文件云闭环是局部证据；28功能、语音、私人来源、写入、影子和配置晋升分别验收。设计采用见[ADR-0024](adr/0024-unified-decision-workflow-architecture.md)，不新增生产包、任务库或执行循环。
