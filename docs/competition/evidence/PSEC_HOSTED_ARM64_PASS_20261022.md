# Hosted 原生 ARM64：两项 REQUIRED PSEC 正例通过（2026-10-22）

Profile：`huawei_ict_agentarts`。这是固定真实 OS 执行与合成用户授权链验收，
不代表真实模型、私人账号或完整鹈鹕六节点验收。

## 可核对来源

- [run 39747596372 / job 119719913275](https://github.com/xianxing-ai/PersonalAgent/actions/runs/39747596372/job/119719913275)
- source：`5392c71453d5218dec1818b2cbfdc755c4bc914d`，分支 `codex/pelican-real-completion`；
  仅此新修复分支派发一次 `psec-strict-arm64`，未覆盖主控分支或 force push。
- runner：`GitHub Actions 1000000782`；setup 日志 image 为 `windows-11-vs2026-arm64`
  `20261013.183.4`，进程环境回执 imageVersion 为 `20261018.189.1`。两者原样记录，不混成同一字段。
- [artifact 12412022615](https://github.com/xianxing-ai/PersonalAgent/actions/runs/39747596372/artifacts/12412022615)，
  名称 `psec-strict-39747596372-1`，ZIP SHA256：
  `d6c57584cf1f6336da2cf476e95f9a193f0d168a132dc1b8bdac24a624208187`。
- 原主回执：[receipt](PSEC_HOSTED_ARM64_PASS_20261022.receipt.json)，
  artifact 中该文件 SHA256：`500975596ef39d724b4ab9b0fc914f9905e5fe05d03f9d45891b9fc03f906742`。
- 原合成授权真实执行回执：[authorization](PSEC_HOSTED_ARM64_PASS_20261022.authorization.json)，
  artifact 中该文件 SHA256：`55187d30495faefacd332ffcabe5b250ff52e727a19c9df09cce048144a0d703`。
  本仓库文本副本仅规范化末尾换行，SHA256 为
  `a18c4afeca6e6effe38019b4aabfc22bfcfe6872fa6a868764d955de8ed994b2`，JSON 内容未改。
- 原 TAP：[OS boundary](PSEC_HOSTED_ARM64_PASS_20261022.os-boundary.tap)、
  [authorization chain](PSEC_HOSTED_ARM64_PASS_20261022.authorization-chain.tap)。

已用 GitHub 连接器读取原 job 日志、步骤及 artifact 元数据，并下载原 artifact 核对两份回执。
缓存为本工作树 `.cache/psec-strict-39747596372-1`，未发布 SQLite、配置、用户内容或凭据。

## 原始门禁结果

严格 prepare、两个 REQUIRED 场景及 artifact 上传均 success。
原生 API 校验 ARM64、`processMachine=0`、`nativeMachine=43620`；Node `24.15.0` ARM64，
dotnet host ARM64，原 .NET8 SDK/runtime 存在。helper/launcher PE 与进程/OS 架构均一致，
launcher/helper 实际框架 `.NET 8.0.32`。原 ordinary-user 回执为
`elevated=false`、`administrator=false`、`appContainer=false`，`ordinaryUser=true`、
`nativeHelper=true`。

| 原 REQUIRED 场景 | 实际测试 | pass | fail/cancelled/skipped/todo |
| --- | ---: | ---: | --- |
| OS boundary、generation guards、lifecycle | 7 | 7 | 全部 0 |
| 原 question → Runtime/Policy → production PSEC command | 1 | 1 | 全部 0 |

两个子进程 exitCode 均 0，signal/error 均 null；完整 TAP 通过原 `assessPsecTap` 严格检查。
原授权链回执明确 `native.backend=windows-psec`、`enforced=true`、`executionStarted=true`、
`exitCode=0`、`stopped=true`；审批前 recipe 执行 0，confirmed 1，重复/替换/不可用降级执行
均 0，Policy 剩余使用次数 0。回执中的 loader/contract `enforced=false` 只描述只读诊断模式，
实际执行 enforcement 由这份原命令回执及真实边界测试证明。

本次阶段日志实测首次原生架构查询 33573 ms，首次 dotnet `--info` 5047 ms、
`--list-sdks` 30 ms、`--list-runtimes` 31 ms。后续 smoke 前原生查询 22157 ms。
这证明新源码下本次完整链成功，不证明上一次 dotnet 10 秒超时的内部冷初始化原因已经确定。
此前两个 preflight 失败 run 保留，不记成功、不重放旧未知写入，也未放宽任何 SDK8/架构/
PE/token/PSEC 或零 skip 门禁。

## 鹈鹕提交前 UI 启动观察（独立）

修复 `f50ccf40` 只将提交任务前 orb/panel 就绪等待设为 120 秒，保留原工作流期限，
补固定 phase/耗时与白名单 startup stdout。直接测试 6/6、零 skip，覆盖 45 秒后才出现
目标窗口和完整 120 秒仍缺窗口时拒绝。

另按主控明确授权，复用公开隔离 `LdlZx4` userData、root 当前 Desktop 入口，只启动一次
自建 Electron PID24756，未提交任务或启动 Laya，随后正常关闭；未触碰正式 PID13072。
实测 connected 1232 ms、原 startup runtime=ready 1984 ms、orb 5305 ms、panel 10747 ms，
含关闭总计 18650 ms。[只读启动回执](PELICAN_UI_STARTUP_READINESS_20261022.json)；
缓存 receipt 为 `.cache/pelican-startup-readiness-mpjDTe/receipt.json`，
root Main SHA256 `283a916ecfe122f41d72f2eeefccfd33ef5dee5a3299dc268be580ec3e79f14b`。
该次暖启动不能倒推旧 `LdlZx4` 的 31.3 秒失败只是等待不足，也不能代替新完整六节点验收；
旧失败保留，由主控在资源槽释放后继续全新 fixture。
