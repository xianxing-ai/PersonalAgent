# Competition continuation aggregate budget

<!-- current-design-20261013 -->
> 本文按所记版本阅读，API/阶段/验收事实保留。当前依据：[完整主架构](../design/workflow-architecture-20261013/DESIGN.md) · [28功能流程](../design/workflow-architecture-20261013/WORKFLOWS.md) · [连通图](../design/workflow-architecture-20261013/index.html) · [接口状态](../interfaces/CURRENT_INTERFACE_CATALOG.md) · [协作规则](../../CONTRIBUTING.md)。唯一全局语义决策为自有ARM64镜像内Laya，国内MaaS为执行候选，责任图/并行/后台影子按当前设计；旧DeepSeek全局决策、Laya本机部署和双人本机阅读不作为现行要求。设计不等于实现；非作者有效Approve和真实检查仍须满足。


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
