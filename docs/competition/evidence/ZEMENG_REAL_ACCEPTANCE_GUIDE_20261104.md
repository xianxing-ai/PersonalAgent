# zemeng5208 真机 / 真人 / 真实云验收指引（2026-11-04）

Profile：`huawei_ict_agentarts`。基线：PR #543 head `codex/pr531-cloud-persistent`。

**本文只是操作指引，不是验收记录。** 下列各项目前都**未验收**。本轮没有读取任何凭据，没有登录 SWR、GitHub 或华为云，没有部署，也没有在真实设备上运行。

各项通过判据中的数字和字段以对应 Evidence 及代码为准；有冲突时以代码中的断言为准。

## 通用规则

1. **固定版本。** 每次验收先记录以下内容，Evidence 只引用这些固定标识：
   - 仓库 commit SHA
   - Desktop 构建版本
   - AgentArts 部署版本及镜像 digest（`repo@sha256:…`，不使用 tag/latest）
   - 模型 / 目录 revision
2. **凭据只留在本机。** 凭据只放在操作者本机已有的合法配置里（SWR 登录、GitHub token、AgentArts 账号等）。Issue、PR、日志和 Evidence 中都不出现凭据值、auth 配置或完整环境变量。
3. **四类路径都要跑。** 每项至少覆盖：正常、失败/拒绝、取消/恢复、未知副作用（`RESULT_UNKNOWN` 不重放）。只跑通正常路径不算通过。
4. **不放宽断言。** 不得为了让旧版本或缺失环境通过而删除或放宽断言。模拟器、`--platform` 参数、Fake/Synthetic 服务的结果只能作为前置证据，不能计为真实验收。
5. **回填方式。** 结果写入本目录的新 Evidence（`<项>_REAL_<日期>.md`，附脱敏回执 JSON），并在对应 PR/Issue 留链接。
6. **152 项清单。** 只有同时具备「生产注册 + 真实宿主 + 约定证据」的节点才能勾选（见 [IMAGE28_COLLABORATOR_OPEN_WORK_20261031.md](IMAGE28_COLLABORATOR_OPEN_WORK_20261031.md) 规则行）。

---

## 1. F02 语音交互：物理麦克风

| 项 | 内容 |
| --- | --- |
| 环境 | Windows 实机，接物理麦克风和扬声器；Desktop 已构建；百炼既有语音端口在本机配置可用 |
| 人员 | 操作者本人在场说话，另有一名听者做人工听感判断（可以是同一人） |
| 权限 | 系统麦克风权限；语音服务账号由操作者本机配置，不读、不贴 |
| 现状 | 工厂与原卡链路已接，Live、设备帧、provider 事件都是 Synthetic，见 [F02_VOICE_INPUT_WIRING_20261031.md](F02_VOICE_INPUT_WIRING_20261031.md)。未注入独立 `verifyAudioEvidence` 时 worker 明确返回 `f02_acoustic_playback_evidence_unavailable`。 |

**操作步骤**
1. 固定 commit 和 Desktop 版本后启动 Desktop，确认 F02 工厂已由组合层（lab 负责 `main.js`）注入，并且声学证明验证器是真实实现，不是恒真回调。
2. 在原对话中触发一张需要语音确认的原问题卡，用物理麦克风回答。
3. 依次验证以下场景：
   - partial 和 echo 被过滤；
   - 最终转写只与原卡绑定；
   - 拒绝、失效、取消路径都生效；
   - 播放回声（扬声器外放）不会被当作用户确认。
4. 导出脱敏回执：卡片身份、转写 digest、阶段时间，不含音频原文。

**通过判据**
- 最终确认只来自同一回合的真实声学输入。
- echo/partial 不触发业务动作。
- 取消后零业务执行。
- 语音和模型解释不决定授权，授权仍走原审批卡和 Policy。
- 声学证据缺失时为 unavailable，而不是成功。

**已有本地证据（PR）**：无直接相关 PR。#547（CW-05）的进入/归来控制与 checkpoint 只是相邻能力，不覆盖 F02。

---

## 2. F14 浏览器与桌面操作：Playwright / 真实设备

| 项 | 内容 |
| --- | --- |
| 环境 | Windows 实机 Desktop，隔离的 Edge/Chromium 配置文件；`browser-control-host.js` / `f14-workflow-worker-ports.js` 已由组合层注入 |
| 人员 | 操作者在场，负责授权窗口和浏览器范围，必要时手动中断 |
| 权限 | 本机窗口和浏览器观察授权；不使用操作者日常浏览器的登录态 |
| 现状 | 原系统采样与浏览器设备工厂已接 Main；同一输入租约和提交前字段竞态拒绝已通过 Synthetic 验证，见 [F13_F14_SYSTEM_DEVICE_WIRING_20261031.md](F13_F14_SYSTEM_DEVICE_WIRING_20261031.md) 和 [F14_OBSERVATION_ADAPTER_20261029.md](F14_OBSERVATION_ADAPTER_20261029.md)。真实设备整图尚未运行。 |

**操作步骤**
1. 用独立 profile 启动受控浏览器，打开一个公开、无登录的测试页面。
2. 走 F14 整图：
   - 观察（targetRef 绑定原 taskId）；
   - 串行动作；
   - scope 内提交；
   - 实际回执读回。
3. 依次验证：
   - scope 外窗口或站点被拒绝；
   - 提交前字段被改动时拒绝提交；
   - 中途取消后不继续操作；
   - 写后结果未知时不重放。
4. 若用 Playwright 驱动联跑脚本，脚本只负责驱动页面，授权和结果判定仍来自 Desktop 原宿主回执。

**通过判据**
- 每个动作都有原宿主实际回执。
- 越界被拒绝。
- 取消和未知结果不重放。
- 不把观察成功当作操作成功。

**已有本地证据（PR）**：无直接相关 PR。#571 的 fail-closed 门控思路相同，但只覆盖 F22/F26/F28。

---

## 3. F15 代码修改：真人独立签名审核

| 项 | 内容 |
| --- | --- |
| 环境 | 固定的公开或测试仓库，已配置隔离工作区和 runner；Runtime 已配置 `coding-repair-signed-review` 的 Ed25519 公钥 |
| 人员 | 一名**独立于作者**的真人审核者，持有自己的 Ed25519 私钥；私钥不进仓库、不交给代理 |
| 权限 | 审核者对该仓库的审核身份；操作者对 runner/工作区的执行权限 |
| 现状 | 云端固定 Pelican F15 主分支与独立隔离整图已有历史通过记录（[cloud-f15-v4-20261016](cloud-f15-v4-20261016/)），但不等于任意仓库，也不包含真人签名验收。缺配置、缺签名记录或缺当前 grant 时，操作被拒绝。 |

**操作步骤**
1. 发起一次 F15 修复：精确源 SHA → preview → apply → 测试 → 结果读回。
2. 由审核者在自己的机器上对 preview 的 digest 签名，并把签名记录交回。
3. 依次验证：
   - 签名有效时，按原 Policy 授权，只 apply 一次；
   - 用错误密钥、过期 grant、或 preview 改动后的旧签名时都被拒绝；
   - 撤销 grant 后不再 apply。

**通过判据**
- 只有当前 preview digest 的有效独立签名才能推进。
- 作者自签或代理签名都被拒绝。
- apply 和测试结果来自真实 runner 读回。

**已有本地证据（PR）**：#551（CW-07）补了父子报告和主控建议边界回归，并记录 `consumeOriginalChildControllerAdvice` 目前没有生产调用方；#561（F20）覆盖 `coding.repair.trial` 和候选完成校验。两者都不包含真人签名。

---

## 4. F18 / F19：真实 GitHub token

| 项 | 内容 |
| --- | --- |
| 环境 | 专用测试仓库（不要用生产仓库）；Desktop 本机 `readToken` 配置一个最小权限的 fine-grained token |
| 人员 | 一名 PR 作者，加一名**非作者**的真实 GitHub User 批准者 |
| 权限 | token 只授予该测试仓库的 contents/pull requests/issues 所需最小权限；token 值不入日志或 Evidence |
| 现状 | 工厂齐全但端口未接，见 [F18_F19_WIRING_20261031.md](F18_F19_WIRING_20261031.md)、[F19_ORIGINAL_F15_SOURCE_20261101.md](F19_ORIGINAL_F15_SOURCE_20261101.md)、[F19_ORIGINAL_ISSUE_CLOSE_20261101.md](F19_ORIGINAL_ISSUE_CLOSE_20261101.md)。F19 正向整链有一个原 60 秒超时问题，未作为通过。 |

**操作步骤（F18）**
1. 在测试仓库开 PR，由非作者批准当前 head，等所需 checks 成功。
2. 运行 `github.current_head_merge_gate`，确认读到 `MERGEABLE` / `CLEAN` / `APPROVED`、当前 head 的批准，且没有未解决线程。
3. 依次验证拒绝场景：
   - 推新 commit 让批准过期；
   - 留一个未解决讨论；
   - 让某个 required check 失败；
   - 设为 draft 或制造冲突。
4. 在全部条件满足并经用户在场确认后执行 merge，然后独立读回 merge 状态。

**操作步骤（F19）**
1. 在测试仓库建 Issue → 分诊 → 关联唯一的 F15 child 修复 → 回归 → 有条件关闭。
2. 依次验证：
   - Issue 被编辑后版本变化，旧的关联被拒绝；
   - F15 未完成、取消或结果未知时，不关闭 Issue。

**通过判据**
- 所有写操作都只在门控全部为真且用户确认后执行一次。
- 结果以独立 API 读回为准。
- 超时和未知结果不重试写入。

**已有本地证据（PR）**：#549（#464）中导出预检拒绝保留原因码，便于定位 token 和配置缺失；#557（#443）覆盖云续接终止后 inflight 释放。均非真实 GitHub 验收。

---

## 5. F09 订阅与信号：云验收

| 项 | 内容 |
| --- | --- |
| 环境 | 已固定部署版本的 AgentArts（pinned deployment）、`real_host` harness，以及 Potatos498 提供的真实 feeds 提供者和会话授权 |
| 人员 | 操作者，加业务来源账号的所有者（Potatos498 侧） |
| 权限 | 来源账号订阅授权（由连接器 owner 配置）；AgentArts 部署读权限 |
| 现状 | Desktop 只在 pinned deployment 时注入 `f09WorkflowWorkerPorts`；真实账号的 watch/轮询、断线恢复、未订阅相关事件的质量都未验证，见 [IMAGE28_COLLABORATOR_OPEN_WORK_20261031.md](IMAGE28_COLLABORATOR_OPEN_WORK_20261031.md) 第 106、139 行。 |

**操作步骤**
1. 固定部署版本，并用第 8 节的离线工具确认镜像 digest。
2. 配置一个真实来源的订阅，制造一条新事件，确认它经 ConnectorHost 持久化 eventId，再进入 F09。
3. 依次验证：
   - 重复事件去重；
   - 来源版本变化；
   - 断线后恢复时游标不丢、也不重复推进；
   - 未订阅但相关的重要事件不会被静默丢弃。

**通过判据**
- 每条事件都能追溯到真实来源的 eventId 和版本。
- 游标只在成功消费后提交。
- 未订阅的重要事件有明确的待处理或 unavailable 状态。

**已有本地证据（PR）**：#564（CW-03）让 Desktop `proactive-workflow-host.js` 接受、持久化并透传 `sourceResponsibilityBinding`，router 保持 UNAUTHORIZED 原因（Fixture 验证；`main.js` 尚未传入 binding，归 lab）。#568（CW-02/#459）提供镜像读回离线校验工具。

---

## 6. cloudPersistent：关机后持续运行证据

| 项 | 内容 |
| --- | --- |
| 环境 | 固定云宿主（独立服务、固定 SSH/socket，见 [CLOUD_PERSISTENT_HOST_20261103.md](CLOUD_PERSISTENT_HOST_20261103.md)），加一台可以真正关机的 Desktop 实机 |
| 人员 | 操作者本人，负责关机、计时、开机 |
| 权限 | 云宿主运维权限，由操作者本机已有配置提供；不复制 grant 或整库 |
| 现状 | 云 Runtime、私有 socket、远端卡片、目录锁都只有 Fixture 测试。Desktop 侧 `cloudPersistentHost` 在没有关机后的云证据时显式返回 unavailable。**不得宣称关机后持续运行已验收。** |

**操作步骤**
1. 在 Desktop 发起一个有期限的持续任务，执行 enter_unattended，记录 controlRevision、deadline 和 checkpoint。
2. **物理关机** Desktop（不是休眠或断网），等待至少一个 Scheduler wake 周期。
3. 在云宿主侧只读查看：
   - 任务在原 Runtime 中按原审批继续推进；
   - 没有新建任务；
   - 没有绕过需要用户在场的审批。
4. 开机执行 return，确认：
   - 读回原 checkpoint；
   - 同一个 return 不重复 advance；
   - deadline 不变；
   - 旧 controlRevision 被拒绝（`REVISION_CONFLICT`）。
5. 记录关机和开机的 UTC 时间、云侧事件时间线（脱敏）。

**通过判据**
- 关机期间存在云侧真实推进记录，且时间落在关机窗口内。
- 高风险动作在关机期间保持等待审批，不自动执行。
- 归来后状态与云侧一致，没有重复执行。
- 固定宿主不可用时不回退本地。

**已有本地证据（PR）**：#547（CW-05）中 enter/return 读回原 checkpoint；checkpoint 缺失或 deadline 不符时返回 `RESULT_UNKNOWN`；stale controlRevision 被本地拒绝。#557（#443）中云续接终止后 inflight 释放。#571 中缺受信端口时 unavailable。

---

## 7. 勾选 152 项外部节点清单

| 项 | 内容 |
| --- | --- |
| 环境 | 上面各项的真实环境，加固定的 AgentArts 部署 |
| 人员 | 各节点的 owner（lab / Potatos498 / goo122 / zemeng5208），加一名复核人 |
| 权限 | 仓库写权限，只用于更新清单文档 |
| 现状 | 152 项（111 host、41 guard）是外部节点接口要求，不是已注册能力。历史快照为 0/152，见 [IMAGE28_CONVERSATION_WIRING_20261018.md](../IMAGE28_CONVERSATION_WIRING_20261018.md)。Synthetic 工厂存在不构成勾选理由。 |

**操作步骤**
1. 对每个节点，确认它在生产组合（`main.js` 等）中实际注册，而不只是导出了工厂。
2. 在真实宿主上执行，并留存约定证据：任务/run id、脱敏回执、独立读回。
3. 复核人逐项核对后，在清单上勾选并附 Evidence 链接；证据不全时保持未勾选。

**通过判据**：三要素「生产注册 + 真实宿主 + 约定证据」齐全，缺一不可。目录 smoke 显示 28 workflows / 185 nodes 不等于 152 项已绑定。

**已有本地证据（PR）**：没有任何 PR 可以直接勾选。#561、#564、#566、#571 只提供本地 Fixture 和门控证据。

---

## 8. 附：AA 镜像远端版本与 ARM64（CW-02 / #459）

本地离线工具已在 #568 中给出，完整操作步骤见 #568 分支中的 `CW02_459_IMAGE_READONLY_CHECK_20261104.md`；已有 2026-10-21 真实记录 [ARM64_EXISTING_IMAGE_459_20261021.md](ARM64_EXISTING_IMAGE_459_20261021.md)，该记录在 amd64 daemon 的 Docker Desktop 上执行，不等于物理 ARM64 验收：

- **环境与权限**：一台已有合法 SWR 登录的主机，加一台物理 ARM64 主机。
- **通过判据**：
  - digest 精确匹配；
  - 平台为 linux/arm64；
  - OCI revision 与期望一致；
  - 目录 smoke 为 28 workflows / 185 nodes / UID 1000 / 无内嵌 Laya。
- **现状**：revision label 为空，源码版本 unknown，#459 保持打开。

---

## 9. 本轮 PR 与本地证据对照

所有 PR 只开不合，依赖 #543 → #535 → #531（#549 基于 #535）。

| PR | 项 | 本地已有证据 | 对应本文的真实验收项 |
| --- | --- | --- | --- |
| [#547](https://github.com/xianxing-ai/PersonalAgent/pull/547) | CW-05 无人值守进入/归来 | checkpoint 读回、fail-closed、stale revision 拒绝；52/52 | §6 cloudPersistent |
| [#549](https://github.com/xianxing-ai/PersonalAgent/pull/549) | #464 导出预检原因码 | 预检拒绝保留 cause 码；85/85 | §4 F18/F19（排障辅助） |
| [#551](https://github.com/xianxing-ai/PersonalAgent/pull/551) | CW-07 父子控制器 | 只补测试；父子报告/主控建议边界，记录该函数无生产调用方 | §3 F15 |
| [#557](https://github.com/xianxing-ai/PersonalAgent/pull/557) | #443 云 inflight 释放 | 只补测试，基线已由 #448 修复 | §4、§6 |
| [#561](https://github.com/xianxing-ai/PersonalAgent/pull/561) | F20 N03 候选检查 | 只补测试；Schema / 候选前沿 / 完成校验；33/33 | §3、§7 |
| [#564](https://github.com/xianxing-ai/PersonalAgent/pull/564) | CW-03 来源责任 | Desktop 宿主 binding 接线（`main.js` 未传入）；50/50 + 集成 2/2 | §5 F09 |
| [#566](https://github.com/xianxing-ai/PersonalAgent/pull/566) | CW-06 日常 sampling | 驱动接入 sampling 台账 + 只读汇总；57/57 | §7（收益统计仍需真实运行） |
| [#568](https://github.com/xianxing-ai/PersonalAgent/pull/568) | CW-02 / #459 | 离线镜像读回校验工具；18/18 | §8、§5 |
| [#571](https://github.com/xianxing-ai/PersonalAgent/pull/571) | F22/F26/F28 门控 | 未配置时 unavailable；64/64 | §6、§7 |
