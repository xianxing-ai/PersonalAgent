# Hosted Windows 11 ARM64 PSEC candidate — 2026-10-22

Status: preparation verified with focused source tests; Hosted ARM64 compilation,
standard-token smoke/compatibility and real PSEC execution are **not_run**. This
does not replace the separate local x64 receipt in
[PSEC_REAL_COMPLETION_20261022.md](PSEC_REAL_COMPLETION_20261022.md).

## Reason and official platform basis

The integration owner supplied the strict x64 run
[39725054857](https://github.com/xianxing-ai/PersonalAgent/actions/runs/39725054857)
for source `10cc9bbe`, job `119646979653`, artifact `12402772643`: Windows Server
`26100.33296`, ordinary token, System32 `processmodel.dll` absent, loader Win32 126,
all four exports false and contract `DllNotFoundException` / `-2146233052`.
It failed with zero skips. This candidate has not corrected that Server image.

[GitHub's runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
lists the standard `windows-11-vs2026-arm` label for public/private repositories.
[The GA announcement](https://github.blog/changelog/2026-08-20-windows-11-arm64-vs2026-image-generally-available/)
and [official image inventory](https://github.com/actions/runner-images/blob/main/images/windows/Windows11-VS2026-Arm64-Readme.md)
establish the Windows 11 ARM64 candidate, not availability of PSEC on the actual
assigned VM. [Node 24.15.0 checksums](https://nodejs.org/download/release/v24.15.0/SHASUMS256.txt)
include a native Windows ARM64 distribution. Microsoft documents
[.NET support on Windows ARM](https://learn.microsoft.com/en-us/windows/arm/overview).
No larger runner, runner registration, service purchase or DLL redistribution is
introduced. The existing GitHub standard CI usage policy still applies.

## Fixed acceptance path

The new explicit `workflow_dispatch` target `psec-strict-arm64` selects exactly
one `windows-11-vs2026-arm` job. Existing `psec-strict` remains Windows Server x64;
ordinary short probes retain their existing routes. Push refs cannot start either
strict target. No job permits `continue-on-error` or an optional skip.

1. `actions/setup-node` installs `.node-version` 24.15.0 with `architecture: arm64`.
   Before npm install/build, the native gate compares the Node process and OS
   machine architecture with the requested matrix target, then checks the actual
   `dotnet --info` Host architecture and installed .NET 8 SDK/runtime. A mismatched
   or emulated host fails; .NET SDKs are not automatically installed.
2. The helper and launcher publish with explicit `win-arm64` RID and
   `--self-contained false`. The helper builder checks the apphost PE machine.
   The launcher exposes only fixed safe `--architecture` metadata, and smoke
   checks its actual process and OS architectures before publishing the launcher
   entrypoint. Independent external TEMP/TMP use the current job's RUNNER_TEMP.
3. The original standard-token smoke and `--compatibility` still execute fully.
   Direct and Node-descendant Framework64 `csc /help` probes remain required in
   both original environments and console variants. No ARM-specific bypass,
   substitute compiler or skip was added. A legacy compiler's compatibility
   result does not prove native ARM64 PSEC execution.
4. `--run-psec-acceptance` validates the launcher's native architecture and uses
   the original validated ordinary-user token, suspended-child check and Job.
   Inside that actual child the acceptance rechecks native Node/dotnet, both PE
   apphosts, launcher process/OS/.NET 8, helper process/OS/.NET 8, and the original
   ordinary-token and DLL/export/contract diagnostics. An unknown or mismatched
   architecture produces a failed receipt before either positive scenario.
5. The unchanged real roots execute with `PA_TEST_NATIVE_SANDBOX_REQUIRED=1`:
   - `real Windows PSEC boundary, generation guards and lifecycle` — at least 7
     tests, including the real boundary/lifecycle scenarios;
   - `one real original question gates a production PSEC command and never replenishes authority`
     — at least 1 real authorization-chain test.
   Both require exit 0, their exact root, complete TAP summaries and zero
   fail/cancelled/skipped/TODO. Missing DLL/API/helper remains a failure.

The safe receipt now records the runner name and native toolchain/launcher/helper
metadata alongside the existing source SHA, image version, hashes, original TAP
and synthetic authorization receipts. It still excludes private databases and
real account/model activity.

## Focused verification on the author's x64 host

Worktree: `.worktrees/psec-real-completion`; branch `codex/psec-real-completion`;
base `dc477a52272495d088b73f0dad40e4bc5fc5adc2`.

```text
node --test packages/coding-tools/test/host-architecture.test.mjs scripts/ci/runner-probe.test.mjs scripts/ci/windows-standard-token/psec-acceptance-result.test.mjs
9 passed; 0 failed; 0 skipped; 0 cancelled; 0 todo
```

The architecture fixtures exercise native x64/ARM64, emulation/target mismatch,
dotnet metadata without .NET 8, invalid PE machines and actual runtime receipt
mismatch. The route checks exercise both strict push rejections and the existing
x64/ordinary selections. They are source/fixture evidence, not Windows ARM64
process evidence. Node syntax checks, workflow YAML parsing, PowerShell Parser on `smoke.ps1` and
`git diff --check` passed. No C# compile, cross-build, dependency installation,
native execution, full build or model invocation was run during this increment
because the integration owner reserved the real-machine resource slot elsewhere.

## Hosted handoff and remaining result

The integration owner reviews and normally merges this increment, pushes the
reviewed ref, then dispatches `Runner probe` with target `psec-strict-arm64` on
that exact ref. This work package does not push or dispatch cloud jobs itself.
Collect the actual `runner_name`, run/job/source SHA, assigned image version,
architecture preflight, smoke/compatibility logs and `psec-strict-<run>-<attempt>`
artifact. Only both real REQUIRED roots passing with zero skips can establish
Hosted ARM64 acceptance. Platform label, static image inventory and local x64
success cannot do so. Any PSEC/token/Framework64/runtime failure remains a
specific unresolved platform prerequisite until its actual receipt is reviewed.
