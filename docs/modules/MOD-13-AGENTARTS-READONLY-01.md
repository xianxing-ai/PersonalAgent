# MOD-13-AGENTARTS-READONLY-01：Competition 后台只读配置状态

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；MOD-13 / PA-002、PA-026。
- 原实现负责人：`zemeng`；本次主分支重建：`goo122`；状态：`review`，
  待注册协作者完成非作者评审与集成。
- 基线：`main@f0867e24`；分支：`codex/desktop-agentarts-readonly-rebuild`。

后台原先在 AgentArts 模式也展示盘古编辑、测试及启停按钮，但可信主进程明确拒绝这些操作。
本项以现有可信快照中的 `model.provider === 'agentarts'` 选择只读状态页，展示 Runtime 名称与原因，
明确区分已配置和已验收。不新增配置入口、权限、公共字段或任何云调用。

主进程在初始化前即按已选择的 Competition Profile 设置 AgentArts 的不可用状态，
避免缺配置或初始化失败时继续显示盘古配置入口。只有既有初始化成功路径才标为已配置；
失败不会提升能力或改成 Local。未初始化时不沿用盘古 Endpoint、部署名或密钥配置标记。

Local/Fake 原有页面不变；主进程权限检查仍保留，隐藏控件不构成授权边界。
部署名及状态原因继续 HTML 转义；不展示密钥、凭据或未公开的 trace/version 字段。

验收：定向纯函数测试、Desktop 静态检查、基础 Electron smoke、workspace smoke 和全仓检查；不运行真实 AgentArts 云验收。

## 验证结果

当前重建分支在 Node `v24.15.0` / npm `11.12.1` 下验证：

- `node --test --test-isolation=none apps/desktop/test/agentarts-model.test.mjs`：1/1 通过，
  覆盖已配置/未配置文案、两种状态均不生成编辑控件，以及外部字段转义与凭据 canary 不展示。
- `npm run typecheck --workspace=@personal-agent/desktop`：通过。
- `npm run test:smoke --workspace=@personal-agent/desktop`：通过，保留 #77 的审批状态逻辑，
  Electron 窗口、Preload、提交/取消及后台关闭均无页面错误。
- `npm run test:workspace-smoke --workspace=@personal-agent/desktop`：首次在既有第 109 行断言
  波动失败，未改代码立即重跑后通过；本项不把单次重跑提升为稳定性证据。
- `npm run check`：退出码 0；`git diff --check`：通过。
- 安装依赖时 npm 报告 1 个 moderate advisory；未运行 `npm audit fix --force`，锁文件未变化。

本分支未重新执行旧 PR 记录的 AgentArts 专项 GUI 截图，因此不复用该截图作为当前证据。
没有真实 AgentArts、Runtime 失败、云端、凭据或用户数据调用；配置状态不等于连接或任务验收。
无公共协议、依赖、迁移或权限变化，可回滚单一功能提交。
