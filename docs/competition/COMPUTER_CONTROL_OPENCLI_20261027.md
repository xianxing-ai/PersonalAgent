# 电脑控制与 OpenCLI 接线

目标 profile：`huawei_ict_agentarts`。工作树：`D:/worktree/9933/PersonalAgent`。

按用户提供的 `03_COMPUTER_CONTROL_ARCHITECTURE.md` 保留 Runtime、Policy、ToolGateway 与 Evidence，复用现有 Windows 原生驱动、Playwright 和 OpenCLI 的执行能力，不接入另一个 Agent 循环。

本次定位的现场等待是 `computer.request_access` 在受限策略下等待真人在场。主对话此前仍显示 `cloud coordination`；现在消费 Main 已按原会话过滤的电脑状态，明确显示等待原因。该投影不修改 Runtime 终态，不签发授权。

新增 Desktop 生产依赖 `@jackwener/opencli` 固定 1.8.6（Apache-2.0），复用官方公开 `browser/page` API。现有设备的扩展 1.0.26 已经通过官方 doctor 连通测试。安装使用 `--ignore-scripts`，不运行上游适配器下载脚本；只用浏览器核心，不暴露任意 CLI、JavaScript、CDP、Cookie、上传或系统命令。

新增 `browser.connected.open/observe/type/click`，在用户浏览器中新建本任务标签，复用该浏览器的登录状态。现有 `browser.*` 独立 Playwright 路径保留，不在一个写入失败后换驱动重做。只允许公共 HTTP(S) 入口；观察与动作限定原任务、新标签身份、原网站、短期控件观察与有效访问/出口许可。代码拒绝 password/file/hidden 类型，以及 autocomplete 标记为 password、one-time-code、cc-* 的输入；这不代表能识别所有未标记的登录、验证码或支付页面。浏览器共享会话不是网络沙箱，站点自身重定向仍由浏览器执行；离开授权网站后禁止读取页面和继续动作。

OpenCLI 执行放在自有 Node 子进程；取消/期限到达/停止终止该进程，阻止库继续发起后续请求。已经发送给扩展的动作可能完成，不能撤回；无法确认时保留原 Runtime unknown，禁止后续写入，重启也不清除该状态。不会停止共享 OpenCLI daemon 或关闭用户浏览器。此变更不迁移数据库、不更改原授权策略。

安装应用依赖不等于自动安装浏览器扩展。当前使用设备已安装扩展；发行时须提供官方扩展引导并保留浏览器自己的安装授权。真实生产接线、代码测试、实机输入与云端整链结果分别记录，不把 doctor 连通视为任务通过。

## 本次证据与限制

- 2026-10-27 14:51:27 UTC，当前 Windows 设备、OpenCLI 1.8.6 + 已有扩展 1.0.26：真实打开 Wikipedia，在唯一空搜索框输入 `PersonalAgent 验收 20261027`，独立重新观察同一 DOM 元素并核对文字、未提交搜索。最终样本 2416 ms；这是浏览器驱动单次实测，不是云端任务延迟或 P95。原始回执在本工作树 `.cache/computer-control-live/opencli-device-receipt.json`，包含源码 SHA-256。
- 受影响 Desktop 测试：2224 项，2214 通过、10 跳过；根集成 57/57 通过。首次 `npm run check` 的两个退出生命周期测试曾失败，已修复并重跑完整 Desktop 与根集成；首次命令的退出码仍保留为 1，不标成原命令成功。其前置架构、契约夹具、生成检查、类型检查及其他 workspace 测试通过。之后的小范围读回身份与布局修复另做聚焦测试、架构/语法检查与真实桌面观察。
- 真实 Competition 请求已经进入本机授权/在场等待；修复子任务授权没有进入原会话卡片的问题，并把本机等待解释固定在面板历史滚动区外。用户选择暂不确认；未代按 F9、未更改只读策略，测试请求通过原 UI 停止并读回 cancelled。
- 新增工具未完成获授权后的整条 AgentArts → Runtime → 浏览器 → 云端最终回答验收。不能据此宣称原 `EXTERNAL_FAILURE` 全链消除，或已具备 Codex 等效能力。真实浏览器 click、复杂跨网站流程、安装包自带扩展、原生桌面写入仍未验收。
- 此增量是 Desktop 本机依赖与接线，没有更改云端镜像代码；本机已重启加载。没有把本次本机启动描述为新云端镜像发布。
