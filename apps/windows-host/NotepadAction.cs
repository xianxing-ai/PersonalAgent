using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.CompilerServices;
using System.Security.Principal;
using System.Text;
using System.Windows.Automation;
using Microsoft.Win32.SafeHandles;

[assembly: InternalsVisibleTo("WindowsHost.Timing")]
[assembly: InternalsVisibleTo("ManualNotepadProbe")]
[assembly: InternalsVisibleTo("WindowsHost.Host")]
[assembly: InternalsVisibleTo("WindowsHost.HostFixture")]

namespace PersonalAgent.WindowsHost;

// This public DTO has no authorization semantics. A future trusted Runtime adapter must
// consume a specific approval before invoking this library.
public sealed record ConfirmedNotepadTarget(
    nint WindowHandle,
    int ProcessId,
    DateTime ProcessStartUtc,
    string ExpectedText,
    string ReplacementText);

public enum ActionState { Rejected, Verified, ResultUnknown }

public sealed record ActionResult(ActionState State, string Reason, string? ErrorCode = null);

public static class NotepadAction
{
    private const int MaxTextLength = 4096;
    private static readonly SemaphoreSlim InputLock = new(1, 1);

    public static async Task<ActionResult> ReplaceTextAsync(
        ConfirmedNotepadTarget target, CancellationToken cancellationToken)
    {
        if (target is null || target.WindowHandle == 0 || target.ProcessId <= 0 ||
            target.ProcessStartUtc.Kind != DateTimeKind.Utc ||
            target.ExpectedText is null || target.ReplacementText is null ||
            target.ExpectedText.Length > MaxTextLength || target.ReplacementText.Length > MaxTextLength ||
            target.ExpectedText == target.ReplacementText)
            return new(ActionState.Rejected, "Invalid or unchanged bounded request", "INVALID_ARGUMENT");

        if (cancellationToken.IsCancellationRequested)
            return new(ActionState.Rejected, "Cancelled before execution", "CANCELLED");

        try { await InputLock.WaitAsync(cancellationToken).ConfigureAwait(false); }
        catch (OperationCanceledException) { return new(ActionState.Rejected, "Cancelled while waiting for input lock", "CANCELLED"); }

        var mutationStarted = false;
        try
        {
            // Reject an elevated host: ordinary user authority is an invariant, not a fallback.
            using var identity = WindowsIdentity.GetCurrent();
            if (new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator))
                return new(ActionState.Rejected, "Elevated host is not supported", "UNAUTHORIZED");

            // Baseline precedes all UIA reads: a user edit during discovery must not
            // become the new baseline for an otherwise matching expected value.
            var inputTick = LastInputTick();
            if (!IsSameForegroundTarget(target))
                return new(ActionState.Rejected, "Confirmed target is no longer foreground", "TARGET_STALE");

            var root = AutomationElement.FromHandle(target.WindowHandle);
            if (root.Current.ProcessId != target.ProcessId)
                return new(ActionState.Rejected, "Window identity changed", "TARGET_STALE");
            if (!TryGetOnlyTab(root, target.ProcessId, out var selectedTab))
                return new(ActionState.Rejected, "Exactly one Notepad tab is required", "TARGET_AMBIGUOUS");
            if (!TryGetOnlyEditableTextControl(root, out var edit, out var value, out _))
                return new(ActionState.Rejected, "Exactly one editable UIA text control is required", "TARGET_STALE");

            cancellationToken.ThrowIfCancellationRequested();
            if (LastInputTick() != inputTick)
                return new(ActionState.Rejected, "User input detected before execution", "USER_TAKEOVER");
            if (!PrewriteStable(inputTick, target.ExpectedText, () => value!.Current.Value,
                    LastInputTick, () => IsSameForegroundTarget(target)))
                return new(ActionState.Rejected, "User input or target text changed before execution",
                    LastInputTick() != inputTick ? "USER_TAKEOVER" : "TARGET_STALE");
            cancellationToken.ThrowIfCancellationRequested();
            // Rebind the selected tab and edit immediately before SetValue. UIA has
            // no atomic compare-and-set; this only narrows the remaining race.
            var prewriteRoot = AutomationElement.FromHandle(target.WindowHandle);
            if (prewriteRoot.Current.ProcessId != target.ProcessId ||
                !TryGetOnlyTab(prewriteRoot, target.ProcessId, out var prewriteTab) ||
                !SameElement(selectedTab, prewriteTab))
                return new(ActionState.Rejected, "Target tab changed before execution", "TARGET_STALE");
            if (!TryGetOnlyEditableTextControl(prewriteRoot, out var prewriteEdit, out _, out _) ||
                !SameElement(edit, prewriteEdit))
                return new(ActionState.Rejected, "Target editor changed before execution", "TARGET_STALE");
            if (LastInputTick() != inputTick)
                return new(ActionState.Rejected, "User input detected before execution", "USER_TAKEOVER");
            if (!PrewriteStable(inputTick, target.ExpectedText, () => value!.Current.Value,
                    LastInputTick, () => IsSameForegroundTarget(target)))
                return new(ActionState.Rejected, "Target editor changed before execution",
                    LastInputTick() != inputTick ? "USER_TAKEOVER" : "TARGET_STALE");
            cancellationToken.ThrowIfCancellationRequested();

            // SetValue can mutate before returning or throwing. Any subsequent failure is unknown.
            mutationStarted = true;
            value!.SetValue(target.ReplacementText);
            if (cancellationToken.IsCancellationRequested || !IsSameForegroundTarget(target) ||
                LastInputTick() != inputTick)
                return new(ActionState.ResultUnknown, "Interrupted after text mutation; read back before retry", "RESULT_UNKNOWN");

            // Read the target again. A successful UIA call alone is never proof of the result.
            var reread = AutomationElement.FromHandle(target.WindowHandle);
            if (reread.Current.ProcessId != target.ProcessId ||
                !TryGetOnlyTab(reread, target.ProcessId, out var readbackTab) ||
                !SameElement(selectedTab, readbackTab))
                return new(ActionState.ResultUnknown, "Target tab changed during readback", "RESULT_UNKNOWN");
            if (!TryGetOnlyEditableTextControl(reread, out var readbackEdit, out var readbackValue, out _) ||
                !SameElement(edit, readbackEdit) ||
                readbackValue!.Current.Value != target.ReplacementText)
                return new(ActionState.ResultUnknown, "Target readback did not confirm replacement", "RESULT_UNKNOWN");
            if (!IsSameForegroundTarget(target) || LastInputTick() != inputTick ||
                cancellationToken.IsCancellationRequested)
                return new(ActionState.ResultUnknown, "Target or user input changed during readback", "RESULT_UNKNOWN");
            return new(ActionState.Verified, "Target UIA text readback confirmed");
        }
        catch (OperationCanceledException)
        {
            return new(mutationStarted ? ActionState.ResultUnknown : ActionState.Rejected,
                mutationStarted ? "Cancelled after mutation; reconcile before retry" : "Cancelled before mutation",
                mutationStarted ? "RESULT_UNKNOWN" : "CANCELLED");
        }
        catch (Exception)
        {
            // UIA and process APIs may throw COM, Win32 or provider-specific exceptions.
            // Never leak target text, process path, window title or exception messages.
            return new(mutationStarted ? ActionState.ResultUnknown : ActionState.Rejected,
                mutationStarted ? "UIA failure after mutation; reconcile before retry" : "Target validation failed",
                mutationStarted ? "RESULT_UNKNOWN" : "EXTERNAL_FAILURE");
        }
        finally { InputLock.Release(); }
    }

    internal static bool PrewriteStable(uint baseline, string expectedText,
        Func<string> readText, Func<uint> readInputTick, Func<bool> sameTarget)
    {
        if (readText() != expectedText) return false;
        if (readInputTick() != baseline || !sameTarget()) return false;
        // A programmatic UIA edit need not update the last-user-input tick.
        return readText() == expectedText && readInputTick() == baseline && sameTarget();
    }

    private static bool IsSameForegroundTarget(ConfirmedNotepadTarget target)
    {
        try
        {
            return TargetIdentityCurrent(
                () => GetForegroundWindow() == target.WindowHandle &&
                    GetWindowThreadProcessId(target.WindowHandle, out var pid) != 0 && pid == target.ProcessId,
                () =>
                {
                    using var process = Process.GetProcessById(target.ProcessId);
                    return IsTrustedNotepadProcess(process) && process.StartTime.ToUniversalTime() == target.ProcessStartUtc
                        && !process.HasExited;
                });
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or
                                   System.ComponentModel.Win32Exception)
        { return false; }
    }

    internal static bool TargetIdentityCurrent(Func<bool> windowMatches, Func<bool> processMatches) =>
        // Process metadata may block after the window was checked. The same live
        // process can outlast a closed or replaced HWND, so check the window last.
        windowMatches() && processMatches() && windowMatches();

    internal static bool IsTrustedNotepadProcess(Process process)
    {
        // Anchor image and package queries to this Process handle, rather than
        // reopen its numeric PID after reading the original start time.
        var image = ReadProcessImagePath(process);
        if (image is null ||
            !string.Equals(Path.GetFileName(image), "notepad.exe", StringComparison.OrdinalIgnoreCase))
            return false;
        var packageResult = ReadPackageFamily(process, out var family);
        if (process.HasExited) return false;
        if (packageResult == 0)
            return string.Equals(family, "Microsoft.WindowsNotepad_8wekyb3d8bbwe",
                StringComparison.OrdinalIgnoreCase);
        if (packageResult != 15700) return false; // APPMODEL_ERROR_NO_PACKAGE
        var trustedPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),
            "System32", "notepad.exe");
        return string.Equals(image, trustedPath, StringComparison.OrdinalIgnoreCase);
    }

    internal static string? ReadProcessImagePath(Process process)
    {
        try
        {
            var handle = process.SafeHandle;
            if (process.HasExited || handle.IsInvalid) return null;
            var image = new StringBuilder(32768);
            var length = (uint)image.Capacity;
            if (!QueryFullProcessImageName(handle, 0, image, ref length) || process.HasExited) return null;
            return image.ToString();
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or
                                   System.ComponentModel.Win32Exception)
        { return null; }
    }

    private static int ReadPackageFamily(Process process, out string? family)
    {
        family = null;
        var handle = process.SafeHandle;
        if (process.HasExited || handle.IsInvalid) return -1;
        var familyLength = 0u;
        var packageResult = GetPackageFamilyName(handle, ref familyLength, null);
        if (packageResult == 122 && familyLength is > 1 and <= 256)
        {
            var buffer = new StringBuilder((int)familyLength);
            packageResult = GetPackageFamilyName(handle, ref familyLength, buffer);
            if (packageResult == 0) family = buffer.ToString();
        }
        return process.HasExited ? -1 : packageResult;
    }

    private static bool SameElement(AutomationElement? first, AutomationElement? second) =>
        first is null ? second is null : first.Equals(second);

    // Manual probe checks only target identity and tab structure before asking for consent.
    // No window title, tab label or editor value is read here.
    internal static bool HasSingleTabForManualProbe(nint window, int pid, DateTime startUtc) =>
        CheckSingleTabTarget(window, pid, startUtc).Success;

    internal static (bool Success, string? ErrorCode) CheckSingleTabTarget(nint window, int pid, DateTime startUtc)
    {
        if (GetWindowThreadProcessId(window, out var owner) == 0 || owner != pid)
            return (false, "TARGET_STALE");
        Process process;
        try { process = Process.GetProcessById(pid); }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or
                                   System.ComponentModel.Win32Exception)
        { return (false, "TARGET_STALE"); }
        using (process)
        {
            try
            {
                if (!IsTrustedNotepadProcess(process)) return (false, "UNAUTHORIZED");
                if (process.StartTime.ToUniversalTime() != startUtc) return (false, "TARGET_STALE");
            }
            catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or
                                       System.ComponentModel.Win32Exception)
            { return (false, "TARGET_STALE"); }
        }
        AutomationElement root;
        try { root = AutomationElement.FromHandle(window); }
        catch { return (false, "TARGET_STALE"); }
        if (root.Current.ProcessId != pid) return (false, "TARGET_STALE");
        if (!TryGetOnlyTab(root, pid, out _)) return (false, "TARGET_AMBIGUOUS");
        if (!TryGetOnlyEditableTextControl(root, out _, out _, out var editError))
            return (false, editError ?? "TARGET_AMBIGUOUS");
        return (true, null);
    }

    internal static bool TryGetOnlyEditableTextControl(
        AutomationElement root,
        out AutomationElement? editControl,
        out ValuePattern? valuePattern,
        out string? errorCode)
    {
        editControl = null;
        valuePattern = null;
        errorCode = null;
        try
        {
            var edits = root.FindAll(TreeScope.Descendants,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit));
            var candidates = new List<(AutomationElement Edit, ValuePattern Value)>();
            for (var i = 0; i < edits.Count; i++)
            {
                var edit = edits[i];
                if (edit.Current.IsOffscreen || !edit.Current.IsEnabled) continue;
                if (!edit.TryGetCurrentPattern(ValuePattern.Pattern, out var pattern)) continue;
                var value = (ValuePattern)pattern;
                if (value.Current.IsReadOnly) continue;
                candidates.Add((edit, value));
            }
            if (candidates.Count == 1)
            {
                editControl = candidates[0].Edit;
                valuePattern = candidates[0].Value;
                return true;
            }
            errorCode = "TARGET_AMBIGUOUS";
            return false;
        }
        catch (Exception ex) when (ex is ElementNotAvailableException or InvalidOperationException)
        {
            errorCode = "TARGET_STALE";
            return false;
        }
    }

    private static bool TryGetOnlyTab(AutomationElement root, int pid, out AutomationElement? selectedTab)
    {
        selectedTab = null;
        var tabs = root.FindAll(TreeScope.Descendants,
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Tab));
        if (tabs.Count == 0)
        {
            using var process = Process.GetProcessById(pid);
            return ReadPackageFamily(process, out _) == 15700; // Only classic Notepad may lack tabs.
        }
        if (tabs.Count != 1) return false;
        var items = tabs[0].FindAll(TreeScope.Children,
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.TabItem));
        if (items.Count != 1 ||
            !items[0].TryGetCurrentPattern(SelectionItemPattern.Pattern, out var selected) ||
            !((SelectionItemPattern)selected).Current.IsSelected) return false;
        selectedTab = items[0];
        return true;
    }

    private static uint LastInputTick()
    {
        var info = new LastInputInfo { Size = (uint)Marshal.SizeOf<LastInputInfo>() };
        if (!GetLastInputInfo(ref info)) throw new InvalidOperationException("Input state unavailable");
        return info.TickCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LastInputInfo { public uint Size; public uint TickCount; }

    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint window, out int processId);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool GetLastInputInfo(ref LastInputInfo info);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetPackageFamilyName(SafeProcessHandle process, ref uint length, StringBuilder? familyName);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryFullProcessImageName(SafeProcessHandle process, uint flags,
        StringBuilder imageName, ref uint size);
}
