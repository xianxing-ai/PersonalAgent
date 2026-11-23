# Z-09 · #17 通知冷激活与补偿接线（本地增量）

Profile：`huawei_ict_agentarts`。工作树：`.worktrees/zemeng-owned-image-remediation-20261119`。

## 范围

- **#17**：中风险执行后的桌面通知，在无内存 `Notification` 对象（冷启动 / Action Center）时仍能按 Tag 复现点击 → `riskAutonomyHost.compensate` → 导航。
- 附带修复 **#21 相关 IPC**：主面板/工作台 `mountBriefingPanel` 的「查看审批卡」原先被 `briefing.openDecision` 仅允许 admin 拦截。

未宣称：#05 复杂工作区真机证据；Action Center 真人手点录屏（生产激活路径已接，见收口回执）。  
收口见 `Z09_RECOVERY_REPLAN_PLUGIN_NODECHECK_20261120.md`（#17 recovery+读回 / #19 Crew 派发 / #25 最小权限正例 / #649 诊断+编辑器打开）。

## 行为

1. 逻辑通知 id（可含 `:`）映射为 32 位十六进制 `nativeTag`（Windows Tag 仅字母数字），落盘到 `desktop-notifications.json`。
2. 默认 notifier 在 win32 写入 `id=nativeTag`，并用 `toastXml` 的 `launch="type=click&tag=…"` 携带 Tag。
3. `activateById` / `activateByNativeTag` 复用与热路径相同的点击语义（已读、`onClick` 补偿、`onNavigate`）。
4. `main.js` 在装配通知端口后注册 `Notification.handleActivation`，解析 arguments 后调用 `activateByNativeTag`。
5. `briefing.openDecision` 允许 `admin` / `panel` / `workspace` 主框架。

## 验证

```text
node --test apps/desktop/test/notification-cold-activation.test.mjs \
  apps/desktop/test/desktop-notification-port.test.mjs \
  apps/desktop/test/risk-autonomy-settings.test.mjs \
  apps/desktop/test/daily-briefing-chain.test.mjs
```

真实 OS toast 点击与独立 SQLite 读回仍待真机回执；本包 Fake notifier + 落盘重开覆盖冷激活补偿闭环。

## 同树续：#05 内容围栏（2026-11-20）

- `content-fence-product.js`：本地 `workspace.*` / `coding.*` 写入不再染毒；`workspace.npm_test|node_check|npm_build|git_diff_check|run_allowed_command` 授权豁免。
- 定向：`apps/desktop/test/content-fence-product.test.mjs`（含 patch→npm_test）7/7 通过。
- 仍缺：复杂真实工作区真机联合证据。
