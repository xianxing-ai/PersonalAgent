# ADR-0015：自有镜像的 Workflow 与 Controller 可执行绑定

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。当前实验为本机Laya有限候选判断，资格不足升级原受信teacher，国内执行模型经AgentArts调用；自有ARM64镜像串行编排，架构未最终定型。历史部署方案不覆盖当前决定，模板数量不等于业务验收；旧双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


日期：2026-10-12。状态：proposed；在 `codex/agentarts-owned-image` 实施，真实平台验收与合并分别记录。
Profile：`huawei_ict_agentarts`。补充 ADR-0012、ADR-0014，不替代本地 Runtime/Policy 边界。

## 背景

原 8 个 Workflow、3 个 Controller 的职责已在自有 fast/world/plan/review 中部分迁移，
但资源没有独立可调用绑定。只把名称放进迁移表不能让协作者实际调用各阶段。
World/Plan 是内部角色报告，不能当作旧 CoordinationResult 或本地执行成功返回。
原 MVP Controller 的导出是空绑定，不能凭资源名称声称已恢复业务流程。

## 决定

1. 使用脱敏清单中的固定资源 ID/name 编译安全绑定目录，提供 `getOwnedBindings()`。
   8 个 Workflow 分别真实分派；3 个 Controller 使用固定受限图。
2. 包公开 `invokeWorkflow` 与 `invokeController`。World 单阶段只调用 world；
   Plan 重验调用方提供的 World；Review 重验 World/Plan 并保持原候选一致性检查。
   报告与结果一律标记 `verification: unverified`。
3. 镜像专用信封 `bindingVersion: 1.0.0` 通过原 HTTP/WS 的 query 文本传递。
   普通调用保持兼容，本地 wire 1.0.0、云传输 0.1.0 和 candidateVersion 1.0 不扩权。
4. 使用独立宿主凭据保护 `/bindings`。受信启动可选固定默认 Controller，只有其
   application_result 解包进入旧消费链；角色报告保持独立，不能写入本地计划。
5. 原空 MVP Controller 建立新的 owned 主路由，标记 `new-owned-binding`；原空绑定事实保留。
   两个持续认知 Controller 的同目标 Normal/Default 分支不重复执行。
6. 确定性检查/构建/测试只从宿主当前公布的工具目录产生合法提案；不使用模型猜命令，
   不在云镜像执行本机工具，不加入私人凭据、数据库或原始导出。

## 理由与兼容影响

固定目录使迁移资源可以实际调用，阶段重验使之前的报告不会成为权限来源。
接口复用现有 transport 的 body/digest、期限、取消、并发和结果未知处理；
不新增本地任务库、云授权器或任意 DSL/Python 执行器。绑定目录编译进入原镜像
allowlist 的 agentarts/dist，不扩大镜像到整个仓库。

没有数据库迁移或新依赖。旧 `invoke` 保持兼容。新绑定专用 wrapper 不是旧公共候选；
消费者必须显式识别版本和类型，不能把 role_report 当工具提案或完成证据。
更新 PR head 会使旧阅读声明失效，仍按两人门槛重新确认，禁止强制合并。

## 替代方案

- 仅注册名称别名：不能提供独立 World/Plan/Review 的可调用行为，不采用。
- 在镜像直接执行本机工具或运行导出 DSL：越过现有授权/依赖边界，不采用。
- 把内部报告扩成旧 CoordinationResult：容易让分析报告进入可执行路径，不采用。

## 验证与复审条件

覆盖全部资源分派、固定图与停止条件、未知资源/版本/额外字段、前置报告替换、
候选越界/替换、目录缺失、确定性零模型提案、期限/取消、认证和原调用兼容。
构建后在非 root 容器读回绑定目录并实际调用 HTTP/WS；镜像 source SHA/digest 单独保存。
真实华为公网 WSS、模型、部署、trace/评估及平台原生 Controller 等价不由这些离线结果证明。
新增计划删除/新节点/后续动作仍须单独公开契约与本地 Policy 消费，不能借绑定入口放开。
