using System.Collections.Concurrent;
using System.Globalization;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text.Json;

namespace PersonalAgent.WindowsHost.Service;

internal readonly record struct ExecutionRequester(
    NamedPipeServerStream Pipe,
    string RequestId,
    string SessionId,
    CancellationToken Connected);

internal static class NotepadExecutionLifetime
{
    internal static (CancellationTokenSource Lifetime, DateTime DeadlineUtc)? Create(
        CancellationToken connected, DateTime taskDeadlineUtc, DateTime targetExpiresUtc)
    {
        var now = DateTime.UtcNow;
        var deadline = taskDeadlineUtc < targetExpiresUtc ? taskDeadlineUtc : targetExpiresUtc;
        var watchdog = now.AddMinutes(10);
        if (watchdog < deadline) deadline = watchdog;
        var remaining = deadline - now;
        if (remaining <= TimeSpan.Zero) return null;
        var lifetime = CancellationTokenSource.CreateLinkedTokenSource(connected);
        lifetime.CancelAfter(remaining);
        return (lifetime, deadline);
    }
}

internal sealed class ActiveExecution
{
    private readonly object _gate = new();
    private HostRunRecord? _terminalReceipt;
    internal CancellationTokenSource Lifetime { get; }
    internal List<ExecutionRequester> Requesters { get; }

    internal ActiveExecution(CancellationTokenSource lifetime, NamedPipeServerStream pipe,
        string requestId, string sessionId, CancellationToken connected)
    {
        Lifetime = lifetime;
        Requesters = [new ExecutionRequester(pipe, requestId, sessionId, connected)];
    }

    internal bool TryAttach(NamedPipeServerStream pipe, string requestId, string sessionId,
        CancellationToken connected, out HostRunRecord? completedReceipt)
    {
        lock (_gate)
        {
            if (_terminalReceipt is not null)
            {
                completedReceipt = _terminalReceipt;
                return false;
            }
            if (!Requesters.Any(r => r.RequestId == requestId && r.SessionId == sessionId))
            {
                Requesters.Add(new ExecutionRequester(pipe, requestId, sessionId, connected));
            }
            completedReceipt = null;
            return true;
        }
    }

    internal List<ExecutionRequester> MarkCompleted(HostRunRecord receipt)
    {
        lock (_gate)
        {
            _terminalReceipt = receipt;
            return new List<ExecutionRequester>(Requesters);
        }
    }
}

internal sealed class HostService(HostLaunchBinding launch, HostWire wire, RunJournal journal,
    Action<NotepadObservationStage>? observationDiagnostic = null)
{
    private const string Version = "0.1.0";
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private readonly ConcurrentDictionary<string, ActiveExecution> _active = new(StringComparer.Ordinal);

    internal async Task RunAsync(CancellationToken stop)
    {
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(stop);
        var monitor = launch.MonitorClientExitAsync(lifetime);
        try
        {
            while (!lifetime.IsCancellationRequested)
            {
                using var pipe = new NamedPipeServerStream(launch.PipeName, PipeDirection.InOut, 1,
                    PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync(lifetime.Token).ConfigureAwait(false);
                launch.VerifyProcess(pipe);
                using var connection = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
                try { await ServeConnectionAsync(pipe, connection.Token).ConfigureAwait(false); }
                finally
                {
                    connection.Cancel();
                    foreach (var active in _active.Values)
                    {
                        try { active.Lifetime.Cancel(); }
                        catch (ObjectDisposedException) { /* Completion won the disconnect race. */ }
                    }
                }
            }
        }
        finally { lifetime.Cancel(); await monitor.ConfigureAwait(false); }
    }

    private async Task ServeConnectionAsync(NamedPipeServerStream pipe, CancellationToken connected)
    {
        var reader = new BoundedJsonlReader(pipe);
        using var hello = await ReadRequiredAsync(reader, connected).ConfigureAwait(false);
        if (Kind(hello.RootElement) != "hello") throw new InvalidDataException("Expected Windows Host hello");
        launch.VerifyProcess(pipe);
        launch.VerifyUser(pipe);
        var first = hello.RootElement;
        var helloRequest = Field(first, "requestId");
        var clientNonce = Field(first, "clientNonce");
        var hostNonce = RandomId();
        var sessionId = RandomId();
        // Capture pre-existing windows before acknowledging readiness. A trusted client
        // may launch a new target after hello_ack; bind has no acknowledgement frame.
        var targets = new NotepadTargets(diagnostic: observationDiagnostic);
        await SendAsync(pipe, new
        {
            kind = "hello_ack", protocolVersion = Version, requestId = helloRequest,
            clientNonce, hostNonce, sessionId
        }, connected).ConfigureAwait(false);
        using var bind = await ReadRequiredAsync(reader, connected).ConfigureAwait(false);
        var bound = bind.RootElement;
        if (Kind(bound) != "bind" || Field(bound, "requestId") != helloRequest ||
            Field(bound, "sessionId") != sessionId || Field(bound, "hostNonce") != hostNonce)
            throw new InvalidDataException("Windows Host handshake did not bind");

        try
        {
            while (!connected.IsCancellationRequested)
            {
                var bytes = await reader.ReadAsync(connected).ConfigureAwait(false);
                if (bytes is null) return;
                using var message = wire.Parse(bytes);
                var frame = message.RootElement;
                if (Field(frame, "sessionId") != sessionId)
                    throw new InvalidDataException("Windows Host session changed");
                switch (Kind(frame))
                {
                    case "observe":
                        await ObserveAsync(pipe, targets, frame, connected).ConfigureAwait(false);
                        break;
                    case "target_ready":
                        await TargetReadyAsync(pipe, targets, frame, connected).ConfigureAwait(false);
                        break;
                    case "execute":
                        await StartExecuteAsync(pipe, targets, frame, connected).ConfigureAwait(false);
                        break;
                    case "cancel":
                        Cancel(frame);
                        break;
                    case "status":
                        await StatusAsync(pipe, frame, connected).ConfigureAwait(false);
                        break;
                    default:
                        throw new InvalidDataException("Unexpected Windows Host client frame");
                }
            }
        }
        finally { targets.Clear(); } // Target refs never execute after disconnect.
    }

    private async Task ObserveAsync(NamedPipeServerStream pipe, NotepadTargets targets,
        JsonElement frame, CancellationToken connected)
    {
        var requestId = Field(frame, "requestId");
        var sessionId = Field(frame, "sessionId");
        var deadline = Utc(Field(frame, "deadline"));
        (ObservedNotepadTarget? target, string? error) result;
        try { result = targets.Observe(deadline); }
        catch { result = (null, "EXTERNAL_FAILURE"); }
        if (result.target is null)
        {
            await SendAsync(pipe, new
            {
                kind = "observation_refused", protocolVersion = Version, requestId, sessionId,
                errorCode = result.error ?? "EXTERNAL_FAILURE"
            }, connected).ConfigureAwait(false);
            return;
        }
        await SendAsync(pipe, new
        {
            kind = "observed", protocolVersion = Version, requestId, sessionId,
            targetRef = result.target.Reference, expiresAt = Timestamp(result.target.ExpiresUtc),
            source = "windows-uia"
        }, connected).ConfigureAwait(false);
    }

    private async Task TargetReadyAsync(NamedPipeServerStream pipe, NotepadTargets targets,
        JsonElement frame, CancellationToken connected)
    {
        var requestId = Field(frame, "requestId");
        var sessionId = Field(frame, "sessionId");
        var targetRef = Field(frame, "targetRef");
        var deadline = Utc(Field(frame, "deadline"));

        var (target, errorCode) = CheckTargetReady(deadline, () => targets.Resolve(targetRef));
        if (target is null)
        {
            await SendAsync(pipe, new
            {
                kind = "target_ready_result", protocolVersion = Version, requestId, sessionId,
                targetRef, ready = false, errorCode
            }, connected).ConfigureAwait(false);
            return;
        }

        await SendAsync(pipe, new
        {
            kind = "target_ready_result", protocolVersion = Version, requestId, sessionId,
            targetRef, ready = true, expiresAt = Timestamp(target.ExpiresUtc)
        }, connected).ConfigureAwait(false);
    }

    internal static (ObservedNotepadTarget? Target, string? ErrorCode) CheckTargetReady(
        DateTime deadlineUtc, Func<ObservedNotepadTarget?> resolve, Func<DateTime>? utcNow = null)
    {
        var now = utcNow ?? (() => DateTime.UtcNow);
        if (deadlineUtc <= now()) return (null, "TIMEOUT");
        ObservedNotepadTarget? target;
        try { target = resolve(); }
        catch { target = null; }
        var finished = now();
        if (deadlineUtc <= finished) return (null, "TIMEOUT");
        return target is null || target.ExpiresUtc <= finished ? (null, "TARGET_STALE") : (target, null);
    }

    private async Task StartExecuteAsync(NamedPipeServerStream pipe, NotepadTargets targets,
        JsonElement frame, CancellationToken connected)
    {
        var requestId = Field(frame, "requestId");
        var sessionId = Field(frame, "sessionId");
        var identity = new HostRunIdentity(
            Field(frame, "taskId"), Field(frame, "runId"), Field(frame, "toolName"),
            Field(frame, "toolVersion"), Field(frame, "authorizationRef"),
            Field(frame, "argumentsDigest"), Field(frame, "targetRef"),
            RunJournal.PayloadDigest(Field(frame, "expectedText"), Field(frame, "replacementText")));
        var startedAt = Timestamp(DateTime.UtcNow);
        // A reference in the frame is not a grant. The exact OS-bound client must
        // have consumed Policy authorization through Runtime/ToolGateway first.
        var previous = journal.Start(identity, startedAt);
        if (previous is not null)
        {
            if (previous.Terminal)
            {
                await SendRecordAsync(pipe, previous, requestId, sessionId, connected).ConfigureAwait(false);
                return; // Reconnects and duplicate runIds never replay a write.
            }
            if (_active.TryGetValue(identity.RunId, out var active))
            {
                if (active.TryAttach(pipe, requestId, sessionId, connected, out var completedReceipt))
                {
                    return; // Active run in progress; receipt will be delivered when complete.
                }
                await SendRecordAsync(pipe, completedReceipt!, requestId, sessionId, connected).ConfigureAwait(false);
                return;
            }
            // Host process was restarted after an uncompleted run: only journal entry exists.
            await SendRecordAsync(pipe, previous, requestId, sessionId, connected).ConfigureAwait(false);
            return;
        }

        var deadline = Utc(Field(frame, "deadline"));
        ObservedNotepadTarget? target;
        try { target = targets.Resolve(identity.TargetRef); }
        catch { target = null; } // A vanished UIA target is a write-before refusal.
        if (deadline <= DateTime.UtcNow || target is null ||
            Field(frame, "expectedText") == Field(frame, "replacementText"))
        {
            var refused = journal.Complete(identity, "refused", Timestamp(DateTime.UtcNow), null,
                deadline <= DateTime.UtcNow ? "TIMEOUT" : target is null ? "TARGET_STALE" : "INVALID_ARGUMENT");
            await SendRecordAsync(pipe, refused, requestId, sessionId, connected).ConfigureAwait(false);
            return;
        }

        // A prepared target is a short-lived confirmation, not permission to
        // continue UIA discovery until the much longer task deadline.
        var lease = NotepadExecutionLifetime.Create(connected, deadline, target.ExpiresUtc);
        if (lease is null)
        {
            var refused = journal.Complete(identity, "refused", Timestamp(DateTime.UtcNow), null, "TIMEOUT");
            await SendRecordAsync(pipe, refused, requestId, sessionId, connected).ConfigureAwait(false);
            return;
        }
        var (lifetime, effectiveDeadline) = lease.Value;
        var execution = new ActiveExecution(lifetime, pipe, requestId, sessionId, connected);
        if (!_active.TryAdd(identity.RunId, execution))
        {
            lifetime.Dispose();
            if (_active.TryGetValue(identity.RunId, out var existingActive))
            {
                if (existingActive.TryAttach(pipe, requestId, sessionId, connected, out var completedReceipt))
                {
                    return;
                }
                await SendRecordAsync(pipe, completedReceipt!, requestId, sessionId, connected).ConfigureAwait(false);
                return;
            }
            var latest = journal.Find(identity.RunId) ?? journal.Start(identity, startedAt)!;
            await SendRecordAsync(pipe, latest, requestId, sessionId, connected).ConfigureAwait(false);
            return;
        }
        var expectedText = Field(frame, "expectedText");
        var replacementText = Field(frame, "replacementText");
        _ = Task.Run(async () =>
        {
            try
            {
                var action = await NotepadAction.ReplaceTextAsync(new ConfirmedNotepadTarget(
                    target.Window, target.ProcessId, target.StartUtc, expectedText, replacementText),
                    lifetime.Token).ConfigureAwait(false);
                var state = action.State == ActionState.Verified && !lifetime.IsCancellationRequested
                    ? "verified" : action.State == ActionState.Rejected && lifetime.IsCancellationRequested
                        ? "cancelled" : action.State == ActionState.Rejected ? "refused" : "result_unknown";
                var error = state switch
                {
                    "verified" => null,
                    "cancelled" => effectiveDeadline <= DateTime.UtcNow ? "TIMEOUT" : "CANCELLED",
                    "refused" => action.ErrorCode == "TARGET_AMBIGUOUS" ? "TARGET_STALE" : action.ErrorCode ?? "TARGET_STALE",
                    _ => "RESULT_UNKNOWN"
                };
                var receipt = journal.Complete(identity, state, Timestamp(DateTime.UtcNow),
                    state == "verified" ? RandomId() : null, error);
                var requesters = execution.MarkCompleted(receipt);
                foreach (var req in requesters)
                {
                    await TrySendRecordAsync(req.Pipe, receipt, req.RequestId, req.SessionId, req.Connected).ConfigureAwait(false);
                }
            }
            catch
            {
                try
                {
                    var receipt = journal.Complete(identity, "result_unknown", Timestamp(DateTime.UtcNow),
                        null, "RESULT_UNKNOWN");
                    var requesters = execution.MarkCompleted(receipt);
                    foreach (var req in requesters)
                    {
                        await TrySendRecordAsync(req.Pipe, receipt, req.RequestId, req.SessionId, req.Connected).ConfigureAwait(false);
                    }
                }
                catch { Environment.Exit(3); } // The durable started record keeps the result unknown.
            }
            finally
            {
                _active.TryRemove(identity.RunId, out _);
                lifetime.Dispose();
            }
        });
    }

    private void Cancel(JsonElement frame)
    {
        var record = FindMatching(frame);
        if (record is not null && _active.TryGetValue(record.Identity.RunId, out var active))
        {
            try { active.Lifetime.Cancel(); }
            catch (ObjectDisposedException) { /* Completion won the cancel race. */ }
        }
        // There is no cancel acknowledgement frame in 0.1.0. Caller polls status.
    }

    private async Task StatusAsync(NamedPipeServerStream pipe, JsonElement frame,
        CancellationToken connected)
    {
        var requestId = Field(frame, "requestId");
        var sessionId = Field(frame, "sessionId");
        var record = FindMatching(frame);
        if (record is null || _active.ContainsKey(record.Identity.RunId))
        {
            await SendAsync(pipe, new
            {
                kind = "status_reply", protocolVersion = Version, requestId, sessionId,
                taskId = Field(frame, "taskId"), runId = Field(frame, "runId"),
                state = record is null ? "not_found" : "in_progress"
            }, connected).ConfigureAwait(false);
            return;
        }
        await SendRecordAsync(pipe, record, requestId, sessionId, connected).ConfigureAwait(false);
    }

    private HostRunRecord? FindMatching(JsonElement frame)
    {
        var record = journal.Find(Field(frame, "runId"));
        if (record is null) return null;
        var identity = record.Identity;
        if (identity.TaskId != Field(frame, "taskId") ||
            identity.ToolName != Field(frame, "toolName") ||
            identity.ToolVersion != Field(frame, "toolVersion") ||
            identity.ArgumentsDigest != Field(frame, "argumentsDigest") ||
            identity.TargetRef != Field(frame, "targetRef"))
            throw new InvalidDataException("Windows Host run identity changed");
        return record;
    }

    private async Task SendRecordAsync(NamedPipeServerStream pipe, HostRunRecord record,
        string requestId, string sessionId, CancellationToken connected)
    {
        var identity = record.Identity;
        var state = record.Terminal ? record.State : "result_unknown";
        var result = new Dictionary<string, object>
        {
            ["kind"] = "result", ["protocolVersion"] = Version, ["requestId"] = requestId,
            ["sessionId"] = sessionId, ["taskId"] = identity.TaskId, ["runId"] = identity.RunId,
            ["toolName"] = identity.ToolName, ["toolVersion"] = identity.ToolVersion,
            ["argumentsDigest"] = identity.ArgumentsDigest, ["targetRef"] = identity.TargetRef,
            ["state"] = state, ["startedAt"] = record.StartedAt,
            ["finishedAt"] = record.FinishedAt ?? Timestamp(DateTime.UtcNow)
        };
        if (state == "verified") result.Add("evidenceRef", record.EvidenceRef!);
        else result.Add("errorCode", record.ErrorCode ?? "RESULT_UNKNOWN");
        await SendAsync(pipe, result, connected).ConfigureAwait(false);
    }

    private async Task TrySendRecordAsync(NamedPipeServerStream pipe, HostRunRecord record,
        string requestId, string sessionId, CancellationToken connected)
    {
        try { await SendRecordAsync(pipe, record, requestId, sessionId, connected).ConfigureAwait(false); }
        catch (IOException) { /* Durable status is available after reconnect. */ }
        catch (OperationCanceledException) { /* The old session cannot receive results. */ }
        catch (ObjectDisposedException) { /* The old pipe is closed. */ }
    }

    private async Task SendAsync(NamedPipeServerStream pipe, object frame, CancellationToken connected)
    {
        await _writeLock.WaitAsync(connected).ConfigureAwait(false);
        try { await wire.WriteAsync(pipe, frame, connected).ConfigureAwait(false); }
        finally { _writeLock.Release(); }
    }

    private async Task<JsonDocument> ReadRequiredAsync(BoundedJsonlReader reader, CancellationToken connected)
    {
        var bytes = await reader.ReadAsync(connected).ConfigureAwait(false)
            ?? throw new InvalidDataException("Incomplete Windows Host handshake");
        return wire.Parse(bytes);
    }

    private static string Field(JsonElement frame, string name) => frame.GetProperty(name).GetString()!;
    private static string Kind(JsonElement frame) => Field(frame, "kind");
    private static string RandomId() => Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
    private static string Timestamp(DateTime utc) => utc.ToUniversalTime().ToString(
        "yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
    private static DateTime Utc(string value) => DateTime.ParseExact(value,
        "yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture,
        DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);
}
