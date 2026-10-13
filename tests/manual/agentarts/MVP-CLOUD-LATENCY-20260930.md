# AgentArts MVP cloud latency work (2026-09-30)

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Profile: `huawei_ict_agentarts`. Owner: zemeng. Status: in_progress / WIP.
This record distinguishes console configuration from request-level acceptance.

## Resumed work and independent fast workflow

- Existing three workflows officially exported before changes, SHA256:
  `A60ADD4AC06B3C634B2CA072B2B7C903DEA77C9250AC77C24CF7F06A5AAE46BC`.
  Backup is ignored and may contain provider authentication data; never publish it.
- New task workflow `PA-MVP-快速工具与答复`, entity
  `71f3004f-faba-4487-9e6f-996194ec2b3c`, created through the console.
  Old controller draft/source and runtime v14 have not been replaced.
- Published source `mvp-fast-20260930-a` / `1790745445443`, publication time
  2026-09-30 13:17:25 GMT+08, confirmed by version-history readback. The following
  new-runtime deployment dialog was cancelled; no new runtime was created.
- Fast graph: Start → LLM → End. DeepSeek-V4-Flash, stream enabled,
  history disabled, temperature 0.2, maximum response 2048 tokens.
- Protocol permits catalog-constrained proposals including locally approved
  write candidates, without cloud authorization or execution. Continuations
  summarize confirmed bounded projections. Repair candidates belong to the
  professional flow. Actual catalog names/versions/schema are mandatory.
- Real platform trial 2026-09-30 13:15:33–13:15:35 (GMT+08): ordinary one-sentence
  introduction with empty tool list; strict `kind:text` result, one model node,
  platform total duration **2.25s**. Trace showed reasoning output, so disabling
  thinking is not yet verified. This is neither TTFT nor Desktop latency, and
  is not a comparable before/after benchmark against the prior meeting task.
- P8 reports formal command proposals `workspace.node_check`,
  `workspace.npm_build`, `workspace.npm_test`, version `1.0.0`, input schema
  `{type:object,properties:{},additionalProperties:false}`. Trusted fixed recipes;
  cloud projection only `{recipeId,exitCode,passed}`. P5/P7/Notepad capabilities
  have not been published as cloud tools and must not be invented.
- DSL builder emits only a new uniquely named workflow; provider credentials
  and old workflow resource lines are never emitted. Browser filechooser timed
  out; independent workflow was created through UI instead. Generated candidate
  DSL is not proof of imported or deployed configuration.
- Independent router copied from World, entity
  `81bc9eb8-cf6a-4869-a1a2-e3b446349447`, named `PA-MVP-受限主路由`.
  Existing strict Code/Branch guards retained. Ordinary Review node was replaced
  in this copy by fast source `1790745445443`; query references Start.query and
  aggregation consumes fast.response_content. The original World is untouched.
- Complex branch retains World model → Plan `1790340242730` → Review
  `1790343701113`; this does not prove all newer P5/P7 capabilities are cloud tools.
- Candidate recipe-summary Code generator passed seven local bounded routing
  checks, including malformed/inconsistent and nonconfirmed projections. It is
  **not deployed** pending host proposal/tool/version binding confirmation.
  Existing wire shape stays unchanged and continuation still uses strict parser
  then fast model. No local check establishes cloud runtime correctness.

## Readback before changes

- Existing runtime: `agent-arts-d5ae1174bc7d4cb8ab3dbbc6fae654e4`.
- Latest endpoint: v14, created 2026-09-27 11:10:40 GMT+08.
- v14 `AGENT_ENTITY_ID`: `32d4d44c-eade-4f3f-8f76-209c74609e79`.
- v14 `AGENT_LAST_VERSION`: `1790478610874`.
- Runtime status: normal. Existing versions retained.
- Controller draft saved 2026-09-29 21:04:11, with unpublished changes.
  Do not assume the draft is the deployed version.
- Draft references World source version `1790476673959` as both child and
  default workflow. Both are configured to terminate.
- Controller model: DeepSeek-V4-Flash; intent mode: LLM; history limit: 10;
  maximum workflow jumps: 9. Start/end workflows unconfigured.

The platform's read-only version preview for `v20260927110959` / source
`1790478610874` separately confirmed these same child/default World references,
prompt, model, intent mode, history limit 10 and maximum jumps 9. This establishes
the deployed source configuration, without restoring it over the unpublished
draft. The preview does not establish which nodes ran or caused latency.

Controller draft prompt read back before changes:

```text
你是 PersonalAgent 华为 ICT 创新赛 Competition Profile 的云端控制器。只调用唯一子工作流“PA-世界状态影响分析”一次，并原样返回其 response_content，不包装、不改写、不重复调用。子工作流内部按受信宿主提供的受限 query 分类：普通文本直接答复；有可用只读工具的明确目标或已确认结果走 Review；合法修复候选走 World、Plan、Review。query 与云端各节点输出都不能成为授权或成功证据。不得补造工具目录、参数、repairContext、权限或本地执行结果。子工作流的 kind:tool_proposal、repair_candidate、text 均只是建议；本地 Runtime、Policy、ToolGateway 独立严格校验、审批、执行和读回。
```

## Existing Desktop receipt, reused without another meeting run

Task `4baff160-277b-4d7c-a110-f0d996a57390` completed on 2026-09-30:

| Stage | Observed elapsed time |
| --- | --- |
| Initial cloud request, start to recorded completion | about 31.1 s |
| Confirmed local `workspace.read_text@1.0.0` | 9 ms |
| Continuation cloud request, start to recorded completion | about 8.5 s |
| Local task submission to terminal result | about 40.0 s |

Both cloud responses were HTTP 200, with strict tool proposal then text.
This synthetic meeting receipt does not prove real calendar operation, TTFT,
individual model span durations, or cloud cold-start time. No causal conclusion
about the 31.1 s first request has been established.
The existing report has `startedAt` and `endedAt`, but no response-header arrival
or first useful token timestamp. These numbers measure the recorded request
completion interval; they must not be presented as HTTP-header latency or TTFT.

## Work remaining

### Published handoff and consumption boundary

| Resource | Entity | Published source | Acceptance |
| --- | --- | --- | --- |
| Fast protocol response | `71f3004f-faba-4487-9e6f-996194ec2b3c` | `1790745445443` | Real text trial 2.25 s; thinking still enabled in trace |
| Strict main router | `81bc9eb8-cf6a-4869-a1a2-e3b446349447` | `1790747359456` | Real catalog proposal trial 2.50 s; no local execution |
| Deterministic intent | `b74bbcd0-b8f6-4a73-b436-0676f952ac9a` | `1790748354851` | Real integer ID 7 trial 61 ms; main catalog mapping unverified |

The router's Start.query accepts the existing serialized coordination envelope:

```json
{"goal":"请对当前已授权工作区运行一次workspace.node_check语法检查。","availableTools":[{"name":"workspace.node_check","version":"1.0.0","inputSchema":{"type":"object","properties":{},"additionalProperties":false}}]}
```

The confirmed continuation uses the existing wire contract. Only a trusted host
may construct it after matching the proposal and tool receipt; this sample is a
contract example, not an execution receipt:

```json
{"continuation":{"proposalId":"proposal-001","state":"confirmed","result":{"recipeId":"node-check","exitCode":0,"passed":true}}}
```

No tool/version fields are added to that wire contract. Pending or unknown
execution must not become confirmed. No command arguments, private source,
stdout/stderr or absolute workspace paths are sent. Local Policy, approval,
ToolGateway and Evidence remain the authority for execution and completion.
The existing adapter supports explicit `workflowGoalInput`, but that code option
does not prove a workflow is bound to this Runtime. Preserve the current v14
composition until a supported mapping and actual invocation are verified.

The Python file records the deployed intent Code body. Both PowerShell builders
are local candidate generators, not the cloud publication mechanism or an
automatic deployment command. The recipe-summary optimization remains undeployed.

Independent no-model intent workflow draft `PA-MVP-确定性意图`, entity
`b74bbcd0-b8f6-4a73-b436-0676f952ac9a`, has the official `messages` and
`intents` array-of-object input shapes and integer `intent_id` output.
`mvp-deterministic-intent.py` selects only a unique exact named strict-router
intent from the supplied controller catalog. Five bounded local checks passed
(including non-fixed ID 7, boolean ID rejection and ambiguous names).
This selection is not authorization; the child router still validates the
request envelope, and local Runtime/Policy gates still apply. The platform trial
at 14:04:49 GMT+08 returned `7` for an exact router intent whose supplied ID was
7, with total 61 ms (Code 50 ms). The graph contained only Start, Code and End.
Version history confirmed `mvp-intent-20260930-a`, source `1790748354851`,
published at 14:05:55 GMT+08. Main-controller binding is pending at this
checkpoint.

New independent multi-agent controller `PersonalAgent-MVP协调器`, entity
`ae641e4a-1524-4435-a132-c58fb13e288d`, was created without modifying the old
controller's unpublished draft. Its deterministic intent and router bindings
are being configured; it is not yet deployed.

At 14:15:54 the new controller's `{}` trial returned intent-not-recognized.
Debug readback showed initial default LLM intent recognition (1.34 s), only
classification 1 and the original default prompt, despite the local canvas
showing the intended workflow bindings. The visual canvas therefore does not
prove those edits persisted. Publishing/source preview is being used to verify
the actual source before any runtime change. No Desktop success is claimed.
Diagnostic publication `mvp-main-20260930-a`, source `1790749155220`, at
14:19:15 confirmed the failure: its read-only preview retained the initial
model intent recognition and unconfigured workflows. This source is ineligible
for Runtime binding. A second controlled save kept the form open and published
directly from the configured canvas as `mvp-main-20260930-b`, source
`1790750348089`, at 14:39:08. Its read-only source preview again showed the
initial model and all workflows unconfigured. Both diagnostic sources are
ineligible for Runtime binding; this is a reproducible persistence failure,
not a successful deterministic main controller.

Official export of only the new controller displayed success, but the supported
download event timed out after 10 s and no downloaded file was present. There
is no export artifact to inspect or import. No private API, credential extraction
or same-name overwrite was used to work around this failure.

The existing Runtime's edit form was inspected without saving. Its current
`AGENT_TYPE` and `AGENT_ENTITY_TYPE` are both `agent`; entity/source still match
v14. Official [workflow deployment documentation](https://support.huaweicloud.com/lowcode-agentarts/agentarts_05_0053.html)
supports workflow deployment, but its first-deployment UI creates a Runtime.
Reuse of this existing Runtime for a workflow entity has not been established,
and no type string or API mapping is inferred. Runtime binding and formal
Desktop latency remain unavailable at this checkpoint.

The independent router `PA-MVP-受限主路由` was published as
`mvp-router-20260930-a`, source `1790747359456`, at 13:49:19 GMT+08.
Its actual platform trial at 13:41:17–13:41:19 used only
`workspace.node_check@1.0.0` with an empty-object schema. It returned
`{"kind":"tool_proposal","proposalId":"proposal-001","toolName":"workspace.node_check","toolVersion":"1.0.0","arguments":{}}`.
Observed platform total was 2.50 s, fast subflow 2.44 s and Code 44 ms.
No local command ran during this trial. These values establish the wired
ordinary branch, not Desktop latency, TTFT, or improvement against the different
synthetic meeting task. Runtime v14 has not yet been replaced.

The earlier power-loss pause was revoked by the user. Work resumed with a clean
checkpoint at commit `977c209`. New independent source changes and the bounded
trial are recorded above. The unpublished controller draft remains separate from
the deployed v14. No Desktop latency improvement is claimed yet.

- Bind the new deterministic router to existing professional source versions.
- Resolve/verify thinking configuration and read back the deployed source.
- Keep World/Plan/Review for legitimate repair and local Policy/ToolGateway gates.
- Ordinary goals must consume only the current published tool catalog and return
  strict text or a legal proposal; unknown capabilities remain unsupported.
- Measure first useful output and terminal elapsed time on the necessary
  non-meeting acceptance path; do not run a broad paid benchmark.
- Hand off exact versions and binding to the sole P8 composition writer for real
  Desktop consumption of the formal P5/P6/P7 surfaces.

## 17:03 checkpoint: native controller copy and Runtime v15

This checkpoint supersedes the earlier pending Runtime-binding statements.
The failed empty-controller workflow-intent saves and export were not repeated.
The official Agent card **Copy** action instead preserved the working native
multi-agent controller structure in a separate entity:

| Item | Actual readback |
| --- | --- |
| Copied Agent | `PersonalAgent持续认知协调器_1` |
| Entity | `2f5d361c-bd85-4d2f-9903-bb35d4f55afa` |
| Published name | `mvp-controller-copy-20260930-a` |
| Published source | `1790758814293` |
| Published time | 2026-09-30 17:00:14 GMT+08 |
| Intent mode / model | Native LLM recognition / DeepSeek-V4-Flash |
| Child and default | Router source `1790747359456`, both terminate |
| History / jumps | 0 / 1 |

The copied form closed after Save and its saved timestamp became 16:54:02.
Independent **read-only published-source preview**, including the controller
form, confirmed the 296-character prompt, intent mode, history/jump limits,
both router pins and termination settings. The source is eligible for binding.
The original controller, original unpublished draft, and old published sources
were preserved. Deterministic intent source `1790748354851` remains standalone;
it is not deployed as this controller's intent recognizer. LLM intent overhead
therefore remains. Thinking-off and recipe-summary candidates remain undeployed.

The official **Save as new version** action reused the existing Runtime,
without creating another Runtime or changing credentials, permissions, image,
other environment variables, storage, or live/SIS settings:

| Runtime field | Actual readback |
| --- | --- |
| Runtime name | `agent-arts-d5ae1174bc7d4cb8ab3dbbc6fae654e4` |
| Console ID | `1beeb366-7d05-4bb5-b054-d0b626aaef7f` |
| New version / time | `v15` / 2026-09-30 17:03:43 GMT+08 |
| Status | Normal |
| `AGENT_TYPE` / `AGENT_ENTITY_TYPE` | `agent` / `agent` |
| `AGENT_ENTITY_ID` | `2f5d361c-bd85-4d2f-9903-bb35d4f55afa` |
| `AGENT_LAST_VERSION` | `1790758814293` |
| Existing access name | `Latest`, now explicitly mapped to `v15` |
| Old version | `v14` remains in the 15-entry version history |

Saving the new version automatically changed the existing Latest access mapping
to v15. Preserving v14 as a version does **not** mean Latest still invokes v14.
The existing invocation address remains:

```text
https://defaultgw-gztdqobzmm.cn-southwest-2.huaweicloud-agentarts.com/runtimes/agent-arts-d5ae1174bc7d4cb8ab3dbbc6fae654e4/invocations?endpoint=Latest
```

No workflow entity-type string or private API was guessed. The official
[InvokeRuntime contract](https://support.huaweicloud.com/api-agentarts/InvokeRuntime.html)
defines `query` for single/multi agents and `inputs` for workflows; it does not
document a per-invocation source/entity override. This deployment stays within
the already working native `agent` type and existing query/catalog/confirmed
continuation contract.

Ignored local UI evidence is under `.cache/cloud-mvp-build/`:
`controller-published-20260930.jpg`, `runtime-v15-binding-20260930.jpg`, and
`runtime-v15-latest-20260930.jpg`. The binding image includes only the three
non-secret entity/type/source rows; no provider credentials are exposed.

This checkpoint confirms **published source and configuration/endpoint
readback**, not a successful API invocation, tool execution, Desktop acceptance,
TTFT, or end-to-end latency improvement. P8 has the exact pins and access mapping
for one necessary non-meeting `workspace.node_check@1.0.0` proposal, trusted
local receipt, and confirmed continuation after final composition. Separate
initial-cloud total/TTFT, local execution, continuation and overall elapsed
time; TTFT stays unknown unless sampled. No extra cloud benchmark was run here.
New child/model and Goal capabilities are not asserted ready before their
host composition/catalog is published. Legal repair still follows the pinned
World/Plan/Review path; local Policy and Evidence remain authoritative.

## 18:19 checkpoint: Goal compatibility and Runtime v16

The v15 router accepted the historical confirmed Fact repair envelope, but not
the initial Goal REVISE projection or the current production continuation
wrapper. v15 therefore was not claimed as Goal/continuation acceptance.

Official native copies of Plan and Review preserve the original role entities.
The existing independent MVP router was updated through its Code/prompt editor
and native child-workflow picker. The picker did not offer workflow reference
replacement, so only this MVP copy's old Plan/Review nodes were replaced and
their input/output bindings restored through the visible canvas.

| Role | Entity | Published source | Version |
| --- | --- | --- | --- |
| Goal Plan | `65236810-db21-41cb-928b-39af691c4cfa` | `1790761689353` | `mvp-goal-plan-20260930-a` |
| Goal Review | `8004735c-cac6-4c09-9691-1a93233475ac` | `1790762412803` | `mvp-goal-review-20260930-a` |
| MVP router | `81bc9eb8-cf6a-4869-a1a2-e3b446349447` | `1790763138570` | `mvp-goal-router-20260930-a` |
| MVP controller | `2f5d361c-bd85-4d2f-9903-bb35d4f55afa` | `1790763483827` | `mvp-goal-controller-20260930-a` |

Read-only published previews confirmed the Plan/Review prompts and, at that
publication checkpoint, the router's 9,435-character Code source against
`mvp-goal-router.py`; the World Goal
addendum, child versions, parameter references and aggregation. Plan receives
Start.query and World.raw_output; Review receives Start.query, Plan.response_content
and Plan.world_result. The first-nonempty aggregate preserves Code.text_result,
Fast.response_content and new Review.response_content. Fast stays pinned at
`1790745445443`. Controller child/default both pin router `1790763138570`;
published history=0, jumps=1, LLM intent mode and termination were read back.

The initial Goal path consumes P5's existing fixed selected-decision prefix,
REVISE payload/nodes and repairContext, either directly or inside existing
`{goal,availableTools}`. `executed:false` means a proposal, not confirmed
execution. Target.summary remains the current plan baseline; Plan compares
actual old/new Goal semantics instead of requiring `current_plan` or copying
strategy/Laya descriptions. Review emits only existing repair_candidate 1.0.
Missing source/selection remains RECHECK. The original confirmed Fact path
continues to copy requestedSummary/requestedDependencies exactly.

The router accepts only the exact current production and historical confirmed
continuation wrappers (literal prefix/suffix), rejecting appended instructions.
For an exact recipeId/exitCode/passed receipt of a known recipe, it emits a
qualified kind:text summary with zero model calls. The wire has no tool/version
field; matching proposal, tool/version, persisted receipt and confirmed state
is P8's trusted Runtime responsibility. Cloud strings grant no authority.
Controller intent still uses a model; thinking-off and end-to-end speed are
not claimed verified.

At **2026/09/30 18:19:52 GMT+08**, the same Runtime saved **v16** and showed
**正常**, with the existing **Latest -> v16** mapping. Environment readback:
AGENT_TYPE=agent, AGENT_ENTITY_TYPE=agent, AGENT_ENTITY_ID=`2f5d361c-bd85-4d2f-9903-bb35d4f55afa`,
AGENT_LAST_VERSION=`1790763483827`. Credentials, network/access configuration,
image and other environment values were not changed. v15/v14 and original
sources remain available. This is deployment configuration readback only;
one final real cloud/Policy/CAS acceptance was handed to P8 after these pins.
No additional cloud probe, evaluator invocation or paid judge was launched.

Bounded local checks cover direct/wrapped Goal, executed/uncertain/RECHECK and
reference/baseline failures, current/legacy continuation wrappers and tampering,
old Fact confirmed/pending, recipe summary, and ordinary catalog routing.
Replay command: `python tests/manual/agentarts/verify-mvp-goal-router.py`.
These checks execute only the deterministic Python function; no cloud call or
local tool is invoked. Cloud prompt behavior and real CAS remain separately
unverified at this checkpoint.

Ignored UI proof: `goal-plan-published-20260930.jpg`,
`goal-review-published-20260930.jpg`, `goal-router-published-20260930.jpg`,
`goal-controller-published-20260930.jpg`, `runtime-v16-latest-20260930.jpg`,
`runtime-v16-binding-20260930.jpg` under `.cache/cloud-mvp-build/`.

After that publication checkpoint, the local router added tuple membership
checks so malformed list/dict `kind` and `state` values return a controlled
response. This hardening has not been published or verified in the cloud;
Runtime v16 and Latest still point to the previously read-back source.
