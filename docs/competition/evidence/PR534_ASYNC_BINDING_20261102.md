# PR #534 async Competition binding repair — 2026-11-02

Profile: `huawei_ict_agentarts`. Worktree: `pr534-async-fix`, base `b9b5eb21`; runner service fix `938fd286` was cherry-picked for interface composition.

The real user request still delegates only its original `user-work`. A verified canonical worker may create async work bound to the original user task; its actual source task, run and input digest remain recorded. Only a confirmed original spawn permits execution or approval recovery after normal parent completion. Cancellation, failure, foreign binding, unknown results and expired deadlines remain closed.

Fixed actual consumers: lazy registry construction before Runtime exists; additive availability for canonical user-work; synchronous dispatch excludes confirmed async children; Competition worker/send/resume consume the fixed deadline and step cap; type tool allowlists remain enforced on resume. Type instructions and queued follow-up text enter the original Competition request as untrusted context. Pagination no longer drops older active or queued tasks after 500 records. Workspace reports remain in their original conversation; missing conversations retain pending reports rather than receiving another conversation's content.

Remote submission runs inside the original TaskRuntime lifecycle with its abort signal and deadline. Cancellation after submission remains `waiting_reconciliation`; it neither confirms remote stop nor starts a local replacement. Custom types and queued follow-ups use the existing local Competition worker before any remote send because that remote contract cannot enforce their constraints.

Validation is local and synthetic, not AgentArts or remote host acceptance:

- TypeScript dependency build in original root-script order; Runtime typecheck after final edits.
- `async-subagent-competition.test.mjs`: one actual Desktop/Runtime/Policy composition case, using an explicit Fake CoordinationPort. Covers canonical user-work spawn, completed parent, fixed type deadline/steps, real pending approval and resume, original tool allowlist, type/follow-up context consumption, nested/foreign proof rejection, workspace report deduplication and absent-conversation hold.
- `remote-subagent-dispatch.test.mjs`, exact new in-flight cancellation case: active Runtime ownership, signal/deadline propagation, cancellation retained as unknown, zero local replacement and zero repeat dispatch.
- JavaScript syntax and `git diff --check`.

Limit: follow-up for an already started child explicitly returns `UNSUPPORTED_CAPABILITY`; it is not acknowledged as accepted metadata. Integrating #535 execution-epoch control is required before safely accepting changes while a cloud proposal is in flight. No local Agent loop, scheduler, database or cloud fallback was added.
