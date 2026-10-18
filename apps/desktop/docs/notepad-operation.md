# Desktop 新记事本写入

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Profile：`huawei_ict_agentarts`；MOD-11 / MOD-16，zemeng。依赖 Runtime prepared Host task、Windows Host / Pipe Bridge。不涉及 Windows 安装包。

## 开发启动

从仓库根目录执行 `npm run build:windows-host --workspace=@personal-agent/desktop`。需要普通 Windows 用户会话及 .NET 8 SDK；脚本串行生成 Host 与 Bridge 的 Release 输出。Desktop 仅使用这两个固定仓库产物路径，Renderer 不能指定 exe。缺少产物时显示不可用，不注册工具。

在完成 AgentArts 配置的正式 Desktop 中打开“设置 → 电脑操控”。填写 1～4096 字符的用户文本，点击“新建并准备写入”。Host 在 hello_ack 前记录既有记事本窗口；可信 Desktop 在握手后启动系统记事本。

用户确认它是新建的独立、空白、单标签窗口，将其保持在前台，按 F9 允许本次已填写内容写入。快捷键只在这次准备期间登记，用完即释放；已被其他功能占用时拒绝准备。不关闭、不保存用户窗口。系统记事本若在既有窗口新开标签，必须由用户创建独立新窗口；旧窗口不会成为目标。

## 执行边界

- 复用 `prepareHostToolTask → observe → finalizeHostToolTask → authorization.respond(allow_once) → Policy / ToolGateway → Host`。F9 是当前任务的明确一次性确认，不是持续授权；UI 文本框值在 prepare 时复制后不可替换。
- `expectedText` 固定空字符串；不读取或替换用户已有正文。用户自己输入的 replacementText 会进入现有 Runtime 任务检查点；不得填写密钥。UI 与模型拿不到窗口身份、旧窗口内容或原生 targetRef。
- 模型工具目录暂不公布该写操作；模型不能伪造用户在场确认。当前入口为本机设置页，不能据此宣称“任意 Windows 自动化”或云端 Windows 完整链路。
- 目标确认有效期取 Host 的短期引用和本地确认期限的较早者。换窗口、用户输入、取消、过期、目标身份不明等由原生宿主与 Runtime 拒绝或保留未知结果。不会盲目重试写入。
- 成功必须来自 Runtime 终态、confirmed 工具结果和 Evidence 引用；只说明控件读回匹配，不说明文件已保存。取消后的已发生副作用不自动撤销。
- 退出先取消本模块准备/操作、关闭 Host 连接；其他活动 Runtime 任务仍由现有退出门禁处理。

## 本轮证据与缺项

- Runtime adapter / 持久 attempt store 定向检查 15/15；包括准备阶段顺序和取消。
- Desktop 使用真实 SQLite Runtime / Client / Policy / ToolGateway，合成原生帧检查 2/2：F9 之前无 observe / execute；确认后只消费一次授权并保留 Evidence；确认前取消不写入。
- Host 与 Bridge Release 构建通过，0 警告、0 错误。浏览器只核对新增设置组件的渲染，未操作真实 Windows 窗口。
- 尚待真实 Electron → 新记事本 → F9 → 授权 → UIA 写后读回，以及用户接管验证。不能据此完成 MOD-16 或整体 MVP 验收。

原生窗口隔离实现来自 #188，Runtime / 原生 Pipe 组合来自 #181；二者均须完成原有非作者评审。本工作不会用同账号检查代替评审。
