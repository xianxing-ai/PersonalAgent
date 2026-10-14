# ADR-0023：本机 Skill 安装与 Competition 使用

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。唯一全局语义决策为自有ARM64镜像内Laya，国内MaaS为执行候选，责任图/并行/后台影子按当前设计；旧DeepSeek全局决策、Laya本机部署和双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


- 状态：proposed；负责人 goo122；2026-10-09。
- 范围：用户确认的本机标准 SKILL.md 目录安装与使用，MOD-06/07、PA-005/006。

## 决定

复用 packages/skills 提供受信安装目录读取与原子本地目录册；目录册是有界安装快照，不是任务库、调度器或新的授权存储。Desktop 主进程持有目录选择器、安装/启用/卸载确认，Renderer 只获得脱敏元数据及用户主动打开的说明。使用时将确切版本的 SKILL.md 作为不可信任务参考，通过现有 Competition task.submit / coordinationInput 接线；不新增 Local 模型或 Agent loop，不执行附带 scripts。标准 allowed-tools 是说明，不授予权限。

每次使用必须原生确认任务与完整说明出机（可能计费）；只发送选定 SKILL.md，不发送资源、目录路径或其它已安装 Skill。绑定内容 digest、目录册 generation、当前会话、任务、到期时间；确认中变化、停用、卸载和重启使旧许可失效。检查放在 prepareCoordinationGoal 和 beforeCoordinationSend，Runtime/Policy/ToolGateway 继续拥有任务、工具授权和执行事实。停用/卸载通过原 Runtime 请求取消相关任务，不伪造终态。

安装管理独立于云配置和 Runtime 连接；未配置时仍能安装、预览、启停和卸载，使用明确拒绝。单任务许可不覆盖子任务，发送前检查原 Runtime 的父任务绑定。已使用 Skill 的任务及派生回答从后续云对话历史中排除，原 UI/Runtime 记录仍保留。

安装默认停用，复制有界普通文件快照，拒绝符号链接、路径逃逸、敏感文件和不兼容 metadata；同名不同版本不静默覆盖，先卸载再安装。内容以本机安装目录册保存，不用于长期私人记忆；此目录册无备份功能。卸载移除应用安装副本，不承诺独立备份或文件系统已释放页的安全擦除。

2026-10-10 补齐安装资源的纯本地预览：只按精确安装 name/digest 和已存相对路径读取快照，最多 64 KiB 的普通 UTF-8 文本；拒绝二进制/控制字符、越界路径及卸载版本。Renderer 用 textContent 展示，脚本只作文本；此操作不提交任务、签发授权、读取原目录或发送云端，资源仍不自动进入 Skill 任务。

## 兼容与限制

已有固定参考摘要 Skill、学习工作流、wire schema、SQLite 迁移和云 Skill selection 端口不改变。安装的通用 Skill 通过用户明确使用注入现有任务目标，不注册成 Tool；附带脚本需要以后独立受控执行工作包。脚本型 Skill 的任意代码能力不因此可用。真实云执行本轮暂缓，先用显式 Fake CloudAgentPort 验证相同 Runtime 接线，不能声称 AgentArts 实测成功。

YAML 复用锁文件已有 js-yaml 4.3.2，声明为 skills 直接依赖；不维护自制 YAML 解析器。标准参考：[Agent Skills specification](https://agentskills.io/specification)。

## 2026-10-12：最终输入预算

Desktop 在逐任务确认前及确认返回后，读取与实际发送相同的有界对话历史和公开来源投影，
复用 Runtime 的 `compileCoordinationGoal` 检查最终 16000 字符限制。没有任务 ID 的
`readConversationContext` 仅供受信宿主预检，不创建任务、不获取凭据、不发送内容。
无 task ID 时，TaskRuntime 用当前事件水位复用原历史 SQL 的状态、非空摘要与
私人历史排除规则，不以列表查询另建一套筛选。
实际发送再次编译和检查；确认或受理不保证之后变化的输入仍可发送。

普通公开输入与 prepared 输入相同时，只在 `publicGoal` 保留一次；私人准备输入不同
时仍保留两者并经过原私人记忆消费许可。不静默截断 Skill、不扩大协议上限。
此变更为 host-only provisional 接线，无新增 wire capability、依赖或数据库迁移。
