# ADR-0011：文字与原生 Live 共用任务执行体系

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- 状态：accepted（产品负责人在 2026-09-27 当前任务直接授权）
- 负责人：zemeng；范围：MOD-11/14，必要 ModelGateway 音频入口与装配

## 决定

麦克风按钮只将 SIS 转写填入可编辑输入框；发送文字只返回文字。圆形波形按钮和可配置
F8 快捷键启停原生 Live，不以 ASR→文本模型→TTS 串联替代。新增千问原生音频会话，
用户已授权开启后向阿里云发送音频与对话上下文。API Key 由主进程加密保存；不进入
快照、模型上下文和日志。固定北京业务空间官方端点，不接受任意代理 URL。

音频 Provider 由 models 的实时 ModelGateway 入口管理，单独增加连续 PCM、取消和
事件端口，兼容现有 complete 文本入口。Desktop 只装配音频设备、IPC 和凭据。
千问不注册连接器、不持有业务凭据、不执行本地工具；工作请求经公开 Client 提交
现有 AgentArts Competition Runtime。任务状态、审批、执行、证据仍由 Runtime /
Policy / ToolGateway 负责，不复制 Agent 执行循环。

文字与语音共用 desktop-panel 会话，真实工作任务出现在同一任务视图。关闭 Live
停止麦克风、播放、网络连接和结果等待，不隐式取消已受理任务。任务取消走现有
task.cancel。模型没有独立授权权力。Live 中的普通闲聊不是 AgentArts 工作流证据。

主对话和展开的子任务对话最终使用已有 Runtime 任务/AgentArts 交接记录；模型及思考
设置必须记录请求与实际生效值，不支持的参数显示 unavailable，不能用界面滑块冒充生效。

## 复用与兼容

- 使用官方 Realtime WebSocket 协议和 ws 传输，不引入额外 Python/RTC 服务或本地大模型。
- 复用现有麦克风授权租约、16 kHz PCM 源、Runtime Client 和任务持久化。
- 参考 LiveKit / Pipecat 的流式音频与打断设计，协议依据为阿里云官方文档。
- 新增的原生流式输出使用 24 kHz PCM；打断立即丢弃待播放音频。
- SIS 配置与文本 AgentArts 配置继续独立保存，Live 未配置不会影响文字和听写。

## 验收

必要离线检查覆盖取消、晚到消息、非法工具请求、听写不自动提交、按键连按与音频释放。
真实验收验证 Live 双向音频与打断，以及语音建任务→文字查看→语音询问真实进度。
配置保存、WebSocket 已连接、合成音频存在均不能独立证明完整验收。

## 来源

- https://help.aliyun.com/zh/model-studio/realtime
- https://help.aliyun.com/zh/model-studio/client-events
- https://help.aliyun.com/zh/model-studio/server-events
- https://github.com/livekit/agents
- https://github.com/pipecat-ai/pipecat
