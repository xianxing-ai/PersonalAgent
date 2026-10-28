using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace PersonalAgent.WindowsHost.Desktop;

internal sealed class InputController : IDisposable
{
    [StructLayout(LayoutKind.Sequential)] private struct Mouse { internal int X, Y; internal uint Data, Flags, Time; internal nuint Extra; }
    [StructLayout(LayoutKind.Sequential)] private struct Keyboard { internal ushort Vk, Scan; internal uint Flags, Time; internal nuint Extra; }
    [StructLayout(LayoutKind.Explicit)] private struct Data { [FieldOffset(0)] internal Mouse Mouse; [FieldOffset(0)] internal Keyboard Keyboard; }
    [StructLayout(LayoutKind.Sequential)] private struct Input { internal uint Type; internal Data Data; }
    [StructLayout(LayoutKind.Sequential)] private struct MouseHook { internal Native.Point Point; internal uint Data, Flags, Time; internal nuint Extra; }
    [StructLayout(LayoutKind.Sequential)] private struct KeyHook { internal uint Vk, Scan, Flags, Time; internal nuint Extra; }
    [StructLayout(LayoutKind.Sequential)] private struct Message { internal nint Hwnd; internal uint Value; internal nuint W; internal nint L; internal uint Time; internal Native.Point Point; }
    private delegate nint Hook(int code, nint w, nint l);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("user32.dll", SetLastError = true)] private static extern nint SetWindowsHookEx(int type, Hook hook, nint module, uint thread);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool UnhookWindowsHookEx(nint hook);
    [DllImport("user32.dll")] private static extern nint CallNextHookEx(nint hook, int code, nint w, nint l);
    [DllImport("user32.dll")] private static extern int GetMessage(out Message message, nint hwnd, uint min, uint max);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool TranslateMessage(ref Message message);
    [DllImport("user32.dll")] private static extern nint DispatchMessage(ref Message message);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool PostThreadMessage(uint thread, uint message, nuint w, nint l);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern nint GetModuleHandle(string? name);
    private readonly object gate = new();
    private readonly HashSet<(ushort Vk, ushort Scan, bool Unicode)> keys = [];
    private readonly HashSet<string> buttons = [];
    private readonly nuint marker = (nuint)(BitConverter.ToUInt32(RandomNumberGenerator.GetBytes(4)) | 0x80000000u);
    private Hook? mouseHook, keyHook;
    private nint mouseHandle, keyHandle;
    private uint hookThread;
    private Thread? thread;
    private long generation;
    private bool disposed;
    internal long Generation => Interlocked.Read(ref generation);

    internal void StartHooks()
    {
        using var ready = new ManualResetEventSlim(); var success = false;
        thread = new Thread(() =>
        {
            hookThread = GetCurrentThreadId();
            mouseHook = (code, w, l) =>
            {
                if (code >= 0 && Marshal.PtrToStructure<MouseHook>(l).Extra != marker) Interlocked.Increment(ref generation);
                return CallNextHookEx(mouseHandle, code, w, l);
            };
            keyHook = (code, w, l) =>
            {
                if (code >= 0 && Marshal.PtrToStructure<KeyHook>(l).Extra != marker) Interlocked.Increment(ref generation);
                return CallNextHookEx(keyHandle, code, w, l);
            };
            mouseHandle = SetWindowsHookEx(14, mouseHook, GetModuleHandle(null), 0);
            keyHandle = SetWindowsHookEx(13, keyHook, GetModuleHandle(null), 0);
            success = mouseHandle != 0 && keyHandle != 0; ready.Set();
            if (success) while (GetMessage(out var message, 0, 0, 0) > 0) { TranslateMessage(ref message); DispatchMessage(ref message); }
            if (mouseHandle != 0) UnhookWindowsHookEx(mouseHandle);
            if (keyHandle != 0) UnhookWindowsHookEx(keyHandle);
        }) { IsBackground = true, Name = "PersonalAgent input monitor" };
        thread.Start(); ready.Wait();
        if (!success) throw new Refusal("UNSUPPORTED_CAPABILITY");
    }
    private void Send(Input input, RequestContext? context)
    {
        if (context is not null) { context.Check(); context.Dispatched = true; }
        if (SendInput(1, [input], Marshal.SizeOf<Input>()) != 1 && context is not null) throw new Refusal("RESULT_UNKNOWN", true);
    }
    internal void Move(int x, int y, RequestContext context, Action check)
    {
        // Provider/UIA guards can block. Never hold the input release gate while consulting them.
        check();
        lock (gate)
        {
            context.Check();
            var left = Native.GetSystemMetrics(76); var top = Native.GetSystemMetrics(77);
            var width = Native.GetSystemMetrics(78); var height = Native.GetSystemMetrics(79);
            if (width < 2 || height < 2 || x < left || y < top || x >= (long)left + width || y >= (long)top + height) throw new Refusal("TARGET_STALE", context.Dispatched);
            Send(new Input { Type = 0, Data = new Data { Mouse = new Mouse { X = (int)Math.Round((x - (double)left) * 65535 / (width - 1)), Y = (int)Math.Round((y - (double)top) * 65535 / (height - 1)), Flags = 0xC001, Extra = marker } } }, context);
        }
    }
    internal void Button(string button, bool down, RequestContext context, Action check)
    {
        check();
        lock (gate)
        {
            context.Check();
            uint flags = button switch { "left" => down ? 2u : 4u, "right" => down ? 8u : 16u, "middle" => down ? 32u : 64u, _ => throw new Refusal("INVALID_ARGUMENT") };
            if (down) buttons.Add(button); else buttons.Remove(button);
            Send(new Input { Data = new Data { Mouse = new Mouse { Flags = flags, Extra = marker } } }, context);
        }
    }
    internal void Wheel(int count, bool horizontal, RequestContext context, Action check)
    {
        check();
        lock (gate)
        {
            context.Check(); Send(new Input { Data = new Data { Mouse = new Mouse { Data = unchecked((uint)(count * 120)), Flags = horizontal ? 0x1000u : 0x800u, Extra = marker } } }, context);
        }
    }
    internal void Key(ushort vk, bool down, RequestContext context, Action check, ushort scan = 0, bool unicode = false)
    {
        check();
        lock (gate)
        {
            context.Check(); var key = (vk, scan, unicode);
            if (down) keys.Add(key); else keys.Remove(key);
            Send(new Input { Type = 1, Data = new Data { Keyboard = new Keyboard { Vk = vk, Scan = scan, Flags = (unicode ? 4u : 0u) | (down ? 0u : 2u), Extra = marker } } }, context);
        }
    }
    internal void Chord(ushort[] chord, RequestContext context, Action check)
    {
        try { foreach (var key in chord) Key(key, true, context, check); }
        finally { ReleaseAll(); }
    }
    internal void TypeText(string text, RequestContext context, Action check)
    {
        try { foreach (var character in text) { Key(0, true, context, check, character, true); Key(0, false, context, check, character, true); } }
        finally { ReleaseAll(); }
    }
    internal void ReleaseAll()
    {
        lock (gate)
        {
            foreach (var key in keys) Send(new Input { Type = 1, Data = new Data { Keyboard = new Keyboard { Vk = key.Vk, Scan = key.Scan, Flags = (key.Unicode ? 4u : 0u) | 2, Extra = marker } } }, null);
            keys.Clear();
            foreach (var button in buttons) Send(new Input { Data = new Data { Mouse = new Mouse { Flags = button == "left" ? 4u : button == "right" ? 16u : 64u, Extra = marker } } }, null);
            buttons.Clear();
        }
    }
    internal static ushort[] ParseChord(string text)
    {
        var tokens = text.Split('+', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (tokens.Length is < 1 or > 5) throw new Refusal("INVALID_ARGUMENT");
        var names = new Dictionary<string, ushort>(StringComparer.OrdinalIgnoreCase)
        {
            ["ctrl"] = 0x11, ["control"] = 0x11, ["shift"] = 0x10, ["alt"] = 0x12,
            ["enter"] = 0x0D, ["return"] = 0x0D, ["tab"] = 9, ["escape"] = 0x1B, ["esc"] = 0x1B,
            ["backspace"] = 8, ["delete"] = 0x2E, ["del"] = 0x2E, ["space"] = 0x20,
            ["home"] = 0x24, ["end"] = 0x23, ["left"] = 0x25, ["up"] = 0x26, ["right"] = 0x27, ["down"] = 0x28,
            ["pageup"] = 0x21, ["pagedown"] = 0x22
        };
        var keys = tokens.Select(value => names.TryGetValue(value, out var key) ? key : value.Length == 1 && char.IsAsciiLetterOrDigit(value[0])
            ? (ushort)char.ToUpperInvariant(value[0]) : value.StartsWith('F') && int.TryParse(value.AsSpan(1), out var f) && f is >= 1 and <= 24
                ? (ushort)(0x6F + f) : throw new Refusal("INVALID_ARGUMENT")).ToArray();
        if (keys.Distinct().Count() != keys.Length || keys.Contains((ushort)0x12) && keys.Contains((ushort)0x11) && keys.Contains((ushort)0x2E)
            || keys.Contains((ushort)0x11) && keys.Contains((ushort)0x10) && keys.Contains((ushort)0x1B)) throw new Refusal("UNAUTHORIZED");
        return keys;
    }
    public void Dispose()
    {
        if (disposed) return; disposed = true; ReleaseAll();
        if (hookThread != 0) PostThreadMessage(hookThread, 0x12, 0, 0);
        thread?.Join(1500);
    }
}
