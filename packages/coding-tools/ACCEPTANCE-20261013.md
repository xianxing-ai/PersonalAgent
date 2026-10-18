# MOD-18：真实补丁、固定命令与恢复验收（2026-10-13）

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../../docs/design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../../docs/design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../../docs/design/workflow-architecture-20261013/index.html) · [接口状态](../../docs/interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


- Profile：`huawei_ict_agentarts`；负责人 zemeng；工作包状态 `review`。
- 工作树：`.worktrees/zemeng-windows-tools-completion`；分支 `codex/zemeng-windows-tools-completion`；起点 `5b581139`。
- 无生产 API、Schema、依赖或迁移改动，不触及 dev-workflows、git-tools、test-locate 或共享 ROADMAP。

已有 P6 runner 未配置当前 Runtime 必需的 workspace patch binding。
本次使其复用生产 `createDesktopCodingToolHost` 的 ACL、路径/文件身份固定和真实恢复端口，
以 `workspacePatchReconciliation` 注入 Runtime。没有创建第二套授权或恢复状态库。

## 首次执行与持久读回

```powershell
node tests/manual/coding/p6-runtime-acceptance.mjs (Get-Command pwsh).Source
```

Windows 普通用户会话，Node `24.15.0` / npm `11.12.1` / PowerShell `7.6.6`。
退出码 0；回执 `.cache/p6-runtime-ZDgtLV/receipt.json`，同目录保留公开合成源码、独立数据库及 recovery。

- read → preview → apply → 固定 `run-demo` 命令 → 二次读回全部成功，preview 未修改源码。
- apply task：`d6d147d4-48f5-4191-b74a-f00b132e2ef6`；固定命令 task：`11d167be-08d4-4f67-b924-25abbacf4f31`。
- 真实命令 exit 0，stdout 为 `P6_AFTER_中文`，stderr 空；没有任意 shell/argv 或私人项目。
- 旧源摘要拒绝，审批前取消未写入；同进程 Runtime/SQLite 重开复用原任务/执行记录，替换原参数被拒绝。
- 公共 Evidence 保持 `conditional`；文件读回和真实 stdout 作为独立本地验证，不改变公共证据等级。

## 故障恢复

```powershell
node tests/manual/coding/patch-recovery-acceptance.mjs (Get-Command pwsh).Source
```

每次在新建的合成中文工作区运行。真实 Runtime 审批签发并消费授权，生产 helper 自己创建并 fsync marker，
真实 PowerShell 进程身份查询核对 PID 与启动时间。runner 只观察 marker，不制造或修改其内容。

| 故障 | 当前任务 / 回执 | 结果 |
| --- | --- | --- |
| marker 已持久、候选尚未发送时，专用 worker 自行 exit 73 | `c9f82e01-3ccf-4943-91be-c76722a2663a`；`.cache/mod18-recovery-Oscsh5/receipt.json` | 新进程重开 SQLite，原任务 `waiting_reconciliation → failed`，`not_applied`，原字节不变 |
| 只读共享锁使生产 helper 完成写入后的 marker 清理失败 | `11dc389e-b8b4-486e-9494-75f49587ace7`；`.cache/mod18-recovery-edQaFp/receipt.json` | 真实 `RESULT_UNKNOWN`；释放自身 locker 后重开，原任务 `waiting_reconciliation → succeeded`，`applied`，新字节匹配 |

两者均为单次工具派发、单次授权消费、同一 task/run。恢复端口保留 marker 时核对其仍在，
清理 acknowledgement 前核对原 run 的持久执行记录与 reconciliation checkpoint 已匹配。
重复恢复及再次重开 Runtime 的记录/Evidence 不变，未重新执行 apply；最终 marker 清除。
锁定辅助进程只接触本次 marker，正常释放与超时均受界限约束；失败保留 fixture 与原身份供恢复，不按进程名杀用户进程。

这分别证明候选派发前的宿主退出和写后 marker 清理失败的恢复；**不证明写入中崩溃或断电原子性**。
第二种是故障注入，但文件写入、helper、SQLite、Policy 与恢复提供者均真实。
回执未包含独立 SHA 校验文件，未读取/复制云凭据。

51 项相关观测/补丁/Runtime 恢复回归通过、0 跳过。另命令与架构门禁 27/27 通过、0 跳过，
包括 Windows Job helper 的正常退出、取消、超时和孙进程收尾；两个模块类型检查通过。
用户随后要求不等待 CI、不扩大测试，本工作包遵循该要求，远端 CI 自行运行。

## 根装配与剩余条件

新增 [合成工作区云端联合验收入口](../../tests/manual/coding/SYNTHETIC-CLOUD-WORKSPACE.md)。
它可由主对话可信宿主注入现有 AgentArts 配置，固定执行 read → 精确 patch → 固定字节验证命令，
限制单任务、参数、次序及出云结果。调用方持有凭据和应用，入口不读环境变量或复制配置。
参数拒绝、出云投影变值拒绝、显式 Fake coordination 驱动的真实本地三工具闭环，
以及无活动 worker 的等待审批取消共 4/4 通过、0 跳过；失败会撤销执行与出云资格。
没有真实云调用。回执明确区分本地 verified 字段与尚未取得的 deployment/trace 证据。

现有生产接线无需改动：`apps/desktop/electron/coding-tool-host.js` 的 `patchReconciliation`
由 `workspace-config-host.js` 接至 Runtime `workspacePatchReconciliation`；恢复入口为
`RuntimeApplication.reconcileWorkspacePatchTask(taskId)`。

上述真实 helper 故障验收只覆盖持久 `host-tool-intent` 任务；Competition 增量的验证边界见下文。
真实 AgentArts 提案/续答、正式 Desktop 设置/交互、用户选定真实项目以及 Artifact 服务仍需对应联合验收。
由主对话的可信凭据宿主运行云段，仅使用明确允许出云的合成内容；本分支不复制凭据或扩大权限。
MOD-18 保持 in_progress，独立验收增量进入 review；正常合并仍需一位非作者对当前提交有效批准。

## Competition 原任务恢复增量

云端提案的补丁结果未知时，旧适配器只接受 `host-tool-intent`，不能接回多步 Competition 任务。
现在 Runtime 在原补丁审批/执行前保存每个 run 的 workspace binding、云配置、namespace、
完整提案、参数摘要、源摘要及提案 revision。恢复缺少该原始绑定的旧任务仍等待核实，不能事后补造。
核实异步返回后，再核对任务 revision、原意图和执行记录；配置或输入变化拒绝投影。

- 可信恢复端口在同一次稳定文件读取中增加可选 `byteLength`，不增加读取或公开 wire 字段。
  老端口对宿主直接任务保持兼容；Competition 缺少该字段时保留等待，不编造工具输出。
- `applied` 必须有当前文件摘要等于候选摘要的独立读回。原 run 确认后任务仍等待，
  完整核实结果留在本地，普通 patch 输出按现有 Schema 持久化并回读，再清理原 marker。
- 成功清理的确认回执绑定原输入摘要与完整读回。清理中、失败或回执未落盘时不能续跑；
  重启后只补齐规范结果与确认。已有确认的旧任务重复读取不再碰触同路径后来产生的 marker。
- 仅通过现有 `resumeConfirmedTask` 接回原循环，Runtime 返回已确认缓存，不重新 apply 或消费授权。
  pending 提案采用自己的 step/run，不能误用上一步读取的 run；云端最终返回前不标记任务成功。
- 只有独立读回与旧文件摘要相符的 `not_applied` 才使原任务失败。未知、仍运行、缺 marker、
  回执不完整及冲突不触发重做。初版将取消后的 `applied` 保留在等待状态；
  2026-10-15 的取消收尾增量见下文，已取消工作流不会据补丁成功被标成 succeeded。
- 原 deadline、云调用 unknown/inflight、出云许可撤销仍阻止续云；出云前校验失败时保留已确认写入与等待状态。

必要验证：coding-tools 与 Runtime TypeScript 构建通过；旧宿主恢复及生产文件核实测试 22/22，
新增 Competition 专项 23/23；追加持久 marker 确认后，仅重跑 4 条直接相关路径，全部通过。
专项包含真实本地文件读写与读回、Runtime/Policy/SQLite 和 `unverified` 提案触发的生产出云校验，
云端与补丁 helper 为明确的 Fake，未进行真实 AgentArts 调用、Windows helper 崩溃或 Desktop UI 验收。
最初新夹具因缺幂等键及不完整输入 Schema 被拒绝，修正为复用生产 Schema 后通过，未放宽生产校验。

修改范围为 Runtime Application 的原调用/核实接缝、coding-tools 稳定读回及专项测试；
没有修改 TaskRuntime 核心、contracts Schema、锁文件、传输代码或凭据。

## Competition 取消后的已写入补丁收尾（2026-10-15）

用户取消不撤销已经发生的文件写入。旧适配器在 `cancelRequested + applied` 时直接返回，
原任务和 marker 因而一直等待；核心 `deferTaskCompletion` 对取消任务还会走工具成功即任务成功的分支。
此增量让该选项始终保留等待状态，由工作流所有者完成正常结果持久化、回读及 marker 确认后，
通过既有 `confirmCancellation` 结束原任务为 `cancelled`。原工具执行仍是 `confirmed/applied`，
写入和 Evidence 保留，不续云、不重放工具或授权，也不回滚文件。

缺 marker、摘要不符、未知、缺 byteLength 或仍有未知工具/云调用时继续等待；
取消在读回过程中改变 revision 仍拒绝本轮投影。取消在 marker 确认期间到达则在确认落盘后收尾。
缓存落盘或 marker 确认失败保留等待，重启后只完成原结果和确认；重复恢复不查询后来产生的 marker。

验证：修前新增取消专项失败；修后 Runtime TypeScript 构建通过，Competition 与宿主恢复两文件
40/40、0 跳过；共享 `deferTaskCompletion` 的 DEV-WORKFLOWS 已有正常 applied 恢复路径另行定向通过。
首次 Runtime 构建遇主线新增 Wiki/Memory 声明的旧构建产物，补建 knowledge、memory 后通过，无依赖变更。
测试使用真实文件、Runtime/Policy/SQLite 和明确 Fake 云/补丁 helper；未进行真实 AgentArts、Windows UIA/F9 或用户项目验收。
变更仅涉及 Runtime 核心既有选项的任务状态语义、原补丁恢复接缝、专项测试和本记录；无公共 wire/Schema、迁移、凭据或权限扩展。
