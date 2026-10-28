using System.Runtime.InteropServices;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Interop;
using System.Windows.Media.Imaging;

namespace PersonalAgent.WindowsHost.Desktop;

internal sealed class DesktopSession(InputController inputs)
{
    private sealed record Listed(string Ref, WindowFacts Window, DateTime Expires, long Epoch, long InputGeneration, string Monitors);
    private sealed record Target(string Ref, Listed Listed, long InputGeneration, string Monitors, DateTime Expires, long Epoch,
        Dictionary<string, AutomationElement> Elements, bool Sensitive);
    private readonly Dictionary<string, Listed> windows = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Target> targets = new(StringComparer.Ordinal);
    private long epoch;
    internal void Invalidate() => Interlocked.Increment(ref epoch);
    internal object Handle(string method, JsonElement parameters, RequestContext context)
    {
        context.Check(); Prune();
        return method switch
        {
            "initialize" => Initialize(parameters),
            "list_windows" => List(parameters, context),
            "activate" => Activate(parameters, context),
            "observe" => Observe(parameters, context),
            "screenshot" => Screenshot(parameters, context),
            "action" => Action(parameters, context),
            _ => throw new Refusal("UNSUPPORTED_CAPABILITY")
        };
    }
    private static void Fields(JsonElement value, params string[] allowed)
    {
        var names = value.EnumerateObject().Select(p => p.Name).ToArray();
        if (names.Distinct(StringComparer.Ordinal).Count() != names.Length || names.Any(n => !allowed.Contains(n, StringComparer.Ordinal))) throw new Refusal("INVALID_ARGUMENT");
    }
    private static string Text(JsonElement value, string name, int limit = 4096)
    {
        if (!value.TryGetProperty(name, out var property) || property.ValueKind != JsonValueKind.String || property.GetString() is not string text || text.Length > limit || text.Contains('\0'))
            throw new Refusal("INVALID_ARGUMENT");
        return text;
    }
    private static int Number(JsonElement value, string name, int fallback, int min, int max)
    {
        if (!value.TryGetProperty(name, out var element)) return fallback;
        if (!element.TryGetInt32(out var number) || number < min || number > max) throw new Refusal("INVALID_ARGUMENT");
        return number;
    }
    private static bool Flag(JsonElement value, string name)
    {
        if (!value.TryGetProperty(name, out var element)) return false;
        if (element.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) throw new Refusal("INVALID_ARGUMENT");
        return element.GetBoolean();
    }
    private object Initialize(JsonElement p)
    {
        Fields(p);
        return new { protocol = "personal-agent-desktop/1", version = "1.0.0", capabilities = new[]
        { "list_windows", "activate", "observe", "screenshot", "click", "type", "scroll", "move", "shortcut", "drag", "press", "invoke", "set_value", "select", "focus", "stop" } };
    }
    private void Prune()
    {
        var current = Interlocked.Read(ref epoch); var now = DateTime.UtcNow;
        foreach (var key in targets.Where(p => p.Value.Expires <= now || p.Value.Epoch != current).Select(p => p.Key).ToArray()) targets.Remove(key);
        foreach (var key in windows.Where(p => p.Value.Expires <= now || p.Value.Epoch != current).Select(p => p.Key).ToArray()) windows.Remove(key);
    }
    private Listed Register(WindowFacts facts, RequestContext context)
    {
        var current = Interlocked.Read(ref epoch);
        var generation = inputs.Generation; var monitors = Native.MonitorGeneration();
        var existing = windows.Values.FirstOrDefault(w => Native.Same(w.Window, facts) && w.Epoch == current && w.Expires > DateTime.UtcNow
            && w.InputGeneration == generation && w.Monitors == monitors);
        if (existing is not null) return existing;
        if (windows.Count >= 256) throw new Refusal("RESOURCE_BUSY");
        var listed = new Listed(Guid.NewGuid().ToString(), facts, Min(context.Deadline, DateTime.UtcNow.AddSeconds(30)), current, generation, monitors);
        windows.Add(listed.Ref, listed); return listed;
    }
    private static DateTime Min(DateTime first, DateTime second) => first < second ? first : second;
    private object List(JsonElement p, RequestContext context)
    {
        Fields(p); var result = new List<object>();
        Native.EnumWindows((hwnd, _) =>
        {
            if (result.Count >= 128 || context.Token.IsCancellationRequested || DateTime.UtcNow >= context.Deadline) return false;
            try
            {
                var facts = Native.ReadWindow(hwnd, false); var window = Register(facts, context);
                result.Add(new { windowRef = window.Ref, title = facts.Title, processName = facts.ProcessName, bounds = facts.Bounds });
            }
            catch { /* Unobservable or protected windows are absent, never errors containing OS metadata. */ }
            return true;
        }, 0);
        context.Check(); return new { windows = result };
    }
    private Listed ResolveWindow(string reference, bool foreground, RequestContext context)
    {
        if (!windows.TryGetValue(reference, out var listed) || listed.Expires <= DateTime.UtcNow || listed.Epoch != Interlocked.Read(ref epoch)) throw new Refusal("TARGET_STALE");
        if (listed.InputGeneration != inputs.Generation) throw new Refusal("USER_TAKEOVER");
        if (listed.Monitors != Native.MonitorGeneration()) throw new Refusal("TARGET_STALE");
        context.Check(); var facts = Native.ReadWindow(listed.Window.Hwnd, foreground);
        if (!Native.Same(listed.Window, facts)) throw new Refusal("TARGET_STALE");
        context.Check(); return listed;
    }
    private object Activate(JsonElement p, RequestContext context)
    {
        Fields(p, "windowRef"); var listed = ResolveWindow(Text(p, "windowRef", 128), false, context);
        context.Check();
        if (listed.Epoch != Interlocked.Read(ref epoch) || listed.InputGeneration != inputs.Generation) throw new Refusal("USER_TAKEOVER");
        context.Dispatched = true;
        if (!Native.SetForegroundWindow(listed.Window.Hwnd)) throw new Refusal("RESULT_UNKNOWN", true);
        var after = Native.ReadWindow(listed.Window.Hwnd, true);
        context.Check();
        if (!Native.Same(listed.Window, after) || listed.Epoch != Interlocked.Read(ref epoch) || listed.InputGeneration != inputs.Generation)
            throw new Refusal("RESULT_UNKNOWN", true);
        return new { snapshot = Capture(listed.Window.Hwnd, context), verification = new { state = "verified", kind = "foreground" } };
    }
    private object Observe(JsonElement p, RequestContext context)
    {
        Fields(p, "windowRef"); var hwnd = p.TryGetProperty("windowRef", out _) ? ResolveWindow(Text(p, "windowRef", 128), true, context).Window.Hwnd : Native.GetForegroundWindow();
        return Capture(hwnd, context);
    }
    private object Capture(nint hwnd, RequestContext context)
    {
        context.Check(); var currentEpoch = Interlocked.Read(ref epoch); var generation = inputs.Generation; var monitors = Native.MonitorGeneration();
        var facts = Native.ReadWindow(hwnd, true); var listed = Register(facts, context);
        var root = AutomationElement.FromHandle(hwnd);
        if (root.Current.ProcessId != facts.Pid) throw new Refusal("TARGET_STALE");
        var items = new List<object>(); var elements = new Dictionary<string, AutomationElement>(StringComparer.Ordinal);
        var queue = new Queue<AutomationElement>(); queue.Enqueue(root);
        var visited = 0; var characters = 0; var sensitive = false; var truncated = false;
        while (queue.Count > 0)
        {
            context.Check();
            if (++visited > 1024 || items.Count >= 256 || characters >= 49152) { truncated = true; break; }
            var element = queue.Dequeue(); var state = element.Current;
            if (state.ProcessId != facts.Pid) continue;
            if (state.IsPassword) { sensitive = true; continue; }
            if (!state.IsOffscreen && state.BoundingRectangle is var rect && !rect.IsEmpty && rect.Width > 0 && rect.Height > 0)
            {
                var box = ToBox(rect);
                if (box.Intersects(facts.Bounds))
                {
                    var name = Bounded(state.Name, 256); var role = state.ControlType.ProgrammaticName.Replace("ControlType.", "", StringComparison.Ordinal);
                    // Secret-like controls are omitted instead of exporting their Name/Value.
                    if (SensitiveName(name)) { sensitive = true; continue; }
                    var reference = Guid.NewGuid().ToString(); var patterns = new List<string>(); string? value = null;
                    if (element.TryGetCurrentPattern(ValuePattern.Pattern, out var v)) { patterns.Add("value"); value = Bounded(((ValuePattern)v).Current.Value, 4096); }
                    if (element.TryGetCurrentPattern(InvokePattern.Pattern, out _)) patterns.Add("invoke");
                    if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out _)) patterns.Add("select");
                    if (state.IsKeyboardFocusable) patterns.Add("focus");
                    characters += name.Length + (value?.Length ?? 0);
                    elements.Add(reference, element);
                    items.Add(new { @ref = reference, role, name, rect = box, enabled = state.IsEnabled, value, patterns });
                }
            }
            var child = TreeWalker.ControlViewWalker.GetFirstChild(element); var siblings = 0;
            while (child is not null && siblings++ < 512 && queue.Count < 1024)
            {
                queue.Enqueue(child); child = TreeWalker.ControlViewWalker.GetNextSibling(child);
            }
            if (child is not null) truncated = true;
        }
        context.Check();
        if (inputs.Generation != generation) throw new Refusal("USER_TAKEOVER", context.Dispatched);
        if (currentEpoch != Interlocked.Read(ref epoch) || monitors != Native.MonitorGeneration() || !Native.Same(facts, Native.ReadWindow(hwnd, true))) throw new Refusal("TARGET_STALE", context.Dispatched);
        var referenceId = Guid.NewGuid().ToString(); var expires = Min(context.Deadline, DateTime.UtcNow.AddSeconds(30));
        var observedAt = DateTime.UtcNow.ToString("O");
        object Result() => new { targetRef = referenceId, windowRef = listed.Ref, observedAt, expiresAt = expires.ToString("O"),
            window = new { title = facts.Title, processName = facts.ProcessName, bounds = facts.Bounds, dpi = facts.Dpi }, controls = items, truncated };
        // Bound escaped UTF-8, not only character counts, so client-side output budgets remain reliable.
        while (items.Count > 0 && JsonSerializer.SerializeToUtf8Bytes(Result()).Length > 192 * 1024)
        { items.RemoveAt(items.Count - 1); truncated = true; }
        foreach (var key in targets.Where(v => v.Value.Listed.Window.Hwnd == hwnd).Select(v => v.Key).ToArray()) targets.Remove(key);
        if (targets.Count >= 64) throw new Refusal("RESOURCE_BUSY", context.Dispatched);
        targets.Add(referenceId, new(referenceId, listed, generation, monitors, expires, currentEpoch, elements, sensitive || truncated));
        return Result();
    }
    private static string Bounded(string? value, int length) => value is null ? "" : value.Length <= length ? value : value[..length];
    private static bool SensitiveName(string name) => System.Text.RegularExpressions.Regex.IsMatch(name,
        @"password|credential|api[ _-]?key|secret|密码|凭据|密钥", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    private static void RequireSafeTree(Target target, RequestContext context)
    {
        // Do not rely on the old snapshot's password classification for a later image capture.
        var queue = new Queue<AutomationElement>(); queue.Enqueue(AutomationElement.FromHandle(target.Listed.Window.Hwnd)); var count = 0;
        while (queue.Count > 0)
        {
            context.Check(); if (++count > 1024) throw new Refusal("UNAUTHORIZED");
            var element = queue.Dequeue(); var state = element.Current;
            if (state.ProcessId != target.Listed.Window.Pid) throw new Refusal("TARGET_STALE");
            if (state.IsPassword || SensitiveName(Bounded(state.Name, 256))) throw new Refusal("UNAUTHORIZED");
            var child = TreeWalker.ControlViewWalker.GetFirstChild(element);
            while (child is not null)
            {
                if (queue.Count >= 1024) throw new Refusal("UNAUTHORIZED");
                queue.Enqueue(child); child = TreeWalker.ControlViewWalker.GetNextSibling(child);
            }
        }
    }
    private static Box ToBox(Rect rect)
    {
        if (!double.IsFinite(rect.X) || !double.IsFinite(rect.Y) || !double.IsFinite(rect.Width) || !double.IsFinite(rect.Height)
            || rect.X < -100000 || rect.Y < -100000 || rect.X > 100000 || rect.Y > 100000 || rect.Width > 32768 || rect.Height > 32768) throw new Refusal("TARGET_STALE");
        return new((int)Math.Floor(rect.X), (int)Math.Floor(rect.Y), (int)Math.Ceiling(rect.Width), (int)Math.Ceiling(rect.Height));
    }
    private Target TargetFor(JsonElement p)
    {
        var reference = Text(p, "targetRef", 128);
        return targets.TryGetValue(reference, out var target) ? target : throw new Refusal("TARGET_STALE");
    }
    private void Check(Target target, RequestContext context)
    {
        context.Check();
        if (target.Epoch != Interlocked.Read(ref epoch) || DateTime.UtcNow >= target.Expires || target.Monitors != Native.MonitorGeneration()) throw new Refusal("TARGET_STALE", context.Dispatched);
        if (inputs.Generation != target.InputGeneration) throw new Refusal("USER_TAKEOVER", context.Dispatched);
        if (!Native.Same(target.Listed.Window, Native.ReadWindow(target.Listed.Window.Hwnd, true))) throw new Refusal("TARGET_STALE", context.Dispatched);
        context.Check();
        if (inputs.Generation != target.InputGeneration) throw new Refusal("USER_TAKEOVER", context.Dispatched);
    }
    private static (int X, int Y) Point(JsonElement p, string name)
    {
        if (!p.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Array || value.GetArrayLength() != 2
            || !value[0].TryGetInt32(out var x) || !value[1].TryGetInt32(out var y) || Math.Abs((long)x) > 100000 || Math.Abs((long)y) > 100000) throw new Refusal("INVALID_ARGUMENT");
        return (x, y);
    }
    private AutomationElement? Element(JsonElement p, Target target)
    {
        AutomationElement? element = null;
        if (p.TryGetProperty("controlRef", out _))
        {
            if (!target.Elements.TryGetValue(Text(p, "controlRef", 128), out element)) throw new Refusal("TARGET_STALE");
        }
        else if (p.TryGetProperty("loc", out _))
        {
            var point = Point(p, "loc"); Native.Hit(target.Listed.Window, point.X, point.Y);
            element = AutomationElement.FromPoint(new System.Windows.Point(point.X, point.Y));
        }
        if (element is not null)
        {
            var state = element.Current;
            if (state.ProcessId != target.Listed.Window.Pid || state.IsPassword || state.IsOffscreen || !state.IsEnabled || !ToBox(state.BoundingRectangle).Intersects(target.Listed.Window.Bounds)) throw new Refusal("UNAUTHORIZED");
            var root = element;
            for (var count = 0; count < 64 && root is not null; count++)
            {
                if (root.Current.NativeWindowHandle == target.Listed.Window.Hwnd) return element;
                root = TreeWalker.ControlViewWalker.GetParent(root);
            }
            throw new Refusal("TARGET_STALE");
        }
        return null;
    }
    private object Action(JsonElement p, RequestContext context)
    {
        Fields(p, "targetRef", "action", "loc", "controlRef", "text", "clear", "caret_position", "press_enter", "shortcut", "key", "button", "clicks", "direction", "wheel_times", "type", "from_loc", "to_loc", "duration", "drag");
        var action = Text(p, "action", 32); var target = TargetFor(p); Check(target, context);
        if (target.Sensitive) throw new Refusal("UNAUTHORIZED");
        if (!new[] { "click", "type", "scroll", "move", "shortcut", "drag", "press", "invoke", "set_value", "select", "focus" }.Contains(action, StringComparer.Ordinal)) throw new Refusal("INVALID_ARGUMENT");
        var element = Element(p, target);
        if (action is "invoke" or "set_value" or "select" or "focus" && element is null) throw new Refusal("INVALID_ARGUMENT");
        var location = p.TryGetProperty("loc", out _) ? Point(p, "loc") : element is not null ? Center(ToBox(element.Current.BoundingRectangle)) : Center(target.Listed.Window.Bounds);
        if (action is "click" or "type" or "scroll" or "move" or "drag") Native.Hit(target.Listed.Window, location.Item1, location.Item2);
        var text = action is "type" or "set_value" ? Text(p, "text") : "";
        var clear = Flag(p, "clear"); var enter = Flag(p, "press_enter");
        var caret = p.TryGetProperty("caret_position", out _) ? Text(p, "caret_position", 10) : "idle";
        if (caret is not ("start" or "end" or "idle")) throw new Refusal("INVALID_ARGUMENT");
        var clicks = Number(p, "clicks", 1, 1, 2);
        var button = p.TryGetProperty("button", out _) ? Text(p, "button", 10) : "left";
        if (button is not ("left" or "right" or "middle")) throw new Refusal("INVALID_ARGUMENT");
        ushort[]? chord = action == "shortcut" ? InputController.ParseChord(Text(p, "shortcut", 128))
            : action == "press" ? InputController.ParseChord(Text(p, p.TryGetProperty("key", out _) ? "key" : "shortcut", 128)) : null;
        var direction = p.TryGetProperty("direction", out _) ? Text(p, "direction", 10) : "down";
        if (direction is not ("up" or "down" or "left" or "right")) throw new Refusal("INVALID_ARGUMENT");
        var wheel = Number(p, "wheel_times", 1, 1, 20);
        var drag = action == "drag" || action == "move" && Flag(p, "drag");
        var from = drag ? Point(p, "from_loc") : location;
        var to = p.TryGetProperty("to_loc", out _) ? Point(p, "to_loc") : location;
        if (drag) { Native.Hit(target.Listed.Window, from.Item1, from.Item2); Native.Hit(target.Listed.Window, to.Item1, to.Item2); }
        var duration = p.TryGetProperty("duration", out var d) ? d.GetDouble() : 0.2;
        if (!double.IsFinite(duration) || duration < 0 || duration > 3) throw new Refusal("INVALID_ARGUMENT");
        // Consume before any UI mutation or input, including actions that later become unknown.
        targets.Remove(target.Ref);
        var verified = false; string? kind = null; string? actual = null;
        void Guard() => Check(target, context);
        void PointerGuard()
        {
            Guard(); if (!Native.GetCursorPos(out var cursor)) throw new Refusal("TARGET_STALE", context.Dispatched);
            Native.Hit(target.Listed.Window, cursor.X, cursor.Y);
        }
        void MoveTo(int x, int y) => inputs.Move(x, y, context, () => { Guard(); Native.Hit(target.Listed.Window, x, y); });
        void KeyboardGuard()
        {
            Guard(); var focused = AutomationElement.FocusedElement;
            if (focused is null || focused.Current.IsPassword || focused.Current.ProcessId != target.Listed.Window.Pid) throw new Refusal("UNAUTHORIZED", context.Dispatched);
            for (var count = 0; count < 64 && focused is not null; count++)
            {
                if (focused.Current.NativeWindowHandle == target.Listed.Window.Hwnd) return;
                focused = TreeWalker.ControlViewWalker.GetParent(focused);
            }
            throw new Refusal("TARGET_STALE", context.Dispatched);
        }
        void Mark()
        {
            Guard(); var point = element is not null ? Center(ToBox(element.Current.BoundingRectangle)) : location;
            Native.Hit(target.Listed.Window, point.Item1, point.Item2); context.Dispatched = true;
        }
        void Focus()
        {
            if (element is null) return;
            Mark(); element.SetFocus(); Guard();
            if (!element.Current.HasKeyboardFocus) throw new Refusal("RESULT_UNKNOWN", true);
        }
        try
        {
            if (action == "set_value")
            {
                if (!element!.TryGetCurrentPattern(ValuePattern.Pattern, out var pattern) || ((ValuePattern)pattern).Current.IsReadOnly) throw new Refusal("UNSUPPORTED_CAPABILITY");
                Mark(); ((ValuePattern)pattern).SetValue(text); Guard();
                actual = Bounded(((ValuePattern)pattern).Current.Value, 4096);
                if (actual != text) throw new Refusal("RESULT_UNKNOWN", true);
                verified = true; kind = "value";
            }
            else if (action == "invoke")
            {
                if (!element!.TryGetCurrentPattern(InvokePattern.Pattern, out var pattern)) throw new Refusal("UNSUPPORTED_CAPABILITY");
                Mark(); ((InvokePattern)pattern).Invoke();
            }
            else if (action == "select")
            {
                if (!element!.TryGetCurrentPattern(SelectionItemPattern.Pattern, out var pattern)) throw new Refusal("UNSUPPORTED_CAPABILITY");
                Mark(); ((SelectionItemPattern)pattern).Select(); Guard();
                if (!((SelectionItemPattern)pattern).Current.IsSelected) throw new Refusal("RESULT_UNKNOWN", true);
                verified = true; kind = "selection";
            }
            else if (action == "focus")
            {
                Focus(); if (!element!.Current.HasKeyboardFocus) throw new Refusal("RESULT_UNKNOWN", true);
                verified = true; kind = "focus";
            }
            else if (action is "shortcut" or "press") inputs.Chord(chord!, context, KeyboardGuard);
            else if (action == "type")
            {
                // Only UIA ValuePattern with an explicit replace request permits exact value verification.
                if (clear && !enter && element is not null && element.TryGetCurrentPattern(ValuePattern.Pattern, out var value) && !((ValuePattern)value).Current.IsReadOnly)
                {
                    Mark(); ((ValuePattern)value).SetValue(text); Guard(); actual = Bounded(((ValuePattern)value).Current.Value, 4096);
                    if (actual != text) throw new Refusal("RESULT_UNKNOWN", true);
                    verified = true; kind = "value";
                }
                else
                {
                    if (element is not null) Focus(); else { MoveTo(location.Item1, location.Item2); inputs.Button("left", true, context, PointerGuard); inputs.Button("left", false, context, PointerGuard); }
                    if (clear) inputs.Chord([0x11, 0x41], context, KeyboardGuard);
                    else if (caret != "idle") inputs.Chord([0x11, caret == "start" ? (ushort)0x24 : (ushort)0x23], context, KeyboardGuard);
                    inputs.TypeText(text, context, KeyboardGuard);
                    if (enter) inputs.Chord([0x0D], context, KeyboardGuard);
                }
            }
            else if (action == "click")
            {
                MoveTo(location.Item1, location.Item2);
                for (var i = 0; i < clicks; i++) { inputs.Button(button, true, context, PointerGuard); inputs.Button(button, false, context, PointerGuard); }
            }
            else if (action == "scroll")
            {
                MoveTo(location.Item1, location.Item2);
                inputs.Wheel(direction is "down" or "left" ? -wheel : wheel, direction is "left" or "right", context, PointerGuard);
            }
            else if (action is "move" or "drag")
            {
                MoveTo(from.Item1, from.Item2);
                if (drag) inputs.Button("left", true, context, PointerGuard);
                for (var i = 1; i <= 24; i++)
                {
                    var x = from.Item1 + (to.Item1 - from.Item1) * i / 24; var y = from.Item2 + (to.Item2 - from.Item2) * i / 24;
                    MoveTo(x, y);
                    if (context.Token.WaitHandle.WaitOne((int)(duration * 1000 / 24))) context.Check();
                }
                if (drag) inputs.Button("left", false, context, PointerGuard);
            }
            Guard();
            return new { snapshot = Capture(target.Listed.Window.Hwnd, context), verification = new { state = verified ? "verified" : "observed", kind, actual } };
        }
        catch (Refusal error) { throw new Refusal(context.Dispatched ? "RESULT_UNKNOWN" : error.Code, context.Dispatched); }
        catch { throw new Refusal(context.Dispatched ? "RESULT_UNKNOWN" : "EXTERNAL_FAILURE", context.Dispatched); }
        finally { inputs.ReleaseAll(); }
    }
    private static (int, int) Center(Box rect) => (rect.X + rect.Width / 2, rect.Y + rect.Height / 2);

    [DllImport("user32.dll")] private static extern nint GetDC(nint hwnd);
    [DllImport("user32.dll")] private static extern int ReleaseDC(nint hwnd, nint dc);
    [DllImport("gdi32.dll")] private static extern nint CreateCompatibleDC(nint dc);
    [DllImport("gdi32.dll")] private static extern nint CreateCompatibleBitmap(nint dc, int width, int height);
    [DllImport("gdi32.dll")] private static extern nint SelectObject(nint dc, nint item);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool PrintWindow(nint hwnd, nint dc, uint flags);
    [DllImport("gdi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool DeleteObject(nint item);
    [DllImport("gdi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool DeleteDC(nint dc);
    private object Screenshot(JsonElement p, RequestContext context)
    {
        Fields(p, "targetRef"); var target = TargetFor(p); Check(target, context);
        if (target.Sensitive) throw new Refusal("UNAUTHORIZED");
        RequireSafeTree(target, context);
        Native.RequireUncovered(target.Listed.Window);
        var bounds = target.Listed.Window.Bounds;
        if (!Native.GetWindowRect(target.Listed.Window.Hwnd, out var whole)) throw new Refusal("TARGET_STALE");
        var width = (long)whole.Right - whole.Left; var height = (long)whole.Bottom - whole.Top;
        var offsetX = bounds.X - whole.Left; var offsetY = bounds.Y - whole.Top;
        if (width < 1 || height < 1 || width * height > 16_000_000 || offsetX < 0 || offsetY < 0
            || offsetX + (long)bounds.Width > width || offsetY + (long)bounds.Height > height) throw new Refusal("UNSUPPORTED_CAPABILITY");
        var screen = GetDC(0); var dc = CreateCompatibleDC(screen); var bitmap = CreateCompatibleBitmap(screen, (int)width, (int)height); nint previous = 0;
        try
        {
            if (screen == 0 || dc == 0 || bitmap == 0) throw new Refusal("EXTERNAL_FAILURE");
            previous = SelectObject(dc, bitmap); Check(target, context); Native.RequireUncovered(target.Listed.Window);
            // Ask only the selected HWND to render. Desktop BitBlt could copy another window during a transient overlay race.
            if (!PrintWindow(target.Listed.Window.Hwnd, dc, 2)) throw new Refusal("UNSUPPORTED_CAPABILITY");
            Check(target, context); Native.RequireUncovered(target.Listed.Window); RequireSafeTree(target, context);
            var source = Imaging.CreateBitmapSourceFromHBitmap(bitmap, 0, new Int32Rect(offsetX, offsetY, bounds.Width, bounds.Height), BitmapSizeOptions.FromEmptyOptions());
            var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(source)); using var stream = new MemoryStream(); encoder.Save(stream);
            if (stream.Length > 6 * 1024 * 1024) throw new Refusal("UNSUPPORTED_CAPABILITY");
            Check(target, context);
            return new { mimeType = "image/png", data = Convert.ToBase64String(stream.ToArray()), width = bounds.Width, height = bounds.Height, targetRef = target.Ref };
        }
        finally { if (previous != 0) SelectObject(dc, previous); if (bitmap != 0) DeleteObject(bitmap); if (dc != 0) DeleteDC(dc); if (screen != 0) ReleaseDC(0, screen); }
    }
}
