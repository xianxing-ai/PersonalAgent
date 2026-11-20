using System.Globalization;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace PersonalAgent.WindowsHost.Desktop;

internal static class OwnedWindowLayer
{
    private const uint SnapshotProcesses = 0x00000002;
    private const uint RootAncestor = 2;
    private const uint KeepBoundsAndFocus = 0x0001 | 0x0002 | 0x0010 | 0x0200;
    private static readonly nint WindowBottom = new(1);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry
    {
        internal uint Size, Usage, ProcessId;
        internal nuint DefaultHeapId;
        internal uint ModuleId, Threads, ParentProcessId;
        internal int BasePriority;
        internal uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] internal string Executable;
    }

    [DllImport("kernel32.dll")]
    private static extern SafeFileHandle CreateToolhelp32Snapshot(uint flags, uint processId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Process32First(SafeFileHandle snapshot, ref ProcessEntry entry);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Process32Next(SafeFileHandle snapshot, ref ProcessEntry entry);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(nint hwnd, nint insertAfter, int x, int y, int width, int height, uint flags);

    internal static int Run(string[] args)
    {
        if (args.Length != 2 || args[0] != "--lower-owned-window"
            || !nuint.TryParse(args[1], NumberStyles.None, CultureInfo.InvariantCulture, out var handle) || handle == 0)
            return 2;

        try
        {
            Native.RequireOrdinaryHost();
            var parent = ParentProcessId();
            var hwnd = unchecked((nint)handle);
            if (parent == 0 || Native.GetWindowThreadProcessId(hwnd, out var owner) == 0 || owner != parent
                || Native.GetAncestor(hwnd, RootAncestor) != hwnd)
                return 1;

            return SetWindowPos(hwnd, WindowBottom, 0, 0, 0, 0, KeepBoundsAndFocus) ? 0 : 1;
        }
        catch (Refusal) { return 1; }
    }

    private static uint ParentProcessId()
    {
        using var snapshot = CreateToolhelp32Snapshot(SnapshotProcesses, 0);
        var entry = new ProcessEntry { Size = (uint)Marshal.SizeOf<ProcessEntry>() };
        if (snapshot.IsInvalid || !Process32First(snapshot, ref entry)) return 0;
        do
        {
            if (entry.ProcessId == Environment.ProcessId) return entry.ParentProcessId;
        } while (Process32Next(snapshot, ref entry));
        return 0;
    }
}
