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

## Windows CI 8007e03f 失败修复

远端 Foundation run `41277858423` 的 Windows job `124763639702` 失败；Linux image job 通过，不能据此宣称整套 CI 通过。退出夹具遗漏新增的 F18 配置资源，导致 18 个正常退出断言失败；已给原 Main 回调的显式夹具补资源声明。另 11 个普通子任务/审批恢复失败为真实兼容回归：Plan 发送前来源门禁错误地用 Competition 对话的完整配置校验读取普通子任务的结构身份。现复用原子任务身份校验（父子键、角色/目标、期限）及原 sibling 校验，递归查原根任务，未绑定 `desktop-subtask:`、替换父任务/子 ID/目标和无效期限仍拒绝。

根重新构建 Runtime 后，退出、子任务绑定/父恢复、Plan 来源与新增伪造拒绝共 59/59 通过，零跳过；日志 `.cache/integration-ci-parent-quit-fixed.log`。新 Local 测试首轮误用仅 Competition 提供的 automaticTools 配置被正确拒绝，已改回 Local 原手动授权配置，未放宽产品策略。直接 workspace npm 构建首轮因 shell 找不到 `tsc` 失败，随后运行仓库安装的同版 TypeScript 编译器成功；不将首轮计作通过。

远端另 4 个原生 bundle/旧模拟进程测试由 native 工作包修复中。最新代码还需完整 check 和新提交 CI。

## Windows CI fa4fc200

[Foundation run 41281897096](https://github.com/xianxing-ai/PersonalAgent/actions/runs/41281897096) 的 Windows job `124775388732` 于 07:18:04 UTC 完成检查并失败，Linux image 通过。先前子任务、退出和原生修复的对应工作区已通过；Windows 本轮仅 1 个 integration 用例失败：`wiki-write-recovery.test.mjs` 在成功写入并恢复后又向 `revalidateSource` 传入写入前的 `expectedSha256`，收到“原写入来源已变化，不能归因于该操作”。这是新的精确来源门禁正确拒绝旧参数。

修复保留该旧哈希拒绝断言，重复投影验证改用实际生产 `revalidate` 回调传出的原写入后参数，并独立核对它与实际文件哈希相等。产品来源校验不变；原正文仅写一次、无关事实不变和重复恢复无额外 revision 的断言全部保留。独立 UI 集成树全量构建通过；原 Windows 文件写入/重启恢复、private Memory 来源、F04 新出机许可/Main、F11/F08 原会话卡联合 31/31 通过、零跳过，日志 `.cache/ui-full-build.log`、`.cache/ui-ci-knowledge-recovery.log`。原失败已复验通过，整套新提交 CI 仍须重跑。
