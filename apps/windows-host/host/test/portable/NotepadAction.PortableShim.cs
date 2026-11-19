namespace PersonalAgent.WindowsHost;

// Compile-time stand-in for the Windows-only NotepadAction surface (UIA + user32),
// so the portable test assembly can compile the real NotepadTargets/HostService
// sources verbatim on any OS. The real NotepadAction.cs needs
// System.Windows.Automation and only compiles and runs against the Windows
// Desktop runtime, so it cannot join a net8.0 portable assembly.
//
// Every member throws on purpose: if a portable test path ever reaches one of
// these call sites, the test fails loudly instead of passing on stub behavior.
// The portable suite only exercises paths that never touch NotepadAction
// (empty or unqueryable process baselines, expired deadlines, unknown target
// refs), and it asserts the "notepad" process precondition up front.
public sealed record ConfirmedNotepadTarget(
    nint WindowHandle, int ProcessId, DateTime ProcessStartUtc,
    string ExpectedText, string ReplacementText);

public enum ActionState { Rejected, Verified, ResultUnknown }

public sealed record ActionResult(ActionState State, string Reason, string? ErrorCode = null);

public static class NotepadAction
{
    public static Task<ActionResult> ReplaceTextAsync(ConfirmedNotepadTarget target,
        CancellationToken cancellationToken) =>
        throw new NotSupportedException(
            "NotepadAction.ReplaceTextAsync is Windows-only and must never run in portable tests");

    internal static bool IsTrustedNotepadProcess(System.Diagnostics.Process process) =>
        throw new NotSupportedException(
            "NotepadAction.IsTrustedNotepadProcess is Windows-only and must never run in portable tests");

    internal static (bool Success, string? ErrorCode) CheckSingleTabTarget(
        nint window, int pid, DateTime startUtc) =>
        throw new NotSupportedException(
            "NotepadAction.CheckSingleTabTarget is Windows-only and must never run in portable tests");

    internal static bool HasSingleTabForManualProbe(nint window, int pid, DateTime startUtc) =>
        throw new NotSupportedException(
            "NotepadAction.HasSingleTabForManualProbe is Windows-only and must never run in portable tests");
}
