using System.Text.Json;
using System.Diagnostics;
using PersonalAgent.WindowsHost.Service;
using PersonalAgent.WindowsHost;

if (args.Length != 2) throw new ArgumentException("Pass #168 schema and fixture paths");
var isolatedJournal = Path.Combine(Path.GetTempPath(), "pa-native-journal-fixture");
if (LocalJournalDirectory.Validate(isolatedJournal) != Path.GetFullPath(isolatedJournal))
    throw new Exception("Local journal directory changed");
foreach (var invalid in new[] { "relative", "C:relative", @"\\server\share", @"\\?\C:\journal",
    "C:\\journal:stream", "C:\\journal\n--pipe", "C:\\journal\" --client-pid 1" })
{
    try { LocalJournalDirectory.Validate(invalid); throw new Exception("Unsafe journal directory was accepted"); }
    catch (ArgumentException) { }
}
foreach (var invalid in new[] { new[] { "--pipe", "pa_" + new string('a', 32), "--client-pid", "1", "--extra", "x" },
    new[] { "--pipe", "pa_" + new string('a', 32), "--client-pid", "1", "--journal-directory", isolatedJournal, "--extra", "x" } })
{
    try { HostLaunchBinding.Parse(invalid); throw new Exception("Extra launch arguments were accepted"); }
    catch (ArgumentException) { }
}
using (var self = Process.GetCurrentProcess())
{
    if (!string.Equals(NotepadAction.ReadProcessImagePath(self), Environment.ProcessPath,
        StringComparison.OrdinalIgnoreCase))
        throw new Exception("Process image was not read from the bound live process");
    if (NotepadAction.IsTrustedNotepadProcess(self))
        throw new Exception("Fixture process was accepted as Notepad");
}
using (var unstarted = new Process())
{
    if (NotepadAction.ReadProcessImagePath(unstarted) is not null)
        throw new Exception("Missing process identity returned an image path");
}
// Exercise the production cancellation source without opening a window or
// invoking UIA: a long task cannot keep an expired target confirmation alive.
var targetExpiry = DateTime.UtcNow.AddMilliseconds(250);
var targetLease = NotepadExecutionLifetime.Create(CancellationToken.None,
    DateTime.UtcNow.AddMinutes(5), targetExpiry) ?? throw new Exception("Fresh target refused");
using (targetLease.Lifetime)
{
    if (targetLease.DeadlineUtc != targetExpiry ||
        !targetLease.Lifetime.Token.WaitHandle.WaitOne(TimeSpan.FromSeconds(3)))
        throw new Exception("Target expiry did not cancel pending execution");
}
var taskExpiry = DateTime.UtcNow.AddMilliseconds(250);
var taskLease = NotepadExecutionLifetime.Create(CancellationToken.None,
    taskExpiry, DateTime.UtcNow.AddMinutes(1)) ?? throw new Exception("Fresh task refused");
using (taskLease.Lifetime)
{
    if (taskLease.DeadlineUtc != taskExpiry ||
        !taskLease.Lifetime.Token.WaitHandle.WaitOne(TimeSpan.FromSeconds(3)))
        throw new Exception("Task expiry did not cancel pending execution");
}
if (NotepadExecutionLifetime.Create(CancellationToken.None,
    DateTime.UtcNow.AddMinutes(5), DateTime.UtcNow.AddSeconds(-1)) is not null)
    throw new Exception("Expired target acquired an execution lifetime");
using (var disconnected = new CancellationTokenSource())
{
    var lease = NotepadExecutionLifetime.Create(disconnected.Token,
        DateTime.UtcNow.AddMinutes(5), DateTime.UtcNow.AddSeconds(30))!.Value;
    using (lease.Lifetime)
    {
        disconnected.Cancel();
        if (!lease.Lifetime.IsCancellationRequested)
            throw new Exception("Disconnect did not cancel target execution");
    }
}
var wire = new HostWire(args[0]);
// Exercise the same production lease/readiness helpers with controlled slow
// metadata predicates. No window, UIA text or real user input is accessed.
var clock = new DateTime(2026, 9, 27, 12, 0, 0, DateTimeKind.Utc);
var clockStart = clock;
var metadataCalls = 0;
var leaseExpires = clock.AddSeconds(1);
if (NotepadTargetLease.IsCurrent(leaseExpires, () =>
    {
        metadataCalls++;
        clock = leaseExpires;
        return true;
    }, () => clock))
    throw new Exception("Slow metadata lookup returned an expired target lease");
if (metadataCalls != 1) throw new Exception("Slow target lookup was not exercised");
if (NotepadTargetLease.IsCurrent(leaseExpires, () =>
    {
        metadataCalls++;
        return true;
    }, () => clock) || metadataCalls != 1)
    throw new Exception("Expired lease performed metadata lookup");
clock = clockStart;
if (!NotepadTargetLease.IsCurrent(leaseExpires, () => true, () => clock) ||
    NotepadTargetLease.IsCurrent(leaseExpires, () => false, () => clock))
    throw new Exception("Valid or invalid metadata changed target lease semantics");
// Change only identity during metadata lookup, keeping the original lease fresh.
// These controlled predicates exercise the guard shared by Observe and Resolve;
// they are not a physical foreground switch or PID/HWND reuse demonstration.
foreach (var changedIdentity in new[] { "foreground", "window owner", "process start", "process exit" })
{
    var originalIdentity = (Foreground: (nint)123, Owner: 456, StartUtc: clockStart, Alive: true);
    var currentIdentity = originalIdentity;
    var identityCalls = 0;
    var lookupCalls = 0;
    var accepted = NotepadTargetLease.IsCurrent(leaseExpires, () =>
        {
            lookupCalls++;
            switch (changedIdentity)
            {
                case "foreground": currentIdentity.Foreground = 0; break;
                case "window owner": currentIdentity.Owner++; break;
                case "process start": currentIdentity.StartUtc = clockStart.AddSeconds(1); break;
                case "process exit": currentIdentity.Alive = false; break;
            }
            return true;
        }, () => clock, () =>
        {
            identityCalls++;
            return currentIdentity == originalIdentity;
        });
    if (accepted || lookupCalls != 1 || identityCalls != 2)
        throw new Exception($"Slow metadata lookup accepted changed {changedIdentity} identity");
}
var invalidIdentityLookupCalls = 0;
if (NotepadTargetLease.IsCurrent(leaseExpires, () =>
    {
        invalidIdentityLookupCalls++;
        return true;
    }, () => clock, () => false) || invalidIdentityLookupCalls != 0)
    throw new Exception("Stale identity performed metadata lookup");
var identityProbeCalls = 0;
if (!NotepadTargetLease.IsCurrent(leaseExpires, () => true, () => clock, () =>
    {
        identityProbeCalls++;
        return true;
    }) || identityProbeCalls != 2)
    throw new Exception("Fresh identity was not checked before and after metadata lookup");
identityProbeCalls = 0;
if (NotepadTargetLease.IsCurrent(leaseExpires, () => true, () => clock, () =>
    {
        if (++identityProbeCalls == 2)
            throw new InvalidOperationException("Synthetic private identity failure");
        return true;
    }) || identityProbeCalls != 2)
    throw new Exception("Unqueryable identity after metadata lookup did not fail closed");
var timedIdentityLookupCalls = 0;
if (NotepadTargetLease.IsCurrent(leaseExpires, () =>
    {
        timedIdentityLookupCalls++;
        return true;
    }, () => clock, () =>
    {
        clock = leaseExpires;
        return true;
    }) || timedIdentityLookupCalls != 0)
    throw new Exception("Expired pre-metadata identity lookup entered UIA metadata query");
clock = clockStart;
identityProbeCalls = 0;
if (NotepadTargetLease.IsCurrent(leaseExpires, () => true, () => clock, () =>
    {
        if (++identityProbeCalls == 2) clock = leaseExpires;
        return true;
    }) || identityProbeCalls != 2)
    throw new Exception("Post-metadata identity lookup returned an expired target lease");
clock = clockStart;
var readinessTarget = new ObservedNotepadTarget("fixture-target", 0, 1, clockStart,
    clockStart.AddSeconds(30));
var requestDeadline = clockStart.AddSeconds(1);
var timedOutReady = HostService.CheckTargetReady(requestDeadline, () =>
    {
        clock = requestDeadline;
        return readinessTarget;
    }, () => clock);
if (timedOutReady.Target is not null || timedOutReady.ErrorCode != "TIMEOUT")
    throw new Exception("Slow readiness lookup outlived its request deadline");
var expiredLookupCalls = 0;
var expiredRequest = HostService.CheckTargetReady(requestDeadline, () =>
    {
        expiredLookupCalls++;
        return readinessTarget;
    }, () => clock);
if (expiredRequest.Target is not null || expiredRequest.ErrorCode != "TIMEOUT" || expiredLookupCalls != 0)
    throw new Exception("Expired readiness request performed target lookup");
clock = clockStart;
var staleReady = HostService.CheckTargetReady(clockStart.AddMinutes(1), () =>
    {
        clock = readinessTarget.ExpiresUtc;
        return readinessTarget;
    }, () => clock);
if (staleReady.Target is not null || staleReady.ErrorCode != "TARGET_STALE")
    throw new Exception("Slow readiness lookup returned an expired target");
clock = clockStart;
var freshReady = HostService.CheckTargetReady(requestDeadline, () => readinessTarget, () => clock);
if (freshReady.Target is null || freshReady.Target != readinessTarget || freshReady.Target.ExpiresUtc != readinessTarget.ExpiresUtc ||
    freshReady.ErrorCode is not null)
    throw new Exception("Fresh readiness changed or renewed its target");
var missingReady = HostService.CheckTargetReady(requestDeadline, () => null, () => clock);
var failedReady = HostService.CheckTargetReady(requestDeadline,
    () => throw new InvalidOperationException("Synthetic private metadata failure"), () => clock);
if (missingReady.Target is not null || missingReady.ErrorCode != "TARGET_STALE" ||
    failedReady.Target is not null || failedReady.ErrorCode != "TARGET_STALE")
    throw new Exception("Missing or unqueryable target did not fail closed");
foreach (var requestExpires in new[] { false, true })
{
    clock = clockStart;
    var sameReadinessIdentity = true;
    var changedReady = HostService.CheckTargetReady(requestDeadline, () =>
        NotepadTargetLease.IsCurrent(readinessTarget.ExpiresUtc, () =>
        {
            sameReadinessIdentity = false;
            if (requestExpires) clock = requestDeadline;
            return true;
        }, () => clock, () => sameReadinessIdentity) ? readinessTarget : null, () => clock);
    if (changedReady.Target is not null ||
        changedReady.ErrorCode != (requestExpires ? "TIMEOUT" : "TARGET_STALE"))
        throw new Exception("Changed readiness identity was accepted or changed deadline error priority");
}
// An unstarted Process has no queryable session/start identity. A baseline
// failure must reject the whole observation, rather than omit an old window
// which could become queryable after the trusted user prepares a new target.
var incompleteBaseline = new NotepadTargets(() => [new Process()]);
var refusedObservation = incompleteBaseline.Observe(DateTime.UtcNow.AddSeconds(30));
if (refusedObservation.Target is not null || refusedObservation.ErrorCode != "UNAUTHORIZED")
    throw new Exception("Incomplete baseline must never select a window");
using var fixtures = JsonDocument.Parse(File.ReadAllText(args[1]));
foreach (var valid in fixtures.RootElement.GetProperty("valid").EnumerateArray())
{
    using var parsed = wire.Parse(JsonSerializer.SerializeToUtf8Bytes(valid));
    if (parsed.RootElement.GetProperty("kind").GetString() != valid.GetProperty("kind").GetString())
        throw new Exception("Fixture frame kind changed");
}
foreach (var invalid in fixtures.RootElement.GetProperty("invalid").EnumerateArray())
{
    try
    {
        using var parsed = wire.Parse(JsonSerializer.SerializeToUtf8Bytes(invalid));
        throw new Exception("Host accepted an invalid contracts fixture");
    }
    catch (InvalidDataException) { }
}

var targetReadyValid = new
{
    kind = "target_ready",
    protocolVersion = "0.1.0",
    requestId = "req-tr-1",
    sessionId = "s1",
    targetRef = "opaque-notepad-1",
    deadline = "2026-09-27T12:00:00.000Z"
};
using var parsedTr = wire.Parse(wire.Encode(targetReadyValid)[..^1]);
if (parsedTr.RootElement.GetProperty("kind").GetString() != "target_ready")
    throw new Exception("target_ready frame parse failed");

var targetReadyResultTrue = new
{
    kind = "target_ready_result",
    protocolVersion = "0.1.0",
    requestId = "req-tr-1",
    sessionId = "s1",
    targetRef = "opaque-notepad-1",
    ready = true,
    expiresAt = "2026-09-27T12:00:30.000Z"
};
using var parsedTrrTrue = wire.Parse(wire.Encode(targetReadyResultTrue)[..^1]);
if (parsedTrrTrue.RootElement.GetProperty("ready").GetBoolean() != true)
    throw new Exception("target_ready_result true parse failed");

var targetReadyResultFalse = new
{
    kind = "target_ready_result",
    protocolVersion = "0.1.0",
    requestId = "req-tr-1",
    sessionId = "s1",
    targetRef = "opaque-notepad-1",
    ready = false,
    errorCode = "TARGET_STALE"
};
using var parsedTrrFalse = wire.Parse(wire.Encode(targetReadyResultFalse)[..^1]);
if (parsedTrrFalse.RootElement.GetProperty("ready").GetBoolean() != false)
    throw new Exception("target_ready_result false parse failed");

try
{
    var invalidTrrBoth = new
    {
        kind = "target_ready_result",
        protocolVersion = "0.1.0",
        requestId = "req-tr-1",
        sessionId = "s1",
        targetRef = "opaque-notepad-1",
        ready = true,
        expiresAt = "2026-09-27T12:00:30.000Z",
        errorCode = "TARGET_STALE"
    };
    wire.Parse(JsonSerializer.SerializeToUtf8Bytes(invalidTrrBoth));
    throw new Exception("Host accepted target_ready_result with both expiresAt and errorCode");
}
catch (InvalidDataException) { }

try
{
    var invalidTrrExpiresWhenFalse = new
    {
        kind = "target_ready_result",
        protocolVersion = "0.1.0",
        requestId = "req-tr-1",
        sessionId = "s1",
        targetRef = "opaque-notepad-1",
        ready = false,
        expiresAt = "2026-09-27T12:00:30.000Z",
        errorCode = "TARGET_STALE"
    };
    wire.Parse(JsonSerializer.SerializeToUtf8Bytes(invalidTrrExpiresWhenFalse));
    throw new Exception("Host accepted target_ready_result with ready=false and expiresAt");
}
catch (InvalidDataException) { }

try
{
    var invalidTrrStringReady = new
    {
        kind = "target_ready_result",
        protocolVersion = "0.1.0",
        requestId = "req-tr-1",
        sessionId = "s1",
        targetRef = "opaque-notepad-1",
        ready = "true",
        expiresAt = "2026-09-27T12:00:30.000Z"
    };
    wire.Parse(JsonSerializer.SerializeToUtf8Bytes(invalidTrrStringReady));
    throw new Exception("Host accepted target_ready_result with string ready");
}
catch (InvalidDataException) { }

var journalPath = Path.Combine(Path.GetTempPath(), $"pa-host-fixture-{Guid.NewGuid():N}.jsonl");
try
{
    var identity = new HostRunIdentity("task", "run", "computer.notepad.replace_text", "1.0.0",
        "grant", new string('a', 64), "opaque-notepad-1", RunJournal.PayloadDigest("before", "after"));
    var journal = new RunJournal(journalPath);
    if (journal.Start(identity, "2026-09-25T12:00:00.000Z") is not null)
        throw new Exception("New run was treated as replay");
    var restored = new RunJournal(journalPath);
    if (restored.Find("run")?.Terminal != false ||
        restored.Start(identity, "2026-09-25T12:00:00.000Z") is null)
        throw new Exception("Interrupted run did not remain uncertain");
    try
    {
        restored.Start(identity with {PayloadDigest = RunJournal.PayloadDigest("changed", "after")},
            "2026-09-25T12:00:00.000Z");
        throw new Exception("Changed input reused a runId");
    }
    catch (InvalidDataException) { }
    restored.Complete(identity, "result_unknown", "2026-09-25T12:01:00.000Z", null, "RESULT_UNKNOWN");
    if (new RunJournal(journalPath).Find("run")?.State != "result_unknown")
        throw new Exception("Durable result was not recovered");
}
finally { if (File.Exists(journalPath)) File.Delete(journalPath); }

// Active execution and duplicate execute tracking:
using var activeCts = new CancellationTokenSource();
var activeExec = new ActiveExecution(activeCts, null!, "req-1", "s1", CancellationToken.None);
if (!activeExec.TryAttach(null!, "req-2", "s1", CancellationToken.None, out var receiptBeforeComplete))
    throw new Exception("TryAttach failed on active execution");
if (receiptBeforeComplete is not null)
    throw new Exception("Active execution returned receipt before completion");
// Duplicate (req-1, s1) should be deduplicated
if (!activeExec.TryAttach(null!, "req-1", "s1", CancellationToken.None, out _))
    throw new Exception("TryAttach failed on deduplicated request");

var testIdentity = new HostRunIdentity("task", "run-active", "computer.notepad.replace_text", "1.0.0",
    "grant", new string('a', 64), "opaque-notepad-1", RunJournal.PayloadDigest("before", "after"));
var terminalReceipt = new HostRunRecord(testIdentity, true, "verified", "2026-09-25T12:00:00.000Z",
    "2026-09-25T12:00:05.000Z", "evidence-1", null);
var requesters = activeExec.MarkCompleted(terminalReceipt);
if (requesters.Count != 2 || requesters[0].RequestId != "req-1" || requesters[1].RequestId != "req-2")
    throw new Exception("MarkCompleted did not return exactly the attached requesters");

// Subsequent attach after completion should return false and provide the terminal receipt
if (activeExec.TryAttach(null!, "req-3", "s1", CancellationToken.None, out var receiptAfterComplete) ||
    receiptAfterComplete != terminalReceipt)
    throw new Exception("TryAttach after completion did not return completed receipt");

// Target structural check rejects invalid or dead handles:
var targetCheck = PersonalAgent.WindowsHost.NotepadAction.CheckSingleTabTarget(0, 0, DateTime.UtcNow);
if (targetCheck.Success || targetCheck.ErrorCode != "TARGET_STALE")
    throw new Exception("CheckSingleTabTarget on dead window did not fail with TARGET_STALE");
if (PersonalAgent.WindowsHost.NotepadAction.HasSingleTabForManualProbe(0, 0, DateTime.UtcNow))
    throw new Exception("HasSingleTabForManualProbe on dead window unexpectedly succeeded");

Console.WriteLine("Windows Host portable contract and durable-run fixture passed");
