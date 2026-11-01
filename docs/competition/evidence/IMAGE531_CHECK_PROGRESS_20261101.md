# #531 集成检查记录（2026-11-01）

目标 `huawei_ict_agentarts`，集成树 `.worktrees/pr531-integration`。本文保留未通过/中断与定向复验，不作为全仓最终通过证明。

## 8007e03f 全仓运行

原 `npm run check` 完成架构、生成检查、构建及类型检查后，在编码工具工作区出现 7 个失败，均约 459～463 秒：原 Git 结果未知、命令期限/停止未知、patch helper 超时及 Node 子进程超时。只读 Windows System 事件确认本机 `2026-11-01T13:29:51.9146883+08:00` Kernel-Power 42，随后 `13:37:33.2902019+08:00` Power-Troubleshooter 1；该睡眠/恢复时间与长暂停相符。未修改系统电源设置、产品 deadline、失败断言或未知结果处理。

保留 `.cache/integration-full-check-8007e03f.log`。为集成新交付后检查同一新版本，根停止该旧版本剩余运行，exit 1；它既有真实失败且未完整结束，不计为通过。

按原断言/期限复验 7 个文件：`git-tools`、`harness-trials`、`isolated-repair`、`patch-apply-dispatch`、`workspace-create-text`、`workspace-patch-apply` 共 91 项，90 通过、1 平台条件跳过；`workspace-command` 26 项，21 通过、5 明确未配置本机 helper 跳过。失败项均通过；这些 Fixture 重跑不重试任何真实账号的未知操作。日志为 `.cache/integration-sleep-failure-rerun.log` 和 `integration-sleep-command-rerun.log`。真实 PSEC 原宿主单独通过的证据仍见原 Job 文档，不能用跳过替代。

## 后续集成定向

F11 原天气/Main、实际原图发送前 guard、HTTPS/WSS adapter、业务目录共 78/78，AgentArts/Runtime 构建通过。原 guard 按唯一 workflowId 路由，凭据后来源变更、重复或异步 guard 均零发送，F20 保留。

F19 第一段首轮两例在原 F15_N05 报 `ENOENT`，日志 `.cache/integration-f19-continuation-tests.log`。原因是根运行命令的短 PATH 未包含 PowerShell，且未显式设置本机测试 `PA_TEST_PWSH`；保留原未知结果与失败。设置已确认的本机 `pwsh.exe` 后，新独立 Fixture 的 F08 原知识投影、F19→F15、Main 与最终 continuation 共 35/35，日志 `.cache/integration-f08-f19-configured-tests.log`；未修改产品或断言来绕过缺失的执行器。

最新集成版本的完整 check 与远端技术 CI 仍需完成。独立审核及完整真实验收也仍是合并前提。
