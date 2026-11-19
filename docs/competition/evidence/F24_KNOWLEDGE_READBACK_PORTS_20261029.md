# F24 知识写入已对账读回端口（2026-10-29）

Competition profile。本切片是组合端口与合成测试，不声称 F24 Desktop 已注册或真实外部服务验收。

- `apps/runtime/src/application/workflow-f24-knowledge-ports.ts` 提供 F24 原效果绑定与 readback 验证端口，仅支持已经由 `KnowledgeWriteReconciliationAdapter` 对账终结的 `knowledge.apply_note_patch` 原任务。身份由可信组合固定，并要求可信 `isOriginalTarget` 判断图 session 与原任务归属；任务、运行标识、namespace、Policy 允许、参数摘要、结果 checkpoint、readback receipt、观察证据及 outcome 全部一致才可返回。缺项 unavailable；不发起读写、不新建证据、不重试未知写入。
- 既有 `apps/runtime/src/application/knowledge-write-reconciliation.ts` 在原工具完成独立读回并经受信 finalizer 确认后，保存 `knowledge-write-readback` 与 verified observation，并使用该证据更新原 TaskRuntime 对账。新端口重复校验该记录与证据的绑定，并交给 F24 宿主检查原 frontier 和导出授权。
- `npm run build --workspace=@personal-agent/runtime` 通过；`node --test apps/runtime/test/workflow-f24-knowledge-ports.test.mjs` 为 3/3，包含缺配置、身份撤销、未决、证据缺失、来源及 checkpoint 篡改、Policy 拒绝。测试为合成数据，不代表真实知识写入或现场持久化验收。
- Desktop/Runtime F24 worker 尚未注入；可信图到业务任务身份绑定、前沿授权、原先对账执行和结果导出授权仍需真实组合。现有 workspace patch 对账以空证据引用调用 `reconcileToolExecution`，未能满足此图宿主对 verified observation 的要求，不能用其状态冒充独立验证。此项原属 goo122 Runtime/知识模块，依 Owner 本轮授权代实现；清单仍未勾选。
