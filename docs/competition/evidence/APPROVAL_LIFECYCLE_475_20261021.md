# Issue 475 — approval lifecycle evidence

Profile: `huawei_ict_agentarts`. Base: `e7d4e0c6f0830f7078a49438ea7d31fe39293394`.
Worktree: `.worktrees/issue-475-approval-lifecycle`; branch: `codex/fix-approval-export-lifecycle-475`.

## Saved increment: Runtime expiry

The existing TaskRuntime owns expiry of pending tool approvals, both on startup and at the nearest deadline. The effective deadline is the earlier of the invocation deadline and ten minutes. Expiry commits before returning a `TIMEOUT`; throwing does not roll back the resolution. A persisted system expiration audit record consumes no execution grant.

The frozen `approval.list` state enum remains `pending | allowed | denied`. Expired approvals persist as `denied` with private `resolution: {actor: 'system', reason: 'expired', resolvedAt}` metadata. No schema migration is required. The private Desktop projection checks the original approval ID, task and revision before projecting `systemExpired`; actual user denial remains labelled “已拒绝”. Old runtimes can read the denied state and fail closed, but an old UI cannot distinguish system expiry from user denial.

Waiting tasks become failed with `TIMEOUT`. An original started/unknown tool or in-flight/unknown cloud receipt instead becomes `waiting_reconciliation`, preserving uncertainty without retry. The explicit state-machine edge `waiting_approval -> waiting_reconciliation` serves this case. Terminal/cancelled tasks are preserved. The Application releases ephemeral work and refreshes the existing parent/child lifecycle; it creates no new scheduler or task store.

## Verification

- Own-tree `npm ci --ignore-scripts --no-audit --no-fund`: 201 packages; Node 24.15.0, npm 11.12.0. No Electron download or native install hooks.
- Sequential build of the Runtime dependency closure: dependencies passed. Runtime compilation exceeded an artificial 512 MiB V8 heap cap, then passed with a 1 GiB cap; Client compilation passed with 512 MiB.
- `node --test apps/runtime/test/approval-lifecycle.test.mjs apps/runtime/test/runtime.test.mjs`: 21/21 passed.
- `node --test apps/runtime/test/host-tool-task.test.mjs apps/runtime/test/subagent-parent-resume.test.mjs apps/desktop/test/approval-card.test.mjs`: 15/15 passed.
- After tightening the actual Fake-provider request-count assertion: parent-resume plus approval-status: 7/7 passed.
- After preserving the real user-denial label: approval-projection plus approval-status: 4/4 passed.
- `git diff --check`: passed.

These tests use isolated databases/Fake adapters. They cover boundary expiry/answer ordering, one-shot grant reuse prevention, argument substitution, late or duplicate answers, cancellation, reopened pending approvals, active worker cancellation, unknown-result preservation and the existing parent continuation. No real account, cloud export, model, Docker or Electron UI was exercised.

## In progress, not delivered by this increment

The original export-dialog race, the unified once/permanent/deny conversation card, removal of Settings consent prerequisites, connector consumers, and the actual Windows sandbox backend remain integration work. The expiry checks above do not prove those features. The final combined Issue 474/475 PR will record their actual wiring and validation separately.
