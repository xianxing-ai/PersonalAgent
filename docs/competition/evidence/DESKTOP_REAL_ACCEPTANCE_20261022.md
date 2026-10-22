# Desktop 真实验收：2026-10-22 首批现场证据

Profile `huawei_ict_agentarts`；分支 `codex/desktop-real-acceptance-20261022`，源码基线 `c15855f5ccceb76d6bf794203d9ebfbe9cb83cb3`。状态 **blocked**，实体设备通过项为零。此次授权要求逐项真实验收；下列阻塞项全部保留，不作为跳过或完成。

实际命令 `node tests/manual/desktop/real-acceptance-preflight-20261022.mjs`，退出 **2**；白名单输出见同名 JSON。此脚本仅诊断前置条件，不是设备验收器，也不读取配置、凭据或任务数据库。`pwsh -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'` 实际 spawn 失败 `ENOENT`（没有进程退出码）。`uname -a` 确认 Linux x86_64；Node `24.19.0`，仓库要求 `24.15.0`，npm `11.9.0`。独立树依赖及当前 Runtime 构建产物不存在，`/dev/snd` 不存在；这些事实不推断其他机器状态。

Cloud status 本轮读取：current=true、running/connected、HTTP unrestricted/enforced，capabilities/secrets/runtime_variables/outbound_identities 全为空。网络快照 VPN=false，TCP domains/ip_ranges 空。当前工具清单没有 browser 控制入口，也没有附加 Windows 环境。未探索私有会话、凭据、数据库或远端 runner 桌面。

| 统一矩阵 ID | 真实目标 | 本轮结果和继续入口 |
| --- | --- | --- |
| DESKTOP-REAL-01 | 默认 Laya ready、六节点原任务 | blocked：当前用户 Windows 现场、当前可信配置、构建和独占槽均未具备。已有 `tests/manual/desktop/laya-existing-health.mjs` 会真实启动模型，未运行；须先由主控分配与 Windows/PSEC 互斥槽，使用当前可信本机原宿主启动，不在 Linux 仿冒。 |
| DESKTOP-REAL-02 | 真实项目读取、检查失败与修复 | blocked：本基线 `tests/manual/desktop` 无 pelican manual；原新工作包尚未取回。保留并核对来源包后沿原入口执行，不猜造第二任务链。公开 agentarts/pelican manual 不等于默认 Desktop 六节点消费验收。 |
| DESKTOP-REAL-03 | 原生 Windows CAS、读回和最终动画 | blocked：真实 Windows 用户桌面缺失。现有 conversation-pelican-wiring 是 Synthetic CAS；不能用其通过替代 native CAS 或动画视觉验证。 |
| DESKTOP-REAL-04 | 正式 UI 文字、模型目录与默认选择 | blocked：可信 userData/模型配置未附加，工作树未构建。恢复当前受信配置后先 build 再正常启动；验证精确模型身份、持久默认选择、实际任务 Evidence，不启用 fake 标志。 |
| DESKTOP-REAL-05 | 原生 Live、麦克风/扬声器、打断和唤醒 | blocked：无附加音频设备/Windows 现场，无当前可信模型配置。已有 live-voice-host、microphone-capture 和语音接线证据；合成 PCM/函数事件不是设备证明。 |
| DESKTOP-REAL-06 | 文字/语音转接同一原任务、原审批恢复 | blocked：缺真实 Live 会话。恢复后核对原 conversation/parent/child、原 approval revision、已受理任务不重复提交与未决结果不重放。已有语音文档仅 Synthetic，不升格。 |
| DESKTOP-REAL-07 | Windows 电脑控制、普通用户、接管与停止 | blocked：无真实 Windows host/用户桌面。恢复实体现场后消费原 Host/Policy 能力；`tests/manual/windows/system-observation-acceptance.mjs` 仅聚合观测，不可代替窗口/鼠标/键盘验收。 |

历史原失败边界由本轮任务交接提供，**本轮没有读取或重放其数据库**：LUCLdz 曾 ready/start、decision confirmed，但选择 owned-review；F15 seq2/N01 unknown、N02–N06 pending，child waiting_reconciliation、parent waiting_approval；业务 read/patch/N05/CAS 为零。恢复先沿原任务只读核实未知结果，禁止强选候选、把不确定升级误判模型错误、重新执行未知写入。历史内容不是本轮通过证据。

本轮只读 `gh pr view 463 --json author,headRefOid,title,state,comments` 成功（exit 0）：作者 `2511375597-lab`，OPEN，head `bd7b57ddac8aa24f8f67696bcf5832c1c5f72b11`，主题为悬浮面板玻璃主题/原生圆角。唯一返回 comment 是 CI 失败机器人通知、要求原作者修复；不代表 owner 已停止工作。本工作包未接管或修改主题文件，也未把该未合入实现计为已交付。

已阅读根 AGENTS、CONTRIBUTING、MODULE_ASSIGNMENTS、当前设计/接口目录、根及 Desktop README、Desktop/Windows manual 与 Laya README；`rg --files ... -g AGENTS.md` 未返回目标子 AGENTS。应用 cloud-environment-runtime 技能检查当前 readiness/network；无安装、构建、Electron/Laya 启动、模型请求、任务提交或用户项目写入。production 无修改，接口/迁移无变化。

恢复条件必须由受信现有现场提供：当前 Windows 用户桌面及宿主配置、原 manual 来源包与独占槽。到位后按根 AGENTS 先完成当前源码 `npm run build`，再执行既有真实入口，保存原 task/run/approval、Policy、native CAS 前后 hash、独立检查/动画及音频/设备证据。不得新建授权、扩大付费模型范围、发信、删除或重放旧未决任务。
