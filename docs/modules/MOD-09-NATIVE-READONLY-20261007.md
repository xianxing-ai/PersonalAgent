# MOD-09：原生只读检索与取消确认验收

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

- Profile：`huawei_ict_agentarts`；需求：PA-020、PA-024；负责人：goo122。
- 基线：`origin/main@4b5ec614663908dde938bd1f463203319f7c09d2`。
- 工作树：`.worktrees/goo122-mod09-stable-controls`；分支：`codex/goo122-mod09-stable-controls`。
- 模块状态：`in_progress`；本工作包已完成本地验收，提交及 PR 状态以 Git 为准，不代表 MOD-09 完成或接口冻结。

## 问题与修复

原生管理窗口的宿主状态更新会重新替换记忆页内容。即使记忆状态没有变化，
检索输入、摘要控件及其事件监听也被替换，正在选择 Vault 的按钮被重新启用。
另一个失败路径在异步选择结束后访问 DOM 已清空的 `event.currentTarget`，无法恢复按钮。

记忆页现在仅在记忆宿主状态、搜索结果、管理列表或本页操作结果变化时重新渲染。
无关任务及健康状态更新保留现有控件；权限撤销仍刷新并禁用写入。
选择 Vault 时捕获按钮引用，失败时恢复原按钮。其他页面行为保持原有实现。
没有公共接口、Schema、迁移、依赖或权限变更；记忆接口仍为 `provisional`。

## 验证结果

| 检查 | 结果与证据边界 |
| --- | --- |
| 新增三条 Renderer 行为回归 | 原实现 3/3 失败；修复后 3/3 通过，覆盖输入及节点保留、待选择状态、异步失败恢复；权限撤销仍禁写 |
| 私人记忆控制器与新增回归 | `node --test apps/desktop/test/private-memory-render.test.mjs apps/desktop/test/private-memory.test.mjs` 对应 7/7 用例通过；控制器来源及确认端口为合成夹具 |
| 构建与类型检查 | 根 `npm run build`、`npm run typecheck --workspace=@personal-agent/desktop` 通过；Node 24.15.0 与仓库要求一致 |
| Desktop 模块全量测试 | 隔离 .NET 8/TEMP 下 `npm run test --workspace=@personal-agent/desktop`：455 项，453 通过、0 失败、2 跳过 |
| 实际原生窗口 | 已安装 Electron 44.2.0，独立 userData，正式 Competition 装配；Computer Use 操作真实 Windows 文件夹选择与确认对话框，无替身确认 |
| 用户指定真实 Vault | 原生选择已授权目录，检索得到 5 条引文；宿主刷新后检索词和候选摘要保留；不在公共记录中复制私人内容或绝对路径 |
| 原生取消与持久读回 | 对话框显示确切来源、引文和候选摘要；只点击取消。管理列表为空；重启相同 userData 后仍为空，Vault 会话撤销 |
| SQLite 只读检查 | 取消后及重启后，事实、创建、更正、删除意图、feed delivery 均为 0；来源文件 SHA-256 与操作前一致 |
| Runtime 检查 | 仅装配生成的 Knowledge Watch 根任务处于 `created`，只有一条 `task.created`；未提交模型/云消费任务；未提供云凭据 |

测试前依赖尚未构建的一次运行报缺少依赖包 `dist`，构建后重新执行。
默认环境的完整 Desktop 测试为 450 通过、3 失败、2 跳过：
`coding-tool-host.test.mjs:72` 装配断言失败，
`windows-host-fixture.test.mjs:34` 缺少稳定 .NET 8 SDK，
`workspace-command-recipes.test.mjs:605` native helper 缺少 .NET 8 Runtime。
系统枚举的 SDK 为 10.0.302，Runtime 为 7/10；装配失败不能仅凭这个枚举归因。
复用仓库此前校验的 SDK 8.0.425 缓存、Runtime 8.0.31，且只在验证进程
设置 PATH、DOTNET_ROOT 和工作树外隔离 TEMP/TMP 后，上述全量门禁通过。
没有安装、修改系统 SDK 或放宽测试；不能据此声称默认 TEMP 兼容问题已修复。

本次没有重跑根 `npm run check` 或合成 Electron smoke；改动局限于 Desktop Renderer。
原生只读与取消交互记录不等于真实用户确认保存，也不是出机许可或 AgentArts 调用证据。
未做网络包计数，不能宣称捕获了零网络请求。

## 本地证据与继续入口

忽略目录 `.cache/mod09-stable-controls/` 保留失败复现、默认及隔离测试和类型检查日志。
`.cache/mod09-native-readonly-20261007/` 保留启动收据、独立数据库和原生验收摘要。
原生截图及可访问性观察见本次操作记录；日志、数据库和私人正文不进入 Git。

当前原生工具可用，2026-10-06 的初始化错误已不再阻断本次只读/取消验证。
仍需对具体摘要取得用户逐条确认后，完成真实保存、更正、重启、撤回、
全版本删除及无关数据保留；完整 parent→child 许可和真实 AgentArts 消费另验。
用户的“继续”不作为具体摘要确认；本次没有确认保存按钮操作。
