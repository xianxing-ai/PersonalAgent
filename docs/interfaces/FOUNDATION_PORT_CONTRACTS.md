# 基础底座端口契约（goo122 分区：F01/F03/F04/F05/F10/F13/F16/F17/F21/F23/F24/F25/F27 及 runtime/system/workspace 面）

> 本文是 28 图中基础域能力名（`memory./knowledge./model./policy./mcp_skill./configuration./system./workspace./github./runtime.` 前缀）的接口约定登记。
> 机器校验：`node scripts/competition/verify-graph-capability-coverage.mjs --domain foundation`。
> 缺口登记：`docs/competition/evidence/graph-capability-gaps.json`（foundation 53 条）。
> 规则：缺受信口保持 unavailable，禁止 Fake/静默回退；Runtime/Policy/ToolGateway 边界与接口冻结条件不变。

## 1. 已提供（main 有生产实现）

| 图能力 | kind | 提供者 | 说明 |
| --- | --- | --- | --- |
| `memory.query` | tool | packages/memory（公开 Memory 查询/变化流） | 事实投影消费 |
| `knowledge.search` | tool | packages/knowledge | 受信检索（v1 契约含 sourceId/configRevision） |
| `workspace.read_text` / `workspace.apply_text_patch` / `workspace.run_allowed_command` | tool | Desktop 受信宿主 + ToolGateway（MOD-18） | 受限工作区读写与固定命令 |
| `github.bound_pr_diff` / `github.current_head_merge_gate` / `github.issue_snapshot` / `github.merged_repair_readback` | host | packages/agentarts `f18-f19-github-hosts.ts`（PR #587） | 平台绑定读回（只读，绑定由受信组合提供） |
| `github.pr.get` / `pr.diff` / `issue.get` / `issue.list` 等只读操作 | tool | packages/connectors/github（MOD-33） | 真实 gh 读回（已验收） |

## 2. 已登记缺口（53 条，摘要分组；逐条见缺口登记 JSON）

| 组 | 图 | 缺口摘要 | 负责 |
| --- | --- | --- | --- |
| `policy.*`（8 条：scope/pending_question/confirmation_check/resume_original_operation/quiet_hours/compensation_check/operation_scope_check/outbound_context_check） | F01/F02/F03/F08/F12/F24/F25 | Policy fail-closed 工厂随 #531 链交付；main 无生产口 | goo122 |
| `runtime.*`（27 条：commit_task_graph/commit_responsibility/schedule_graph/invalidate_affected_subgraph/original_effect_binding/reconcile_original_effect/submit_bound_compensation/patch_and_required_checks/deliver_patch_evidence/deliver_failure_report/enqueue_research/enqueue_issue_repair/execute_published_operation/keep_confirmed_effect/persist_graph/publish_actual_status/local_stop_observation/recover_checkpoint/stop_*/versioned_replan/wait_reconciliation/completion_check/confirmed_recovery/publish_sourced_answer/read_original_effect/invalidate_question/invalidate_context_mapping） | F01–F05/F08/F09/F13/F15/F17/F19/F24/F27/F28 | Runtime host 面随 #531 链交付 | goo122 |
| `mcp_skill.*`（5 条：install_registry/isolated_probe/protocol_health/source_manifest/enable_authorized） | F21 | 安装隔离与启用许可后端口 | goo122 |
| `configuration.*`（3 条：operation_readback/promote_with_rollback/save_credential_reference） | F23/F25 | 现行配置消费者；CAS 契约面已在 agentarts shadow release 服务（只读/回执），生产消费者缺 | goo122 |
| `model.*`（2 条：native_config_check/context_source_map_check） | F01/F27/F28 | 模型能力 guard 的 host 组合口 | goo122 |
| `knowledge.*`（3 条：source_and_write_check/citation_revision_check/check_supported_claims） | F04/F05/F10 | 受信写检查/引用验真/断言支持检查 | goo122 |
| `memory.*`（2 条：invalidate_projection/quarantine_candidate） | F04 | 投影失效/隔离候选口 | goo122 |
| `system.registered_probe` | F13 | 系统观测 probe 的 host 组合（providers 已有，MOD-17） | zemeng5208 |
| `workspace.*`（3 条：patch_scope_check/test_intent_check/source_and_test_check） | F15/F16/F28 | 补丁范围/测试意图/源与测试一致性检查口 | zemeng5208 / Potatos498（test_intent_check） |

## 3. 组合契约

1. 缺口落地模式：Runtime 侧 fail-closed 工厂（`createRuntimeF*`）+ 实际调用方注入 + 定向测试 + Evidence；与 #531 链模式一致。
2. 配置消费者（F23）：`createWorkflowShadowReleaseService` 已定义 CAS/readOperation 端口契约与 unavailable 语义（tests/contracts/f22-f26-f28-gates.test.mjs）；生产配置端口注入前，promote/rollback 一律 unavailable。
3. 主影/影子选择收益（CW-06）与知识对账身份、出站凭据（F24/F25）按现有 OPEN_WORK 分工推进，不因本契约放宽任何授权。

## 4. 维护方式

同 BUSINESS_CONNECTOR_PORT_CONTRACTS.md 第 4 节：先改 wiring 契约源，再由覆盖校验驱动登记更新。
