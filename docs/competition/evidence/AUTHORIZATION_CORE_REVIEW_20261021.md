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

## 已确认结果与同一操作多阶段导出增量

只读输入为 `a3e96a9b`、`63fd006b` 在 `e3105aa05813b37ec6becc4b0b12b6d1f8916477` 的组合，以及后续修复 `88731263e84a9cbfaa2e06031c501516d563cd34`。本轮没有启动测试、模型、设备或构建，也不将实施者测试回执记作审查者亲自运行。

- 已确认导出重读只放宽 export 分支：原 task/run/tool/version/参数、未过期 deadline、confirmed execution record 与原 proposal checkpoint 仍逐项匹配；工具执行仍要求 pending。原结果摘要、精确投影、consumer 单次消费及当前配置/资源/模型目的地守卫保留，没有从 confirmed 结果补发执行 grant。
- Developer/Harness 多阶段复用先核对原 owner task、同 action/scope/operation digest、同期限和已确认的 decision intent；每个实际阶段仍绑定自己的原 run、参数与精确 export lease。它不把一次决定解释为业务执行完成，也没有允许未知副作用重放。
- 曾发现 Harness 的首卡措辞限定原历史范围，但 operation key 未包含完整范围，可能在同一 task 下复用到另一个历史范围。`88731263` 已让 Runtime 逐 segment 传入同一 whole-pass 的 configurationRef/sourceDigest/sourceCount/tailDigest/goalFrameDigest；宿主再将 conversation/cutoff、实际配置、模型目的地和整个 policy 绑定进 policyBinding，并在实际发送前重核。相同范围的多个 segment 可共享一次决定；范围变化不能继承旧 key。该静态问题已在此修复范围内闭合。
- 同一修复的 `OwnedWorkflowHostBridge.projectReceiptResult` 在 writeOnce 后读取并比对完整原 receipt/result/projection/authorization audit，只有匹配才签名。已有 audit 被替换投影、租约或原 receipt 命中时拒绝，相同 audit 幂等，避免存储旧审计却签新投影。

在上述增量范围未发现剩余静态阻断；此结论不扩大为最终全链路或真实云验收通过。
