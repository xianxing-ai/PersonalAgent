# 项目负责人接手与工作区清理记录

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

日期：2026-10-07 · 主要负责人：zemeng / zemeng5208 · 用户保留产品决策与账号授权。

## 后续修订（2026-10-07）

用户随后明确重置为三人独立交付：zemeng 继续负责核心与 AgentArts，goo122 负责基础运行时和知识记忆，Potatos 恢复负责业务连接器、业务接线与 MOD-34/35/38。DEV-WORKFLOWS 按随后减负要求由 goo122 接续 MOD-33/36/37、Potatos 接续 MOD-34/35/38，各三项；zemeng 保持核心与 AgentArts。取消指定协作者 PR 审批、集中验收和唯一集成槽。以下“全部接手”描述保留为早先阶段记录，当前分工以 MODULE_ASSIGNMENTS 为准；工作区清理与备份事实不变。

## 原阶段生效范围（历史）

用户明确要求更新项目状态、成为主要负责人、从 Potatos 接过控制权、同步仓库、删除其他工作树和归档无用对话。

当前主代理承担项目统筹及 Potatos 原 P0～P4、MOD-20～26、MOD-35、集中验收的后续工作；唯一负责人登记见 [MODULE_ASSIGNMENTS](MODULE_ASSIGNMENTS.md)。goo122 的技术维护及公共兼容职责保留。历史作者与非作者评审不能追溯改写；本次未修改 GitHub 协作者权限。

Competition Profile 仍是比赛主路径，已授权的 DEV-WORKFLOWS Local 增量保留原范围。接手不自动启动 MOD-37、社交平台扩展、Windows 打包安装或真实账号写入。

## 已核对与整理

- 已 fetch/prune，并将主目录与当前分支同步到 main@`4d15f06312745c45412c3d9caf6086fa16a99436`；主目录原落后 930 个提交，本对话起始代码落后 297 个提交。
- 本轮文档交付分支为 `codex/project-takeover-20261007`，主目录同步相同文档；提交与推送状态以 Git 为准，PR 创建及 main 集成分别记录。
- 最初 131 条工作树登记中，17 条路径已不存在。其他工作树的 HEAD 全部固定到 `refs/archive/takeover-20261007/<编号>`，并保存经校验的完整 Git bundle。
- 删除前保存工作区二进制差异、暂存差异、未跟踪及忽略的非生成资料，约 875 MB；包含本地配置、日志、证据和数据库等。依赖、dist/build 等可重建目录不纳入内容备份。ZIP 每个文件均做 SHA-256 回读校验；部分删除留下的目录再次完整备份后才继续清理。
- Git 工作树登记已收敛到主目录及当前工作树两个。主目录承载 Git 公共数据；当前工作树承载本次工作。保留它们是仓库及当前任务继续运行的必要条件。
- 30 个已完成、被中断或被新主控替代的旧项目对话已通过 app 工具归档；原稿、任务回执与失败记录保留。早期桌面设计参考对话保留。没有向旧对话发送新开发请求。
- 当前仅两处旧路径留下被 Codex 占用的 Electron `default_app.asar` 依赖文件。其内容已独立保存，清理安排在锁定进程自然退出后执行；不把清理请求写成物理删除已完成。
- 清理时旧依赖中的目录联接导致主目录 `packages/contracts` 的 15 个跟踪文件缺失；已从刚同步的 HEAD 恢复，逐包 Git 差异为零，整个主目录跟踪文件缺失数为零。本对话工作树未受影响。剩余延后清理使用 PowerShell 7，并拒绝出现目录联接或新增文件的目标。

公开状态、开放 PR 与真实验收缺项集中在 [ROADMAP](ROADMAP.md)。#291 是明确不合并的验收产物；#298 的评审及集成仍独立处理。归档旧对话不意味着其中的未验收能力已完成。

## 本地恢复入口

备份在主目录的 `.cache/takeover-20261007/`；该目录被忽略，包含私人本地资料，不提交 Git 或公开发布。

| 文件 | 用途 |
| --- | --- |
| `inventory.json` | 原工作树路径、HEAD、状态、文件哈希及逐项清理回执 |
| `repository.bundle`、`backup-complete.json` | 完整 Git 对象/引用备份及校验摘要 |
| `<编号>/working.patch`、`index.patch` | 原工作区与暂存区差异 |
| `<编号>/files.zip`、`remaining-files.zip` | 初始非生成资料与清理残留的校验备份 |
| `thread-archive-receipts.json` | 对话归档身份及工具回执，仅保存在本地 |
| `file-locks.json`、`locked-files.zip` | 依赖文件锁定诊断及内容备份 |
| `finish-locked-cleanup.ps1`、`deferred-cleanup.json` | Codex 正常退出后的精确目录清理与执行回执 |

恢复时先按 inventory 找到编号，用 `git bundle verify` 校验 bundle；从对应 archive 引用建立新的独立工作树。需要隔离恢复 Git 对象时可从 bundle clone 到新的目录。将 ZIP 解压到新树，应用原工作区差异；若需恢复暂存区，先应用 `index.patch` 到 index，再对照 `working.patch` 和文件备份恢复工作区。不要在已有用户修改的主目录覆盖解压，也不要为了恢复清库或硬重置。

## 验证与限制

本轮按文档与清理范围执行差异检查、修改文件的链接/文档入口校验、主目录文件一致性、Git bundle/ZIP 哈希回读、最终工作树登记和对话归档读回。远程当前 head 的 Foundation CI 成功是已有远程结果，本轮没有重跑产品构建、全量测试、Desktop/Live、模型、云服务或真实账号操作。代码、PR 合并、历史验收与整版 MVP 状态分别记录。
