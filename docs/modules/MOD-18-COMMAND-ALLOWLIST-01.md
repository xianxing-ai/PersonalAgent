# MOD-18-COMMAND-ALLOWLIST-01

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；负责人 `zemeng`；非作者评审 `goo122`；状态 `review`。
- 基线：`origin/main@ec43a55`；拥有范围 `packages/coding-tools/**` 与本记录。PRD `PA-017` 要求指定工作区内可审查改动和必要验证，不授权改无关工作区或自动发布。

本包新增可显式注册的 provisional `workspace.run_allowed_command@1.0.0`。可信宿主注入授权工作区根，以及每条 recipe 的固定绝对可执行文件和完整参数；调用者只能选择 `recipeId`，不能自带 shell、命令、argv、环境或 cwd。工具通过现有 `RegisteredTool`、Policy、ToolGateway 做参数摘要绑定和 `workspace:execute` scope 校验，不创造第二套授权或进程调度。descriptor 标为 `local_write`，不可幂等、不可自动恢复。生产 Runtime/Desktop 不注册，也不公布为可用 capability。

Node 内置 `spawn({shell:false})` 足以避免此固定调用面的 shell 解析，省掉新依赖和自行实现参数转义。工具约束时间、输出字节，取消/截止/超限时终止直接子进程并等待退出；测试只在用户授权的临时合成工作区运行固定 Node recipe。它不提供 OS 文件系统沙箱，cwd 不限制进程的可访问文件，也不保证 Windows 子进程树清理。因此可信宿主只能配置已审查、无需派生不受控进程的固定命令；任意项目脚本/命令、强隔离构建与真实用户工作区验收另行处理。未引入 execa：它提供便利 API，但不能提供缺失的权限或沙箱边界，且会增加直接依赖；未用 jsdiff 模糊应用替换现有精确 patch 路径。

结果只返回 `recipeId`、直接进程 `exitCode` 和完整受限 UTF-8 stdout/stderr。非零退出码不能当验证通过；返回结果不是 Artifact 或目标文件读回。ToolGateway 对写工具异常统一映射 `RESULT_UNKNOWN`，调用方必须先对账再重试。`ArtifactPort`、可信 Evidence、AgentArts 真实 proposal/continuation、生产接线和原文件原子条件替换仍未交付，stage-only 也不冒充 apply。

验证：Windows Node 26.3.0 本地 coding-tools build 通过；声明版本 Node 24.15.0 上的合成测试 `workspace-command.test.mjs` 3/3 通过，覆盖宿主 recipe 固定、cwd、非法输入/缺 scope、Policy 单次参数绑定授权、dispose、输出超限、非零退出、取消后的直接子进程停止。默认沙箱执行遇 `spawn EPERM`，获准在本机执行同一组定向测试后通过；该结果不是 Windows 子进程树或真实项目验证。未运行全仓 check、Electron、真实云端或项目脚本。

2026-10-06 续接修复（基于 main `e02865c`，#212 登记 `6010625309` / `6010635004`）：公开入口独立复现了注册后移动根目录、同路径换成指向别处的链接，原固定 Node recipe 会在替换目标启动。修复在注册时捕获 canonical 根和 bigint 设备/目录身份，执行通过原 scope、取消与 deadline 检查后，在 `spawn` 前同步复核 canonical 路径、目录类型与身份。替换链接、普通目录、文件或缺失根均拒绝 `SCOPE_DENIED`；不会重绑授权目录。正常内容变更以及注册时合法链接的原 canonical 目标继续可用。未改变 recipe、环境、公共协议、审批或未知结果恢复。

本检查缩小路径替换风险，但 OS 仍按路径启动进程，复核至启动之间存在竞态；不声明文件系统隔离。工具层拒绝不代表经过 `ToolGateway` 的写调用一定返回同一错误码，既有未知结果映射保持。测试只使用临时合成目录与固定 Node 命令，不替代原 Windows 设备、真实项目或云端验收。

本增量在 Node 24.15.0 上保留了旧实现回归 1 通过 / 5 失败（含父用例），修后定向 6/6；coding-tools build、typecheck 及完整包测试 193 通过 / 0 失败 / 15 Windows 门控跳过。root 独立公开入口确认替换后不启动子进程；另一只读代理复核 6/6，并验证别名改指向不会迁移原 canonical 授权、正常内容修改允许、原目录移动后同 inode 链接回原路径仍拒绝。准确新提交的 Windows CI 与非作者正式评审在对应 PR 续记，不用已合入 #293 的旧检查覆盖本增量。

2026-10-06 后续执行期限修复（#212 `6018788042`）：支持的 `now` 钩子在真实固定 Node 子进程派发后越过任务 deadline 或最长执行时间，旧完成回调仍返回成功。现在开始时一次捕获时间、绑定两者较早期限；子进程 close 与完整 UTF-8 解码后重查活性。原 stopReason 和未知退出优先，时钟异常固定脱敏拒绝；钩子同步触发取消后抛错时仍返回 `CANCELLED`。不改变 recipe、参数、权限、环境、输出契约或恢复方式。

固定 Node 24.15.0：初始旧回归含父用例 1 通过 / 5 失败；独立复核发现的取消加时钟异常两场景也保留失败，最终定向 9/9、build/typecheck 及包测试 217/0/15 平台跳过。独立真实 Node 入口确认期限前非零退出仍保留、精确期限边界拒绝，并确认初始/完成两处取消优先。这些使用临时合成工作区与显式时钟钩子，不证明原 Windows 曾发生该竞态。命令可能已写入目标，即便最终返回超时或取消也不能安全自动重试；经过写工具 Gateway 的未知结果映射保持。

同轮 #212 `6019076651` 补齐 `reconcileWorkspacePatchApply` 的本次配置快照：首次异步等待前复制 options 的原执行绑定、checker、PowerShell 路径及 marker 保留选项。公开入口以真实临时源文件/marker 与明确合成异步进程查询复现了原 retainMarker:true 在等待期间被同 options 对象改为 false 后提前删除 marker。原绑定字段被改为 undefined 也不能绕过本次核对；checker 替换不改变本次查询。默认清除与显式保留、源/marker 身份和未知结果语义不变，无新权限或恢复 DTO。

该项先在独立缓存副本保留旧回归 6 失败与修后 reconcile 16/16，只做 transpile，不冒充正式类型检查；root 随后串行应用同一两文件，Node 24.15.0 正式 build/typecheck、coding-tools 包测试 223/0/15 平台跳过通过。独立公开入口确认调用者变更不影响原配置、源文件及保留标记，准确组合交付另记。此证据不证明当前 Runtime 采用 literal 配置的现场受该可变对象问题影响。保留 marker 仍需先持久化可信对账结果、再显式确认清除，不能仅据源码哈希或模型自报确认旧写入。
