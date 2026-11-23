# 前端设计验收与完善 · 交接给 Gemini

2026-11-20。本轮由 Codex 把前端工作完整交给 Gemini；Codex 改做其他 Z 系列剩余项。  
总览仍见 [Z_SERIES_AND_DESKTOP_HANDOFF_20261120.md](./Z_SERIES_AND_DESKTOP_HANDOFF_20261120.md)。

## 目标

在正式桌面配置上验收并完善新前端，对齐设计参考图，修已知测试失败，再做真机走查。

## 工作树与分支

| 项 | 值 |
| --- | --- |
| 工作树 | `D:\worktree\e84d\PersonalAgent\.worktrees\image28-live-acceptance` |
| 分支 | `codex/image28-live-acceptance` |
| HEAD（已提交基线） | `ac9a2552e6ae75b180b23197fc2394acd1a7c5a9` |
| 本轮改动 | **未提交、未推送**；大量 desktop/runtime 本地修改仍在工作区 |

不要在本树做 Z-01 镜像推送、SWR、AgentArts「最新」切换；那些归 Z 系列其他任务。

## 设计参考图

目录：`C:\Users\24035\AppData\Local\Temp\`

| 用途 | 文件 |
| --- | --- |
| 三栏主布局（左会话 / 中对话 / 右资料） | `codex-clipboard-2d888bec-5ff1-498e-a9cb-461112e3096f.png` |
| 右栏内容（星球、知识库、订阅、通知、最近活动） | `codex-clipboard-0de8514a-c4a6-4591-bb52-a7e2be9c91be.png` |
| 输入条（压缩、持续目标、模型、思考档、麦克风、Live） | `codex-clipboard-4890ce34-e0cd-4dc2-a566-666889de1d96.png`、`codex-clipboard-0882f2a1-28ce-489c-ac65-ebe04c4c37a5.png` |
| 其他剪贴板图 | 同目录其余 `codex-clipboard-*.png`（含授权失效红字、记事本写入页等，多为旁证，不是本轮布局主图） |

## 已落地能力（相对本工作树）

| 区域 | 位置 |
| --- | --- |
| 大小主对话回复合流 | `result-text.js` → `mainChatReplies`；`main.js` → `compactSubagentTasks`；小窗 `renderer.js`；大窗 `view.js` |
| 三栏工作区 | `command-center.js`、`inline-subagents.js`、`context-sidebar.js` / `.css`、`command-center.css` |
| 输入条控件 | `model-thinking-picker.js`、`workspace-composer.js` / `workspace-composer.css`、`runtime-controls.js`、语音相关 electron 宿主 |
| 右栏 VPS「电脑」 | `context-sidebar.js`、`remote-runners.js`、`remote-runner-host.js`；IPC `runner.hosts.list` / `runner.hosts.test`（正式配置当前 **0 台**） |
| 卡顿优化 | `snapshot-publisher.js`；`main.js` 的 `refresh` / `pumpEvents` / 窗口投影；小窗去掉逐次读后台任务 |

占位符已设为「说要做什么…」；压缩 / 持续目标 / Live 已接到 composer actions。

## 已知测试失败（2026-11-20 本机复现）

命令（在本工作树、Node 24 工具链）：

```powershell
$paNode = 'D:\worktree\679a\PersonalAgent\.cache\toolchains\node-v24.15.0-win-x64'
$env:Path = "$paNode;$env:Path"
Set-Location 'D:\worktree\e84d\PersonalAgent\.worktrees\image28-live-acceptance'
node --test apps/desktop/test/panel-event-readback-order.test.mjs apps/desktop/test/conversation-ui.test.mjs
```

结果：23 测中 19 过、**4 失败**。

### 1. `panel-event-readback-order.test.mjs`（3 项）

- **`visibleConversationTask is not defined`**（取消路径 2 项）  
  `main.js` 的 `task.cancel` 路由现已调用 `visibleConversationTask`；测试 `fixture` 用 VM 抽出该路由，但未把 `visibleConversationTask`（及可用的 `admin` / `workspace` / `conversations`）注入 context。  
  建议：在 `fixture` 中抽出并注入 `visibleConversationTask`，或提供恒真替身，并保证 `sender === panel` 时可见性检查通过。

- **发布次数期望 2、实际 4**  
  `pumpEvents` 恢复路径改为 `publish(['recovery'])`；`refresh` 在任务投影未变时可跳过发布（依赖 `TaskProjectionCache.version`）。测试仍用普通 `Map`，且 fixture 的 `publish` 对 `recovery` 也计数。  
  建议：fixture 使用 `TaskProjectionCache`，或让 `publish(['recovery'])` 与生产 `snapshot-publisher.js` 一样在无脏窗口时不计数；再按真实语义调整断言。

### 2. `conversation-ui.test.mjs`（1 项）

- 用例：`native reasoning tolerates missing/loading/unavailable catalogs…`  
  期望 `nativeReasoningState(...).modelId === 'a'`（目录 `defaultModelId`），实际 `'b'`（陈旧 `preferences.defaultModelId`）。  
  根因候选：`native-reasoning.js` 中 `useDefaults` 在 `preferences` 存在时即采用偏好，**未校验** `preferences.catalogRevision === catalog.revision`。  
  建议：仅当 `defaults.catalogRevision === catalog.revision` 时采用偏好默认；否则回落目录默认（与测试及「不采用陈旧默认」语义一致）。

## 真机验收清单（尚未做）

正式配置目录：`D:\PersonalAgentDesign\.cache\z01-f20-desktop-profile`  
已有 F20 记录：主任务 `860c0551-9c70-4052-af49-c1c222e63a5e`，子任务 `25625000-b1be-4a4b-88bc-f1aae0c6e038`。

启动：

```powershell
$paTree = 'D:\worktree\e84d\PersonalAgent\.worktrees\image28-live-acceptance'
$env:PA_USER_DATA_DIR = 'D:\PersonalAgentDesign\.cache\z01-f20-desktop-profile'
$paNode = 'D:\worktree\679a\PersonalAgent\.cache\toolchains\node-v24.15.0-win-x64'
$env:Path = "$paNode;$env:Path"
Start-Process -FilePath "$paTree\node_modules\electron\dist\electron.exe" -ArgumentList '.' -WorkingDirectory "$paTree\apps\desktop"
```

走查顺序：

1. 小窗读回 F20 结论（文档复核 + 隔离 TS 编译退出码 0）。
2. 展开大窗，核对同一条消息与子任务结论回贴。
3. 左栏切换主对话 / 助手 / 子对话。
4. 输入条：压缩、持续目标、模型、思考滑块、麦克风、Live；有文本时发送按钮替换 Live。
5. 右栏：动态 / 资料库、星球、知识库、订阅、通知、最近活动、电脑（无主机时显示未登记）。
6. 发送、授权卡、反复展开收起的响应与卡顿感。
7. 设置页、子助手独立会话列表（交接表称尚待整体验收）。

注意：若启动后出现红字「授权无效或已失效… `[stage=runtime; code=UNAUTHORIZED]`」，先核对正式配置里 AgentArts / Runtime 令牌，再谈 UI；不要用假数据掩盖。

## 待用户指定摆放的已有能力

见总交接表「已有功能，待用户指定摆放位置」：异步子助手 pause/resume/instruct/redirect/handoff、记忆学习、Harness 经验、风险自治、个人看板、工作流回放配置。Gemini 不要擅自改产品信息架构塞进三栏，除非用户指定位置。

## 边界

- **做**：本工作树前端 UI / 桌面接线 / 上述失败测试 / 真机走查与文档回写。
- **不做**：Z-01 推 SWR、云端「最新」、Z-10 PR `#689` 合并、28 图桌面总入口（依赖 PR `#681`）、其他 Z 系列后端能力。
- **保留**：工作区内他人未提交改动；提交仅在用户明确要求时做 scoped commit。

## 建议完成回报格式

1. 测试：上述 4 失败是否已绿，命令与结果。  
2. UI：相对三张主设计图还差什么（有则列文件）。  
3. 真机：清单 1–7 逐项通过/阻塞原因。  
4. Git：是否仍未提交；若提交，写明 hash 与范围。
