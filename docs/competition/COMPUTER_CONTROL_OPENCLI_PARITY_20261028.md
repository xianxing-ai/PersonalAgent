# 电脑控制对齐 Codex Computer Use 效果（2026-10-28）

目标 profile：`huawei_ict_agentarts`。基线：[PR #525](https://github.com/xianxing-ai/PersonalAgent/pull/525) / [PR #522](https://github.com/xianxing-ai/PersonalAgent/pull/522)。工作树：`.worktrees/sync-latest-20261028`，分支 `codex/computer-use-parity-20261028`。

## 效果定义

本轮对齐的是用户侧「看见 → 操作 → 独立读回 → 续答」的可用效果，不是把工具面改成 Codex 全屏坐标 / `computer_zoom` API。继续沿用 ADR-0039 的 UIA / DOM ref、Runtime、Policy、ToolGateway、Evidence 与共享输入 lease。

## 本轮实现

1. **OpenCLI 双 DNS / origin**：`assertOpenCliPublicUrl` 对齐 `browser.*`：先 `assertPublicBrowserUrl`，再独立第二次 DNS；打开、观察与写入前均再校验授权 origin，离开授权网站仍拒绝读写。
2. **click 独立读回**：`browser.connected.click` 在动作后强制独立 observe；同一控件 `actionRef` 或同站导航变化记为 `fieldVerified=true`，否则 `RESULT_UNKNOWN` 并阻塞后续写入。另提供只读 `browser.connected.wait`（最多 2 秒后重观察）。
3. **扩展引导**：设置页增加「检测现有浏览器扩展」；`computer.control.probeConnectedBrowser` 只跑只读 doctor，不装扩展、不提权。未连通时投影固定安装说明。准备组件时也会尝试只读探测并写入快照。
4. **本机 click 验收入口**：`apps/desktop/test/opencli-browser-click-acceptance.mjs` 在已连通扩展时打开公共页、点击同站控件并写 `.cache/computer-control-live/opencli-click-device-receipt.json`。

## 获授权整链（手册）

以下步骤依赖用户本机授权／F9，不能用 Fake 冒充通过：

1. Desktop 启用电脑操作，允许目标窗口观察出口；准备组件；点「检测现有浏览器扩展」确认连通。
2. 主对话提交需要操作现有浏览器的 Competition 任务（明确公共站点与动作）。
3. 原会话出现授权／在场卡后，由用户确认；不代按 F9。
4. 任务应选择 `browser.connected.open/observe/type/click`（或既有独立 `browser.*`），完成独立读回。
5. 核对 Runtime Evidence 与云端最终回答；失败保留原状态，不自动换 Playwright 重做。

## 证据与限制

- 聚焦自动化（本工作树）：`opencli-browser-host` + `computer-controls` + `task-progress` 共 38/38 通过；架构门禁 3/3 通过。不以完整 Desktop 套件代替本摘要。
- 本机扩展探测：`probeOpenCliExtension` / doctor 在本机返回连通（`connected:true`）。
- 本机 click 脚本：2026-10-28 在本机执行 `opencli-browser-click-acceptance.mjs`；扩展已连通，但系统 DNS 将 `www.wikipedia.org` / `example.com` 解析到 `198.18.0.0/15`（常见于本地 Fake-IP 代理），被既有 `isPublicBrowserAddress` 正确拒绝。收据：`.cache/computer-control-live/opencli-click-device-receipt.json`（`ok:false`）。这证明双 DNS 公共地址守卫生效，不构成真实同站 click 通过。
- 获授权云端模型代理 + 本机发布镜像联测（2026-10-28 用户登录 AgentArts 控制台后继续）：**passed**。从控制台读出运行时环境（不入 Git／聊天），本地 `docker run --platform linux/arm64 personal-agent:computer-fix-23161679-20261027` 监听 `127.0.0.1:18080`，再跑 `tests/manual/agentarts/computer-control-joint.mjs`。任务 `fe9a7576-b537-48ba-8909-1b2879779ef8` 终态 `succeeded`；6 次镜像 `/invocations` 均为 200；5 次 `allow_once` 审批；确认工具 `browser.open` / `type` / `click` / `observe` / `screenshot`；独立 DOM 读回与本机 PNG 截图均通过。收据：`.cache/computer-control-live/opencli-cloud-chain-receipt.json`（`cloudChain:passed`）与 `.cache/computer-control-joint/<runId>/receipt.json`。模型路由记录为 `agentarts-proxy-direct`（本机镜像直连云端推理代理）；**不是**正式平台新部署读回，也**不是** Desktop 内 OpenCLI `browser.connected.*` 公网整链。
- OpenCLI 公网站点 click / 正式 Desktop Competition 会话整链：仍 **blocked**（Fake-IP `198.18.0.0/15`、Desktop 未跑）。不以本次 Playwright 合成页联测冒充该路径通过。
- 跨站流程、安装器内置扩展、正式平台部署、任意坐标 grounding：仍未验收。
- 不宣称 provisional 升为 frozen，不宣称已达 Codex 坐标 API 或安装器／多屏 DPI 级完成。控制台曾展示运行时密钥明文；测后应在 AgentArts 轮换相关凭据。

### 仍待恢复的 OpenCLI / Desktop 入口

1. 关闭 Clash Fake-IP／换真实公网 DNS 后，启动已配置 AgentArts 的正式 Desktop，在主对话提交现有浏览器任务并确认在场；再复跑 OpenCLI click 与会话读回。
2. 正式平台部署读回（deployment/version/trace）仍单独验收，不由本机镜像联测代替。

前序 OpenCLI 接线记录见 [COMPUTER_CONTROL_OPENCLI_20261027.md](COMPUTER_CONTROL_OPENCLI_20261027.md)。
