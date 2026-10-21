# D2 与统一问卡独立定点审查（2026-10-21）

本记录是代码只读审查，不是 GitHub Approve，不代替模块实施者的测试或真实桌面验收。

固定输入：D2 提交 `5c49e524b33228da4f1e8d5348d43727aa0995ff` 的 11 个文件；统一问卡核心与 Desktop host 固定为 `1317cd5d`。审查者没有修改这些输入、运行新构建、启动模型/设备或将后续未保存的 Main 改动混入结论。

## 实际覆盖

- `TaskRuntime` 的 `expirePendingApprovals` / `expireApprovalInTransaction` / `respondApproval` 与 `BEGIN IMMEDIATE` 事务：到期检查与 revision、Policy 撤销/单次 grant 分离；过期归 `resolution.actor=system`，没有伪造真人拒绝。晚到 allow/deny 不产生新的 grant，重复旧 allow 不补充使用次数。
- 最近期限定时器、重启时 pending 读回、取消竞争、活动 worker abort 与晚到结果处理；`started/unknown` 工具或原 cloud unknown/inflight 保留 `waiting_reconciliation`，未发现为了超时重新执行写入的路径。
- Application 的到期通知/临时租约释放/原子任务父级刷新；Desktop 的私有 systemExpired 投影及历史响应，公共 approval.list shape 没有被扩大。
- `AuthorizationQuestions` 的 task/proposal/run/原参数摘要/owner/deadline/profile 绑定、CAS 更新、答案 revision 检查、独立 requirement 单次消费、永久 rule 的受信 resource digest、重启 stale 与 native backend unavailable 拒绝。
- Desktop question host 的原运行解析、输出 Schema/有界字段校验、目的地+projection hash 绑定、结果 hash 精确租约，以及 confirmed export 只消费预登记权限而不新发执行 grant。读过关联 focused 测试源码，但本轮没有运行它们。

## 发现与处置边界

发现一项 P2 live 投影缺口，已交实施 owner 修复：D2 到期只更新 DB 并发送任务失败；Main 的 `approvals` Map 仅在 `approval.requested` 时重读，仍持有原 pending/revision。`projectDesktopApproval` 要求输入已为 denied 且 revision 与存储一致，因此实时快照仍可能显示 pending，`systemExpired` 不出现；直接重新读取的 history 不受此问题影响。最小回归应以“旧 pending 输入 + 同一 approvalId/task 的当前 system-expired 存储”为例，确认投影刷新为真实 denied/revision 并展示过期，不能冒充用户 deny。

另在本人五类 voice 消费中发现真实卡 DTO 不公开 `argumentsDigest`；该桥接曾误要求字段而无法聚焦卡。`84ceaeb9d83b2b1f1cb86460e449656f67556d44` 已改成真实 questionId/revision/sourceApprovalId/task 关系，原 approval reader 的摘要核对保留；voice 仍不能签发任何授权。对应 bridge-only Fake 回归 1/1 通过。

除上述项目，在本次固定范围的静态执行与恢复路径中未发现新增执行越权阻断。结论不涵盖最终未审 head、所有 Main 类别、全部复杂恢复组合、真实 PSEC/UI/云工具闭环；最终集成负责人仍需在其实际新构建 head 上完成受影响检查并记录 P2 的实际修复结果。
