# CI-only Windows standard-token draft

Connected to the Windows ci.yml path behind the actual short smoke gate. This is not a product execution backend and accepts no arbitrary
command, user, token, directory or credentials. Product native helper remains unchanged.

The executable accepts `--smoke`, `--compatibility`, `--run-check` or `--run-psec-acceptance`;
`--architecture` only reports fixed native OS/process/.NET metadata. `--run-check` executes the original fixed
`npm.cmd run check` through a canonical, non-reparse System32 cmd.exe and npm.cmd found in
the current job PATH. It keeps the exact current environment and cwd. Paths containing shell
metacharacters are rejected, not rewritten. Non-elevated current tokens use CreateProcessW;
elevated callers use an existing same-user primary linked token, verified Limited. Only a
missing linked token permits CreateRestrictedToken(LUA_TOKEN | DISABLE_MAX_PRIVILEGE) on
the caller's own primary token. The restricted result may be Default or Limited, but must
still pass every actual elevation/integrity/admin group check. No arbitrary filtering or
UIAccess flag can count as proof of a standard token.

Every selected token and actual suspended child must have the same user SID/session,
TokenElevation=0, medium integrity exactly, UIAccess=0, and no enabled Administrators SID
(if present it must be deny-only). Child creation is suspended; assignment to a non-inherited
KILL_ON_JOB_CLOSE Job and actual token validation precede resume. The Job handle remains
with the launcher, with no breakaway flag. Exit code is returned unchanged. All launch failures
return 125 with fixed stage/native numeric error only. No login/UAC/account/production guard
changes or elevated fallback exist.

CreateProcessAsUserW still requires existing SeIncreaseQuota, and a linked token may require
SeAssignPrimaryToken. The documented restricted-own-token exception waives only the latter.
No privileges are granted by this tool. If the Runner cannot meet these prerequisites, it
fails; a real standard-user runner or a separately reviewed platform solution is required.

Explicit duplicate inheritable standard handles are the only handles in the startup handle
list. Environment uses the inherited Unicode block, without rebuilding or logging secrets.
Ordinary Runner Job nesting, linked-token ACL access to checkout/helper/Node/TEMP, native ABI,
and handle behavior must be verified on Windows before CI adoption.

## Bounded native failure metadata

After the original `--run-check` child exits, the still-loaded launcher preserves its
uint exit and reads fixed Application Error Event1000 metadata itself. It never
executes a checkout script or starts another command from the original Runner token.
The Node pin is captured before the ordinary-token child starts. All new `wevtapi.dll`
imports resolve only from System32; no PATH or writable application-directory DLL
lookup is used.

The existing short `--smoke` executes the bounded XML parser selftest, checks its result
and emits a separate read-only Event Log probe status. Every complete check, including
a healthy check, repeats those checks after closing the original child/Job. The selftest covers hostile paths, versions,
timestamps, duplicate fields, DTD/external entities, oversized input and unchanged exits,
including 0xC0000409. It does not generate a native crash. A healthy check emits only
probe status. A failed check may emit at most sixteen `node.exe` candidates matching
the captured Node version and original UTC check window. A candidate has only event
record/time, application/module basenames and versions, exception code and fault offset.
There is no test-child PID mapping; candidates do not establish a test or root cause.
Missing events and read failures remain `no_matching_candidates` / `unavailable`.
The healthy probe distinguishes no events, successful rendering without projection,
rejection by size/format bounds and unavailable reads. It does not promise that a
matching crash event exists; native render failures report `unavailable`, never no-match.

The query scans at most 128 records, renders at most 64 KiB per XML event, prohibits DTD
and external entities, and has a six-second caller budget. Handles and buffers are
released in their owning reader's `using`/`finally` paths; process exit reclaims any
reader still blocked in a local Windows API after the budget expires. The worker never
logs or writes files. Only bounded projected JSON reaches stdout; raw XML/messages,
paths, environment, identities, credentials, reports, dumps and exception details do
not. Diagnostic failures cannot replace the original check exit.

The Linux route tests guard this execution/security contract without compiling C#.
Actual Windows compilation, XML selftest and read-only access must be verified in the
official Windows run; Linux tests or a missing event do not supply that evidence.

## Short smoke (not the full check)

From the original checkout/cwd on a Windows x64 or ARM64 Runner with native Node and preinstalled native .NET 8 SDK/runtime:

```powershell
pwsh -File scripts/ci/windows-standard-token/smoke.ps1
```

The script publishes only this tool into a new RUNNER_TEMP directory and executes `--smoke`.
Smoke reads actual child tokens, captures both output channels, checks exact exit 23 plus
inherited env/cwd, and starts a child/grandchild tree. It retains a handle to the actual
grandchild before closing the launcher-owned Job and waits for both to terminate. A second
tree is owned by a separate launcher instance: smoke opens both descendant process handles,
terminates only that launcher, and waits on both original handles to prove reclamation.
GitHub cancellation integration remains a separate Windows acceptance check.

Internal fixed `--smoke-*` modes are process probes, never a free command interface. The
grandchild sleeps for at most 60 seconds if a test is interrupted. The full check has no new
timeout or test filtering; original CI cancellation remains in force.

## Strict real PSEC acceptance

`--run-psec-acceptance` uses the same validated ordinary-user token, suspended-child
checks and kill-on-close Job, but executes only the fixed `psec-acceptance.mjs` with
the current job's trusted Node. It accepts no caller command or arguments. Prepare
the current dependency closure and a newly built native helper, set the explicit
`PA_TEST_JOB_HOST_EXE` and task-specific external TEMP/TMP, then pass the original
smoke and compatibility gate before using this entrypoint.

The helper's fixed `--sandbox-diagnostics` reports OS, ordinary/AppContainer/elevated
token booleans, System32 DLL load stage/Win32 code and the four required exports;
`--sandbox-support` separately queries the PSEC contract. Neither diagnostic claims
enforcement. The acceptance refuses elevated, outer AppContainer or unknown token
receipts and always requires `PA_TEST_NATIVE_SANDBOX_REQUIRED=1` for both real root
scenarios. Each must execute its expected root and minimum scenario count, exit 0,
and have zero fail/cancelled/skipped/TODO. Diagnostics alone cannot count as success.

The output directory contains safe diagnostics, exact TAP hashes and only newly
created synthetic authorization receipts. It excludes the SQLite/cache tree. The
current real Windows result and Hosted boundary are recorded in
`docs/competition/evidence/PSEC_REAL_COMPLETION_20261022.md`.

## Verification status

Manual Runner probe target `psec-strict-arm64` selects the standard
`windows-11-vs2026-arm` image and native Node 24.15.0 ARM64. It leaves the existing
`psec-strict` Windows Server x64 target and ordinary probe targets selectable.
The native toolchain gate requires Node/OS/dotnet Host agreement plus installed
.NET 8 SDK/runtime; helper and launcher publish with the matching explicit RID.
The actual ordinary-user acceptance rechecks both apphosts/process architectures,
.NET 8 framework and original OS architecture. Emulation or an unknown architecture
fails. The original Framework64 csc checks remain required, with no alternate path
or skip; that legacy compatibility result alone is not native ARM64 PSEC evidence.
Both original REQUIRED scenarios and their zero-skip TAP gates remain mandatory.
See `docs/competition/evidence/PSEC_HOSTED_ARM64_CANDIDATE_20261022.md` for preparation
evidence and the remaining Hosted run.

On head 12083a7b the official Windows job 119340508898 compiled this tool and actually
passed the restricted-own smoke, including both Job-close and killed-launcher descendant
reclamation. The full original check then failed compiling the original voice host with
Framework64 csc exit 3221225794 (0xC0000142), with npm internal CALL diagnostics also present.
This does not establish a desktop cause or prove that native tests passed; they were not reached.

The next short gate adds fixed `--compatibility` original-token/selected-token comparisons.
Its Node script executes canonical cmd/npm prefix and csc /help (no output artifact) using
both the full inherited environment and the exact voice SystemRoot/WINDIR/TEMP/TMP environment,
shell:false/windowsHide:true. Reports contain only fixed stages, numeric exits and booleans.
Read-only AccessCheck asks for full access to the inherited windowstation/desktop security
descriptors and reports unknown separately from denial. Enabled logon SID existence/retention
is reported only as booleans. The original elevated-token route is available only to these
fixed diagnostics, never to the complete check. No existing desktop ACL is changed.

Private noninteractive desktop remains a candidate, not an implemented or proven fix:
CreateWindowStationW with a unique CI name, protected same-user/SYSTEM DACL and Medium label;
temporarily SetProcessWindowStation only to CreateDesktopW on that station, then restore
the original borrowed station in finally. Child StartupInfo.Desktop must name that exact
private station\\desktop. Job descendants must terminate before CloseDesktop/CloseWindowStation;
neither object may use CloseHandle or be inherited. No WinSta0/Default ACL modification,
new account or login is permitted. Required access, successful full-env/minimal-env probes,
and compatibility with all original desktop tests must be demonstrated before adoption.

The added compatibility diagnostics are not compiled or run yet.

Head 660b4fbc subsequently compiled and passed smoke. Original-token cmd/npm prefix and
both csc /help environments returned 0; selected-token versions all returned 3221225794,
without output or timeout. Both token DACL AccessChecks reported full access and retained
enabled logon SID. This excludes a failure specific to the minimal voice environment or a
simple observed DACL/logon-SID denial; it does not establish a desktop/MIC/console root cause.

The next fixed matrix compares direct launcher-created cmd/npm prefix and csc /help with
existing creation flags versus only CREATE_NO_WINDOW added, for both original and selected
tokens. STARTF_USESHOWWINDOW/SW_HIDE is explicit in every variant; no new visible console
or detached process is requested. The unchanged Node second-generation probes are also run
under each first-generation Node console variant. All token validation, stdio, env, cwd and
Job rules stay the same. This matrix changes no full-check flags and creates no private
desktop or ACL. New output remains only fixed stages, numeric exits and booleans.

86920567 actually compiled/passed smoke. Original token passed every console variant.
The selected token directly launched csc with the inherited console successfully, but
CREATE_NO_WINDOW caused both direct cmd/csc to return 0xC0000142. Node's hidden second-generation
launches failed too. This identifies the console-dependent startup boundary, not the exact
OS authorization failure; no claim of a CSRSS identity or desktop ACL root cause is made.

The next candidate changes **only the newly created private restricted token**'s DefaultDACL
to two explicit GENERIC_ALL allow ACEs, for its same user and SYSTEM. It does not mutate the
current token, an existing linked token, any existing process/thread/windowstation/desktop
ACL, integrity/elevation, privileges, or product guards. This is a template for subsequently
created objects, not an authority grant to another account. Current and linked-token paths
are unchanged. No private windowstation/desktop is created.

Compatibility keeps an untouched primary-token copy before setting the new default. The
old-copy matrix is evidence only: nonzero exits/errors are recorded and never counted as
candidate success. Original and actual candidate matrices must pass every direct/Node probe,
including exact npm prefix, stdout, empty stderr and both voice environments; otherwise the
short gate fails and full check cannot run. The candidate is also used by the ordinary
complete-check path, with all prior token/Job checks unchanged. DefaultDACL reports are only
literal same-user/SYSTEM GENERIC_ALL ACE configuration booleans, not effective-rights or
actual CSRSS access evidence. This candidate is not compiled or run yet; new Windows CI
must prove whether it fixes startup and then run the full original check.

Linux author environment has no dotnet/C# compiler, PowerShell or Win32. No compilation,
ABI, token acquisition, smoke, Windows tests or full check has been claimed. Diff/static
review is preparation only. Root must review, compile and run the short Windows smoke;
failure is a real blocker and does not authorize fallback or skip. Do not wire shared CI
without requiring the actual short smoke to pass. Real new-head full CI remains mandatory.
