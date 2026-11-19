using System.Text;
using System.Text.Json;
using PersonalAgent.WindowsHost.Service;

// Portable RunJournal unit tests. RunJournal.cs is compiled into this assembly
// verbatim, so these checks exercise the real production journal on any OS
// without Windows UIA/Win32: durable persistence and read-back, the
// result_unknown receipt semantics that make the caller keep
// waiting_reconciliation, runId replay/identity guards, capacity limits,
// payload digests and the no-plaintext persistence invariant from
// docs/interfaces/WINDOWS_HOST_CONTRACT.md. UIA target discovery and every
// Windows-only behavior stay out of scope here and need a real machine.

const string startedAt = "2026-09-25T12:00:00.000Z";
const string finishedAt = "2026-09-25T12:01:00.000Z";
const string digest = "38d3ef0941093cd6b9fd45d13a8cfc34dd549ced548c67be14f91242980af7d4"; // "6:before5:after"
const string digestB = "f3a1dd57e8b52e9ef55a"; // prefix of "1:ab2:bc"; only needs to differ from digest

var tempFiles = new List<string>();

string TrackJournalPath()
{
    var path = Path.Combine(Path.GetTempPath(), $"pa-host-journal-tests-{Guid.NewGuid():N}.jsonl");
    tempFiles.Add(path);
    return path;
}

HostRunIdentity RunIdentity(string runId, string argumentsDigest, string? taskId = null) =>
    new(taskId ?? "task", runId, "computer.notepad.replace_text", "1.0.0", "grant",
        argumentsDigest, "opaque-notepad-1", RunJournal.PayloadDigest("before", "after"));

byte[] RecordBytes(HostRunRecord record) => JsonSerializer.SerializeToUtf8Bytes(record);

// The durable journal must write one line per event, survive restarts, and keep
// an interrupted run exactly as uncertain as it was when the process stopped.
var journalPath = TrackJournalPath();
var identity = RunIdentity("run-1", digest);
var journal = new RunJournal(journalPath);
if (journal.Find("run-1") is not null || journal.Find("run-never-started") is not null)
    throw new Exception("An unknown runId must not resolve to a journal record");
if (journal.Start(identity, startedAt) is not null)
    throw new Exception("A fresh run must not be treated as a replay");
var started = journal.Find("run-1");
if (started is null || started.Terminal || started.State != "result_unknown" ||
    started.ErrorCode != "RESULT_UNKNOWN" || started.FinishedAt is not null ||
    started.EvidenceRef is not null || started.StartedAt != startedAt)
    throw new Exception("Started run must stay result_unknown until a terminal receipt exists");

var restored = new RunJournal(journalPath);
var readBack = restored.Find("run-1");
if (readBack is null || readBack.Terminal || readBack.State != "result_unknown" ||
    readBack.ErrorCode != "RESULT_UNKNOWN" || readBack.StartedAt != startedAt)
    throw new Exception("Interrupted run did not read back as durable result_unknown");
// Same identity after restart replays the tracked record; it never starts fresh.
var replayedStart = restored.Start(identity, startedAt);
if (replayedStart is null || replayedStart.Terminal)
    throw new Exception("Restarted journal lost the interrupted run record");
if (replayedStart.Identity != identity)
    throw new Exception("Replayed run record changed its durable identity");

// Terminal receipts round-trip with the exact state/evidence/error split the
// contract requires: verified carries evidenceRef, every other state carries an
// errorCode so the upstream projection can decide verified vs waiting_reconciliation.
var terminalJournalPath = TrackJournalPath();
var terminalJournal = new RunJournal(terminalJournalPath);
var terminalCases = new (string RunId, string State, string? Evidence, string? Error)[]
{
    ("run-verified", "verified", "host-evidence-1", null),
    ("run-refused", "refused", null, "TARGET_STALE"),
    ("run-cancelled", "cancelled", null, "CANCELLED"),
    ("run-unknown", "result_unknown", null, "RESULT_UNKNOWN"),
};
foreach (var item in terminalCases)
{
    if (terminalJournal.Start(RunIdentity(item.RunId, digest), startedAt) is not null)
        throw new Exception($"Terminal case {item.RunId} collided with an existing run");
}
foreach (var item in terminalCases)
{
    var completed = terminalJournal.Complete(RunIdentity(item.RunId, digest),
        item.State, finishedAt, item.Evidence, item.Error);
    if (!completed.Terminal || completed.State != item.State ||
        completed.EvidenceRef != item.Evidence || completed.ErrorCode != item.Error)
        throw new Exception($"Terminal receipt for {item.RunId} did not persist its state");
}
var terminalReadBack = new RunJournal(terminalJournalPath);
foreach (var item in terminalCases)
{
    var record = terminalReadBack.Find(item.RunId);
    if (record is null || !record.Terminal || record.State != item.State ||
        record.EvidenceRef != item.Evidence || record.ErrorCode != item.Error ||
        record.FinishedAt != finishedAt || record.StartedAt != startedAt)
        throw new Exception($"Terminal receipt for {item.RunId} did not survive a restart");
}
var verified = terminalReadBack.Find("run-verified");
if (verified is null || verified.EvidenceRef is null || verified.ErrorCode is not null)
    throw new Exception("A verified receipt must carry evidenceRef and no error code");
foreach (var runId in new[] { "run-refused", "run-cancelled", "run-unknown" })
{
    var record = terminalReadBack.Find(runId);
    if (record is null || record.EvidenceRef is not null || record.ErrorCode is null)
        throw new Exception($"A non-verified receipt for {runId} must carry an errorCode");
}

// A completed runId replays its durable terminal receipt and can never restart
// or be re-bound to different input, in memory or after a host restart.
var replayJournalPath = TrackJournalPath();
var replayJournal = new RunJournal(replayJournalPath);
var replayIdentity = RunIdentity("run-replay", digest);
if (replayJournal.Start(replayIdentity, startedAt) is not null)
    throw new Exception("Replay case started as a duplicate");
try
{
    replayJournal.Start(replayIdentity with { ArgumentsDigest = digestB }, startedAt);
    throw new Exception("Changed input reused a runId in memory");
}
catch (InvalidDataException) { }
replayJournal.Complete(replayIdentity, "verified", finishedAt, "host-evidence-replay", null);
var replayAfterRestart = new RunJournal(replayJournalPath);
var terminalReplay = replayAfterRestart.Start(replayIdentity, startedAt);
if (terminalReplay is null || !terminalReplay.Terminal || terminalReplay.State != "verified" ||
    terminalReplay.EvidenceRef != "host-evidence-replay")
    throw new Exception("A completed run did not replay its durable terminal receipt");
try
{
    replayAfterRestart.Start(replayIdentity with { TaskId = "other-task" }, startedAt);
    throw new Exception("Changed input reused a completed runId after restart");
}
catch (InvalidDataException) { }
try
{
    replayAfterRestart.Complete(replayIdentity with { ArgumentsDigest = digestB },
        "verified", finishedAt, null, null);
    throw new Exception("A changed identity was accepted for completion");
}
catch (InvalidDataException) { }
try
{
    replayAfterRestart.Complete(RunIdentity("run-never", digest), "verified", finishedAt, "ev", null);
    throw new Exception("An unknown runId was accepted for completion");
}
catch (InvalidDataException) { }

// The first terminal receipt wins: a repeated completion cannot flip the state
// or append a second durable record.
var idempotentPath = TrackJournalPath();
var idempotentJournal = new RunJournal(idempotentPath);
var idempotentIdentity = RunIdentity("run-idempotent", digest);
idempotentJournal.Start(idempotentIdentity, startedAt);
var firstReceipt = idempotentJournal.Complete(idempotentIdentity, "refused", finishedAt, null, "TARGET_STALE");
var idempotentSize = new FileInfo(idempotentPath).Length;
var secondReceipt = idempotentJournal.Complete(idempotentIdentity, "verified", finishedAt, "ev-2", null);
if (!ReferenceEquals(secondReceipt, firstReceipt) || secondReceipt.State != "refused" ||
    secondReceipt.ErrorCode != "TARGET_STALE" || secondReceipt.EvidenceRef is not null)
    throw new Exception("A completed run must keep its first terminal receipt");
if (new FileInfo(idempotentPath).Length != idempotentSize)
    throw new Exception("Repeated completion appended a second durable record");

// The journal persists identity and status only: expected/replacement text must
// never reach the journal file, while the digest itself is durable.
var privacyPath = TrackJournalPath();
var privacyExpected = "SECRET-EXPECTED-BODY-正文";
var privacyReplacement = "secret-replacement-正文";
var privacyDigest = RunJournal.PayloadDigest(privacyExpected, privacyReplacement);
var privacyJournal = new RunJournal(privacyPath);
privacyJournal.Start(RunIdentity("run-private", privacyDigest), startedAt);
privacyJournal.Complete(RunIdentity("run-private", privacyDigest), "verified", finishedAt, "ev-private", null);
var privacyLines = File.ReadAllText(privacyPath, Encoding.UTF8);
if (privacyLines.Contains(privacyExpected) || privacyLines.Contains(privacyReplacement))
    throw new Exception("Journal stored expected or replacement text");
if (!privacyLines.Contains(privacyDigest) || !privacyLines.Contains("opaque-notepad-1"))
    throw new Exception("Journal lost its durable identity fields");

// Corrupt or identity-inconsistent journals fail closed instead of guessing.
var malformedPath = TrackJournalPath();
await File.WriteAllBytesAsync(malformedPath, Encoding.UTF8.GetBytes("{\"Identity\":"));
try { _ = new RunJournal(malformedPath); throw new Exception("A malformed journal line was accepted"); }
catch (Exception ex) when (ex is JsonException or InvalidDataException) { }

var nullIdentityPath = TrackJournalPath();
var nullIdentityLine = "{\"Identity\":null,\"Terminal\":false,\"State\":\"result_unknown\"," +
    $"\"StartedAt\":\"{startedAt}\",\"FinishedAt\":null,\"EvidenceRef\":null,\"ErrorCode\":\"RESULT_UNKNOWN\"}}";
await File.WriteAllBytesAsync(nullIdentityPath, Encoding.UTF8.GetBytes(nullIdentityLine));
try { _ = new RunJournal(nullIdentityPath); throw new Exception("A null journal identity was accepted"); }
catch (InvalidDataException) { }

var emptyRunIdPath = TrackJournalPath();
var emptyRunIdRecord = new HostRunRecord(RunIdentity("ignored", digest) with { RunId = "" },
    false, "result_unknown", startedAt, null, null, "RESULT_UNKNOWN");
await File.WriteAllBytesAsync(emptyRunIdPath, RecordBytes(emptyRunIdRecord));
try { _ = new RunJournal(emptyRunIdPath); throw new Exception("An empty journal runId was accepted"); }
catch (InvalidDataException) { }

var mismatchPath = TrackJournalPath();
var mismatchFirst = new HostRunRecord(RunIdentity("run-dup", digest), false, "result_unknown",
    startedAt, null, null, "RESULT_UNKNOWN");
var mismatchSecond = new HostRunRecord(RunIdentity("run-dup", digestB), true, "refused",
    startedAt, finishedAt, null, "TARGET_STALE");
await File.WriteAllBytesAsync(mismatchPath,
    [.. RecordBytes(mismatchFirst), (byte)'\n', .. RecordBytes(mismatchSecond)]);
try { _ = new RunJournal(mismatchPath); throw new Exception("A runId bound to two identities was accepted"); }
catch (InvalidDataException) { }

var finalStatePath = TrackJournalPath();
var finalStart = new HostRunRecord(RunIdentity("run-final", digest), false, "result_unknown",
    startedAt, null, null, "RESULT_UNKNOWN");
var finalDone = new HostRunRecord(RunIdentity("run-final", digest), true, "verified",
    startedAt, finishedAt, "host-evidence-final", null);
await File.WriteAllBytesAsync(finalStatePath,
    [.. RecordBytes(finalStart), (byte)'\n', .. RecordBytes(finalDone)]);
var finalStateJournal = new RunJournal(finalStatePath);
var finalState = finalStateJournal.Find("run-final");
if (finalState is null || !finalState.Terminal || finalState.State != "verified" ||
    finalState.EvidenceRef != "host-evidence-final")
    throw new Exception("The last journal record for a runId did not win on load");

// Capacity limits: oversized files refuse to load, oversized records and appends
// past the durable cap refuse to write, and refusals leave the journal intact.
var oversizedPath = TrackJournalPath();
await File.WriteAllBytesAsync(oversizedPath, new byte[64L * 1024 * 1024 + 1]);
try { _ = new RunJournal(oversizedPath); throw new Exception("An oversized journal file was accepted"); }
catch (InvalidDataException) { }

var oversizedRecordPath = TrackJournalPath();
var oversizedJournal = new RunJournal(oversizedRecordPath);
try
{
    oversizedJournal.Start(RunIdentity("run-huge", digest, new string('t', 9000)), startedAt);
    throw new Exception("A record above the journal append limit was accepted");
}
catch (InvalidDataException) { }
if (oversizedJournal.Find("run-huge") is not null || File.Exists(oversizedRecordPath))
    throw new Exception("A refused oversized record leaked into the journal");

var nearLimitPath = TrackJournalPath();
var maxJournalBytes = 64L * 1024 * 1024;
var capacityLine = RecordBytes(new HostRunRecord(RunIdentity("run-cap", digest), false,
    "result_unknown", startedAt, null, null, "RESULT_UNKNOWN"));
if (capacityLine.Length + 64 >= maxJournalBytes)
    throw new Exception("Journal capacity test padding budget is invalid");
var nearLimitBytes = new byte[maxJournalBytes - 1];
capacityLine.CopyTo(nearLimitBytes, 0);
Array.Fill(nearLimitBytes, (byte)' ', capacityLine.Length, nearLimitBytes.Length - capacityLine.Length);
await File.WriteAllBytesAsync(nearLimitPath, nearLimitBytes);
var nearLimitJournal = new RunJournal(nearLimitPath);
try
{
    nearLimitJournal.Start(RunIdentity("run-cap-2", digest), startedAt);
    throw new Exception("An append past the journal capacity limit was accepted");
}
catch (InvalidDataException) { }
var capped = nearLimitJournal.Find("run-cap");
if (capped is null || capped.Terminal || new FileInfo(nearLimitPath).Length != maxJournalBytes - 1)
    throw new Exception("A refused append damaged the existing journal");

// PayloadDigest is the durable input binding: its length-prefixed UTF-8 format is
// pinned, order-sensitive and disambiguates plain concatenation.
if (RunJournal.PayloadDigest("before", "after") != digest)
    throw new Exception("PayloadDigest changed its pinned length-prefixed format");
if (RunJournal.PayloadDigest("ab", "c") == RunJournal.PayloadDigest("a", "bc"))
    throw new Exception("PayloadDigest lost the length-prefix disambiguation");
if (RunJournal.PayloadDigest("a", "b") == RunJournal.PayloadDigest("b", "a"))
    throw new Exception("PayloadDigest conflated expected and replacement text");
var unicodeDigest = RunJournal.PayloadDigest("正文- expected", "替换- replacement");
if (unicodeDigest.Length != 64 || unicodeDigest != unicodeDigest.ToLowerInvariant() ||
    unicodeDigest != RunJournal.PayloadDigest("正文- expected", "替换- replacement"))
    throw new Exception("PayloadDigest must be a stable lowercase SHA-256 hex digest");

// Concurrent runs append serialized, complete independently and all read back.
var concurrentPath = TrackJournalPath();
var concurrentJournal = new RunJournal(concurrentPath);
var concurrentRuns = Enumerable.Range(0, 8)
    .Select(i => RunIdentity($"run-concurrent-{i}", digest)).ToArray();
Parallel.ForEach(concurrentRuns, run =>
{
    if (concurrentJournal.Start(run, startedAt) is not null)
        throw new Exception("Concurrent fresh runs collided on replay detection");
    concurrentJournal.Complete(run, "refused", finishedAt, null, "TARGET_STALE");
});
var concurrentReadBack = new RunJournal(concurrentPath);
foreach (var run in concurrentRuns)
{
    var record = concurrentReadBack.Find(run.RunId);
    if (record is null || !record.Terminal || record.State != "refused" || record.ErrorCode != "TARGET_STALE")
        throw new Exception($"Concurrent receipt for {run.RunId} was lost or corrupted");
}
if (File.ReadLines(concurrentPath).Count() != concurrentRuns.Length * 2)
    throw new Exception("Concurrent journaling changed the append-per-event contract");

foreach (var path in tempFiles)
    if (File.Exists(path)) File.Delete(path);

Console.WriteLine("PASS: RunJournal portable unit tests (persistence, read-back, replay guards, capacity, digests)");
