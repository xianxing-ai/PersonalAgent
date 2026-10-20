# PR #376 审查问题修复

目标 Profile：`huawei_ict_agentarts`。工作包为 Desktop / Runtime Application 审查回归修复，基线 `0ef08645`，分支 `codex/fix-pr376-ui-regressions`。原 PR #376 已合并；本增量不代表修复已经集成 main 或发布。

2026-10-18 补交为 PR #404（`codex/publish-pr376-regressions-20261018`），依赖窗口/拖拽 PR #403 及其冷启动父 PR #398，保留上游的 WSS 条件表单和已有空目录修复；同步 main `0b671afc`。上游已修复空目录的同一问题，不将其作为本增量重复实现。原生 WSS 测试现在先选择 WSS 再填写条件显示的令牌，保留原凭据清空及配置读回断言。

本次新证据：构建及定向测试 61/61、原生回归 13 场景通过。完整 `npm run check` 已实际执行，Desktop 1134 项中 1128 通过、6 跳过、0 失败；Runtime 753 项中 751 通过、2 失败，均为 F15 main/shadow 停在 `waiting_reconciliation`，完整检查退出 1，末尾集成步骤未执行。不能宣称该合并头全仓通过，PR 保持草稿等待 F15 问题与必需 CI 解决。日志 `.cache/publish-pr376-full-check-20261018.log` 保留。下方完整检查、计数和烟测属于 2026-10-17 原分支的历史验收，不能替代本次失败结论；本次没有真实云验收。

## 修复与接线

| 问题 | 修复后的行为与实际调用方 |
| --- | --- |
| 新安装或目录加载失败时，空目录/偏好导致整个对话视图渲染失败 | `nativeReasoningState()` 只采用与当前目录 revision 一致且存在的默认偏好；面板、工作区在缺目录时保留可用页面并禁用原生强度选择。 |
| 连接器/责任通知配置被全局广播覆盖 | `mountNotificationSettings()` 分离当前范围策略和通知中心广播；保存携带所读范围的 revision，输入及请求进行中不被后台快照覆盖。 |
| 归档列表展开后挤压输入区、尾项不可达 | 面板明确四个网格行；归档内容和唤醒说明各自限高滚动，模型浮层保留可点击和内部滚动。边界取逻辑视口比例，不使用本机分辨率或 DPI 常量。 |
| 模型页面无法完成 WSS 入站凭据和固定版本配置 | 原 `agentarts.configure` 表单增加 `appToken` 密码输入、`deploymentVersion`；继续由原主进程校验和 safeStorage 加密。密钥不回显，提交后清空，留空保留同实例已有密钥。 |
| 原生关闭窗口时，800ms 防抖尚未落盘的草稿丢失 | 面板/工作区 `beforeunload` 经 Preload 的私有 `desktop:draft-close` 同步写入原 Conversations v4；同窗口主 frame、对话归属、重复/额外字段和原长度限制都须通过后一次落盘。写入失败阻止关闭并保留文本供重试。正常输入继续异步防抖。 |
| 升级前已显示的 Todo 无法关闭 | 只有拥有新 batch 身份的通知才向原 NotificationService 确认已读；旧本机条目可持久关闭，不补造 feed、投递或 toast。新记录丢失原 feed 时仍明确失败。 |
| 主动镜像 HTTP describe/advance 丢失固定部署版本 | Desktop 根组合把原可信传输的版本和 `assertDeploymentBinding` 交给原适配器；HTTP 请求保留同版 endpoint，凭据读取前和真正发送前都检查绑定。配置变更拒绝，结果未知不重发。 |

冒烟测试还暴露了 Fake Runtime 的任务被送去查询独立 Runtime Application 子任务库的问题。快照现对显式 Fake 返回空子任务列表，使联调任务提交/停止恢复；生产 Competition 子任务投影路径保留。旧冒烟导航断言同步到当前已有的“通知”和“任务监控”入口，不删除检查。

没有新增依赖、Core wire、任务循环或数据库迁移。Runtime 适配器增加的可选可信配置与私有关闭 IPC 保持 provisional，不提升能力冻结或真实服务验收等级。文件写入仍复用原原子保存；代码回退前应保留现有 Conversations v4 数据，不能让不支持 v4 的历史版本直接读写。

## 验证

使用仓库要求的 Node 24.15 / npm 11.12；Windows Host 验证使用 .NET 8。每个 Electron 场景使用项目内独立 userData，与日常用户数据隔离。

- `npm run test:pr376-smoke --workspace=@personal-agent/desktop`：13 个场景通过。实际 Electron 页面、生产 Renderer/Preload、实际 Conversations 文件和配置宿主；safeStorage、目录/通知/模型服务为明确离线替身。
- 布局覆盖 420×720、600×720、420×600 与 100% / 125% / 150% 缩放组合，交替浅/深主题，20 个长名称归档；检查最后一项可滚动、线程不压住输入区、模型菜单在视口内并能命中控件。9 份原生截图与 JSON 回执在 `apps/desktop/.cache/pr376-regressions/run-*/`。
- 原生 `BrowserWindow.close()` 紧接输入后执行，由测试进程读回原文件检查最新草稿；注入最终写入失败时窗口和草稿保留，再明确重试关闭。此处不冒充实际 Alt+F4、断电或强制结束进程验收。
- 单元/集成回归覆盖空目录、旧提醒关闭及重启、新 feed 缺失、草稿原子保存与拒绝越界 frame/对话、部署变更发生在凭据等待期间禁止发送。
- `npm run build`：通过。最终串行 `npm run check`：退出码 0，包含架构、契约夹具、生成类型、类型检查、工作区测试和集成测试；各测试汇总共 3,892 项，3,857 通过，35 项按既有条件跳过，0 失败。
- `npm run test:smoke --workspace=@personal-agent/desktop`、`npm run test:workspace-smoke --workspace=@personal-agent/desktop`、`npm run test:text-smoke --workspace=@personal-agent/desktop`、`npm run test:runtime-application-smoke --workspace=@personal-agent/desktop`：四项均通过。
- 首轮全仓检查曾出现 `apps/agentarts-runtime/test/proactive-controller.test.mjs` 文件级进程失败，仅报告 `test failed`，没有具体断言定位。同文件与新增回归隔离重跑 34 项通过，最终完整串行检查也通过；没有删除测试或放宽断言来处理该失败。原始与最终日志保留于本工作树 `.cache/check.log`、`.cache/targeted-retest.log`、`.cache/check-final.log`。
- `git diff --check`：通过。工作包代码及本地验证可交付审查；独立批准、合并、真实云端验收与发布分别处理。

本轮不修改云镜像或工作流，不部署、不运行真实华为评测集、收费推理或物理音频。新增测试验证本地 UI、持久化和 HTTP 路由/绑定；云版本实际调用和设备验收仍需相应真实环境及授权，不能从这些测试推导已通过。
