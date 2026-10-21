# CI-only Windows standard-token draft

Connected to the Windows ci.yml path behind the actual short smoke gate. This is not a product execution backend and accepts no arbitrary
command, user, token, directory or credentials. Product native helper remains unchanged.

The executable accepts `--smoke` or `--run-check`. The latter executes the original fixed
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

## Short smoke (not the full check)

From the original checkout/cwd on a Windows x64 Runner with preinstalled .NET 8 SDK/runtime:

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

## Verification status

Linux author environment has no dotnet/C# compiler, PowerShell or Win32. No compilation,
ABI, token acquisition, smoke, Windows tests or full check has been claimed. Diff/static
review is preparation only. Root must review, compile and run the short Windows smoke;
failure is a real blocker and does not authorize fallback or skip. Do not wire shared CI
without requiring the actual short smoke to pass. Real new-head full CI remains mandatory.
