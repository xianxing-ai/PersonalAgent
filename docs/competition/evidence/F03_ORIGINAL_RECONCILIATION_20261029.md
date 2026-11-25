# F03 原效果核验宿主（2026-10-29）

Competition profile；本记录不代表真实外部服务或 F03 整图验收。

- `apps/runtime/src/application/workflow-f03-reconciliation-host.ts` 新增 N07 可选工厂，复用 `workflow-f24-reconciliation-host.ts` 抽出的固定 F03/F24 内部只读核验实现，不新建任务库或重试原写入。图 N07 输入字段为空，适配器使用空输入；输出 `state`（`applied`/`not_applied`）、原 task/run/revision 和已验证 observation 引用，对应图的已发生/未发生及证据。仍未知时返回 `RESULT_UNKNOWN`，不会伪装成完成。
- 要求原图同一 session 保存且独立读回已确认的 N06 host 结果，可信组合还必须验证该结果与原操作及变更因果链对应；然后核对 TaskRuntime 原执行的 Policy 允许记录、输入 digest、reconciliationOutcome 和附着任务的 verified observation。回执导出前后重新核验；源/能力缺失保持 unavailable。
- 运行 `npm run build --workspace=@personal-agent/runtime` 通过；`node --test apps/runtime/test/workflow-f03-reconciliation-host.test.mjs apps/runtime/test/workflow-f24-reconciliation-host.test.mjs apps/runtime/test/workflow-f24-reconciliation-integration.test.mjs` 为 10/10。F03 主要测试使用合成记录；F24 集成测试使用 Runtime 本地 fixture，不是外部服务验收。
- 未接 Desktop/Runtime 图 worker，未提供生产 N06、原效果来源、因果链验证和业务特定 readback/export 口；无法声称 F03 已注册或真实写入完成。F03 其余失效子图、补偿 Policy/执行、调度等仍待接。此项原为 goo122 Runtime 公共宿主，依 Owner 本轮授权代实现，相关清单仍未勾选。
