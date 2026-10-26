# 电脑操控实施与联合验收记录（2026-10-24）

目标 profile：`huawei_ict_agentarts`。本线实现与列明范围的专项验收已交付，工作包保持 `in_progress` 等待主工作树串行集成；不表示 C0～C6 或 MOD-16/17、完整比赛路径已整体完成。

实施工作树：`<source-worktree>`；分支：`codex/computer-control-completion`；基线 HEAD：`0abefff257c8e45136886e1cafa8bd3b830c751a`。电脑操控改动目前仍为未提交修改和新文件，HEAD 不包含全部实现，不能单独作为当前源码身份。最终向原任务工作树 `<source-worktree>` 的集成由主负责人串行处理。本记录不授权提交、推送、创建 PR、平台部署、合并或发布。

需求依据为原任务工作树中只读的 `docs/reviews/2026-10-23-product-simplification/03_COMPUTER_CONTROL_ARCHITECTURE.md`，实施设计见 [ADR-0039](adr/0039-native-desktop-control.md)。Runtime、Policy、ToolGateway、Evidence 和原任务记录继续是唯一执行与事实链；沿用现有对话授权，不引入外部框架的 Agent 循环或第二任务库。

## 主树集成补记

主负责人已将本线完整补丁串行应用到 `f809`，并与权限／CCB 团队和内存包合并共享的 Main、Renderer 与能力上下文。原工作树及下文专项回执保持原来源。完整目录的超 64 项／24 KiB 问题已实现原候选集合上的 `capability.search`，确认回执激活下一工具页；65 项边界经合成协调器和真实 Policy／ToolGateway 验证。当前默认实云任务的原目录是 47 项；此结果不能替代全部电脑／浏览器／视觉候选同时启用时的云验收。

主树另修复原生进程预备读取工作区 Node 绑定，以及预备期间旧审批提前投影的问题，保留原 argumentsDigest、Runtime pending 与 active marker 校验，没有扩大授权。真实默认桌面已完成一例工作区修复、受限原生项目测试、独立文件／动画和重启读回，见[主树实施记录](competition/PROGRESSIVE_EXECUTION_20261024.md)；该样例不操作 Windows 业务应用，不能代替下文 C2/C3 的设备接管验收。第三轮整仓组合检查正在执行；安装器、签名、干净系统、多屏 DPI、物理用户及正式新平台部署仍保留原 `not_run`。

用户后续已授权主集成在 Codex 账户剩余额度约 5% 时提交本轮完整改动并创建 PR；这里记录授权，当前不据此宣称已提交、合并或发布。

## 1. 当前可用入口与边界

电脑设置页已接实际 Main／Preload／IPC：启用状态、目标观察出口、组件准备／重试、停止、原任务／对话恢复入口及具体错误均来自宿主。默认原生执行器不要求普通用户填写 Python 路径。源码 checkout 仍需要本机 .NET 8 SDK 构建固定组件；安装形态要求应用内已有完整组件，缺失时明确提示更新完整应用，不在用户机器临时编译或下载任意程序。

模型默认仍由 AgentArts 进行文本规划。可选视觉默认关闭，来源默认显示 AgentArts 视觉代理，保留自定义 OpenAI 兼容 Endpoint／模型入口。启用视觉需在本机设置中填写目标与 Key；Key 经 Electron safeStorage 加密，只写不回显。保存配置不会发起模型调用，也不替换默认文本 planner。

目标观察、任务工具权限和精确图片出机继续分别核对。受限模式按原任务确认在场；完全访问模式只在已有有效策略和原 `computer.request_access` 成功绑定内更新短期 presence，不伪造 F9，不跨任务、会话、策略 revision 或 deadline 延续。显式关闭观察出口仍生效。截图留在本机不等于图片已送模型；视觉文字也不证明任务目标已经实现。

## 2. C0～C6 状态

| 工作包 | 状态 | 已实现与当前证据 | 尚未闭合的验收 |
| --- | --- | --- | --- |
| C0 事实投影 | `in_progress` | 实际电脑／浏览器入口、健康与准备状态、错误 code／stage／安全详情；E04 的 17 项实际 Electron 检查与 11 张截图逐图审阅通过；request_access 固定语义已进入 Desktop 使用的 Runtime 能力上下文 | 完整目录 65 项的路由与容量修复交主集成负责人处理 |
| C1 开箱组件 | `in_progress` | 固定 .NET 8 UIA／Win32 stdio 执行器、可取消准备、自包含 publisher、文件哈希与上游许可清单；E06 独立运行时初始化成功 | 安装器、卸载器、代码签名、干净普通用户系统安装运行 `not_run`；不能称已发行 |
| C2 强目标与输入 | `in_progress` | HWND／PID／进程启动身份、普通权限、前台／命中、输入 generation、DPI／区域、一次性目标；共享输入 lease、可信零分派证明；E01 13 项实机、E02 11 项 Runtime 检查 | 实际物理用户接管、多屏／DPI 变化、UAC／安全桌面、广泛应用兼容 `not_run`；非原子 UIA／Win32 竞态仍存在 |
| C3 任务级 UX | `in_progress` | 原任务授权、精确参数绑定、停止与草稿保留、原记录恢复、策略 presence 续期；presence focused 22 项，E04 实际按钮，E10 direct native 六工具云端闭环通过 | 未知写入保持待核实，不能以重启或切引擎重做；正式平台与全部用户目标另验 |
| C4 网页 driver | `in_progress` | 受控 Playwright library、独立 Edge profile、受限 DOM refs、固定 DNS／IP 出站、同来源下载和清理；E03、E05、E07、E09 分层通过 | 日常真实站点登录／业务、多站兼容 `not_run`；完整目录与云镜像容量缺口未闭合；不接管用户浏览器登录态 |
| C5 视觉兜底 | `in_progress` | 显式 PNG ModelRequest、独立视觉端口、safeStorage／CAS、精确原图出机与最终守卫；config 14、host 13 项 focused 通过，E04 验配置 UI；E09 新镜像 planner→真实截图→真实视觉模型→续答通过 | 不宣称任意坐标 grounding、低置信度自动操作或原生视觉目标闭环已验；完整检查与正式平台部署仍另验 |
| C6 当前设备验收 | `in_progress` | 实机组件、Runtime、实际 Electron、下载、直连云浏览器及随机 Canvas 真实视觉链各自有回执；失败回执保留；必要检查分项见第 7 节 | 串行集成后需最终组合检查；新镜像正式平台部署 `not_run` |

上述“通过”仅指对应回执覆盖范围。Fixture／合成审批、真实 OS 输入、真实 Runtime、真实 Electron、真实云模型与正式平台部署分别记录；不能相互代替。

## 3. 工具存在、注册与实际调用

以下工具源码已存在并进入 Main 组合；注册、目录可用和实际执行仍受平台、配置、组件、授权、目标及原任务状态影响。默认原生为 **16 个 `computer.desktop.*` 工具 + 1 个 `computer.request_access`**；浏览器 **12 个**；视觉 **1 个**，本线合计 30 个候选工具。它们包含读取和等待，不是 30 个写动作。其他模块、可选兼容引擎及既有 Notepad 工具不计入此数。集成负责人最新盘点另发现完整目录 **65 项**超过镜像最大 64 工具门槛，以及 `request_access` 语义在目录投影中被过滤两个缺口；由原主集成工作包处理，本线未修复／未验收。不能用 E07／E09 的工具子集代替完整产品目录验收。

表中 E 编号对应下一节回执。“OS”指真实 Windows 上的专有合成 WPF 窗口；“Runtime”仍使用明确的合成审批／测试 worker。“未取得”表示当前记录没有该项真实公共工具回执。

| 工具（均为 `1.0.0`） | 存在／接线 | 当前实际调用证据 | 后置条件与限制 |
| --- | --- | --- | --- |
| `computer.request_access` | 是／默认宿主 | E02、E08、E10 confirmed | 返回 `presence_confirmed` 或 `policy_allowed` 表示本步成功；`authorizationGranted=false` 不要求循环申请，也不授予后续工具权限 |
| `computer.desktop.list_windows` | 是／原生目录 | E01 OS；E02 Runtime；E10 云模型 confirmed | 返回本任务不透明窗口引用，不是业务完成 |
| `computer.desktop.observe` | 是／原生目录 | E01 OS；E02 Runtime／未授权拒绝；E10 云模型独立 observe confirmed | 生成短期 targetRef 与有界控件观察 |
| `computer.desktop.activate` | 是／原生目录 | E01 OS；E02 Runtime；E10 云模型 confirmed；E08 失败保留 | 前台身份读回；不能从激活推断业务完成 |
| `computer.desktop.screenshot` | 是／原生目录 | E01 OS；E02 Runtime；E10 云模型 confirmed | 目标窗口 PNG 与摘要；未自动送文本模型 |
| `computer.desktop.set_value` | 是／原生目录 | E01 OS；E02 Runtime／参数替换拒绝；E10 云模型 confirmed | UIA 值读回及合成窗口独立读回；只证明该控件值 |
| `computer.desktop.click` | 是／原生目录 | E01 OS 对应 action | 合成按钮计数读回；公共 Runtime／云链该动作未取得单独通过回执 |
| `computer.desktop.type` | 是／原生目录 | E01 OS 对应 action | 合成文本读回；不等于真实业务提交成功 |
| `computer.desktop.invoke` | 是／原生目录 | E01 OS 对应 action | 控件调用及合成计数观察 |
| `computer.desktop.select` | 是／原生目录 | E01 OS 对应 action | 选择状态读回 |
| `computer.desktop.focus` | 是／原生目录 | E01 OS 对应 action | 焦点读回 |
| `computer.desktop.shortcut` | 是／原生目录 | E01 OS 对应 action | 原目标内有界快捷键；不是系统权限授权 |
| `computer.desktop.press` | 是／原生目录 | E01 OS 对应 action | 原目标单按键与后续观察 |
| `computer.desktop.scroll` | 是／原生目录 | E01 OS 对应 action | 合成区域滚动观察 |
| `computer.desktop.move` | 是／原生目录 | E01 OS 对应 action | 指针移动；不证明应用接收业务动作 |
| `computer.desktop.drag` | 是／原生目录 | E01 OS 进行中拖拽被 stop 中断 | 证明停止路径；完整拖拽业务目标 `not_run` |
| `computer.desktop.wait` | 是／原生目录 | 当前真实公共调用回执未取得 | 只等待，不延长旧目标寿命或证明目标完成 |
| `browser.open` | 是／浏览器目录 | E03 Runtime；E07／E09 云模型选择并 confirmed | 仅自有 profile 和允许的 HTTP(S) 来源 |
| `browser.observe` | 是／浏览器目录 | E03 Runtime；E07 云模型选择并 confirmed | 有界 DOM／文字和一次性 refs，不信任页面指令 |
| `browser.type` | 是／浏览器目录 | E03 Runtime；E07 云模型选择并 confirmed | 合成普通输入；密码／文件控件拒绝 |
| `browser.click` | 是／浏览器目录 | E03 Runtime；E07 云模型选择并 confirmed | 合成 DOM 独立读回；generic 结果仍不自报目标完成 |
| `browser.download` | 是／浏览器目录 | E05 真实 Edge + 合成 Runtime 记录 | 同来源观察链接、文件 hash；无自动打开、执行或文件内容出机 |
| `browser.select` | 是／浏览器目录 | 当前真实公共调用回执未取得 | 限原观察中原生下拉控件值 |
| `browser.press` | 是／浏览器目录 | 当前真实公共调用回执未取得 | 固定按键集合，不开放任意快捷键 |
| `browser.scroll` | 是／浏览器目录 | 当前真实公共调用回执未取得 | 自有页面有界滚动 |
| `browser.back` | 是／浏览器目录 | 当前真实公共调用回执未取得 | 仍检查原授权公共来源 |
| `browser.wait` | 是／浏览器目录 | 当前真实公共调用回执未取得 | 最多 2 秒后重新观察 |
| `browser.screenshot` | 是／浏览器目录 | E03 Runtime；E07／E09 云模型选择并 confirmed | PNG 先留本地；E09 仅经后续精确图像许可送独立视觉模型，文本 planner 不收原图 |
| `browser.close` | 是／浏览器目录 | E03 Runtime confirmed；E07 宿主清理读回 | 仅关闭自有 Edge；E07 的清理不冒充模型选择 close 工具 |
| `computer.vision.inspect` | 是／可选视觉目录 | focused 合成传输；E09 真实视觉 API 200、原 run confirmed、随机标记独立匹配 | 仅原任务唯一 confirmed 截图；仍返回 `visual_observation`、`goalVerified=false`、`untrustedObservation=true` |

原生宿主协议另有生命周期 `stop`，不直接暴露为模型写工具。截图元数据、执行确认、独立业务读回与通用 Evidence 的 `conditional` 必须分开；`confirmed` 不等于所有业务目标均 `verified`。

## 4. 已有回执与失败记录

以下 `.cache` 路径相对实施工作树，属于本机忽略产物，不应连同数据库、截图、配置或原始日志直接提交。已纳入源码的测试入口可以复现对应层级；发布审阅材料时只收录必要脱敏摘要。

| ID | 回执位置与结果 | 能证明的范围 | 不能证明的范围 |
| --- | --- | --- | --- |
| E01 | `apps/windows-host/desktop/test/last-real-device-receipt.json`；13 项通过；原证据 `.cache/desktop-native/c8ad51b4-5065-4db1-a741-afd8e639699f` | 真实 Windows UIA／SendInput、窗口截图、遮挡／密码截图拒绝、旧 target 拒绝、注入的外部输入 generation、stop；自有进程退出确认 | 物理人接管、全部应用、Runtime、Electron、模型、云、安装器 |
| E02 | `.cache/desktop-native-runtime/316409e0-b11c-4ac2-8906-efaafe7b97bf/receipt.json`；11 项通过 | 真实 Runtime／Policy／Gateway／原生执行、未授权零分派、参数替换拒绝、原 run 缓存重放、原 SQLite 重开读回 | 使用确定性测试 worker、合成审批和测试隐私过滤；无模型／Electron／云；generic Evidence 保持 conditional |
| E03 | `.cache/browser-control-runtime/d56f41cf-31b7-4817-8e87-5bcb2ace09bb/receipt.json`；11 项通过 | 真实 Edge、自有 profile、真实 Runtime、精确参数／原 run、共享 lease、截图 artifact、关闭与 SQLite 重开 | localhost 必须显式注入真实 driver 和精确测试来源；合成审批／网页不是真实账号或云验收 |
| E04 | `.cache/computer-control-product-smoke/run-NcyNlG/receipt.json`；17 项通过，11 张截图；同目录 `visual-review.json` 完成逐图审阅 | 真实 Electron Main／Preload／IPC／Renderer／Runtime、准备和停止、CAS、草稿、EISDIR／EPERM 技术错误可见、safeStorage 加密重启恢复、600px 视觉设置布局检查；捕获范围内无阻断布局问题 | Key 为不可用合成占位；`visionRequests=not_invoked_configuration_only`、云验收 not_run；原回执不改写，补充审阅未覆盖窄窗错误状态、多屏 DPI 或原生桌面合成 |
| E05 | `.cache/browser-control-download-acceptance/b98ebf26-91b9-48bb-ab04-7c9fdc2d8a10/receipt.json`；11 个检查布尔值均 true | 真实 Edge 下载、同来源／跨来源、target 重放、默认 10 MiB 上限、超额取消后 unknown、gzip 响应头拒绝、残留目录清理 | Runtime 记录为显式 Fixture；无真实 Runtime／模型／云联合证明 |
| E06 | `.cache/native-desktop-publish/938aa6e9-9c45-4876-8886-04cbfec713bd/identity-receipt.json` 与同目录 `resources/native-tools/desktop/component-manifest.json` | win-x64 自包含 .NET 8.0.30，屏蔽外部 DOTNETROOT／PATH 后 initialize 成功并 exit 0；472 文件／167,660,383 字节 | 只发送 initialize，无用户输入；非干净 OS、安装器、签名或当前最新源码整包动作验收 |
| E07 | `.cache/computer-control-joint/b6b0718c-88fd-481d-900f-4c001aec9da5/receipt.json`；passed，task succeeded；6 次模型 HTTP 200、5 个原审批回执 | PR511 发布镜像本地 linux/arm64 运行、无源码 overlay、直接 AgentArts model-proxy；真实 Edge 表单独立 DOM 读回、截图本地保存、原 Runtime Evidence、清理 | 合成表单及审批；只公布本次工具子集；不是新镜像正式平台部署、视觉理解、原生桌面闭环或全部工具验收 |
| E08 | `.cache/computer-control-native-joint/66ee9109-f611-4780-9ae4-009c313eca08/receipt.json`；failed，原 task `8a5864e4-1cdc-458e-85f4-dd933049abcd` | request_access／list_windows confirmed；activate 的 `executionStarted=false`，原内部错误 `USER_TAKEOVER`；保留失败和运行记录 | 不得改写为通过。内部码到 public `REVISION_CONFLICT` 映射及原 presence 续期已有修复；新独立任务的最终通过见 E10 |
| E09 | `.cache/computer-control-vision-joint/23d0765d-a3e4-4082-8dae-f317d0b6d269/receipt.json`；passed，task `7acd7182-3611-4278-90d4-87ea6ef9219b` succeeded；3 个原 run confirmed，4 次 planner HTTP 200 + 1 次视觉 HTTP 200 | 本地发布 ARM64 镜像无 overlay；真实独立 Edge Canvas 随机 8 字母不在 goal／DOM／AX；原截图 17,880 bytes、实际完整 body 24,454 bytes，原图 SHA 与 image_url bytes 一致；真实 Questions 的精确图像 export requirement、beforeSend 元数据重验、独立随机标记匹配及云端续答；自有 Edge／原生宿主／Runtime 释放 | 完全访问决策是明确合成测试配置，原 Runtime／Policy 和精确回执仍真执行；原 Evidence 仍 `conditional`；不是新平台部署、物理用户目标、任意 grounding 或完整目录容量验收 |
| E10 | `.cache/computer-control-native-joint/6902d477-e721-4d9a-9501-dad1b83d07ea/receipt.json`；passed，task `8b79f756-61b3-4ff9-84c7-eed286aa7dcc` succeeded；8 次 planner HTTP 200、7 个原审批／confirmed run，6 种要求工具齐全 | 原生产 presence、Runtime／Policy、固定能力上下文、真实 WPF／UIA、独立 fixture 值与 UIA `verified` 值相同、本机 PNG SHA、原 SQLite 重开、原 attempt／Evidence 保留、共享 lease idle；12 个检查 true，自有 native／fixture／Runtime 关闭 | 合成审批与专有窗口／目录隐私过滤明确；Evidence 仍 conditional；不证明真实账号、一般应用、物理接管、模型稳定性或新平台部署 |

E09 前两次失败保留在 `.cache/computer-control-vision-joint/fefdb2a5-c9f3-49f1-b09b-748e6737a31e/receipt.json`（审批期间 `waiting_approval` 被原 guard 拒绝，尚未发送图片）与 `.cache/computer-control-vision-joint/2190ea6f-5ea6-4e88-b962-c1c4a480963a/receipt.json`（图片 HTTP 200 后，结果出口按错误身份查找，原任务 `waiting_reconciliation`）。修复后以新的独立合成任务得到 E09；没有重放原未知结果，也没有修改失败回执。

E10 前的独立原生验收均保留：`56eec8ce-7748-4630-aa37-19d6ec446423` 为 32 次 planner 请求／30 次 request_access 后 `TIMEOUT`；补固定生产状态语义后，`625b5dac-7d26-42c5-af01-1b13d62b187a` 的原任务 succeeded、真实写入与截图完成，但模型省略独立 observe，严格六工具验收 failed。验收目标随后明确说明 activate 附带 snapshot 不能代替独立 observe 回执，没有放宽断言。`51c0d787-7eec-467b-a99f-1c5579a1f931` 已执行全部六工具，最终模型返回 HTTP 200 后发布镜像在 `response_json` 解析阶段失败，向本地返回 502，原任务保留 `waiting_reconciliation`。这些 ID 的 `receipt.json`、独立 `state.json` 与 `container.log` 均在 `.cache/computer-control-native-joint/<ID>/`；E10 使用新的独立窗口和任务，没有重放原写入。一次最终通过不证明模型输出或步骤选择在所有任务上稳定。

E06 manifest SHA-256：`2d4dcfc68528e43f3cd09a244c9e3324b6cd48d4f81a6e29be069fb2e20c27ca`；其中 `WindowsHost.Desktop.exe` SHA-256：`2a61e17e8d221f7f7abe9aa2f1f0161f8f01724c025e8f63256eb605b4232b65`。manifest 标记 `workingTreeModified=true`，需连同其中源码摘要判断对应版本；不得把该 bundle 的历史初始化结果提升为后续修改后的二进制验收。

本轮集成负责人核对的镜像身份：`ghcr.io/xianxing-ai/personal-agent-owned:sha-ffb0e0859d4b5d7256d0f0e6cb11288bb7634408`，digest `sha256:91cc82092f621a28e09a9eeebd1c99fe6a59ba9f2451fa7e6fc40d2b5d440993`；对应 PR511 head 为 `ffb0e0859d4b5d7256d0f0e6cb11288bb7634408`。联测使用本地真实发布镜像和直接云模型，未做源码 overlay。既有平台版本 `arm64-output32k-1023` 与新镜像正式部署是两件事，`newImagePlatformDeployment=not_run` 保留；旧 bridge 联测仅为显式适配级历史证据，不替代 E07 direct 路线。

E09 视觉模型为 `deepseek-v4.1-flash`，原图 SHA-256 为 `b728e7aa7cd83fd083dae1288aae5f2712b9564cc64fdeb1917582460a707f99`。3 个 confirmed 工具依次为 `browser.open`、`browser.screenshot`、`computer.vision.inspect`；图片仅进入独立视觉调用，随机标记只在原视觉结果 confirmed 后进入 planner 续轮。本轮真实调用同时暴露并修复了两处生产调用形状：原 Questions 在 `waiting_approval` 期间需要原绑定守卫；结果投影实际只携带 `proposalId`，不能假定存在 `runId`，需从同任务唯一 prepared 提案读回绑定。这些修复有 E09 真实 caller 证据，当前全量检查仍 pending。

## 5. 安全、兼容与迁移

1. 默认执行面改为固定原生 stdio 子进程，协议 `personal-agent-desktop/1`；原 Notepad Named Pipe 0.1.0 与严格专用读回边界保留。Windows-MCP 0.8.8／Python 3.14+ 仅在受信开发兼容配置 `PA_WINDOWS_CONTROL_PYTHON` 明确存在时选择，本次未捆绑其 Python wheel 或传递依赖。
2. `computer-control.json` 是 Main 非秘密偏好；启用、出口及显式拒绝保留。旧 `PA_WINDOWS_CONTROL_EXPORT` 只作兼容输入，不迁移为所有未来截图／模型永久许可；显式新偏好优先。`computer-vision-config.json` 是 safeStorage 密文信封，版本 1、随机 revision CAS；更换来源／Endpoint／模型需要重新填写 Key，同目的地空 Key 可保留现有密钥。
3. 不新增数据库迁移、不清空原记录。保留原 Runtime task、run、attempt、checkpoint、取消、期限及重启 unknown 检查。无持久 native／browser 业务读回能力时保持 `recoverySupport=false`；不能从新观察猜测旧写入未发生。
4. `ToolNotStartedError` 使用进程内 WeakSet 身份品牌。仅受信零分派证据允许 Gateway／Runtime 记录执行未开始；普通错误名、字符串、模型／网页字段不能伪造。分派后超时、断线、取消及读回失败仍保留 `RESULT_UNKNOWN`。原生内部 `USER_TAKEOVER`／目标变化等映射为公共 `REVISION_CONFLICT` 和固定安全原因，不把未定义内部码发送到 public Schema。
5. 允许的原生目标依然要求普通权限、同会话／desktop、HWND／PID／启动身份、可用目标区域、前台、命中、DPI／输入 generation。UIA 和 Win32 不是原子窗口事务，不构成内核输入沙箱；不放开 UAC、管理员／登录／凭据界面。两种电脑引擎与受控浏览器共享输入 lease，不因目标看似一致而并发写入。
6. 浏览器只访问允许的公共 HTTP(S)，在代理处固定已核验 DNS／IP 后连接，拒绝私网／metadata 和不允许的重定向。下载只来自当前观察的同来源链接，固定落到 Downloads 下的 `PersonalAgent`，默认 10 MiB；压缩响应在头部拦截，超额／取消保留实际 unknown 和清理结果。模型不能指定路径、任意 JS／CDP、Shell、cookies 或自动打开下载。
7. `ModelRequest.images` 是可选 host-only PNG 输入；无 images 的旧请求保持原路径。PNG 上限为单图 8 MiB、最多 4 图、总 16 MiB、单图 IHDR 32 million pixels，并核对标准 Base64、签名、尺寸、长度和 SHA-256。OpenAI compatible 仅显式 `vision:true` 才声明视觉，默认 false；Pangu 文本端口拒绝图像。这些上限不是供应商配额。
8. AgentArts source 的最终 JSON 字符串按 UTF-8 整体计量，含图片 Base64、文本与结构，超过 **5,000,000 字节** 在精确出机授权消费及 fetch 前拒绝。华为[图像理解文档](https://support.huaweicloud.com/model-call-maas/model-call-011.html)（2026-10-22 更新）使用“5MB”但未明确字节换算，本机采用保守十进制门槛；不声称官方明示 5,000,000。自定义 source 不强加这一平台上限，但原 PNG／任务／授权限制仍保留。非法或不可计量的 AgentArts JSON 不发送，错误不回显正文或 Key。
9. `computer.vision.inspect` 仅消费原任务唯一 confirmed screenshot 的原 artifact／run／参数 digest／target／期限绑定，最终发送前重验配置、presence、原图与 `computer-image-export` requirement。只把视觉描述和元数据交回文本 planner；目标图片不进入普通文字 planner。视觉输出视为不可信观察，不签发权限或伪造独立后置验证。
10. 退出先关闭视觉宿主、清除 prepared 图像范围并 dispose 配置，撤销 pending 调用、清空内存 Key；关闭后不再发布依赖 Runtime 的状态回调。Main 在 Runtime 关闭前执行此释放，重复 dispose 安全。已经发送的云端请求无法靠本机取消“撤回”；未知结果与原记录仍按原语义处理。只清理自有进程／profile，不关闭用户应用。

回退时保留 userData、原 Runtime 数据库与 unknown 记录，不以删除配置／切换 Python 清除未知动作。较旧客户端不会理解新可选视觉配置；禁用并保留密文、停止自有组件后回到兼容版本，不能自动解密搬迁 Key 或将截图授权降格成普通文字出口。自包含组件尚未完成分发验收，当前不提供已验证安装器回退保证。

## 6. 运行与复核入口

以下命令在本实施工作树执行。固定 Node 为 `<source-worktree>/.cache/toolchains/node-v24.15.0-win-x64/node.exe`，根声明 Node 24.15.x；全局 Node 26 不用于本轮。已有依赖及构建产物继续复用，不为纯文档验证重装、构建或启动应用。重型检查与其他协作工作串行；真实输入单独占用设备时段。

```powershell
Set-Location '<source-worktree>'
$paNode = '<source-worktree>/.cache/toolchains/node-v24.15.0-win-x64/node.exe'

# 本工作树既有固定 Node/npm shim；本轮结果及原失败见第 7 节。
& $paNode .cache/run-pinned-npm.cjs run check

# 配置／视觉宿主等定向入口，依赖对应 workspace 已构建产物。
& $paNode --test apps/desktop/test/computer-vision-config.test.mjs apps/desktop/test/computer-vision-host.test.mjs
& $paNode --test apps/desktop/test/windows-control-host.test.mjs apps/desktop/test/tool-presence-host.test.mjs

# 源码默认启动会运行固定 native prestart；缺组件会保留具体错误并允许其余能力启动。
& $paNode .cache/run-pinned-npm.cjs run start --workspace=@personal-agent/desktop

# 发布新的本地自包含 bundle 并做隔离外部 .NET 的 initialize 读回；不上传／安装。
& $paNode apps/desktop/scripts/publish-native-desktop.mjs
```

真实设备／产品脚本按授权和设备独占时段分别执行，不作为文档改动的固定重跑门槛：

```powershell
& $paNode apps/windows-host/desktop/test/acceptance.mjs
& $paNode apps/windows-host/desktop/test/runtime-acceptance.mjs
& $paNode apps/desktop/test/browser-control-runtime-acceptance.mjs
& $paNode apps/desktop/test/browser-control-download-acceptance.mjs
& $paNode apps/desktop/test/computer-control-product-smoke.cjs --run
```

产品脚本使用隔离 userData 和自有应用；`PA_PRODUCT_SMOKE_ELECTRON_EXE` 可指定已有 Electron，`PA_PRODUCT_SMOKE_SOURCE_PROFILE` 指定已授权的配置来源。模型任务、桌面观察、真实用户窗口输入和视觉请求数以生成回执为准，不根据脚本名字推定发生。

云联合入口在 `tests/manual/agentarts/computer-control-joint.mjs`、`computer-control-native-joint.mjs` 与 `computer-control-vision-joint.mjs`。当前 `.cache/computer-cloud-image/run-joint.cjs` 是本机可信 Electron 主进程辅助器：默认 direct browser，`--native` 或 `--vision` 选择独立验收；`--model-bridge` 是旧显式适配路线，不用于新 direct 结论。必须让真实 safeStorage 在 Electron 主进程内解密并只以内存／子进程受信环境传递凭据，不能用普通 Node 或假 safeStorage 模拟该环节；不要把 Key 写进参数、日志、回执或仓库。辅助器不随源码发布，正式复现者需使用自己的已授权本机配置。

## 7. 当前检查与待填结果

| 项目 | 当前状态 | 收尾要求 |
| --- | --- | --- |
| 最新 presence 绑定修复 | focused 22 项通过（本轮集成记录） | 保留原 request_access／任务／会话／revision／deadline 约束；最终 fullcheck 包含当前源码 |
| 视觉 config | focused 14/14 通过；两文件 `node --check` 通过 | exact 5,000,000／超 1 byte／Unicode／custom／非法 JSON／异步正文替换已覆盖；这是合成 fetch 证据 |
| 视觉 host／生命周期 | focused 13 项通过（含真实 caller 形状回归） | 原授权、撤销、审批 waiting_approval、proposalId 结果出口及 pending 调用释放；最终 Main 生命周期纳入本轮整体检查 |
| 实际 Electron 产品 | E04 17 项通过、11 张截图逐图审阅通过 | 补充 `visual-review.json` 保留原回执 SHA 与逐图观察；配置真加密不等于模型真调用 |
| direct vision 新镜像联合 | **E09 passed，范围限定** | 随机 Canvas 标记识别与云端续答通过；3 confirmed runs、4 planner 200 + 1 vision 200；17,880-byte 原图／24,454-byte body，原 Questions 精确出机与 beforeSend 重验；Evidence 保持 conditional |
| direct native 修后重验 | **E10 passed，范围限定** | 6 种要求工具齐全、7 confirmed run、8 planner 200；原审批、UIA／独立 fixture 读回、PNG、原 SQLite 与 lease 释放通过；之前各失败不改写 |
| 访问状态给模型的语义 | **生产固定上下文已补，7/7 focused** | 仅对 Competition 已注册的 `computer.request_access@1.0.0` 给出固定成功状态与 `authorizationGranted=false` 含义，不复制外部 Schema 描述，不改变 readiness／原审批／期限；Runtime tsc 通过。Desktop 环境上下文每次发送重新生成，未 opt-in 的 typed-goal 消费方保持兼容 |
| 完整产品工具目录 | **65 项阻断未在本线闭合** | 实际 factory 配合明确合成就绪配置：关闭视觉 64 项／23,383 bytes 可建立目录，开启视觉 65 项／23,741 bytes 在模型前拒绝。复现 `.cache/computer-control-catalog-audit/reproduce.mjs`／`receipt.json`；模型和工具调用均为 0。原主集成工作包负责发现／分页与最终验证，不单调大 64 或静默裁剪 |
| 当前源码检查 | **必要分项完成；首轮整条命令 exit 1 保留** | 首轮 `npm run check` 的架构／契约夹具／生成检查／构建／类型检查通过，测试汇总 5,778 pass、40 skip、6 fail；6 项为测试环境问题。修后原失败所在两文件 33/33 通过，再运行原未执行的根集成 57/57 通过；未重跑完整命令，不把首轮标为全绿 |
| 文档、差异与自审 | 本文件交付时做路径／事实／冲突标记／空白检查 | 最终集成前结合当前完整 diff 复核，不代替非作者审查与技术 CI |

## 8. 保留的 `not_run`／unknown 矩阵

当前检查日志：`.cache/computer-control-check-final-20261024.log`（原失败）；`.cache/computer-control-check-fixture-repair-20261024.log`（33/33）；`.cache/computer-control-check-integration-final-20261024.log`（57/57）。这 6 项修复只给 absent native 测试注入同一固定 clock，并为提取 Main 回调的 VM fixture 声明新增视觉／电脑宿主变量；保留 `UNSUPPORTED_CAPABILITY`、拒绝传递、原 scope 与后续参与者断言。随后新增的生产访问语义另做 Runtime 编译与 7/7 focused，未重跑整条门禁。40 项 skip 保持未运行，不能计作通过。

| 表面 | 状态 | 仍需的独立证据 |
| --- | --- | --- |
| 完整安装器／卸载器、普通用户干净 OS、签名与发行 | `not_run` | 实际安装、运行、升级／回退／卸载；E06 只证明当前机器隔离 .NET 后的初始化 |
| 多屏、跨屏 DPI、显示拓扑变化、任意应用控件兼容 | `not_run` | 原目标守卫与坐标命中、拒绝与恢复回执 |
| 物理用户接管与端到端停止时延 | `not_run` | 真人输入和真实桌面观察；E01 的外部输入由独立夹具注入，1ms stop 回合不是物理人全链延迟 |
| UAC／安全桌面／提升进程现场 | `not_run` | 普通权限实际拒绝记录；源码守卫不能替代现场 |
| 新 PR511 镜像正式 AgentArts deployment | `not_run` | 平台读回 deployment／version／image digest、API／trace；本地 ARM64 容器加云模型不等于该部署 |
| 真实站点／账号业务、一般文件下载内容处理 | `not_run` | 对应授权的业务后置读回；合成网页和附件不足以证明 |
| 任意视觉 grounding／置信度控制／原生自绘视觉操作 | `not_run` | 明确模型能力和真实目标读回；本轮视觉工具仅产生不可信描述 |
| 断电／跨进程未知写入的外部业务核实 | `unknown`／按原任务待核实 | 受支持的原 run 外部读回；不能通过新 run、换引擎或重启试做 |
| 当前全工具、全模块或比赛 Golden Path | `not_run` | 不同模块各自生产接线和比赛平台链；本线回执不提升其他 MOD |

提交／PR／合并状态：电脑操控工作包未提交、未推送、未创建对应新 PR；PR511 是用于联合测试的镜像来源，不是本工作包已纳入其 head 的声明。最终交付在补齐或明确保留 pending 后由集成负责人更新本页；当前不得将任一包含未验真实环节的完整工作包改为 `done`。

2026-10-24 主集成补充：91 文件补丁已进入 `f809` 主集成树，并保留默认对话、团队与内存优化的共享接线；本页原独立树回执及失败不改写。65 项目录现由主树的按需发现处理，原 64 项／24 KiB 单次门槛保留，65 项原 Runtime／Policy 回归通过。主树默认桌面真实工作区修复另有独立成功回执，但不替代电脑／视觉的现场矩阵。当前新增 WSS 只读恢复、父子完成校验及最终组合结果统一见[主实施记录](competition/PROGRESSIVE_EXECUTION_20261024.md)，安装发行、多屏和物理接管仍保留上述 `not_run`。
