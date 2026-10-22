using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace PersonalAgent.WindowsHost.Service;

internal sealed record ObservedNotepadTarget(
    string Reference, nint Window, int ProcessId, DateTime StartUtc, DateTime ExpiresUtc);
internal enum NotepadObservationStage { BaselineUnqueryable, ProcessUnqueryable, ProcessExited,
    UntrustedImage, NoFreshWindow, MultipleFreshWindows, IdentityChanged, MetadataRejected, Observed }

internal static class NotepadTargetLease
{
    // UIA metadata lookup may block; the same lease and identity govern its result.
    internal static bool IsCurrent(DateTime expiresUtc, Func<bool> validate,
        Func<DateTime>? utcNow = null, Func<bool>? identityCurrent = null)
    {
        var now = utcNow ?? (() => DateTime.UtcNow);
        bool SameIdentity()
        {
            try { return identityCurrent?.Invoke() ?? true; }
            catch { return false; }
        }
        return expiresUtc > now() && SameIdentity() && expiresUtc > now() && validate() &&
            SameIdentity() && expiresUtc > now();
    }
}

// Observations never inspect a title, tab label or editor value. Old HWNDs remain
// excluded even if Notepad later opens the requested file as a tab within them.
internal sealed class NotepadTargets
{
    private readonly HashSet<(nint Window, int Pid, DateTime StartUtc)> _existing = [];
    private readonly Dictionary<string, ObservedNotepadTarget> _current = new(StringComparer.Ordinal);
    private readonly bool _baselineComplete = true;
    private readonly Action<NotepadObservationStage>? _diagnostic;

    internal NotepadTargets(Func<Process[]>? baselineProcesses = null, Action<NotepadObservationStage>? diagnostic = null)
    {
        _diagnostic = diagnostic;
        var currentSession = Process.GetCurrentProcess().SessionId;
        foreach (var process in (baselineProcesses ?? (() => Process.GetProcessesByName("notepad")))())
        {
            using (process)
            {
                try
                {
                    if (process.SessionId != currentSession) continue;
                    _ = process.SafeHandle; // Bind subsequent queries to the original process.
                    if (process.HasExited) throw new InvalidOperationException("Baseline process exited");
                    var start = process.StartTime.ToUniversalTime();
                    foreach (var handle in WindowsForProcess(process.Id, visibleUnownedOnly: false))
                        _existing.Add((handle, process.Id, start));
                    if (process.HasExited) throw new InvalidOperationException("Baseline process exited");
                }
                catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or
                                           System.ComponentModel.Win32Exception)
                {
                    // A skipped old window could become queryable later and be
                    // mistaken for a new target. This session cannot observe
                    // safely unless its entire baseline was established.
                    _baselineComplete = false;
                }
            }
        }
    }

    internal (ObservedNotepadTarget? Target, string? ErrorCode) Observe(DateTime deadlineUtc)
    {
        var now = DateTime.UtcNow;
        if (deadlineUtc <= now) return (null, "TIMEOUT");
        if (!_baselineComplete) { _diagnostic?.Invoke(NotepadObservationStage.BaselineUnqueryable); return (null, "UNAUTHORIZED"); }
        var currentSession = Process.GetCurrentProcess().SessionId;
        var candidates = new List<(nint Window, int Pid, DateTime StartUtc)>();
        var unverifiable = false;
        foreach (var process in Process.GetProcessesByName("notepad"))
        {
            using (process)
            {
                try
                {
                    if (process.SessionId != currentSession) continue;
                    _ = process.SafeHandle;
                    if (process.HasExited) throw new InvalidOperationException("Observed process exited");
                    var start = process.StartTime.ToUniversalTime();
                    foreach (var handle in WindowsForProcess(process.Id, visibleUnownedOnly: true))
                    {
                        if (_existing.Contains((handle, process.Id, start))) continue;
                        if (!NotepadAction.IsTrustedNotepadProcess(process)) { _diagnostic?.Invoke(NotepadObservationStage.UntrustedImage); unverifiable = true; }
                        else candidates.Add((handle, process.Id, start));
                    }
                    if (process.HasExited) { _diagnostic?.Invoke(NotepadObservationStage.ProcessExited); unverifiable = true; }
                }
                catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or
                                           System.ComponentModel.Win32Exception)
                {
                    _diagnostic?.Invoke(NotepadObservationStage.ProcessUnqueryable); unverifiable = true;
                }
            }
        }
        if (unverifiable) return (null, "UNAUTHORIZED");
        if (candidates.Count == 0) { _diagnostic?.Invoke(NotepadObservationStage.NoFreshWindow); return (null, "NOT_FOUND"); }
        if (candidates.Count != 1) { _diagnostic?.Invoke(NotepadObservationStage.MultipleFreshWindows); return (null, "TARGET_AMBIGUOUS"); }
        var candidate = candidates[0];
        var expires = deadlineUtc < now.AddSeconds(30) ? deadlineUtc : now.AddSeconds(30);
        string? errorCode = null;
        var current = NotepadTargetLease.IsCurrent(expires, () =>
        {
            var result = NotepadAction.CheckSingleTabTarget(
                candidate.Window, candidate.Pid, candidate.StartUtc);
            errorCode = result.ErrorCode;
            if (!result.Success) _diagnostic?.Invoke(NotepadObservationStage.MetadataRejected);
            return result.Success;
        }, identityCurrent: () => HasCurrentIdentity(candidate.Window, candidate.Pid, candidate.StartUtc));
        if (!current) { _diagnostic?.Invoke(NotepadObservationStage.IdentityChanged); return (null, expires <= DateTime.UtcNow ? "TIMEOUT" : errorCode ?? "TARGET_STALE"); }
        var target = new ObservedNotepadTarget(
            Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant(),
            candidate.Window, candidate.Pid, candidate.StartUtc, expires);
        _current.Add(target.Reference, target);
        _diagnostic?.Invoke(NotepadObservationStage.Observed);
        return (target, null);
    }

    internal ObservedNotepadTarget? Resolve(string targetRef)
    {
        if (!_current.TryGetValue(targetRef, out var target))
            return null;
        return NotepadTargetLease.IsCurrent(target.ExpiresUtc, () =>
            NotepadAction.HasSingleTabForManualProbe(target.Window, target.ProcessId, target.StartUtc),
            identityCurrent: () => HasCurrentIdentity(target.Window, target.ProcessId, target.StartUtc))
            ? target : null;
    }

    internal void Clear() => _current.Clear();

    private static bool HasCurrentIdentity(nint window, int pid, DateTime startUtc)
    {
        if (GetForegroundWindow() != window ||
            GetWindowThreadProcessId(window, out var owner) == 0 || owner != pid)
            return false;
        try
        {
            using var process = Process.GetProcessById(pid);
            _ = process.SafeHandle;
            if (process.HasExited || process.StartTime.ToUniversalTime() != startUtc ||
                !NotepadAction.IsTrustedNotepadProcess(process) || process.HasExited)
                return false;
            // Process metadata can also block. Finish with the fast foreground
            // and HWND owner checks; never activate or inspect the window text.
            return GetForegroundWindow() == window &&
                GetWindowThreadProcessId(window, out owner) != 0 && owner == pid;
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or
                                   System.ComponentModel.Win32Exception)
        { return false; }
    }

    private static List<nint> WindowsForProcess(int pid, bool visibleUnownedOnly)
    {
        var windows = new List<nint>();
        if (!EnumWindows((handle, _) =>
            {
                if (GetWindowThreadProcessId(handle, out var owner) != 0 && owner == pid &&
                    (!visibleUnownedOnly || (IsWindowVisible(handle) && GetWindow(handle, 4) == 0)))
                    windows.Add(handle);
                return true;
            }, 0)) throw new InvalidOperationException("Notepad window enumeration failed");
        return windows;
    }

    private delegate bool EnumWindowsProc(nint window, nint parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, nint parameter);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint window, out int processId);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(nint window);
    [DllImport("user32.dll")] private static extern nint GetWindow(nint window, uint command);
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
}
