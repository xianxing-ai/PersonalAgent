using System.Diagnostics;
using System.Globalization;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Security.Cryptography;
using PersonalAgent.WindowsHost.Service;

// This process owns the actual Windows pipe client handle. Node's public
// net.Socket API does not expose that handle for OS peer-PID verification.
// Standard input/output carry unmodified Windows Host 0.1.0 JSONL bytes;
// standard error carries one fixed launch verdict before any frame is relayed.
Process? host = null;
var verified = false;
try
{
    if ((args.Length != 2 && args.Length != 4) || args[0] != "--host" ||
        (args.Length == 4 && args[2] != "--journal-directory") || !Path.IsPathFullyQualified(args[1]) ||
        !string.Equals(Path.GetFileName(args[1]), "WindowsHost.Host.exe", StringComparison.OrdinalIgnoreCase))
        throw new ArgumentException("Invalid Host executable");
    var hostPath = Path.GetFullPath(args[1]);
    var journalDirectory = args.Length == 4 ? LocalJournalDirectory.Validate(args[3]) : null;
    if (!File.Exists(hostPath) || !File.Exists(Path.Combine(Path.GetDirectoryName(hostPath)!, "windows-host.json")))
        throw new FileNotFoundException("Host or contract is unavailable");
    using (var identity = WindowsIdentity.GetCurrent())
    {
        if (identity.User is null || new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator))
            throw new UnauthorizedAccessException("Elevated or unidentified bridge is unavailable");
    }

    var pipeName = "pa_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
    var launch = new ProcessStartInfo(hostPath)
    {
        UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
        RedirectStandardOutput = true, RedirectStandardError = true
    };
    launch.ArgumentList.Add("--pipe");
    launch.ArgumentList.Add(pipeName);
    launch.ArgumentList.Add("--client-pid");
    launch.ArgumentList.Add(Environment.ProcessId.ToString(CultureInfo.InvariantCulture));
    if (journalDirectory is not null)
    {
        launch.ArgumentList.Add("--journal-directory");
        launch.ArgumentList.Add(journalDirectory);
    }
    host = Process.Start(launch) ?? throw new InvalidOperationException("Host did not start");
    _ = host.StandardOutput.BaseStream.CopyToAsync(Stream.Null);
    _ = host.StandardError.BaseStream.CopyToAsync(Stream.Null);
    var hostStartUtc = host.StartTime.ToUniversalTime();
    var sessionId = Process.GetCurrentProcess().SessionId;

    using var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut,
        PipeOptions.Asynchronous, TokenImpersonationLevel.Impersonation);
    await pipe.ConnectAsync(5000).ConfigureAwait(false);
    if (!PipeNative.GetNamedPipeServerProcessId(pipe.SafePipeHandle.DangerousGetHandle(), out var serverPid) ||
        serverPid != host.Id || host.HasExited || host.StartTime.ToUniversalTime() != hostStartUtc ||
        host.SessionId != sessionId || !pipe.IsConnected)
        throw new UnauthorizedAccessException("Windows Host pipe server identity changed");

    Console.Error.Write("VERIFIED\n");
    Console.Error.Flush();
    verified = true;
    using var stop = new CancellationTokenSource();
    using var input = Console.OpenStandardInput();
    using var output = Console.OpenStandardOutput();
    var toHost = input.CopyToAsync(pipe, 8192, stop.Token);
    var fromHost = pipe.CopyToAsync(output, 8192, stop.Token);
    var hostExit = host.WaitForExitAsync(stop.Token);
    var first = await Task.WhenAny(toHost, fromHost, hostExit).ConfigureAwait(false);
    var normalClose = first == toHost && toHost.IsCompletedSuccessfully;
    stop.Cancel();
    pipe.Dispose();
    return normalClose ? 0 : 3;
}
catch
{
    if (!verified)
    {
        Console.Error.Write("REFUSED\n");
        Console.Error.Flush();
    }
    return verified ? 3 : 2;
}
finally
{
    if (host is not null)
    {
        try { if (!host.HasExited) host.Kill(entireProcessTree: true); }
        catch { /* Host also exits when its bound bridge PID exits. */ }
        try { host.Dispose(); }
        catch { /* Preserve the fixed control signal on cleanup failure. */ }
    }
}

internal static class PipeNative
{
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetNamedPipeServerProcessId(nint pipe, out uint serverProcessId);
}
