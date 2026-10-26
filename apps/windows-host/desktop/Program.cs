using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using System.Windows.Threading;

namespace PersonalAgent.WindowsHost.Desktop;

internal sealed class Refusal(string code, bool dispatched = false) : Exception
{
    internal string Code { get; } = code;
    internal bool Dispatched { get; } = dispatched;
}

internal sealed class RequestContext(string id, DateTime deadline, CancellationToken token)
{
    internal string Id { get; } = id;
    internal DateTime Deadline { get; } = deadline;
    internal CancellationToken Token { get; } = token;
    internal bool Dispatched { get; set; }
    internal void Check()
    {
        if (DateTime.UtcNow >= Deadline) throw new Refusal("TIMEOUT", Dispatched);
        if (Token.IsCancellationRequested) throw new Refusal("CANCELLED", Dispatched);
    }
}

internal static class Program
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private static readonly object Output = new();
    private static readonly ConcurrentDictionary<string, CancellationTokenSource> Pending = new(StringComparer.Ordinal);
    private const int MaxLine = 1024 * 1024;

    [STAThread]
    private static int Main()
    {
        Console.InputEncoding = new UTF8Encoding(false, true);
        Console.OutputEncoding = new UTF8Encoding(false);
        try
        {
            Native.RequireOrdinaryHost();
            Native.SetProcessDpiAwarenessContext(new nint(-4));
            using var inputs = new InputController();
            inputs.StartHooks();
            var ready = new ManualResetEventSlim();
            Dispatcher? dispatcher = null;
            DesktopSession? session = null;
            var worker = new Thread(() =>
            {
                dispatcher = Dispatcher.CurrentDispatcher;
                session = new DesktopSession(inputs);
                ready.Set();
                Dispatcher.Run();
            }) { IsBackground = true, Name = "PersonalAgent desktop STA" };
            worker.SetApartmentState(ApartmentState.STA);
            worker.Start();
            ready.Wait();
            string? line;
            while ((line = ReadBoundedLine()) is not null)
            {
                string? id = null;
                try
                {
                    using var document = JsonDocument.Parse(line, new JsonDocumentOptions { MaxDepth = 16 });
                    var frame = document.RootElement;
                    if (frame.ValueKind != JsonValueKind.Object || frame.EnumerateObject().Any(p => p.Name is not ("id" or "method" or "params" or "deadline"))
                        || frame.EnumerateObject().Select(p => p.Name).Distinct(StringComparer.Ordinal).Count() != frame.EnumerateObject().Count())
                        throw new Refusal("INVALID_ARGUMENT");
                    id = frame.GetProperty("id").GetString();
                    var method = frame.GetProperty("method").GetString();
                    if (string.IsNullOrEmpty(id) || id.Length > 128 || id.Any(char.IsControl) || string.IsNullOrEmpty(method))
                        throw new Refusal("INVALID_ARGUMENT");
                    var deadline = DateTime.Parse(frame.GetProperty("deadline").GetString()!, null,
                        System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal);
                    if (deadline <= DateTime.UtcNow) throw new Refusal("TIMEOUT");
                    if (deadline - DateTime.UtcNow > TimeSpan.FromMinutes(30)) throw new Refusal("INVALID_ARGUMENT");
                    var parameters = frame.TryGetProperty("params", out var data) ? data.Clone() : JsonSerializer.SerializeToElement(new { });
                    if (parameters.ValueKind != JsonValueKind.Object) throw new Refusal("INVALID_ARGUMENT");
                    if (method == "stop")
                    {
                        if (parameters.EnumerateObject().Any()) throw new Refusal("INVALID_ARGUMENT");
                        foreach (var source in Pending.Values) { try { source.Cancel(); } catch (ObjectDisposedException) { } }
                        session!.Invalidate();
                        inputs.ReleaseAll();
                        Reply(id, new { stopped = true });
                        continue;
                    }
                    if (Pending.Count >= 64) throw new Refusal("RESOURCE_BUSY");
                    var cts = new CancellationTokenSource(deadline - DateTime.UtcNow);
                    if (!Pending.TryAdd(id, cts)) { cts.Dispose(); throw new Refusal("REVISION_CONFLICT"); }
                    var context = new RequestContext(id, deadline, cts.Token);
                    dispatcher!.BeginInvoke(() =>
                    {
                        try { context.Check(); Reply(context.Id, session!.Handle(method, parameters, context)); }
                        catch (Refusal refusal) { Fail(context.Id, refusal.Code, refusal.Dispatched || context.Dispatched); }
                        catch (OperationCanceledException) { Fail(context.Id, "CANCELLED", context.Dispatched); }
                        catch { Fail(context.Id, context.Dispatched ? "RESULT_UNKNOWN" : "EXTERNAL_FAILURE", context.Dispatched); }
                        finally { Pending.TryRemove(context.Id, out _); cts.Dispose(); }
                    });
                }
                catch (Refusal refusal) { Fail(id, refusal.Code, refusal.Dispatched); }
                catch { Fail(id, "INVALID_ARGUMENT", false); }
            }
            foreach (var source in Pending.Values) { try { source.Cancel(); } catch (ObjectDisposedException) { } }
            session!.Invalidate(); inputs.ReleaseAll();
            dispatcher!.BeginInvokeShutdown(DispatcherPriority.Send);
            worker.Join(1500);
            return 0;
        }
        catch { Fail(null, "UNSUPPORTED_CAPABILITY", false); return 1; }
    }

    private static string? ReadBoundedLine()
    {
        var text = new StringBuilder();
        var exceeded = false;
        for (;;)
        {
            var value = Console.In.Read();
            if (value < 0) return exceeded ? "{" : text.Length == 0 ? null : text.ToString();
            if (value == '\n') break;
            if (value == '\r') continue;
            if (text.Length >= MaxLine) exceeded = true;
            else text.Append((char)value);
        }
        // Invalid JSON is handled once by the caller, after draining the complete oversized line.
        if (exceeded) return "{";
        return text.ToString();
    }

    private static void Reply(string id, object result) => Write(new { id, ok = true, result });
    private static void Fail(string? id, string code, bool dispatched) => Write(new
    {
        id, ok = false, error = new { code, message = code switch
        {
            "INVALID_ARGUMENT" => "Desktop request is invalid.", "TIMEOUT" => "Desktop request expired.",
            "CANCELLED" => "Desktop request was stopped.", "TARGET_STALE" => "Observe the original target again.",
            "USER_TAKEOVER" => "User input changed; control was returned.", "UNAUTHORIZED" => "This desktop target is protected.",
            "RESULT_UNKNOWN" => "The dispatched action requires original-run reconciliation.",
            "RESOURCE_BUSY" => "Desktop request capacity is full.", "REVISION_CONFLICT" => "Desktop request identity was reused.",
            "UNSUPPORTED_CAPABILITY" => "The requested desktop capability is unavailable.",
            _ => "The desktop provider could not complete this request."
        }, dispatched }
    });
    private static void Write(object value)
    {
        lock (Output) { Console.Out.WriteLine(JsonSerializer.Serialize(value, Json)); Console.Out.Flush(); }
    }
}
