# MOD-19-PACKAGED-DATA-PATHS-01

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile: `huawei_ict_agentarts`；负责人 zemeng；状态 review。
- 用户是授权来源；主任务统一指挥；goo122 非作者评审后才能合并。
- 工作树 `.worktrees/zemeng-packaged-data-paths`，分支 `codex/zemeng/packaged-data-paths`。

## 行为

Desktop 的 packaged 模式将 Runtime 数据库和会话记录放入 Electron `userData`，
不再落入安装资源或 `app.asar`。源码开发模式保留既有 `.cache` 路径，不迁移、覆盖或删除
现存数据库。显式测试目录仍优先；Fake/ephemeral 模式不持久化对话，打包后的这两种测试
模式使用进程独立临时 userData。临时目录不会在退出时自动递归删除。

只抽取宿主侧纯路径选择并接入 main；无 wire、Schema、数据库迁移、凭据格式或 Renderer 改动。
不会扫描旧安装或自动迁移开发数据，也不把未配置的 Competition 云端切换为 Fake。

## 验证与限制

主进程语法检查、五项定向测试及差异检查通过。定向测试使用 Node 24.15.0；默认
隔离子进程因本机 `spawn EPERM` 无法启动，同一文件改用 `--test-isolation=none` 后 5/5 通过。
测试覆盖 packaged/development/test/Fake
分流，并在合成 userData 中用 SQLite 与现有 Conversations 写入、关闭、重新打开读回，
确认数据库/会话选择路径位于 userData，预先创建的合成安装资源目录下没有生成 `.cache`。
所有数据均为测试夹具。

该验证是 Node 下的数据路径/持久化检查，不是打包 Electron 实机启动或升级验收。
尚未生成安装器；正式候选还须验证打包内 SQLite、启动、升级保留数据和卸载策略。
不宣称 MOD-19 done 或产品可发布。回退代码不会删除已写入的 userData；未来升级与迁移
不得通过清库或覆盖既有用户数据实现。
