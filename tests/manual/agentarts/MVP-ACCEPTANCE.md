# Competition MVP: one acceptance path

<!-- current-design-20261009 -->
> 当前目标与协作规则（2026-10-09）：[完整设计](../../../docs/design/resident-developer-agent-20261008/DESIGN.md) · [离线阅读/全部 SVG](../../../docs/design/resident-developer-agent-20261008/index.html) · [两人确认与本机阅读门槛](../../../docs/reviews/DESIGN_READING_GATE.md)。WSS 主通道、HTTPS 备用；Wiki 记忆由 goo122 接入。goo122 与 Potatos498 均确认后才可按授权合并，禁止强制合并/管理员绕过。设计不等于已实现；本文历史验收与作者记录保留，旧合并规则以当前门槛为准。

> 维护入口（2026-10-07）：项目主要负责人为 zemeng；当前分工以 [模块分工](../../../docs/MODULE_ASSIGNMENTS.md) 为准，最新状态见 [ROADMAP](../../../docs/ROADMAP.md)。历史日期、作者和验收结论按原记录保留。

Owner: zemeng / D integration. Snapshot: 2026-09-24. Profile: `huawei_ict_agentarts`.
This is an acceptance plan, not a successful execution record.

## Baseline and dependencies

Start from main `c5c4ada`, not the overlapping PR #78 stack. Preserve existing
Desktop cancellation, data paths, and Runtime ownership. PR #62 overlaps the
merged MOD-09 implementation: reuse public Memory query/feed, SQLite Memory,
`createMemoryProjectionApplication`, `createPendingImpactApplication`, and
CoordinationStore `appendBatch`; do not copy its older alternate consumer.

| Stage | Owner / minimum interface | Required evidence |
| --- | --- | --- |
| Submit synthetic text | D Desktop main; A adapter; B `workflowGoalInput` pass-through | Same task and exact integrated commit; no Fake fallback |
| Real AgentArts orchestration | A / deployed Runtime invocations | Deployment, timestamp, trace/run correlation, bounded safe result |
| Local proposal and approval | B / Runtime Application, Policy, ToolGateway | Task-bound proposal; explicit approval; expiry/cancel/replay rejected |
| Read approved synthetic fixture | B execution / D scenario | Confirmed execution plus Evidence; no private directory access |
| Return minimal result to cloud | A/B continuation | Same local task, explicit NEW cloud invocation, per-invocation IDs and synthetic output projection |
| Consume changed fact | D / existing Memory projection application | Exact FactRef to NodeRef mapping, durable batch receipt, impact |
| Apply explicit repair | D / public cognition repair API | Expected graph revision, validated candidate, one atomic appendBatch |
| Display and restart | D Desktop / original Runtime and Memory DBs | Displayed answer and unchanged persisted result after restart |

Meeting fixture: meeting 15:00 -> 17:00, preparation 14:00 -> 16:00;
an unrelated plan stays unchanged. Baseline and correction are synthetic.
Never hard-code a successful cloud answer or manually edit storage to pass.
Master selected a bounded multi-invocation MVP on 2026-09-24: cloud proposal ->
local approval/tool -> new cloud invocation for a summary, correlated under one
local task. Low-code native same-cloud-run resume remains unavailable; a new
invocation is not a resumed run. Keep each actual cloud invocation/trace identity,
the task/tool/Evidence relation and any partial failure. Do not merge run IDs or
claim the original native same-run acceptance passed. A owns the continuation
adapter and B owns local execution gates; D consumes their reviewed public APIs.

The cloud candidate still requires validation and local authorization; model
confidence, including uncalibrated Laya output, cannot authorize execution.

Memory fact revision, feed checkpoint, and graph revision are distinct.
Staging -> provider confirmation -> projection activation is recoverable but
not a cross-database atomic transaction. Use the existing implementation.

## Configuration and minimum verification

Trusted host supplies `PA_RUNTIME_PROFILE=huawei_ict_agentarts`,
`PA_AGENTARTS_GATEWAY_URL`, `PA_AGENTARTS_RUNTIME_NAME`, and
`PA_AGENTARTS_AUTHORIZATION`; optional `PA_AGENTARTS_WORKFLOW_GOAL_INPUT` is
passed through unchanged for strict adapter validation. Competition submission
gets 180000ms; normal Local/Fake requests retain the Client default. Keep
`requestTaskCancellation` and `desktopDataPaths` intact.

The development-only opt-in `PA_DESKTOP_SYNTHETIC_MVP=1` binds the existing
`workspace.read_text@1.0.0` to this repository's dedicated synthetic fixture root.
`PA_AGENTARTS_RESPONSE_MODE=tool-proposal-json` and
`PA_AGENTARTS_REPAIR_CANDIDATE_VERSION=1.0` explicitly enable the strict
proposal/candidate parser for this development fixture. The candidate remains
unverified until a separate local repair task passes Policy and graph CAS.
Only exact arguments `{ "path": "meeting-update.json" }` are export-eligible.
Runtime still requests normal local approval; the export gate does not grant it.
The actual confirmed file result must match the approved synthetic meeting fields
exactly before those four fields can leave the machine. Paths, raw file content,
extra fields and Evidence claims are not exported. Default startup exposes none
of these tools, and this development-only opt-in is rejected in Local/Fake or
packaged execution. No arbitrary user directory is accepted.

Run syntax/diff checks for the composition change; then the necessary targeted
integration check after A/B dependencies are integrated. One real synthetic
multi-invocation scenario and its same-database restart readback are the MVP acceptance, not
several independent successes from different branches. Record failure honestly;
do not automatically retry paid or uncertain side-effecting operations.

Local persistence preparation (after building matching baseline dependencies):
`node --test tests/manual/agentarts/mvp-meeting-persistence.test.mjs`.
It uses real temporary SQLite stores and public APIs, but an explicitly supplied
synthetic repair candidate. It does not invoke AgentArts, authorize a tool, or
qualify as the final real-cloud acceptance.

2026-09-24 D preparation result: Node 24.15.0 compiled the matching-worktree
Runtime dependency closure (12 workspaces); the single persistence scenario
passed (1/1). The first executed attempt rejected an extra `limit` argument on
the test's `getVersion` call; the fixture call was corrected and the same test
passed without changing or weakening the production validator. Desktop/cloud
composition remains unverified.

Cloud console readback by D on 2026-09-24: target app
`32d4d44c-eade-4f3f-8f76-209c74609e79` is published (displayed publication time
2026-09-17 16:09:47). API panel shows POST
`https://defaultgw-gztdqobzmm.cn-southwest-2.huaweicloud-agentarts.com/runtimes/agent-arts-d5ae1174bc7d4cb8ab3dbbc6fae654e4/invocations`,
Authorization Bearer, input `query`. This was configuration readback only:
no invocation, no credential export, no changed cloud configuration. Browser
login does not populate the local authorization environment variable.

## Competition evidence and distinct submissions

Rule observations below were supplied by the project coordinator on 2026-09-24;
D has not independently re-reviewed the legal terms. Verify the applicable
edition/region and final organizer notices before submission; retain copyright
and contributor authorization. No agent accepts enrollment/legal terms for the user.

- Huawei official source:
  <https://e.huawei.com/cn/talent/#/ict/innovation-details?zoneCode=027425&zoneId=98269700&compId=85132021&divisionName=%E4%B8%AD%E5%9B%BD%E5%8C%BA&type=C002&isCollectGender=N&enrollmentDeadline=2026-11-30%2023%3A59%3A59&compTotalApplicantCount=1113>.
  Topic 2 requires AgentArts construction/orchestration/deployment and a visual
  demo. Coordinator reports preliminary weighting innovation 60%, application
  40%, and an online interactive demo for the final. Unchanged duplicate entries
  from other competitions are not acceptable.
- iCAN official source: <https://www.g-ican.com/competition/details?id=138>.
  Coordinator reports software track accepts an online demo or runnable program,
  2026-09-30 registration/work submission deadline, PDF at most 20 pages, MP4 at
  most 5 minutes, and link or source. A Windows installer is not today's prerequisite.

Freeze the iCAN first functional version with commit, artifact and evidence date.
For Huawei, record actual later improvements, such as deeper AgentArts workflow /
multi-agent orchestration, repeatable cloud evaluation and trace-linked repair
evidence, with before/after commits and measured results. These are a planned
improvement checklist, not completed claims; changing only the name is insufficient.

## Open evidence gaps

- The trusted Desktop host loads an existing AgentArts key from an ignored,
  current-user Windows DPAPI file for manual runs. Credential presence is not
  proof of any cloud request; the one-time loopback setup is closed.
- An earlier Desktop continuation returned application-specific JSON without
  `kind`; the strict adapter rejected it. After the candidate-only continuation
  contract and versioned synthetic projection, one later Desktop source task
  completed both published cloud invocations and received a strict candidate.
  A separate approved repair task committed graph revision 9 and survived restart.
- Native same-cloud-run resume remains unavailable. The selected MVP uses two
  separate published invocations correlated by one local task and Evidence.
- Runtime has a provisional task/Evidence/FactRef-bound local repair path. The
  real synthetic Desktop task and Fake-cloud SQLite test now cover separate
  Policy approval and restart. Do not parse task summaries into writes.
- No claim of real microphone/speaker acceptance or packaging delivery.

## D controlled integration receipt (2026-09-24)

This is not main and not a real-cloud acceptance. Composition tested at
`b69dcaa`: main `c5c4ada`, A PR #99 `cfdb170`, A PR #103 `bcee4d7`,
B PR #101 `f04086a`, D PR #102 `970bb35`, and D synthetic tool composition
`66efd54`. Newer source PR heads must be explicitly incorporated and rechecked
only for their affected paths.

- Node 24.15.0: matching Client/Coordination/Runtime incremental compilation passed.
- `apps/desktop/test/competition-synthetic-workspace.test.mjs`: 3/3 passed.
- `tests/manual/agentarts/mvp-readonly-runtime.test.mjs`: 1/1 passed. This uses a
  Fake cloud port with unverified proposals but real Runtime/Policy/ToolGateway,
  actual synthetic file read, explicit allow-once, minimal export, persisted
  conditional execution Evidence and same-database restart. It does not count as
  two real cloud invocations or a real Desktop interaction.
- `tests/architecture/dependency-boundaries.test.mjs`: 1/1 passed.
- Node syntax checks and `git diff --check`: passed.

The factory-level immediate-before-send host guard is still being connected by B;
do not treat the earlier handoff guard alone as closing every revocation window.
Versioned repair-candidate binding and Runtime-approved local graph commit remain
separate pending work. The read-only test does not silently perform that repair.

## D2 integrated receipt (2026-09-24)

The clean D2 branch at `2d947ffa` incorporates the final A/B/C source commits
available at this checkpoint. Node 24 targeted Desktop synthetic/cognition/real
SQLite host tests passed 7/7; B local repair tests passed 11/11. The existing
Electron Runtime Application smoke passed, and Electron 44.2.0 was installed
from its official cached package. The opt-in manual harness is
`tests/manual/agentarts/support/desktop-synthetic-e2e.cjs`; it uses isolated
ignored user data and saves only a redacted receipt. It automates the synthetic
UI approval clicks for validation, which are not a human authorization claim.

A's separate published AgentArts probes each returned HTTP 200: text,
`tool_proposal`, then graph-bound `repair_candidate` v1.0 matching the three
synthetic target references and dependencies. These are three independent query
receipts, not a resumed provider run or a Desktop completion.

The latest real Desktop attempt used the exact successful first-stage proposal
goal. The source task received a strict `tool_proposal`, displayed a local
read approval, consumed `allow_once`, confirmed `workspace.read_text`, projected
Fact revision 2 to graph revision 6, and saved the task/Evidence binding.
Its second published invocation was sent and returned HTTP 200 with complete
SSE and no error event. The final answer was valid JSON but lacked the required
`kind`/candidate shape, so the adapter rejected it and the Runtime marked the
source task `EXTERNAL_FAILURE`. No plan write occurred in that failed attempt.

After the candidate-only continuation contract and export policy v3 landed,
the later real Desktop source task in ignored `.cache/desktop-agentarts-wu7Qlf`
received two HTTP 200 published responses with distinct request IDs. The first
was a strict `tool_proposal`; the Desktop displayed and consumed `allow_once`,
the trusted tool confirmed the synthetic read, Fact revision 2 projected to
graph revision 6, and a task/Evidence binding was saved. The second response
was a strict `repair_candidate` v1.0; the source task succeeded and the native
preview path produced a candidate with all three expected summaries. The manual
harness substituted the dialog answer to create the local approval task; this
verifies dialog content and code path, not a human click or a screenshot of the
actual composited native dialog.

The initial harness then stopped on its own assertion of `toolName` in a UI
approval snapshot; the UI field is `action`. It had not approved or written the
graph. A corrected local-only resume launched the same user-data directory,
clicked the pending `cognition.commit_repair` approval in the Admin UI, and read
back a succeeded local task and graph revision 9. A second restart read both
tasks as succeeded, the attendance and preparation summaries at 17:00/16:00,
the unrelated plan still at revision 1, and two confirmed tool execution records.
The resume made zero cloud requests. Redacted receipts are
`.cache/desktop-agentarts-wu7Qlf/receipt.json` and
`.cache/desktop-agentarts-wu7Qlf/local-resume-receipt.json`.

Laya was not configured in this real Desktop run. The separate real Laya model
probe and Fake DecisionPort injection do not establish live Desktop consumption;
that remains a separate acceptance item. Native same-cloud-run resume, a human
dialog click, packaging and production/private-data use also remain outside this
receipt.

After this receipt, the Desktop source-marker recovery was hardened for a crash
between durable local-repair submission and writing `mvp-repair-submitted`.
On restart the trusted host finds the existing local task by its stable key,
validates its saved intent and source binding, then records the missing marker.
It never creates a second approval or repeats a completed graph write. A real
SQLite restart test fault-injects the absent marker after a confirmed commit;
the existing task and graph are preserved with no additional cloud call. This
is a recovery test, not another paid cloud run.

## D2 Laya Desktop run (2026-09-24)

The first wrapper start stopped before starting Laya or Electron: Windows
PowerShell 5.1 lacks the script's static random-byte method. After that ignored
wrapper was corrected and syntax-checked, the one authorized corrected run used
the same DPAPI credential and synthetic fixture. Its isolated data is
`.cache/desktop-agentarts-Yz7VtO`; `receipt.json` records the live request
boundary and `partial-readback.json` records the closed-database inspection.

Laya passed loopback health. The first published AgentArts invocation returned
HTTP 200 and a strict `tool_proposal`; the synthetic Admin UI responded
`allow_once`, and Runtime confirmed `workspace.read_text` with Evidence. The
confirmed correction projected Fact revision 2 and graph revision 6. The
Desktop-configured Laya DecisionPort then saved `mvp-local-impact-advice` as
`ready` at graph revision 6 with `ESCALATE_AGENTARTS / low_confidence`. That is
real Desktop consumption of local Laya, with advisory-only effect; the model
did not authorize a graph write. The harness installed its global fetch observer
after Desktop constructed the Laya transport, so its fetch count does not
measure that local request. The persisted advice and explicit transport
configuration are the evidence for this stage.

The second published AgentArts fetch began with a distinct request ID but
rejected locally with `TypeError` before an HTTP response was observed. Whether
the remote service received it is unknown. Runtime marked the source task
`failed / EXTERNAL_FAILURE`; no repair candidate, separate local write task or
plan-node CAS was created. The source plan nodes and unrelated plan remain at
revision 1. The wrapper reported its Laya service stopped and zero remaining
child/new Laya processes. No automatic paid retry was made. This partial run
does not replace the earlier completed two-invocation Desktop acceptance above
or establish a single new complete Laya-enabled run.

The receipt stores both fetch start times and the first response's HTTP 200,
but did not store the exact first-response arrival time, the rejected fetch's
`cause.name`/`cause.code`, or its abort-signal state. Runtime's saved deadline
was 13:19:53 UTC, after the harness finished at 13:17:35 UTC; the failure was
not a task-deadline expiry. The manual harness now records allowlisted cause
metadata, abort state and response/finish times for a future necessary run.
This change cannot reconstruct missing details from the completed attempt.
