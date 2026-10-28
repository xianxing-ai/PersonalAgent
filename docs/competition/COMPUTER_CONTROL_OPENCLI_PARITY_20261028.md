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

云端整链本轮默认 `not_run`（未获另行授权实跑）。本机 doctor／click 收据不等于 Competition 最终验收。

## 证据与限制

- 聚焦自动化（本工作树）：`opencli-browser-host` + `computer-controls` + `task-progress` 共 38/38 通过；架构门禁 3/3 通过。不以完整 Desktop 套件代替本摘要。
- 本机扩展探测：`probeOpenCliExtension` / doctor 在本机返回连通（`connected:true`）。
- 本机 click 脚本：2026-10-28 在本机执行 `opencli-browser-click-acceptance.mjs`；扩展已连通，但系统 DNS 将 `www.wikipedia.org` / `example.com` 解析到 `198.18.0.0/15`（常见于本地 Fake-IP 代理），被既有 `isPublicBrowserAddress` 正确拒绝。收据：`.cache/computer-control-live/opencli-click-device-receipt.json`（`ok:false`，`cloudChain:not_run`）。这证明双 DNS 公共地址守卫生效，不构成真实同站 click 通过；需在解析到真实公网地址的网络环境下重跑脚本。
- 获授权云端整链：本轮 `not_run`（未获另行授权代按 F9 / 实跑 Competition 终答）。
- 跨站流程、安装器内置扩展、正式平台部署、任意坐标 grounding：仍未验收。
- 不宣称 provisional 升为 frozen，不宣称已达 Codex 坐标 API 或安装器／多屏 DPI 级完成。

前序 OpenCLI 接线记录见 [COMPUTER_CONTROL_OPENCLI_20261027.md](COMPUTER_CONTROL_OPENCLI_20261027.md)。
