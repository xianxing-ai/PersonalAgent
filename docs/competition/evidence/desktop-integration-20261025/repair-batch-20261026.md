# 2026-10-26 十一包修复与 Root MCP 组合 Evidence

接收方状态补记：以下 A11/Root 描述是来源 Windows 工作树的历史证据范围，不是云端新候选的验证回执。2026-10-26 已收到来源 ZIP，清单 288 项任务文件、119 份基线原文及 32 项材料全部核验；接收方从 main `934b7c44` 三方整合。来源 `b2fb20dd` commit 尚无可核实远端 provenance；A12 的其他输入仍有 65 项相对 main 不同/缺失且未交付，完整原始日志也未随包提供。收到六份回执并核其文件，不等于核过其全部 logSHA 原文或重跑 Windows。

后续 SQLite 来源 A12 报告为 6194 total / 6165 pass / 29 skip，Runtime Application、MCP 产品链及实际 Root Main 旧资料迁移/退出/重开另有回执，均限各自源码快照；两项 v2 GUI 脚本晚于 A12，尚未实跑，PR376 使用生成 Main stub。公共 SQLite 草案仍 pending，尚未生成/发布最终通过记录。稳态写改善与迁移、重开、RSS、磁盘回退同时保留；Map 常驻及 v5→v4 最新历史导出缺口见 [ADR-0041](../../../adr/0041-desktop-conversation-incremental-persistence.md)。下文计数不与后续结果相加。

目标 Profile：`huawei_ict_agentarts`。完整白名单数据、原始样本、各源文件 SHA 与回执 SHA 见 [组合 JSON](combined-verification-repair-20261026.json)。

## 当前冻结源码与四项检查

同一源码快照 SHA256 `7a25e23633e72792bdd5d40b12044c0d60b419e32257dd3f9557592044d0a4a9`，共 1720 个源码输入；十一包及 Root MCP 要求的 45 项均在四份快照内，运行期间 `changedInputs=[]`，生成时逐项与当前 Root 字节相符。

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| `npm run check` | exit 0；6174 项，6145 通过，29 跳过，0 失败 | 架构、类型、工作区测试；跳过不计通过 |
| Runtime Application smoke | exit 0 | 生产装配烟测，不是云平台验收 |
| 原生窗口 smoke | exit 0 | 显式 Fake Runtime，不代表真实模型或设备 |
| Root MCP 产品链 | exit 0 | 实际 Electron 管理／对话页、safeStorage 与本机 HTTPS/TLS；目录和消息对话框显式合成 |

MCP a8 原产品日志报告 1 次原 MCP 工具调用、4 类拒绝负例、0 个页面错误、0 次模型调用及 0 次 AgentArts 调用；两次重开及进程核身份清理见原日志哈希和 JSON 白名单摘要。a1–a6 原失败与 a7 较早源码通过保留，不把历史回执算作本轮结果。

Root 的 `@personal-agent/runtime/application` 实际解析到本树 `dist/application.js`，该入口导出含私有持久 cursor 绑定的 `mail-triage.js`；源码、编译产物及 Runtime 构建回执哈希已单列。这是构建和解析核对，不代表真实 QQ 邮箱读回。

## 局部回归与测量边界

控制、Runtime、历史、语音、连接器、快照、邮件变化 epoch、视觉、通知终态、通知点击及持久游标共十一包的作者聚焦日志各自绑定源码。通知终态先前失败与修复、点击原 3 项失败→27 项聚焦通过、后续 delivered 点击／ack 的两组红例→30 项聚焦通过，以及持久游标的漏报和双 namespace 红例→54 项聚焦通过均保留。测试集合重叠，不相加成组合总数。邮件与通知使用 Fake provider／notifier；视觉是生产宿主配 Fake 像素、网关和 fetch；Root MCP 用本机 loopback TLS 和显式合成对话框。

Runtime 启动测量在 Node 与真实 SQLite 内存库上使用合成任务人口；历史缓存和消息页测量使用独立 Node 进程。JSON 保存原始样本及 P50/P95/max、RSS/heap 和适用边界。10k 缓存终态化 P95 在该合成测量中约从 7.918 ms 到 9.256 ms，回退如实保留；权威消息 Map 与同步全量保存未移除。没有据此得出最终 Electron 合成、IPC/DOM 或跨环境 SLO。

## 剩余验收

本轮没有以四项本机检查证明真实 QQ 邮箱连续 cursor、真实 Windows OS 通知点击、物理设备、真实外部账号、云模型／AgentArts 部署和平台评测。公共 Schema 与本次私有邮件首读 checkpoint 的数据库迁移未新增；既有迁移 11/12 仍按各自工作包说明。Git 提交、PR 审查、CI、合并和发布另按实际记录判断。
