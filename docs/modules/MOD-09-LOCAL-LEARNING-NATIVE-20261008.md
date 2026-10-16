# MOD-09 本地流程学习原生验收与读取许可

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


状态：`in_progress`。负责人：goo122。目标：`huawei_ict_agentarts` Competition Profile。

## 本轮范围与权限调整

原生验收发现工作区只读 MCP 连接依赖 `cloudExportAllowed=true`，本地流程学习因此必须先允许向 AgentArts 发送结果。调整为：用户点击“授权本地读取及所选权限”可创建本次会话的本地读取许可，云端结果发送复选框独立保持未选中。

复用既有工作区宿主、许可对象和 MCP/Skill 入口，不新增公共 Schema、数据库迁移或第二套执行器。原来的 `cloudExportAllowed=true` 授权保持兼容；`false` 新增仅本地读取的路径。写入和命令的现有条件保持，取消勾选云端发送不授予这些能力。向 AgentArts 公布工作区工具、读取导出配置、接受导出和投影结果仍分别检查云端许可。

许可不持久化。重启、撤销和更换目录或 Node 继续使旧绑定无效。必须由原生选择器绑定目录和可信 Node，再显式授权本次会话；仅保存配置不授权读取。

原生操作还发现后台重复发布相同学习宿主状态时，表单被重建，输入焦点和未提交草稿丢失。学习控件现在只在生成的界面内容改变时替换 DOM；状态确实改变时仍正常刷新。回归覆盖重复状态保留草稿与实际状态变化刷新。

## 验收环境与证据边界

- 工作树：`.worktrees/goo122-local-learning-permission`；基线：`e86bac53`。
- 独立用户数据和公开合成参考文件位于被忽略的 `.cache/local-learning-native-20261008/`，参考目录与用户数据库分开。
- 正式 Competition Runtime 装配；未使用 Fake Runtime 或 Fake Model。复用固定本地参考摘要 Skill 与官方 filesystem MCP。
- 启动进程仅继承系统运行所需环境，不继承凭据；云端 Authorization 为空。网关/运行时为未调用的验收占位配置，不构成部署证据。
- 原 Vault 不修改，不写入或重建真实私人记忆。云端验收按用户要求暂缓。

## 检查记录

| 检查 | 当前证据 |
| --- | --- |
| 修复前原生连接 | 未配置云端许可时被拒绝；界面提示检查工作区许可 |
| 修复前回归 | 宿主拒绝 `cloudExportAllowed=false`；表单授权按钮禁用 |
| 读取与云端导出边界回归 | 工作区宿主与表单测试 54/54 通过 |
| 原生本地读取许可与实际 MCP | 原生选择独立参考目录与可信 Node；云端、写入、命令均未勾选；读取可用，实际 MCP connected、参考摘要 ready |
| 重复宿主状态保留表单 | 修复前 4 次 DOM 替换导致失败；修复后学习宿主/控件测试 7/7 通过 |
| 原生流程候选、验证、启用、执行 | v1 候选未验证时启用禁用；实际任务 succeeded 后读回 passed；取消确认保持无启用版本；原生确认后 v1 成功执行 |
| v2 与回退 | v2 验证与执行均 succeeded，来源为 reference-b.md；生成候选不改变 active v1；原生确认激活记录为无→1→2→1 |
| 重启后版本与会话许可 | 原生读取 v1 仍为 passed、active v1；未重新授权/连接时运行任务 failed，提示先许可工作区并连接只读参考服务，没有读取结果 |
| 原生删除 | 选择最新 v2 后原生确认删除 reference-review 全部版本；SQLite 读回版本与激活记录均为 0，删除收据 1；两个原文件 SHA-256 与成功执行结果一致 |
| 删除后再次重启 | 新进程 SQLite 读回版本 0、激活记录 0、删除收据 1；原生查询 v1 后仍无版本、无启用，启用与运行按钮禁用 |
| 完整门禁 | `npm run check` exit 0：2639 项，2614 通过，25 跳过，0 失败；Desktop 708 项，跨模块集成 439 项 |

门禁环境复用根工作树缓存 `.cache/ci-dotnet-sdk8`（.NET SDK 8.0.425），仅验证进程设置 `DOTNET_ROOT`、`DOTNET_ROOT_X64` 和 PATH。初次系统 SDK 10 与仓库内临时目录导致辅助组件测试失败；仅替换 SDK 后仍有受信位置/运行时探测失败。最终使用独立的仓库外英文临时目录，原断言全部通过，没有删除或跳过失败测试。三次完整日志分别为独立缓存内 `check.log`、`check-dotnet8.log`、`check-external-temp.log`。

本轮运行 task IDs：v1 验证 `7b8fa721-482a-4a59-9ece-68c0605903be`、v1 执行 `2dfa8a65-3080-4bcb-bd9c-62eeb5657b11`、v2 验证 `289ab958-19ff-4501-bb9a-766598def3f8`、v2 执行 `2986c7cc-a3f7-4e23-b84c-e56fe051def5`。重启无会话许可的拒绝任务 `3da84f60-c9a6-475a-8901-bebd4d9b2a1a` 为 failed，`retryable=false`。固定只读工具由真实 Policy 放行，本轮没有伪造工具审批。

合成任务执行历史保留在独立 Runtime 验收数据库中；这里的删除证据限定为学习版本、激活历史和后续学习消费，不声称抹除 Runtime 的既有公开合成任务记录。没有实际云端调用，不能据本轮证据完成云端消费验收。

未完成的原生验收不以单元测试替代；本记录不将 MOD-09 标为 done。工作包交付还需按用户规范完成非作者评审与集成。

本轮本地验收已完成。交付分支为 `codex/goo122-local-learning-permission`；工作包等待非作者评审及集成。云端验收继续暂缓，不把本地固定 Skill 成功当作比赛云端能力完成。
## 2026-10-12：继承 PR #315 连续候选版本绑定修复

本次独立验证工作树 `.worktrees/goo122-learning-guidance-revision` 基于 #316 `cc9d6ba8`。
继承 #315 的修复：渲染先保留编辑草稿和焦点，再应用 Host 返回的新候选版本，旧 DOM
不能把 v2 恢复成 v1；保留 #316 自有的状态反馈和操作提示。

新增回归使用真实 Desktop Host、Learning Application、SQLite TaskRuntime 与明确合成
DOM/旧验证证据；检查 v1 candidate/passed→v2→验证时的界面、请求及持久 checkpoint。
未运行 worker、模型或真实云服务。完整门禁首次发现旧 Git 夹具复制目录后重命名的
Windows EPERM，复用 #318 已有的有界重试，保留原身份与拒绝断言；失败日志保留于
`.cache/learning-guidance-full-check.log`。传递回归时新增的重复导入已移除，复用本分支
原公开 imports；测试按显示的 v2 语义检查，保留本分支“版本”文案。两次完整失败与
专项失败日志均保留。最终 Host/Runtime/MCP 专项 19/19、0 skip，完整 `npm run check`
**2648 项、2623 pass、25 skip、0 fail/取消**，日志
`.cache/learning-guidance-full-check-verified.log`。无新公共接口、依赖或迁移；仍待 Git
交付、当前提交非作者评审和集成。

## 2026-10-12：PR #315 连续候选版本绑定修复

独立工作树 `.worktrees/goo122-learning-revision-binding` 基于 #315 `9700880e`。
原渲染逻辑保留草稿时会把旧 DOM 的 v1 覆盖到新候选 v2 的版本输入。
现在先保留可编辑草稿与焦点，再应用宿主返回的版本；原异常、拒绝和快照更新不凭空
改变流程版本。不更改原 TaskRuntime 状态、公共接口、依赖或数据库迁移。

已先复现候选 v1 和已通过 v1 两种场景的 `1 !== 2`，原失败日志
`.cache/learning-revision-repro.log` 保留。修复后 Desktop Host、Runtime 学习应用及
MCP 集成专项 **18/18 通过、0 skip**（`.cache/learning-revision-focused.log`）：
连续 v1→v2→验证的界面版本、请求和 SQLite checkpoint 均绑定 v2/new-reference.md，
原草稿、焦点和选择范围保留，异步快照不能恢复旧版本。新增回归的 DOM、旧已通过
版本证据为明确合成夹具；未启动 worker、模型或真实云服务。该修复已在本分支继承，
对应组合门禁已通过，仍待当前提交非作者评审和集成。验证中复用 #318 已有的 Windows Git
夹具有界 EPERM 重试；Git 工具测试 30/30 通过、0 skip，保留身份与拒绝断言。
该旧基线含已提交 CRLF，使用 `git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check`
验证空白，不改动全文件换行或全局 Git 配置。
相同修复传递到 #316 后，保留其自有文案与读回状态逻辑；组合完整门禁 2648 项、
2623 pass、25 skip、0 fail/取消。该完整命令在独立 #316 工作树执行，不冒充本分支
单独跑过完整门禁；本分支最终 Host 回归 10/10 通过、0 skip。
