# Developer harness 关机交接

用户于 2026-10-20 明确要求提交全部当前成果，并把全部工作移交 Codex 对话「同步仓库」继续，本机即将关机。本地已停止测试和实现；本记录不表示产品验收完成。

## 唯一继续入口

- 接手对话：`01a10ad8-d69c-75e5-8803-c56acd98d014`，host `durable`，标题「同步仓库」。已发送完整交接消息；原临时禁止该对话写入 #451 的限制由用户本次移交撤销。
- 仓库：`zemeng5208/PersonalAgent`，PR #451，分支 `codex/developer-harness`。
- 已推送产品源码：`5542972e47babab66601d8ea56477a66b71c00bf`；tree `980cd802e906bd82779785984ac413a80c724c57`；包含 main `93e00889e20d4cfa1f7122f16870aea4e5fc6348`。
- 本地工作树：`D:/worktree/24cd/PersonalAgent/.worktrees/developer-harness`。云端接手者应从 GitHub 获取，不能依赖本机路径或忽略缓存。
- 交接文档与验证记录的后续提交只补证据，不改上述产品源码。PR 保持 Draft，未自行批准或启用自动合并。

## 用户约束

1. 主对话只负责交互、委派、汇总，实际工作经持久子智能体；不能加入 root 直答/直接业务执行例外。
2. 参考 upstream 方法自行实现，不改成第三方 harness，不复制其源码或提示。
3. 必须完整交付，全部修改提交 PR。先完成源码和实际调用方，只做必要小回归，再统一验证。
4. Competition Profile `huawei_ict_agentarts` 保持原 Runtime/TaskRuntime、ModelGateway、ToolGateway/Policy、审批与 Evidence 权威；不新增 Local 回退或第二任务库/调度器/授权系统。
5. #445 研究相关度与真实来源回执已有负责人，不重复处理。#407 缺 `ci-source-39407015256-2` 工件问题明确排除；本轮没有调查、修复或重跑它。
6. 真实付费模型、账号、云部署、麦克风、系统登录项与实体设备未由本轮工程测试证明；不自动使用本机凭据，不伪称真实验收。
7. 保留其他协作者及工作树。Git 只普通合并/推送，不 force/reset/rebase 覆盖。当前提交必需技术 CI、严格主线与有效非作者批准仍是正常合并条件。

## 已保存的源码范围

- H1 原生开发 DAG/角色/预算、原审批续接、deadline/cancel、根对话强制 user-work，以及当前配置与原执行模型绑定。
- H2 原设置页中的模型/摘要/Harness/事件/开发宿主/经验控件、可信摘要上下文、Main-only IPC、safeStorage、来源与私人上下文门禁。
- H3 canonical trial/compare/prepare-adoption/main CAS publish、恢复与唯一 provenance；锁定依赖独立复制、候选内部链接、可取消 FS worker、私有 npm 配置、安全 metadata projection、历史 published/unknown 不重放。
- H4 启动问候、持续语音、登录项与开发宿主配置源码，原安全默认和可用性边界保留。
- H5 原 learning SQLite 的经验提案/验证/激活/停止，原四 confirmed run 来源；active 经验下本人已确认发布后只允许文本完成，新工具仍拒绝，外改/撤回保原 withheld 核实状态。
- H6 原事件来源/日程/通知策略/持久 ledger 消费与启动只读恢复；修复 canonical 用户会话和同时间戳当前 head 校验。
- 启动恢复、真实 Runtime 产物身份、TaskRuntime 原子 native failed/cancelled 收敛，以及原 confirmed WSS 终态恢复。
- 公共 contracts 固定 schema ref 编译器按 path 复用；不缓存验证结果、源内容或权限。
- 普通保留并发的完整 conversation sources/prior continuations、草稿退出、native reasoning 与主线 UI 改动。

交付 PR：#449、#450、#451、#452、#453、#455、#456，另有 #444；原 #434、#407、#438、#448 状态分别查询，不用源码合入冒充各 PR 已合并。最后直接核实 #434/#407/#448 已合并；#438 当时仍 open，其他对话正在沿原 PR 处理。状态可能继续变化。

## 当前验证结果

精确运行记录见同目录 `DEVELOPER_HARNESS_VALIDATION_20261020.md`。

- 固定源码 `5542972e`：architecture 3/3、contract fixtures 4/4、generated、完整 build、全部 workspace typecheck 已通过。
- `npm run check` 在沙箱测试阶段因 `fs.realpathSync.native` EPERM 中止。项目内独立 TEMP 的同一 probe 在平台最小升级后全部通过；原 git-tools 30/30、knowledge TLS 两单例 2/2 通过。没有改断言或 timeout。
- 随后最小升级续跑 `npm run test --workspaces`，用户关机指令到达时在最后 Runtime workspace，已 Ctrl-C 停止唯一隔离 session。integration 尚未运行，完整 workspace aggregate 尚未通过，不能写单次 `npm run check` exit 0。
- Desktop 当时实跑 1496 项：1485 pass、4 fail、7 原配置 skip。其他 workspace 的完整统计以验证文档为准。
- 必要定向证据：经验 12 项最初 10 pass/2 预期错误，独立只读核实原安全 hold 语义后，两项增强精确断言并复验 2/2；completion reader 4/4、contracts 5/5；依赖/投影 13 项和私有 npm 1 项；历史发布读回修复同例由失败复现到 1/1。它们不替代最终统一检查。
- 独立子智能体在 `5542972e` 只读复核两项原 P1，限定范围内未发现剩余源码阻断；不是正式非作者 Approve，也不是实际云/设备验收。

## 六项待复核失败

### 三项 TEMP 布置造成的安全拒绝

本轮把 TEMP/TMP 放在整合仓库的 `.cache` 内，以下用例要求可信 helper/控制状态位于被编辑仓库外，实际安全拒绝正确。应使用仓库外、本任务独立 TEMP，再重跑原用例或受影响完整文件；不能放宽产品边界。

- `packages/coding-tools/test/workspace-patch-apply.test.mjs:54`，repository-root helper/recovery trusted locations。
- `apps/desktop/test/coding-tool-host.test.mjs:45`，repository-root external byte-identical helper。
- `apps/desktop/test/workspace-command-recipes.test.mjs:604`，buildNativeHelper external directory。

### 知识写入 race 夹具前置

- `packages/knowledge/test/write.test.mjs:174`：`a user edit between reconciliation reads returns unknown and retains both durable markers`。
- 实际先抛 `RESULT_UNKNOWN: Workspace patch helper identity checker is unavailable`，未进入原第 3 次 bindingCurrent/source race。栈经过 coding-tools `patch-reconcile`、knowledge `write`。
- 只读诊断：#436 `f4d0357b` 已删除额外 PowerShell 身份查询 fallback。该例只按 Windows+PowerShell 门禁，fixture 从 `PA_TEST_JOB_HOST_EXE` 注入 native checker；本机该变量 unset、Release helper 不存在。人工 `.inflight` 强制进入 `isProcessAlive/native helper` 必需分支。单有 PowerShell 已不够。
- 生产 Main → knowledge-source-config → writer 在存在真实 helper 时传其路径；缺失保持安全 RESULT_UNKNOWN/原 markers。接手者应确认真实执行前提或完善显式 Fake/Unavailable fixture 门禁，不能填无校验 noop、强置成功/unknown、删除安全检查。README 的旧 PowerShell 兼容说明也是待核事实。

### 两项旧 Main VM 上下文缺项

- `apps/desktop/test/panel-task-progress.test.mjs:82`：failed progress get preserves same-batch terminal events and cancellation approval cleanup，expected cancelled/actual waiting_approval。
- `apps/desktop/test/panel-task-refresh-order.test.mjs:49`：delayed public task.get cannot revive cancelled task，`ReferenceError: harnessEventsHost is not defined`。
- H2 已用两个精确冷用例复现。生产 Main 已声明 `harnessEventsHost`，`applyEvent` 的 `harnessEventsHost?.flush()` 合法；两个 VM 仅抽函数，未声明该 binding。optional chaining 不保护未声明标识符，导致同批后续取消/approval cleanup 被异常截断。
- 尚未应用修复。最小建议：两个 fixture context 注入显式 Unavailable `harnessEventsHost: undefined`，保生产 hook 和全部原断言。不要改 Renderer/Runtime 取消语义来迁就夹具。

## 恢复执行顺序

1. 获取 #451 最新文档提交，核对产品源码锚点、工作树和其他协作者改动。保全本对话既有云端任务，不复制本机缓存。
2. 在适用平台使用 Node 24.15 和仓库指定 npm。Windows 嵌套 npm 的继承 PATH 曾超 cmd 长度限制；只规范化测试子进程 PATH，保实际存在的必要目录，不改全局环境。
3. 新建仓库外的本任务隔离 TEMP/TMP；Windows sandbox 若阻止 realpath，走平台最小权限机制，不绕过拦截。
4. 复核/修复上述六项；有源码改动先保存 PR，再执行受影响检查。此前通过的 build/typecheck 不需因纯环境/两行 VM fixture 反复重建；源码接口变动按实际风险补必要检查。
5. 覆盖所有失败与中止后未运行项，完成 workspace tests 和 `npm run test:integration`。不要把先前 aggregate exit 1/中止隐去。
6. 执行两段最终 Desktop 验收：真实产品 renderer/preload + Synthetic IPC 的 Harness/context/events/developer/experience/停止方块交互；隔离 profile 下实际 Competition Main/preload 的模型/Harness safeStorage 保存、关闭、重开。普通和紧凑尺寸、核心截图和 receipt。无真实麦克风/登录项写入/付费网络。
7. 必要 Windows 证据应在实际 Windows 环境或合适 CI 获得。云端 Linux 不能冒充本机 Electron、safeStorage、设备或登录启动验收。原本机可复用同版 Electron 44.2.0；本机关闭后不能依赖该绝对路径。
8. 更新 PR 正文/证据，正式非作者评审和当前技术 CI 正常通过后再按授权合并。所有后续修改继续 PR 交付，不能把 Draft 或本交接当完成。

## 本机停止与保留

本轮测试原始日志位于工作树被忽略的 `.cache/harness-validation/`，诊断 VM 日志在 `.cache/panel-progress-diagnostic/`；它们未作为公开源数据上传，重要结果已在本记录与验证文档中保留。未读用户现场数据库、未用真实账号/付费模型、未开启麦克风或注册 OS 登录项。原有 `.codex`、缓存、凭据、数据库、无关工作树与他人修改不纳入本次提交，也不清理。
