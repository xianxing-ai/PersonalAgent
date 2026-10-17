# 自有镜像绑定与最小修复验收（2026-10-13）

Profile：`huawei_ict_agentarts`；负责人：zemeng；本工作包为 `in_progress`。
目标为已部署的自有 ARM64 Runtime `pa-owned-bindings-0dae0ff5-api`，没有调用 Studio 历史工作流。

## 已实现的代码

- [逐绑定 runner](../../tests/manual/agentarts/OWNED-BINDING-LIVE.md)：精确校验 8 Workflow / 3 Controller；WSS 串行调用并传递本次真实上游报告，没有应用 HTTPS 回退或自动重试。每项保留脱敏阶段、受理及终态接收信息。
- [最小修复 runner](../../tests/manual/agentarts/OWNED-REPAIR-LOOP-LIVE.md)：复用生产 Runtime、Policy、SQLite、事实投影及 `cognition.commit_repair`，仅针对仓库固定公开会议夹具和独立验收数据库。
- 修复合成会议宿主与生产 `workspace.read_text` 新增可选摘要字段的兼容：存在时严格核验内容一致性；公开投影仍只包含原批准的四项会议字段。其他字段和不匹配摘要仍拒绝。
- CLI 接收 PowerShell 高精度 ISO 时间时规范化为协议接受的 UTC 毫秒时间，不续期。

## 新镜像部署与增量验收（02:28 UTC 起）

`owned-1.3` ARM64 镜像已由 GitHub 发布工作流发布，并导入华为 SWR；既有 Runtime 的 Latest
已更新为 `arm64-7b6b4101`。控制台读回正常，保留原凭据、入站身份和权限，增加内容无关的部署版本标识。
[预览镜像与验收附件](https://github.com/zemeng5208/PersonalAgent/releases/tag/agentarts-preview-7b6b4101)。

- 02:30:00–02:30:13 UTC：新镜像 World 绑定真实 WSS 调用通过，返回通过严格来源/结构校验的 `role_report/REVISE`；目录 8 Workflow / 3 Controller 一致。
- 随后的全绑定运行在目录发现阶段遇到 `EXTERNAL_FAILURE`，所有 invoke 均未发送；不能算成 11 个模型调用失败。02:34 与 02:37 的只读诊断再次读回 HTTP 200/11 个绑定和 WSS ready，未发 invoke。
- 02:33 的修复尝试在本地结果导出门禁拒绝：云端提案使用公开 Schema 已允许的 `maxBytes`，合成宿主却仅接受 `path`。现已允许固定夹具路径及可选的整数 `maxBytes=1..2048`；未知字段、其他路径与非法字节上限仍拒绝。
- 02:39 的新尝试证明审批前零读，合成验收宿主批准后读取 1 次并记录 Evidence 1 条、图修订到 6。随后云端续答返回 `INVALID_ARGUMENT`，原任务保持 `waiting_reconciliation`，尚未取得修复候选、CAS 提交或完整闭环成功。

上述审批来自明确标识的已授权合成验收宿主，不是用户本人点击；输入、文件与隔离数据库均是固定公开夹具。
原始失败数据库保持原状，不通过清除挂起或重做未知写入掩盖问题。最新回执保存在忽略目录，公开文档仅记录脱敏结果。

## 02:54 UTC 最新逐绑定结果与后续源码

02:54:28.014–02:55:10.039 UTC 的真实 WSS 回执整体为 `failed`：目录精确 8 Workflow / 3 Controller，
**3 项通过、4 项失败、4 项跳过**。该轮仍对应已确认部署的 `arm64-7b6b4101`。

| 场景 | 实际结果 | 证据边界 |
| --- | --- | --- |
| Fast、Deterministic、Controller MVP | 通过，`application_result/text` | 仅这三项的当前真实答复 |
| World、Router | 顶层 `EXTERNAL_FAILURE`，`transport` 诊断为 `RATE_LIMITED` | 已发送、受理并收到终态；未取得可用报告，不把所有失败归因于限流 |
| Controller Repair、Controller Router | 合法 `application_result/repair_candidate`，场景断言 `EXPECTED_REPAIR_CANDIDATE` 失败 | 通过结构解析不等于符合固定最小修复场景，更不等于本地 CAS 或执行通过 |
| Plan、Plan_1、Review、Review_1 | `DEPENDENCY_FAILED`，跳过 | World 前置失败，未伪造报告继续 |

该 runner 工具执行为 0、`executionAuthorized=false`，不能作为完整最小修复闭环成功证据。
原 02:39 任务及其 `waiting_reconciliation` 状态仍保留。

后续源码 `0cbb3f1d` 已修复 strict continuation 的已确认来源传递，并完成相应必要检查。
截至 02:57 UTC，本地 `linux/arm64` 镜像已构建成功；导出、推送和新云端部署由后续流程继续，
尚无该版本的云端独立读回或真实 continuation 成功证据。构建成功不能替代部署及调用验收。
[PR #343](https://github.com/zemeng5208/PersonalAgent/pull/343) 已交付 WSS upgrade 脱敏诊断，
[PR #344](https://github.com/zemeng5208/PersonalAgent/pull/344) 已交付落盘失败及目录阶段诊断，
后者 18 项离线测试通过；这些代码交付不提升本次云端失败或整 MOD 状态。

## 收尾交付（2026-10-13）

`0cbb3f1d` 源码已推送；strict continuation 的七文件修复已提交为
[Draft PR #345](https://github.com/zemeng5208/PersonalAgent/pull/345)，依赖 #336，尚未合并。
本地 ARM64 构建及镜像内 parser import 通过。
[新预览 Release](https://github.com/zemeng5208/PersonalAgent/releases/tag/agentarts-preview-0cbb3f1d)
已读回：ARM64 tar（93,313,024 字节）与脱敏 `VERIFICATION.json` 均为 `uploaded`；归档上传完成于北京时间 11:12:37。没有额外 SHA256 附件。

GHCR 工作流已触发，但未等待 CI 或核实其发布结果。SWR 上传完成状态与新 Runtime 部署未核实；最后已确认的云版本仍为 `arm64-7b6b4101`，新版本真实闭环仍未验证。
两个 Controller 的旧场景失败已定位在协议解析后的内容比较；夹具公布两个修复目标，而断言要求仅修改第一个，现有脱敏回执不足以判定具体不符项。没有放宽断言或据此归因于模型。

用户要求现有成果提交 PR 后停止；本次仅收尾，无新增真实模型调用、部署、合并或测试。MOD-19 保持暂停。

## 旧镜像当日较早的实际结果

2026-10-13 01:31:53–01:32:16 UTC 的逐项运行：

| 场景 | 结果 | 可证明范围 |
| --- | --- | --- |
| 目录发现 | 通过，8 Workflow / 3 Controller | 目录身份、类型、角色、来源及要求一致 |
| Fast | 通过，`application_result/text` | 该绑定的真实 WSS 普通答复 |
| Deterministic | 通过，`application_result/text` 且 RECHECK | 无公布工具时明确拒绝猜测工具 |
| World | 失败，EXTERNAL_FAILURE | 未取得可传递的合法报告 |
| Plan、Plan_1、Review、Review_1 | 跳过 | 本次 World 前置条件失败，未伪造报告继续 |
| Router、三个 Controller | 失败，EXTERNAL_FAILURE | 不能标记这些入口验收通过 |

01:39:26 UTC 单项 World 诊断进一步确认：请求已发送、云端已受理、终态错误已返回，诊断阶段为 `transport`，未返回合法阶段报告。此证据不能区分模型请求失败和云端报告校验失败，不能武断归因为凭据、限流或网络断开。

01:40:47–01:41:08 UTC 的生产最小修复尝试在来源任务进入审批前失败；工具执行 0、Evidence 0、未创建修复任务、隔离图谱保持 revision 5，HTTPS 应用调用 0，宿主关闭已确认。没有写用户业务数据，也没有声称云端最小修复成功。

最早一次 CLI 尝试的目录发现成功，但高精度时间被本地协议校验拒绝。修复后公开端口回归确认该旧输入在读取授权、创建 WSS 和发帧之前被拒绝，因此不计作云端应用调用成功或模型失败。

## 必要检验与边界

宿主字段兼容的 5 项测试、生产本地最小修复 runner 的 4 项关键离线测试通过。后者覆盖读取审批前零读、修复审批前零写、一次 CAS、两个 Evidence、无关节点保留、同库重开和重复身份不重放；云端在这组测试中为明确 Fake，不能替代上面的真实失败记录。

来源审批前失败后，runner 又补充任务实际错误码和内容无关的云诊断保存，并单独通过 1 项 Fake 回归：保留初次审批前的失败状态、净化错误码、零执行/零 Evidence 与图版本 5；白名单诊断丢弃原始正文、URL、错误文本和未知值。此次诊断改动尚未再次调用真实云，不追补旧回执中不存在的诊断字段。

真实回执仅保存在被忽略的 `.cache/owned-binding-live/` 与 `.cache/owned-repair-loop-live/`，没有保存凭据、原始模型正文或报告。审批者在 runner 中明确标为已授权的合成验收宿主，不能写作用户本人点击。

下一步以云端角色日志和内容无关诊断定位失败，再修复并验收受影响路径。此前真实单文件读取成功仍单独成立；本次结果不提升整 MOD、平台 trace/费用/评估、真实桌面或完整自主修复的完成状态。
