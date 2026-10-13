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
