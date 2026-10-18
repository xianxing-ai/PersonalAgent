# Competition continuation aggregate budget

<!-- current-design-20261009 -->
> 当前协作规则（2026-10-17）：[接线交付总包](../competition/COLLABORATOR_WIRING_PACKAGE.md) · [模块分工](../MODULE_ASSIGNMENTS.md) · [当前设计](../design/CURRENT_DESIGN_20261015.md)。各 MOD 负责人自行闭环实现、公开契约、实际调用方接线、必要测试与 Evidence/文档。常规 PR 须由 zemeng5208、goo122、Potatos498、2511375597-lab 中任一非作者对当前提交有效批准；Owner zemeng5208 对具体 PR 的审核例外须在该 PR 明确记录，不伪称独立批准。拥有合并权限者（包括作者）可在最新必需技术 CI 通过、严格同步 main、无冲突且阻断意见已处理后合并；四位协作者跨 PR 均衡承担审查与合并，禁止强推、直接推 main 或绕过技术检查。下文历史正文、作者及验收按原日期保留，旧流程不作为现行门槛。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Profile: huawei_ict_agentarts. Follow-up to PR #49 at a54b408.
User-authorized repair; provisional interface, not production cloud acceptance.

## Scope and compatibility

`parseCoordinationContinuation` now limits the complete continuation object
(`proposalId`, `state`, and `result`) to 1,048,576 UTF-8 JSON bytes. The running
budget includes escaped strings and keys, separators, arrays, nested objects,
and the envelope. It stops copying once exhausted rather than building an
unbounded complete serialized result. Existing depth and per-container limits
remain. This is an in-process resource budget, not a promise that a later wire
wrapper fits its own frame limit or that data export has been authorized.

Previously accepted oversized continuations now fail with the existing fixed
`INVALID_ARGUMENT` message. Sparse/extra-property/accessor arrays and hostile
reflection are rejected; arbitrary array `map` implementations are never invoked
in this bounded path. Repeated non-cyclic references and special JSON keys remain
data, and returned containers are isolated copies. The proposal API shape and
existing argument budget are unchanged. No new wire Schema, migration, dependency,
capability, cloud transport, or authorization behavior is introduced.

Only the parser boundary is bounded: this does not bound a provider's own memory
allocation, make in-process proxies a sandbox, or prove the Runtime/tool/cloud
end-to-end lifecycle. Oversize failure does not undo a tool already executed and
must not trigger blind re-execution of that tool.

## Validation

Five new target groups cover exact byte/envelope boundaries; Unicode, escaped
controls and keys; cumulative growth and early rejection; JSON identity/isolation;
and non-JSON/hostile values. The test imports the real package parser in normal CI.

Local execution used Node 22.16.0 / TypeScript 5.8.3 in an isolated parser harness:
the parser source was transpiled, unused adapter re-exports omitted, and the
repository's ProtocolError class substituted for the otherwise unrelated contracts
initialization. The original source's blob hash was checked against GitHub.
The old parser failed the new regression suite; the modified parser passed 5/5.
A strict focused TypeScript check passed. This is not a full workspace build,
Node 24/Windows validation, or cloud/device test. Repository CI must validate the
actual dependency graph before merging this repair. No private content, credentials,
provider processes, audio devices, or cloud services were used.
