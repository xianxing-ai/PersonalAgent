# 审批卡简化：UI 与真实 DOM 验证

- Profile：`huawei_ict_agentarts`。
- 工作树：`D:\worktree\f809\PersonalAgent\.worktrees\connector-real-completion`；分支 `codex/connector-real-completion`。
- 集成基线：普通合入主控 `71715c7c`，本树合并提交 `39918d61f5e2cfe982f134593988acd4a08fefd6`。记录时间 `2026-10-22T06:04:02Z`。
- 所有权：统一 question 卡、同视图旧 Runtime approval 卡、相关 CSS、DOM helper、直测与专用 UI runner。未修改 Electron 授权 host、Runtime、Policy 或 AgentArts 提示词。

普通卡只显示目的、原 requirements 的必要摘要、“同意 / 拒绝”两按钮；没有永久选项、必填确认词或额外选择。原三类 requirements 继续由原卡合并，技术权限、隔离状态、期限和完整说明放入默认收起的原生 `details`。快照刷新保留详情展开和键盘焦点。

“同意”仅当可信快照同时提供 `canReuseTask === true` 与 `suggestedDecision === 'allow_task'` 时提交 `allow_task`；其余情况提交 `allow_once`。UI 不推断资源稳定性或复用资格，不创建规则或 grant。“本任务相同范围不再询问”只在实际选择任务内决定时出现在详情。旧永久决定的响应函数兼容保留，普通卡不暴露该入口。

拒绝直接提交原 `questionId / expectedRevision / deny`。旧 Runtime 卡继续提交原 `approvalId / taskId / expectedRevision / decision`。失效、取消、已处理与重复点击仍不能复用原决定；UI 只展示宿主的决定回执，不宣称工具已经完成。

## 已验证

| 验证 | 结果与边界 |
| --- | --- |
| `node --test apps/desktop/test/authorization-question-card.test.mjs apps/desktop/test/approval-card.test.mjs` | 16/16，0 skip；覆盖最小默认决定、任务内决定、拒绝、旧卡绑定、失效/版本变化、重复提交、已接受决定后的刷新失败、转义、去重与详情焦点 |
| 两个 UI runner 的 `node --check`、`git diff --check` | 通过 |
| `authorization-card-dom-smoke.cjs` | 真实 Electron/Chromium DOM 与 question CSS，显式 Synthetic host 回执，7 项交互阶段通过，`consoleErrors=[]`；模型/账号/工具调用均为 0 |
| 渲染检查 | 已查看 `01-compact.png` 与 `02-decisions.png`，双按钮与收起详情可见；旧卡是组件 DOM，本 runner 未加载整个产品外壳样式 |

真实 DOM 命令（沿主控许可复用现有依赖，未安装）：

```powershell
$env:PA_TEST_REPOSITORY='D:\worktree\f809\PersonalAgent\.worktrees\connector-real-completion'
$env:PA_TEST_ELECTRON_EXE='D:\PersonalAgent\node_modules\electron\dist\electron.exe'
$env:NODE_PATH='D:\PersonalAgent\node_modules'
node apps/desktop/test/authorization-card-dom-smoke.cjs
```

首次沙箱内 Electron 启动失败，按工具许可提升后运行通过。runner 的 HTTP(S) 请求全部取消，只关闭自己的 app。安全截图与原始回执保留在本工作树 `.cache/authorization-card-dom/case-8od8T2/`；可提交摘要见同名 `.receipt.json`。

## 尚未验证与接口限制

- 更新了既有 `authorization-question-product-smoke.cjs`：移除永久批准路径，独立 intent 各自走原卡，检查无二次 modal、无必填和无永久规则。该真实 Main/Runtime/preload/renderer 宿主链本次 `not_run`，待主控集成并构建新的任务内决定后串行执行。
- 上述真实 DOM 验证使用 Synthetic host 回执，不证明后端任务内复用、真实业务或真实模型闭环。
- 旧 approval DTO 只有工具 action、scopes 和固定 `argumentSummary='redacted'`，不能从中得出自然语言目标或原参数。旧卡保留公开 action 作为目的，scope/期限收在详情；更自然的摘要需要可信 host 另行提供脱敏 purpose/summary，或使用统一 question 投影。未读取原参数。
- conversation/admin/app UI 未发现 `confirm()` / `showMessageBox()` 调用。安装 Skill 与 Vault 文案仍引用任务确认/原生确认，后端另有相关管理确认入口，已向主控交接；系统登录、原生 OS 权限与设置重载保护未改动。

这是授权卡 UI 工作包的局部交付，不把 Synthetic 回执或 DOM 通过标成整个产品审批链完成。
