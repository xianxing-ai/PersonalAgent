# PR #526 Wiki 主线同步验证（2026-10-31）

- 目标 Profile：`huawei_ict_agentarts`。
- 修复分支：`codex/pr526-repair-20261031`，隔离工作树 `.worktrees/pr526-repair`；未改动原 Wiki 工作树。
- 合并输入：Wiki `53d21b40b82b3ff8c0323a6af0db89719ba5b124` 与主线 `e7d7c7e72b2138914181840d275a5f5400e8cdd5`。

## 变更与兼容性

解决 `main.js`、管理页控件声明和根锁文件冲突。保留 Wiki 导入宿主、管理页控件与释放逻辑，同时保留主线的观察授权、F23 shadow、语音 final 与主动工作流接线。锁文件先保留双方锁定条目，再经 `npm install --package-lock-only --ignore-scripts --offline --no-audit --no-fund` 校验；比对双方原锁文件，没有升级或丢失既有包版本。

本次同步未增加公共协议、数据库迁移或授权行为。Wiki 能力仍为 provisional；原文证据校验、有界格式纠错和未知结果不重放的规则不变。

## 本地验证

使用仓库要求的 Node 24.15.0、npm 11.12.1，以及已核实的 Git、PowerShell 7、OpenSSL、隔离 .NET SDK 8.0.425。测试临时目录位于工作树之外。日志保存在被忽略的 `.cache/pr526-validation/`。

| 检查 | 结果与边界 |
| --- | --- |
| JavaScript 语法与 `git diff --check` | 通过。 |
| `npm ci --no-audit --no-fund` | 锁定依赖安装通过；没有修改依赖版本。 |
| `npm run check` | 架构、契约夹具、生成类型、构建和类型检查通过；完成全部 workspace 测试，汇总 6,237 项：6,191 通过、1 失败、45 跳过，命令退出 1，未把这次运行记为全绿。Desktop 为 2,257 通过、1 失败、13 跳过；Runtime 1,327/1,327 通过。 |
| `node --test --test-concurrency=1 apps/desktop/test/notification-application-host.test.mjs` | 原实现、原断言复验 12/12 通过，无跳过。 |
| `npm run test:integration` | 57/57 通过，无跳过。此前整仓命令因 workspace 失败未进入该阶段，因此单独补跑。 |
| `node apps/desktop/test/wiki-import-smoke.cjs` | 实际 Electron Main、Preload、Renderer 的隔离空配置界面通过；没有启动模型或网络请求。 |
| `node apps/desktop/test/wiki-import-product-smoke.cjs` | 实际 Main、Runtime、Policy、Preload、Renderer 的导入、审批、问答链通过；文件与模型为显式合成夹具。 |

唯一完整工具链测试失败位于 `notification-application-host.test.mjs` 的旧 Todo 策略编辑用例：预期一次通知，实际为零。保留夹具读回显示，原提醒任务已经 succeeded、SQLite 通知批次已经 `ready_for_delivery`，目标模块文件仍为 `queued`，同目录临时文件已经完整写入 `visible` 与 batchId，故失败发生在本地原子文件替换阶段；没有形成通知投递 round。隔离复验后整个通知宿主文件通过，未修改通知生产代码或放宽断言。原始 `check.log` 和夹具保留；原始异常码未被生产 catch 暴露，不能据此保证本机不会再次遇到该文件操作问题。

前置尝试还记录了沙箱 `EPERM` 文件/网络限制和短 PATH 缺少实际 Git 的环境失败。恢复正常权限、实际工具路径与外部隔离临时目录后验证；这些尝试没有当作产品通过证据。跳过项包括未启用的真实服务、未提供的原生测试宿主/链接权限和可选浏览器场景。

## 未验证与交付状态

本次未重跑付费模型、实际 AgentArts 部署或平台评估，也未访问私人文件、邮箱、日历或实际语音设备。历史云端验收仍见 [Wiki 云端验收记录](wiki-cloud-acceptance-20261028.md)，不能用本次合成烟测替代真实云证据。

本次仅形成可推送的主线同步提交。最新提交的远端完整 CI、合并资格与实际合并状态仍需在推送后读回；未修改审核门槛，也未声称 PR 已合并。
