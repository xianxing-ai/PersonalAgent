using System.Diagnostics;
using System.Text;
using PersonalAgent.WindowsHost;
using PersonalAgent.WindowsHost.Service;

// Portable windows-host unit tests (second batch; the first batch was the
// RunJournal suite in host/test/journal). NotepadTargets.cs, HostService.cs,
// HostWire.cs, RunJournal.cs, HostSecurity.cs and LocalJournalDirectory.cs are
// compiled into this assembly verbatim, so these checks exercise the real
// production logic on any OS without Windows UIA/Win32: the NotepadTargets
// baseline/deadline/refusal gates and the NotepadTargetLease expiry+identity
// guard behind Observe/Resolve, HostService.CheckTargetReady deadline/stale
// semantics, the NotepadExecutionLifetime deadline math, ActiveExecution
// attach/dedup, and the BoundedJsonlReader framing limits that no other test
// covers on any platform.
//
// The NotepadAction surface is a throwing shim (NotepadAction.PortableShim.cs):
// reaching it fails the run, which proves the tested paths stay pure. Unique-tab
// selection, HWND/PID snapshot binding, foreground identity, untrusted-image
// checks, real pipes/ACL and user takeover stay out of scope and need a real
// Windows machine (registered in the PR, not silently skipped).

const string startedAt = "2026-09-25T12:00:00.000Z";
const string finishedAt = "2026-09-25T12:01:00.000Z";

// ---------------------------------------------------------------------------
// NotepadTargets: portable observation gates.
// ---------------------------------------------------------------------------

// Precondition for the no-candidate cases: this OS must not report any
// "notepad" process, otherwise Observe would leave the portable path.
if (Process.GetProcessesByName("notepad").Length != 0)
    throw new Exception("Portable environment unexpectedly reports notepad processes");

// The NotepadAction shim must be wired as the throwing stand-in, never as a
// silent stub that could bless a Windows-only path.
try
{
    NotepadAction.CheckSingleTabTarget(1, 1, DateTime.UtcNow);
    throw new Exception("Portable NotepadAction shim unexpectedly answered a target check");
}
catch (NotSupportedException) { }

// An unstarted baseline process has no queryable session identity. A baseline
// failure must reject the whole observation (fail closed) instead of ever
// selecting an old window that could become queryable later.
var stages = new List<NotepadObservationStage>();
var incompleteTargets = new NotepadTargets(() => [new Process()], stages.Add);
var refusedObservation = incompleteTargets.Observe(DateTime.UtcNow.AddSeconds(30));
if (refusedObservation.Target is not null || refusedObservation.ErrorCode != "UNAUTHORIZED")
    throw new Exception("Incomplete baseline must never select a window");
if (stages.Count != 1 || stages[0] != NotepadObservationStage.BaselineUnqueryable)
    throw new Exception("Incomplete baseline did not report exactly one baseline diagnostic");
// An expired deadline fails before the baseline gate and stays silent.
var lateObservation = incompleteTargets.Observe(DateTime.UtcNow.AddSeconds(-1));
if (lateObservation.Target is not null || lateObservation.ErrorCode != "TIMEOUT")
    throw new Exception("Expired observe deadline did not fail fast with TIMEOUT");
if (stages.Count != 1)
    throw new Exception("Expired deadline recorded a spurious observation stage");

// A complete (empty) baseline with no notepad processes observes no fresh
// window: NOT_FOUND with exactly one NoFreshWindow diagnostic, and no
// Windows-only metadata call (the shim would have thrown).
var cleanStages = new List<NotepadObservationStage>();
var emptyBaseline = new NotepadTargets(() => [], cleanStages.Add);
var emptyObservation = emptyBaseline.Observe(DateTime.UtcNow.AddSeconds(30));
if (emptyObservation.Target is not null || emptyObservation.ErrorCode != "NOT_FOUND")
    throw new Exception("Complete baseline without candidates did not report NOT_FOUND");
if (cleanStages.Count != 1 || cleanStages[0] != NotepadObservationStage.NoFreshWindow)
    throw new Exception("No-candidate observation did not report exactly one NoFreshWindow stage");

// Resolve must fail closed for anything that was never observed, without
// touching Windows-only identity or metadata checks (the shim would throw).
if (emptyBaseline.Resolve("missing-target-ref") is not null ||
    emptyBaseline.Resolve("") is not null || emptyBaseline.Resolve(" ") is not null)
    throw new Exception("Unknown targetRef resolved to a target");

// ---------------------------------------------------------------------------
// NotepadTargetLease: the expiry + identity guard shared by Observe/Resolve.
// The clock, metadata predicate and identity probe are all injected, so no
// real window, process or UIA metadata is touched.
// ---------------------------------------------------------------------------
var leaseBase = new DateTime(2026, 11, 4, 12, 0, 0, DateTimeKind.Utc);
var leaseExpires = leaseBase.AddSeconds(30);
var leaseClock = leaseBase;
var validateCalls = 0;
var identityCalls = 0;

// A fresh lease with valid metadata stays current, and the metadata lookup
// runs exactly once.
if (!NotepadTargetLease.IsCurrent(leaseExpires, () => { validateCalls++; return true; },
        () => leaseClock) || validateCalls != 1)
    throw new Exception("Fresh valid lease was not accepted with a single metadata lookup");
// An expired lease refuses before any metadata lookup.
validateCalls = 0;
leaseClock = leaseExpires;
if (NotepadTargetLease.IsCurrent(leaseExpires, () => { validateCalls++; return true; },
        () => leaseClock) || validateCalls != 0)
    throw new Exception("Expired lease performed a metadata lookup");
// The lease is re-checked between the identity gate and the metadata lookup:
// expiry crossing on that second clock read refuses before the metadata call.
validateCalls = 0;
var leaseNowCalls = 0;
leaseClock = leaseBase;
if (NotepadTargetLease.IsCurrent(leaseExpires, () => { validateCalls++; return true; },
        () => ++leaseNowCalls == 2 ? leaseExpires : leaseBase) || validateCalls != 0)
    throw new Exception("Expiry before the metadata lookup still ran the lookup");
// Expiry crossing during the metadata lookup itself must refuse the result:
// a slow UIA query cannot keep an expired target alive.
validateCalls = 0;
leaseClock = leaseBase;
if (NotepadTargetLease.IsCurrent(leaseExpires,
        () => { validateCalls++; leaseClock = leaseExpires; return true; }, () => leaseClock) ||
    validateCalls != 1)
    throw new Exception("Slow metadata lookup outlived its lease");
// Rejected metadata refuses the lease.
leaseClock = leaseBase;
if (NotepadTargetLease.IsCurrent(leaseExpires, () => false, () => leaseClock))
    throw new Exception("Rejected metadata kept the lease current");

// Identity is probed before and after the metadata lookup. A changed identity
// at any of the three probes must refuse the lease.
bool IdentityFlipsAtProbe(int flipOn)
{
    var calls = 0;
    return NotepadTargetLease.IsCurrent(leaseExpires, () => ++calls > 0, () => leaseClock,
        () => ++calls == flipOn);
}
leaseClock = leaseBase;
for (var flipOn = 1; flipOn <= 2; flipOn++)
{
    if (IdentityFlipsAtProbe(flipOn))
        throw new Exception($"Identity change at probe {flipOn} kept the lease current");
}
// An expiring identity probe refuses before the metadata lookup.
validateCalls = 0;
leaseClock = leaseBase;
if (NotepadTargetLease.IsCurrent(leaseExpires, () => { validateCalls++; return true; },
        () => leaseClock, () => { leaseClock = leaseExpires; return true; }) || validateCalls != 0)
    throw new Exception("Expiring identity probe entered the metadata lookup");
// An unqueryable identity fails closed at any position without leaking the
// exception: before the lookup (no metadata call) and after it (lookup ran once).
validateCalls = 0;
identityCalls = 0;
leaseClock = leaseBase;
if (NotepadTargetLease.IsCurrent(leaseExpires, () => { validateCalls++; return true; },
        () => leaseClock, () =>
        {
            identityCalls++;
            throw new InvalidOperationException("Synthetic identity failure");
        }) || validateCalls != 0 || identityCalls != 1)
    throw new Exception("Unqueryable identity did not fail closed before the metadata lookup");
validateCalls = 0;
identityCalls = 0;
leaseClock = leaseBase;
if (NotepadTargetLease.IsCurrent(leaseExpires, () => { validateCalls++; return true; },
        () => leaseClock, () =>
        {
            identityCalls++;
            if (identityCalls == 2)
                throw new InvalidOperationException("Synthetic identity failure");
            return true;
        }) || validateCalls != 1 || identityCalls != 2)
    throw new Exception("Unqueryable post-lookup identity did not fail closed");

// ---------------------------------------------------------------------------
// HostService.CheckTargetReady: request deadline first, then target freshness.
// ---------------------------------------------------------------------------
var readyBase = new DateTime(2026, 11, 4, 12, 0, 0, DateTimeKind.Utc);
var readyTarget = new ObservedNotepadTarget("opaque-notepad-1", 0, 123, readyBase,
    readyBase.AddMinutes(1));
var readyDeadline = readyBase.AddSeconds(1);
var readyClock = readyBase;

// An expired request refuses before any target lookup.
readyClock = readyDeadline;
var readyLookupCalls = 0;
var expiredReady = HostService.CheckTargetReady(readyDeadline,
    () => { readyLookupCalls++; return readyTarget; }, () => readyClock);
if (expiredReady.Target is not null || expiredReady.ErrorCode != "TIMEOUT" || readyLookupCalls != 0)
    throw new Exception("Expired readiness request performed a target lookup");
// A lookup that outlives its request deadline must not return the target.
readyClock = readyBase;
var slowReady = HostService.CheckTargetReady(readyDeadline,
    () => { readyClock = readyDeadline; return readyTarget; }, () => readyClock);
if (slowReady.Target is not null || slowReady.ErrorCode != "TIMEOUT")
    throw new Exception("Slow readiness lookup outlived its request deadline");
// The request deadline outranks target freshness: a fresh target is refused
// once the deadline passed during the lookup.
readyClock = readyBase;
var lateFresh = HostService.CheckTargetReady(readyDeadline,
    () => { readyClock = readyDeadline.AddSeconds(1); return readyTarget; }, () => readyClock);
if (lateFresh.Target is not null || lateFresh.ErrorCode != "TIMEOUT")
    throw new Exception("Fresh target outlived its request deadline");
// A fresh target is returned unchanged: no renewal, no new expiry.
readyClock = readyBase;
var freshReady = HostService.CheckTargetReady(readyDeadline, () => readyTarget, () => readyClock);
if (freshReady.Target is null || !ReferenceEquals(freshReady.Target, readyTarget) ||
    freshReady.Target.ExpiresUtc != readyTarget.ExpiresUtc || freshReady.ErrorCode is not null)
    throw new Exception("Fresh readiness changed or renewed its target");
// A stale target and a missing target both fail closed.
readyClock = readyBase;
var staleTarget = readyTarget with { ExpiresUtc = readyBase.AddSeconds(-1) };
var staleReady = HostService.CheckTargetReady(readyDeadline, () => staleTarget, () => readyClock);
if (staleReady.Target is not null || staleReady.ErrorCode != "TARGET_STALE")
    throw new Exception("Expired target was returned as ready");
var missingReady = HostService.CheckTargetReady(readyDeadline, () => null, () => readyClock);
if (missingReady.Target is not null || missingReady.ErrorCode != "TARGET_STALE")
    throw new Exception("Missing target did not fail closed");
// An unqueryable target (synthetic metadata failure) fails closed without
// leaking the exception.
var failedReady = HostService.CheckTargetReady(readyDeadline,
    () => throw new InvalidOperationException("Synthetic private metadata failure"), () => readyClock);
if (failedReady.Target is not null || failedReady.ErrorCode != "TARGET_STALE")
    throw new Exception("Unqueryable target did not fail closed");

// ---------------------------------------------------------------------------
// NotepadExecutionLifetime: the execution deadline is the earliest of the task
// deadline, the target expiry and the ten minute watchdog.
// ---------------------------------------------------------------------------
var lifetimeBase = DateTime.UtcNow;
using var disconnected = new CancellationTokenSource();
// The earlier of task deadline and target expiry wins, verbatim.
var taskDeadline = lifetimeBase.AddMinutes(2);
var targetExpiry = lifetimeBase.AddMinutes(3);
var taskBound = NotepadExecutionLifetime.Create(disconnected.Token, taskDeadline, targetExpiry)
    ?? throw new Exception("Fresh task-bound lifetime refused");
using (taskBound.Lifetime)
{
    if (taskBound.DeadlineUtc != taskDeadline || taskBound.Lifetime.IsCancellationRequested)
        throw new Exception("Task deadline did not bound the execution lifetime");
}
var targetBound = NotepadExecutionLifetime.Create(disconnected.Token, targetExpiry, taskDeadline)
    ?? throw new Exception("Fresh target-bound lifetime refused");
using (targetBound.Lifetime)
{
    if (targetBound.DeadlineUtc != taskDeadline)
        throw new Exception("Earlier target expiry did not bound the execution lifetime");
    if (targetBound.Lifetime.Token.WaitHandle.WaitOne(TimeSpan.FromMilliseconds(50)))
        throw new Exception("Fresh lifetime cancelled before its deadline");
}
// The ten minute watchdog caps far-future deadlines.
var watchdog = NotepadExecutionLifetime.Create(disconnected.Token,
    lifetimeBase.AddMinutes(30), lifetimeBase.AddMinutes(30))
    ?? throw new Exception("Watchdog lifetime refused");
using (watchdog.Lifetime)
{
    var remainingMinutes = (watchdog.DeadlineUtc - lifetimeBase).TotalMinutes;
    if (remainingMinutes is < 9.9 or > 10.1)
        throw new Exception("Ten minute watchdog did not cap the execution deadline");
}
// An expired deadline acquires nothing.
if (NotepadExecutionLifetime.Create(disconnected.Token,
        lifetimeBase.AddSeconds(-1), lifetimeBase.AddMinutes(5)) is not null ||
    NotepadExecutionLifetime.Create(disconnected.Token,
        lifetimeBase.AddMinutes(5), lifetimeBase.AddSeconds(-1)) is not null)
    throw new Exception("Expired deadline acquired an execution lifetime");
// A client disconnect cancels the linked lifetime immediately.
var linked = NotepadExecutionLifetime.Create(disconnected.Token,
    lifetimeBase.AddMinutes(5), lifetimeBase.AddMinutes(5))
    ?? throw new Exception("Linked lifetime refused");
using (linked.Lifetime)
{
    disconnected.Cancel();
    if (!linked.Lifetime.IsCancellationRequested)
        throw new Exception("Disconnect did not cancel the execution lifetime");
}

// ---------------------------------------------------------------------------
// ActiveExecution: duplicate execute tracking across requesters and sessions.
// ---------------------------------------------------------------------------
var activeIdentity = new HostRunIdentity("task", "run-active", "computer.notepad.replace_text",
    "1.0.0", "grant", RunJournal.PayloadDigest("before", "after"), "opaque-notepad-1",
    RunJournal.PayloadDigest("before", "after"));
using var activeCts = new CancellationTokenSource();
var activeExec = new ActiveExecution(activeCts, null!, "req-1", "s1", CancellationToken.None);
// A second requester can attach to the active run; no receipt exists yet.
if (!activeExec.TryAttach(null!, "req-2", "s1", CancellationToken.None, out var pendingReceipt) ||
    pendingReceipt is not null)
    throw new Exception("Second requester failed to attach to an active run");
// The same (requestId, sessionId) pair is deduplicated, not appended twice.
if (!activeExec.TryAttach(null!, "req-1", "s1", CancellationToken.None, out _))
    throw new Exception("Duplicate request failed to attach to an active run");
// The same requestId under a different session is a distinct requester.
if (!activeExec.TryAttach(null!, "req-1", "s2", CancellationToken.None, out _))
    throw new Exception("Cross-session duplicate was not tracked as its own requester");
var terminalReceipt = new HostRunRecord(activeIdentity, true, "verified", startedAt,
    finishedAt, "evidence-1", null);
var requesters = activeExec.MarkCompleted(terminalReceipt);
if (requesters.Count != 3 ||
    requesters[0].RequestId != "req-1" || requesters[0].SessionId != "s1" ||
    requesters[1].RequestId != "req-2" || requesters[1].SessionId != "s1" ||
    requesters[2].RequestId != "req-1" || requesters[2].SessionId != "s2")
    throw new Exception("MarkCompleted did not return exactly the attached requesters in order");
// After completion, attach refuses and hands back the durable terminal receipt.
if (activeExec.TryAttach(null!, "req-3", "s1", CancellationToken.None, out var completedReceipt) ||
    completedReceipt != terminalReceipt)
    throw new Exception("Post-completion attach did not return the terminal receipt");

// ---------------------------------------------------------------------------
// BoundedJsonlReader: newline framing under the 1 MiB frame cap. Not covered by
// any existing test on any platform.
// ---------------------------------------------------------------------------
async Task AssertFrameBytes(byte[] input, byte[][] expected)
{
    var reader = new BoundedJsonlReader(new MemoryStream(input));
    foreach (var expectedFrame in expected)
    {
        var frame = await reader.ReadAsync(CancellationToken.None);
        if (frame is null || !frame.AsSpan().SequenceEqual(expectedFrame))
            throw new Exception("BoundedJsonlReader returned an unexpected frame");
    }
    if (await reader.ReadAsync(CancellationToken.None) is not null)
        throw new Exception("BoundedJsonlReader did not report EOF as null");
}

await AssertFrameBytes("\"a\"\n\"bb\"\n"u8.ToArray(), ["\"a\""u8.ToArray(), "\"bb\""u8.ToArray()]);
// A frame spanning internal buffer refills (8 KiB buffer) reads back whole.
var longFrame = new string('b', 20000);
await AssertFrameBytes(Encoding.UTF8.GetBytes(longFrame + "\n" + longFrame + "\n"),
    [Encoding.UTF8.GetBytes(longFrame), Encoding.UTF8.GetBytes(longFrame)]);
// CR is not an accepted delimiter and empty lines are rejected: reading to EOF
// must throw before a clean end of stream.
foreach (var invalid in new[] { "\"a\"\r\n", "\n", "\"a\"\n\n" })
{
    var invalidReader = new BoundedJsonlReader(new MemoryStream(Encoding.UTF8.GetBytes(invalid)));
    try
    {
        while (await invalidReader.ReadAsync(CancellationToken.None) is not null) { }
        throw new Exception("BoundedJsonlReader accepted invalid JSONL framing");
    }
    catch (InvalidDataException) { }
}
// A frame without a trailing newline is incomplete, never a partial frame.
var incompleteReader = new BoundedJsonlReader(new MemoryStream("\"a\""u8.ToArray()));
try
{
    await incompleteReader.ReadAsync(CancellationToken.None);
    throw new Exception("BoundedJsonlReader accepted an incomplete trailing frame");
}
catch (InvalidDataException) { }
// The frame payload cap is 1 MiB - 1 bytes; the boundary is exact.
var cappedPayload = new byte[1024 * 1024 - 1];
Array.Fill(cappedPayload, (byte)'x');
await AssertFrameBytes(EncodePaddedFrame(1024 * 1024 - 1), [cappedPayload]);
var oversizedReader = new BoundedJsonlReader(new MemoryStream(EncodePaddedFrame(1024 * 1024)));
try
{
    await oversizedReader.ReadAsync(CancellationToken.None);
    throw new Exception("BoundedJsonlReader accepted a frame beyond the 1 MiB cap");
}
catch (InvalidDataException) { }

static byte[] EncodePaddedFrame(int payloadLength)
{
    var frame = new byte[payloadLength + 1];
    Array.Fill(frame, (byte)'x');
    frame[^1] = (byte)'\n';
    return frame;
}

// ---------------------------------------------------------------------------
// HostLaunchBinding.Parse / LocalJournalDirectory: argument validation fails
// closed before any process, identity or drive query, so the rejection matrix
// is deterministic on any OS. Accepting a real launch binding binds the client
// process, session and user SID and stays Windows-only.
// ---------------------------------------------------------------------------
var goodPipe = "pa_" + new string('0', 32);
string[][] invalidBindings =
[
    [], // no arguments
    ["--pipe", goodPipe, "--client-pid", "1", "extra"], // wrong arity
    ["--pipe", goodPipe, "--client-pid", "1", "--journal-directory", "C:\\j", "extra"],
    ["--pip", goodPipe, "--client-pid", "1"],
    ["--pipe", goodPipe, "--client-pidd", "1"],
    ["--pipe", goodPipe, "--client-pid", "1", "--journal", "C:\\j"],
    ["--pipe", "pa_short", "--client-pid", "1"],
    ["--pipe", "pa_" + new string('g', 32), "--client-pid", "1"],
    ["--pipe", "PA_" + new string('0', 32), "--client-pid", "1"],
    ["--pipe", goodPipe, "--client-pid", "0"],
    ["--pipe", goodPipe, "--client-pid", "-1"],
    ["--pipe", goodPipe, "--client-pid", "not-a-pid"],
    ["--pipe", goodPipe, "--client-pid", "1", "--journal-directory", "relative"],
    ["--pipe", goodPipe, "--client-pid", "1", "--journal-directory", "C:relative"],
];
foreach (var invalid in invalidBindings)
{
    try
    {
        HostLaunchBinding.Parse(invalid);
        throw new Exception($"Host accepted an invalid launch binding ({invalid.Length} arguments)");
    }
    catch (ArgumentException) { }
}

string[] invalidJournalDirectories =
[
    "relative",
    "C:",
    "C:relative",
    "\\\\server\\share",
    "\\\\?\\C:\\journal",
    "C:\\journal:stream",
    "C:\\journal\n--pipe",
    "C:\\journal\" --client-pid 1",
];
foreach (var invalid in invalidJournalDirectories)
{
    try
    {
        LocalJournalDirectory.Validate(invalid);
        throw new Exception("Host accepted an unsafe journal directory");
    }
    catch (ArgumentException) { }
}

Console.WriteLine("PASS: Windows Host portable unit tests (NotepadTargets gates, target lease, " +
    "target readiness, execution lifetime, active execution, bounded JSONL, launch validation)");
