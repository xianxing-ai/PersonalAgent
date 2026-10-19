# 四台 ECS Runner CI 排查与修复（2026-10-19）

基线 `b63a41c6f0bb295af9a2a79bcf55258ad92edd2f`。目标是区分 CI 脚本、产品用例、工件传输及主机环境；没有依据时保持未知。账号附件未进入源码、日志或 Evidence。没有批准、合并、重启服务或清理活动任务目录。

## 四台主机的实际观察

以下均为 2026-10-19 UTC 的历史 job 记录，不证明当前 online/busy 状态。

| Runner | run / attempt / job | 实际时间 | 结果与归因 |
| --- | --- | --- | --- |
| ecs-472f-c018-linux | [39247433350](https://github.com/zemeng5208/PersonalAgent/actions/runs/39247433350) / 2 / 118137624211 | 15:16–15:20 | Linux 镜像检查成功；不能据此覆盖 Windows |
| ecs-782b-windows-2 | [39269988787](https://github.com/zemeng5208/PersonalAgent/actions/runs/39269988787/attempts/1) / 1 / 118119767778 | 14:33–14:34 | 源码恢复报 `tar(child): Cannot connect to C: resolve failed`；GNU tar 将盘符归档路径解析为远程地址，是 CI 脚本兼容问题 |
| ecs-17f8-windows-3 | [39269988787](https://github.com/zemeng5208/PersonalAgent/actions/runs/39269988787/attempts/2) / 2 / 118137532184 | 15:07–15:16 | Electron 归档 SHA 不符，tar 与产品测试尚未执行；下载没有完成日志，具体断流/文件损坏原因未知 |
| ecs-905d-4175-windows-4 | [39247433350](https://github.com/zemeng5208/PersonalAgent/actions/runs/39247433350/attempts/2) / 2 / 118137624452 | 15:07–15:43 | Runtime 853 项中 848 通过、F15 5 项失败；现有日志缺底层操作错误，产品与主机原因尚不能区分 |

另 [#426 run39247656286](https://github.com/zemeng5208/PersonalAgent/actions/runs/39247656286/attempts/2) 的 GitHub Windows job `118138855370` 已成功，汇总 job `118147298367` 却报 selected job 未通过。脚本当时仅读取 API 一次，未记录具体状态。API 可见性延迟是推测，不是已证实的根因。#421 使用 GitHub 托管 Windows，不占这四台 ECS。

## 已修复

1. **GNU tar 盘符解析**：源码和 Electron 恢复均改为 `cwd=传输目录`，归档参数只传 `source.tgz` / `electron-cache.tgz`。不依赖修改服务器 PATH 或 GNU 专用 `--force-local`。真实 GNU tar 的 Linux 冒号路径模拟中，旧命令报同类错误，新命令恢复精确源码/缓存成功；不是 Windows 实机验收。
2. **下载依赖的未完成退出**：将两个工作流的下载动作固定到官方 v7 `37930b1c2abaa49bbe596cd826c3c89aef350131`。实际故障使用 v4 `d3f86a106a0bac45b974a628896c90dbdf5c8093`。提取这两个精确 dist 的 `streamExtractExternal`，显式模拟响应提前关闭，并将超时缩为30ms：Node 24.15.0 中旧版仅 `EXIT 0`，新版明确 timeout reject、`EXIT 1`。这证明依赖缺陷及修复机制，不证明本次生产网络为何关闭。
3. **缓存残留与缺失诊断**：每个 job 新建空下载目录，独立传递并验证大小及 SHA。缺文件、非普通文件、部分下载或摘要不符继续失败；仅打印安全的大小/摘要。原 lock/version/内嵌校验和、原始 `npm ci` 与 postinstall 全部保留。
4. **汇总证据短暂未就绪**：仅在 needs 成功后，有界重读同 run/attempt/head；实际失败等终态立即拒绝，证据缺失超预算也拒绝。新增安全 job 状态记录，不放宽通过标准。

## F15 与主机问题仍待证据

#423 的 F15 失败包括 `waiting_reconciliation`、缺少原审批和取消状态不符。不能仅凭这些下游状态判定 CPU、华为网络、PowerShell 或产品算法有错。本次仅增加即时 `F15_HOST_OPERATION` 脱敏诊断，即使报告返回前失败，也保留原 start/patch/check 等操作的白名单错误。没有删断言、增加预算或把 unknown 改为成功。

knowledge 证书创建仍使用原 10 秒预算；历史修改包含串行测试、移除 ConvertTo-Json 冷启动及分阶段诊断，不能按截图声称已调整预算。新的 #427 根本未跑到该测试。Windows helper 的已有 readiness/取消预算修复已在主线，不重复造补丁。

当前执行环境的 TCP 目标授权列表为空；GitHub 插件也不开放 runner 管理接口。本轮未建立四台主机的 SSH 连接，因此没有检查账号是否可登录、当前服务/磁盘/网络/Defender 状态，也没有实施主机修复。放行四个目标的 SSH 22 端口后，仍需在空闲主机读取真实资源和进程诊断；不重启 busy runner、不清活动 `_work/_temp`，不把访问工具限制当作服务器离线。

## 验证

- Node **24.15.0**：8 个 CI/审阅门禁测试文件，共 **111/111**，0 失败、0 跳过；含两个真实 GNU tar 兼容性回归。
- actionlint **1.7.12**：两个修改的工作流通过；下载的官方工具包 SHA256 为 `8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8`，与官方 checksum 一致。
- F15 fixture 与测试文件语法检查通过；未在 Linux 将 Windows 专用用例记为通过。
- 固定上游 dist 的响应关闭复现已单独运行，超时及 HTTP/unzip 均明确 Synthetic；没有调用真实模型、Laya 或外部账号写操作。
- 精确命令、UTC、摘要与日志 SHA 见 [validation.json](ci/ecs-triage-20261019.json)。本地没有运行全仓或大规模测试。新 PR 的真实 CI 结果须单独读回，不能以本记录代替。

原负责人：CI 基础设施与 F15 为 zemeng；knowledge 及公共底座为 goo122；#423/#427 业务增量为 Potatos498；#426 前端增量为 2511375597-lab。该包只改必要 CI 与自有 F15 测试诊断，不接管业务实现。
