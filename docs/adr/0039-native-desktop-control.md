# ADR-0039：默认原生电脑控制与受控浏览器

日期：2026-10-24。状态：implementation。Profile：huawei_ict_agentarts。

沿用唯一 Runtime、Policy、ToolGateway、Evidence、原对话授权和共享输入 lease。默认执行器为应用构建的 .NET 8 Windows UIA/Win32 stdio 子进程，消除普通用户配置 Python 路径和环境变量的要求。原 Windows-MCP 固定适配保留为显式兼容入口，写结果未知时禁止切引擎重做。

原生子协议 personal-agent-desktop/1 只连接 Main 创建的子进程，不扩展原 Notepad Named Pipe 0.1.0。普通权限执行器校验观察绑定的 HWND、PID、启动时间、桌面/会话、DPI、窗口区域、控件和物理输入 generation，在同一 broker 内执行。UIA/Win32仍非原子窗口事务，不宣称窗口输入沙箱或管理员权限。

观察生成任务绑定、短期、一次性 targetRef。动作返回新观察；只有明确读回的后置条件标 verified。分派后的超时、取消、断线保持 RESULT_UNKNOWN。可信执行器证明未分派时使用进程内 ToolNotStartedError，普通错误文本、模型与网页不能签发此证明。

网页复用 Playwright library、自有可见浏览器、独立 profile、有界 DOM 工具；模型无 evaluate、Shell、任意 CDP 或用户 cookies 入口。拒绝非HTTP(S)、私有网络和metadata地址，合成验收仅用明确的测试注入。

普通设置提供启用、观察出口、准备/重试、立即停止和原会话。用户现有完全访问免应用审批，仍保留目标、期限、撤销、取消与unknown保护，不伪造OS/OAuth许可。

截图只含允许的目标窗口并保存为本机artifact；元数据不能冒称模型视觉。图像消费必须另有真实支持的模型图像端口及范围校验。Notepad专用安全条件、用户配置和原执行记录保留；设备、应用、Runtime、云端证据分别记录。

## C5 可选视觉端口增量（2026-10-24，provisional）

保持默认 AgentArts 文本 planner 与 `ModelMessage.content:string`。`ModelRequest.images` 可选携带受信宿主已读取的 PNG（mediaType、canonical dataBase64、sha256）；任务、artifact、目标和精确图像出机授权由宿主持有并在实际 guarded fetch 前重验，不把这些元数据当作模型提供的授权。ModelGateway 自动要求 vision，OpenAI compatible Provider 只有受信构造选项 `vision:true` 才声明条件性支持，默认 false，Pangu 文本端口明确拒绝图像。配置声明不构成真实视觉端点验收。

端口仅接收内存 PNG，不解析远端 URL 或文件路径；每次最多 4 图，单图最多 8 MiB、总共最多 16 MiB，每图 IHDR 最大 32 million pixels，校验签名、IHDR、长度、SHA256 和标准 base64。这些是本地安全上限，不宣称供应商配额；端点更小的实际限制仍须宿主收窄。保留原 PNG 字节，不裁剪、压缩或把 base64 塞进文字；发送时图片成为最后一个 user 消息的独立 image_url content part。消息、图片和请求参数在任何异步等待前复制，取消和期限覆盖凭据等待与传输。日志、错误和 ModelResult 不新增图片、凭据或私人路径。

Runtime 另行注册单次 `computer.vision.inspect`，在原 Policy/ToolGateway 中取得精确目标图像出机授权，经 task/artifact reader 和最终发送守卫调用可选视觉 ModelGateway；其有界文字描述是不可信观察，交回原文本 planner。此方案不新增 Agent 循环、不修改 CloudAgentPort/AgentArts query 协议、不替换默认云模型，也不把旧的界面文字许可自动提升为截图许可。自定义模型功能保留，实际视觉能力和目的地须显式配置与独立验证。

兼容：无 images 的旧请求和 wire body 不变，无数据库迁移；不支持视觉时零 Provider API 调用并返回 UNSUPPORTED_CAPABILITY。新端口只有本地合成 fetch 测试时仍为 provisional/conditional，真实 PNG 模型识别、宿主授权撤销与平台调用证据另行验收，不能以编译或配置成功声称 C5 完成。

## C5 供应商配额与关闭生命周期补充（2026-10-24）

本地图像上限与供应商请求上限分别执行。华为[图像理解文档](https://support.huaweicloud.com/model-call-maas/model-call-011.html)（2026-10-22 更新）为 DeepSeek V4.1 Flash 的 Base64 调用标明“整个请求体不能超过 5MB”，未明确 MB 的字节换算。Desktop 对显式 `source=agentarts-proxy` 采用保守的 **5,000,000 UTF-8 字节**门槛：在 Provider 完成 JSON 编码后计量整个 body，包含 image_url、Base64、文本和 JSON 结构；超限、非序列化或非法 JSON 在精确出机授权消费和 fetch 前拒绝。错误仅显示安全原因与字节数，不回显图像、文本或 Key。通过计量的不可变正文在异步最终守卫前固定，等待期间修改调用方 init 不会替换实际发送正文。显式自定义 OpenAI compatible source 不套用该平台上限，原 ModelGateway PNG 校验和任务授权仍生效。5,000,000 是本机保守选择，不声明为华为官方给出的精确数值。

视觉宿主 `close()` 先标记关闭、清空 prepared 范围并 dispose 配置；配置撤销所有 pending 调用并清空内存 Key，关闭后不再接受新的视觉调用。Main 在关闭 Runtime 前释放视觉宿主与配置，重复 dispose 保持幂等。关闭过程不发布会读取 Runtime 的 `onUpdate`，避免在已释放 Runtime 上生成新的状态快照。取消、期限、配置变更和退出均继续在实际发送前复核；本机 abort 不代表云端已接收请求被撤回，也不改变原任务／结果未知语义。

配置 14 项与视觉宿主 13 项 focused 检查属于合成传输／生命周期证据，实际 Electron 配置已另有回执。真实视觉联合回执 `23d0765d-a3e4-4082-8dae-f317d0b6d269` 通过：本地发布 ARM64 镜像无源码 overlay，3 个原工具 run confirmed，4 次 planner 200 和 1 次视觉 200；原图 17,880 bytes 与实际 image_url SHA 一致，完整编码 body 24,454 bytes。原 Questions 精确图像出口和最终守卫真执行，独立核对 Canvas 随机标记，文本 planner 仅在原视觉结果确认后续答；原 Evidence 仍 conditional。真实链修正了 `waiting_approval` 原绑定校验和结果投影仅带 `proposalId` 的调用形状。必要检查分项、原失败、最终原生云链及未验正式平台等限制见[电脑操控交付记录](../COMPUTER_CONTROL_COMPLETION_20261024.md)。

## 原访问结果的固定语义（2026-10-24）

原 `capabilityContext` 只在 Competition 注册了 `computer.request_access@1.0.0` 时加入固定宿主语义：`policy_allowed`／`presence_confirmed` 表示当前访问步骤成功，`authorizationGranted=false` 表示后续工具仍须独立通过 Runtime／Policy，不能把它误作访问拒绝并循环申请。该内容不从外部 Schema 描述或模型结果复制，不授予权限、不让 unavailable 工具变为 ready；过期、撤销、原任务和未知写入规则保持。仅沿 Desktop 已 opt-in 的每次新鲜环境上下文发送；未 opt-in 的 typed-goal 消费方兼容，原上下文 token 预算规则不变。编译与 7 项 focused 通过；严格原生云链回执 `6902d477-e721-4d9a-9501-dad1b83d07ea` 完成六种工具、原审批、UIA／独立窗口读回、PNG 与 SQLite，之前的访问循环、漏独立 observe 和最终 JSON 解析失败均保留，不将一次成功提升为稳定性保证。
