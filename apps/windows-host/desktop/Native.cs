using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace PersonalAgent.WindowsHost.Desktop;

internal sealed record Box(int X, int Y, int Width, int Height)
{
    internal bool Contains(int x, int y) => Width > 0 && Height > 0 && x >= X && y >= Y && (long)x < (long)X + Width && (long)y < (long)Y + Height;
    internal bool Intersects(Box other) => X < (long)other.X + other.Width && other.X < (long)X + Width && Y < (long)other.Y + other.Height && other.Y < (long)Y + Height;
}
internal sealed record WindowFacts(nint Hwnd, int Pid, long StartTicks, int Session, string Desktop, Box Bounds, uint Dpi, string Title, string ProcessName);

internal static class Native
{
    internal const uint OwnInput = 0x50414431;
    internal delegate bool EnumWindowsProc(nint hwnd, nint extra);
    private delegate bool MonitorProc(nint monitor, nint dc, ref Rect rectangle, nint data);
    [StructLayout(LayoutKind.Sequential)] internal struct Point { internal int X, Y; internal Point(int x, int y) { X = x; Y = y; } }
    [StructLayout(LayoutKind.Sequential)] internal struct Rect { internal int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] internal struct LastInput { internal uint Size, Tick; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct MonitorInfo
    {
        internal int Size; internal Rect Monitor, Work; internal uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] internal string Device;
    }
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool EnumDisplayMonitors(nint dc, nint clip, MonitorProc callback, nint data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetMonitorInfo(nint monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool EnumWindows(EnumWindowsProc callback, nint extra);
    [DllImport("user32.dll")] internal static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetForegroundWindow(nint hwnd);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool IsWindow(nint hwnd);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool IsWindowVisible(nint hwnd);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool IsIconic(nint hwnd);
    [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(nint hwnd, out uint processId);
    [DllImport("user32.dll")] internal static extern nint GetAncestor(nint hwnd, uint flags);
    [DllImport("user32.dll")] internal static extern nint GetWindow(nint hwnd, uint command);
    [DllImport("user32.dll")] internal static extern nint WindowFromPoint(Point point);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetWindowRect(nint hwnd, out Rect rectangle);
    [DllImport("dwmapi.dll")] internal static extern int DwmGetWindowAttribute(nint hwnd, int attribute, out Rect value, int size);
    [DllImport("dwmapi.dll")] internal static extern int DwmGetWindowAttribute(nint hwnd, int attribute, out int value, int size);
    [DllImport("user32.dll")] internal static extern uint GetDpiForWindow(nint hwnd);
    [DllImport("user32.dll")] internal static extern nint SetProcessDpiAwarenessContext(nint context);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(nint hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] internal static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] internal static extern nint GetThreadDesktop(uint threadId);
    [DllImport("user32.dll", SetLastError = true)] private static extern nint OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseDesktop(nint desktop);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetUserObjectInformation(nint handle, int index, StringBuilder info, int length, out uint needed);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool OpenProcessToken(nint process, uint access, out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetTokenInformation(SafeAccessTokenHandle token, int type, nint value, uint size, out uint needed);
    [DllImport("advapi32.dll")] private static extern nint GetSidSubAuthorityCount(nint sid);
    [DllImport("advapi32.dll")] private static extern nint GetSidSubAuthority(nint sid, uint index);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetLastInputInfo(ref LastInput info);

    internal static void RequireOrdinaryHost()
    {
        using var identity = WindowsIdentity.GetCurrent();
        if (new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator)) throw new Refusal("UNAUTHORIZED");
    }
    internal static string InputDesktopName()
    {
        var handle = OpenInputDesktop(0, false, 1);
        if (handle == 0) throw new Refusal("UNAUTHORIZED");
        try { return DesktopName(handle); } finally { CloseDesktop(handle); }
    }
    private static string DesktopName(nint handle)
    {
        var buffer = new StringBuilder(256);
        if (handle == 0 || !GetUserObjectInformation(handle, 2, buffer, 512, out _)) throw new Refusal("UNAUTHORIZED");
        var name = buffer.ToString();
        if (!string.Equals(name, "Default", StringComparison.OrdinalIgnoreCase)) throw new Refusal("UNAUTHORIZED");
        return name;
    }
    internal static Box Bounds(nint hwnd)
    {
        Rect rect;
        if (DwmGetWindowAttribute(hwnd, 9, out rect, Marshal.SizeOf<Rect>()) != 0 && !GetWindowRect(hwnd, out rect)) throw new Refusal("TARGET_STALE");
        var width = (long)rect.Right - rect.Left; var height = (long)rect.Bottom - rect.Top;
        if (width < 1 || height < 1 || width > 16384 || height > 16384) throw new Refusal("TARGET_STALE");
        return new Box(rect.Left, rect.Top, (int)width, (int)height);
    }
    internal static WindowFacts ReadWindow(nint hwnd, bool foreground)
    {
        if (!IsWindow(hwnd) || !IsWindowVisible(hwnd) || IsIconic(hwnd) || GetAncestor(hwnd, 2) != hwnd || foreground && GetForegroundWindow() != hwnd)
            throw new Refusal("TARGET_STALE");
        if (DwmGetWindowAttribute(hwnd, 14, out int cloaked, 4) == 0 && cloaked != 0) throw new Refusal("TARGET_STALE");
        var thread = GetWindowThreadProcessId(hwnd, out var pid);
        if (thread == 0 || pid == 0 || pid == Environment.ProcessId) throw new Refusal("UNAUTHORIZED");
        using var process = Process.GetProcessById((int)pid);
        var start = process.StartTime.ToUniversalTime().Ticks;
        var session = process.SessionId;
        if (session != Process.GetCurrentProcess().SessionId || process.HasExited) throw new Refusal("UNAUTHORIZED");
        CheckToken(process);
        var name = process.ProcessName;
        var protectedNames = new[] { "consent", "credentialuibroker", "logonui", "winlogon", "lsass", "securityhealthsystray", "sechealthui", "regedit", "taskmgr", "cmd", "powershell", "pwsh", "windowsterminal", "openconsole", "runas" };
        if (protectedNames.Contains(name, StringComparer.OrdinalIgnoreCase)) throw new Refusal("UNAUTHORIZED");
        var desktop = DesktopName(GetThreadDesktop(thread));
        if (desktop != InputDesktopName()) throw new Refusal("UNAUTHORIZED");
        var buffer = new StringBuilder(513); GetWindowText(hwnd, buffer, buffer.Capacity);
        var title = buffer.ToString();
        if (System.Text.RegularExpressions.Regex.IsMatch(title, @"password|credential|sign[ -]?in|log[ -]?in|user account control|密码|凭据|用户帐户控制|登录|登陆", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
            throw new Refusal("UNAUTHORIZED");
        var bounds = Bounds(hwnd); var dpi = GetDpiForWindow(hwnd);
        if (dpi == 0 || process.HasExited || !IsWindow(hwnd) || GetWindowThreadProcessId(hwnd, out var lastPid) == 0 || lastPid != pid || foreground && GetForegroundWindow() != hwnd)
            throw new Refusal("TARGET_STALE");
        return new(hwnd, (int)pid, start, session, desktop, bounds, dpi, title, name);
    }
    private static void CheckToken(Process process)
    {
        if (!OpenProcessToken(process.Handle, 8, out var token)) throw new Refusal("UNAUTHORIZED");
        using (token)
        {
            var pointer = Marshal.AllocHGlobal(4096);
            try
            {
                if (!GetTokenInformation(token, 20, pointer, 4, out _) || Marshal.ReadInt32(pointer) != 0) throw new Refusal("UNAUTHORIZED");
                if (!GetTokenInformation(token, 25, pointer, 4096, out _)) throw new Refusal("UNAUTHORIZED");
                var sid = Marshal.ReadIntPtr(pointer); var count = Marshal.ReadByte(GetSidSubAuthorityCount(sid));
                if (count == 0 || Marshal.ReadInt32(GetSidSubAuthority(sid, (uint)count - 1)) > 0x2000) throw new Refusal("UNAUTHORIZED");
                using var identity = new WindowsIdentity(token.DangerousGetHandle());
                using var own = WindowsIdentity.GetCurrent();
                if (identity.User?.Value != own.User?.Value) throw new Refusal("UNAUTHORIZED");
            }
            finally { Marshal.FreeHGlobal(pointer); }
        }
    }
    internal static bool Same(WindowFacts original, WindowFacts current) => original.Hwnd == current.Hwnd && original.Pid == current.Pid && original.StartTicks == current.StartTicks
        && original.Session == current.Session && original.Desktop == current.Desktop && original.Bounds == current.Bounds && original.Dpi == current.Dpi;
    internal static void Hit(WindowFacts window, int x, int y)
    {
        if (!window.Bounds.Contains(x, y) || GetAncestor(WindowFromPoint(new Point(x, y)), 2) != window.Hwnd) throw new Refusal("TARGET_STALE");
    }
    internal static string MonitorGeneration()
    {
        var monitors = new List<string>(); var failed = false;
        MonitorProc callback = (nint monitor, nint _, ref Rect rectangle, nint data) =>
        {
            var info = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>(), Device = "" };
            if (!GetMonitorInfo(monitor, ref info)) { failed = true; return false; }
            monitors.Add($"{info.Device}:{info.Monitor.Left}:{info.Monitor.Top}:{info.Monitor.Right}:{info.Monitor.Bottom}:{info.Work.Left}:{info.Work.Top}:{info.Work.Right}:{info.Work.Bottom}:{info.Flags}");
            return monitors.Count < 64;
        };
        if (!EnumDisplayMonitors(0, 0, callback, 0) || failed || monitors.Count is 0 or >= 64) throw new Refusal("TARGET_STALE");
        return string.Join('|', monitors.Order(StringComparer.Ordinal));
    }
    internal static void RequireUncovered(WindowFacts window)
    {
        var screen = new Box(GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79));
        if (!screen.Contains(window.Bounds.X, window.Bounds.Y) || !screen.Contains(window.Bounds.X + window.Bounds.Width - 1, window.Bounds.Y + window.Bounds.Height - 1)) throw new Refusal("TARGET_STALE");
        var current = GetWindow(window.Hwnd, 3); var visited = 0;
        while (current != 0 && visited++ < 4096)
        {
            if (IsWindowVisible(current) && !IsIconic(current))
            {
                var hidden = DwmGetWindowAttribute(current, 14, out int cloaked, 4) == 0 && cloaked != 0;
                if (!hidden && Bounds(current).Intersects(window.Bounds)) throw new Refusal("TARGET_STALE");
            }
            current = GetWindow(current, 3);
        }
        if (visited >= 4096) throw new Refusal("TARGET_STALE");
        Hit(window, window.Bounds.X + window.Bounds.Width / 2, window.Bounds.Y + window.Bounds.Height / 2);
    }
}
