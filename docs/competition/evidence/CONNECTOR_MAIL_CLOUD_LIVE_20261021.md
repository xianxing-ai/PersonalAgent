# 默认 Desktop 邮件信头到云端真实验收

2026-10-21 15:09:21–15:09:52 UTC，真实验收通过，runner exit 0。
目标 profile 为 `huawei_ict_agentarts`，工作树 `D:\worktree\f809\PersonalAgent`，
分支 `codex/autonomous-change-loop`；没有提交、推送或部署。

用户明确授权配置 QQ 邮箱，并要求“从应用发到云端进行验收”。本轮复用应用原安全存储中的
加密配置，通过默认主面板提交，只读取 `INBOX` 最多一封信头，不读取正文或修改邮件。
当前真实账号认证、读取和 AgentArts 工具结果续接均已发生；不是 Fake Provider 或模拟模型。

入口为 [desktop-mail-cloud-live.cjs](../../../tests/manual/connectors/desktop-mail-cloud-live.cjs)。
新隔离 userData 仅复制原 `agentarts-config.json`、`mail-config.json` 和 `Local State`，
不复制原用户会话或业务数据库。继承的 `PA_*` 实验环境全部移除，仅设置原 Competition profile
和隔离 userData；没有更换云部署 pin 或启用新的续接实验配置。
邮箱会话与云端分析许可通过原设置页面开启。

本轮原任务与回执：

| 项目 | 实际读回 |
| --- | --- |
| 主任务 | `b1bcc7d8-037e-439e-944c-eb915747421d`，`succeeded` |
| 原默认子任务 | `d9285498-3386-4c58-b3d8-c02b436bbb25`，`succeeded` |
| 唯一信头读取 | `competition-tool-d9285498-3386-4c58-b3d8-c02b436bbb25-1`，`mail.inbox`，`confirmed / Policy allow / executionStarted=true` |
| 数量与范围 | 一封，`INBOX`；原 `mail.inbox` 提供者仅 fetch envelope/flags，不请求正文 |
| 原出机检查 | 同一持久化提案的两次 metadata preflight、一次完整 result 确认，均绑定原子任务 |
| 原子云请求 | 初始 `89ea00b6-3cae-4d42-b24e-71da1920c94a`；结果续接 `e99827ad-591d-4f8c-a752-ad3a3aba3806`，同 session，各 `attempts=1` |
| 父任务 Evidence | 包含上述原子任务的原 `mail.inbox` execution Evidence |

原始脱敏回执为 `.cache/desktop-mail-cloud-live-zCdnnV/receipt.json`。
runner 关闭自己的应用后，使用原 RuntimeApplication 重开同一个 SQLite，核对原父子终态、
唯一读取、execution Evidence、父任务 Evidence 引用及两次真实云请求身份。
这是原 Runtime 重新开库校验，不称为只读 SQLite 检查。
原结果与云回答保留在本机被忽略的隔离数据内；公开回执和本文不包含邮件主题、发件人、地址、
正文、云回答或凭据。原回执中的 `privateContentsRecorded:false` 仅表示未投影到公开回执，
不表示原私有工具结果未持久化；runner 后续已将此字段明确命名为 `publicReceiptPrivateContents`。

原资料出机门禁保留 task/deadline/signal/当前会话检查。验收器只程序应答本次精确范围的
原 native dialog，不证明原生弹窗已渲染或人工逐项核对。metadata 从原持久化
`competition-loop` 读取 task/step/proposalId，并与冻结参数深比较；审批恢复只允许同一个 run
再次 preflight。result 最多一次。原授权页在执行前检查属于本轮 root/child、冻结参数仅
`INBOX / limit=1`、无 cursor，且最多批准一个不同的读取。审批仍经过原 Preload/IPC、
revision、Runtime 和 Policy，不在数据库中修改批准或执行结果。

前两次失败保留，均没有实际读取邮件：

- `.cache/desktop-mail-cloud-live-E5w4DE/`：脚本从 panel snapshot 获取审批，原审批只在 admin
  authorizations snapshot 提供；原父子停在待批，读取记录为空。修正验收脚本，无产品修改。
- `.cache/desktop-mail-cloud-live-SmLLve/`：同一个原提案在审批恢复时再次执行 metadata preflight，
  过严的一次计数误拒绝，原子任务 `UNAUTHORIZED`，读取记录仍为空。
  修正为相同原 task/step/proposalId/参数的幂等确认，没有扩大读取次数。

另一位子智能体仅源码复核 runner 的授权范围、次数、环境隔离及脱敏表述，没有读取邮箱数据库。
入口语法和差异检查通过。本次不证明自然收到新邮件后的增量触发、完整收件箱首次基线、
跨页订阅、Laya 提醒选择、OS 通知展示或平台独立 Trace/API 对账；这些仍为 `not_run`。
