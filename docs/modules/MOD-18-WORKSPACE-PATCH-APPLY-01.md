# MOD-18-WORKSPACE-PATCH-APPLY-01

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

- Profile：`huawei_ict_agentarts`；负责人 `zemeng`；状态 `review`。PR #147 已合入 main（`5816785`），合并前未取得非作者批准评审。
- 基线：已合并的 #133 stage 工作包；本增量仅涉及 `packages/coding-tools/**` 和本记录。不改公共 Schema、Runtime/Policy、根 lock、Desktop 或业务连接器。

## MOD-11 选择性集成验证（2026-09-27）

旧集成树选择性纳入 stage/apply 与固定命令。Windows 本地合成验证中，command 3/3、stage 3/3、修复后的 apply 6/6 通过；修复了 `.inflight` 标记创建失败后等待 helper 退出或既有 2 秒期限的清理竞态。此验证不证明生产恢复目录 ACL、写中崩溃对账、真实用户工作区、Desktop 联合链路或 AgentArts 工具闭环。

`workspace.apply_text_patch@1.0.0` 复用 preview 的精确编辑、UTF-8、相对路径、敏感项与 expected SHA 校验，使用独立 `workspace:apply` scope。真实源文件写入由 Windows 固定 helper 完成：可信宿主传入授权根、受控且与工作区分离的限权恢复根、PowerShell 路径；helper 脚本和可执行文件须位于授权根外。候选字节由本次 preview 生成并经 SHA 校验后通过 stdin 传递，不读取可被外部编辑的 stage 文件。工具不默认注册到产品，仍由既有 Policy/ToolGateway 对精确参数与一次性授权决定是否调用。

helper 用 .NET `FileStream(FileShare.None)` 独占打开源文件，校验已打开句柄的最终路径与单链接普通文件身份，同句柄读取并核对原 SHA。首写前排他创建备份、`Flush(true)` 并读回；随后仍在同句柄内写入、截断、`Flush(true)` 与目标 SHA 读回。锁前 hash 冲突或文件已占用不写；锁释放后的新编辑不属于这次读回时刻。写入开始后进程中断可能留下部分源文件与备份，结果必须记为未知并凭 task/run 派生备份前缀对账，不自动重试或盲目回滚。启动 helper 时先查询并持久创建每源 `.inflight` 标记（含 PID 与进程起始时间 token），只有 `close` 确认后删除；若 2 秒停止等待先返回未知，标记继续阻止同源二次 apply 与过早对账。进程/宿主崩溃留下的标记必须由受信恢复流程确认同一进程身份已退出并核对备份、当前源文件与授权后处理；PID 复用、起始时间不匹配或身份查询不可用都必须保留未知。该路径防普通 Windows 编辑器在检查与写入之间覆盖，但不是崩溃原子替换、任意路径 OS 沙箱或恶意进程并发改写授权目录时的完整保证。

系统 Windows PowerShell 5.1 在本机为 `Restricted`，固定 `.ps1` 被策略拒绝；实现不使用 `ExecutionPolicy Bypass`。定向测试改用本机已有 PowerShell 7（`RemoteSigned`），因此受信宿主需要提供允许执行此本地脚本的 PowerShell 路径，正式安装/运行环境尚未验收。恢复目录访问控制由受信宿主创建并在生产注册前核验；当前 factory 不验证 ACL，只验证目录在工作区外且存在。未完成 ACL 核验时该能力必须保持未注册/不可用。备份可能包含源码，不是 Artifact，也不自动出机；合成 tmp 目录测试不证明隐私访问控制。

最小验证：coding-tools build 通过；在系统临时目录合成工作区、Node 24.15.0 与 PowerShell 7 下 apply 定向测试 6/6 通过：成功应用/同锁读回且无残留备份、旧 SHA 与已占用源文件不覆盖、缺独立 scope/取消/硬链接拒绝、首写前备份创建失败时原文件不变、现有 Policy/ToolGateway 精确参数绑定的一次性授权，以及遗留同源 `.inflight` 标记拒绝二次 apply。合并前发现 PowerShell 默认 stdin 编码会破坏中文 Windows 路径；`e7a6fc5` 显式设为 UTF-8，并将测试根目录固定为中文路径。带本机 PowerShell 7 的 `npm run check` 已在 PR head 和 2026-09-27 合并后主线通过；合并后 coding-tools 33/33 通过、0 跳过。尚未以真实写中强制终止覆盖进程/宿主崩溃恢复；此风险须在编程链一次联合验收中验证停止/读回。真实用户工作区、AgentArts 和编程链联合验收仍未运行。`ToolGateway` 当前把所有 `local_write` 异常保守映射 `RESULT_UNKNOWN`，包括 helper 首写前冲突；分阶段错误保留属于公共 owner 的后续接口工作。

## P6 对账增量（2026-09-29）

本次增量仍只修改 `packages/coding-tools/**`。新增 `reconcileWorkspacePatchApply(options)`，供可信宿主在
apply 返回未知或进程/宿主重启后处理同源 `.inflight`：marker 严格保存 helper PID 与进程起始时间 token；
宿主可注入绑定两者的 `isProcessAlive(identity)`，或提供绝对 `powerShellPath` 由本包查询并比对起始时间。
只有明确得到同一身份的 `exited` 才复核源文件的 canonical 身份和当前 SHA。`running` 保持 `in_progress`；
PID-only marker、PID 复用、身份不匹配、查询不可用、损坏、源路径变化、身份竞态或任何 `unknown` 均保留 marker
并返回 `RESULT_UNKNOWN`。读回候选 SHA、原 SHA、其他 SHA 分别得到 `applied`、`not_applied`、`unknown`；只有
marker 身份稳定且清理成功才解除同源阻塞。该 API 不启动/终止进程、不重试、不回滚备份，也不改变 ToolGateway
的统一错误映射。原有 apply 现在在发送候选字节前捕获同一进程身份并与 reconciler 共用 marker 路径派生函数，避免
对账清理错误的源记录；身份捕获失败时 helper 被停止且结果保持未知。

本工作树的定向证据：coding-tools typecheck/build 通过；对账测试 8/8 通过；使用本机已有的
PowerShell 7.6.5 运行 coding-tools 包测试，42 通过、3 跳过（3 条原生 Job Object 测试因当前工作树未配置
对应 Release helper 而跳过）。未运行全仓 check、Electron、真实用户工作区或云端验收；本机仅确认了
身份查询和受影响 apply 测试，尚未进行写入中的强制终止或宿主崩溃恢复。
