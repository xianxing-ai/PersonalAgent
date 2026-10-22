using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text.RegularExpressions;

namespace PersonalAgent.WindowsHost.Service;

internal sealed class HostLaunchBinding
{
    internal string PipeName { get; }
    internal string? JournalDirectory { get; }
    private readonly int _clientPid;
    private readonly DateTime _clientStartUtc;
    private readonly int _sessionId;
    private readonly SecurityIdentifier _userSid;

    private HostLaunchBinding(string pipeName, int clientPid, string? journalDirectory)
    {
        PipeName = pipeName;
        JournalDirectory = journalDirectory;
        _clientPid = clientPid;
        using var client = Process.GetProcessById(clientPid);
        _clientStartUtc = client.StartTime.ToUniversalTime();
        _sessionId = Process.GetCurrentProcess().SessionId;
        if (client.SessionId != _sessionId)
            throw new UnauthorizedAccessException("Windows Host client session differs from host");
        using var identity = WindowsIdentity.GetCurrent();
        _userSid = identity.User ?? throw new UnauthorizedAccessException("Windows Host has no user SID");
        if (new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator))
            throw new UnauthorizedAccessException("Elevated Windows Host is not supported");
    }

    internal static HostLaunchBinding Parse(string[] args)
    {
        if ((args.Length != 4 && args.Length != 6) || args[0] != "--pipe" || args[2] != "--client-pid" ||
            (args.Length == 6 && args[4] != "--journal-directory") ||
            !Regex.IsMatch(args[1], "^pa_[0-9a-f]{32}$", RegexOptions.CultureInvariant) ||
            !int.TryParse(args[3], out var pid) || pid <= 0)
            throw new ArgumentException("Windows Host requires a random pipe name and trusted client PID");
        return new HostLaunchBinding(args[1], pid,
            args.Length == 6 ? LocalJournalDirectory.Validate(args[5]) : null);
    }

    internal void VerifyProcess(NamedPipeServerStream pipe)
    {
        if (!GetNamedPipeClientProcessId(pipe.SafePipeHandle.DangerousGetHandle(), out var pid) ||
            pid != _clientPid)
            throw new UnauthorizedAccessException("Unexpected Windows Host pipe peer process");
        using var client = Process.GetProcessById(_clientPid);
        if (client.StartTime.ToUniversalTime() != _clientStartUtc || client.SessionId != _sessionId)
            throw new UnauthorizedAccessException("Windows Host pipe peer identity changed");
    }

    // Named-pipe impersonation uses the last message read from this pipe. Call
    // only after reading and validating hello, before acknowledging the client.
    internal void VerifyUser(NamedPipeServerStream pipe)
    {
        SecurityIdentifier? peerSid = null;
        pipe.RunAsClient(() => { using var peer = WindowsIdentity.GetCurrent(); peerSid = peer.User; });
        if (peerSid is null || !_userSid.Equals(peerSid))
            throw new UnauthorizedAccessException("Windows Host pipe peer is not the current user");
    }

    // A killed bridge must not leave this Host waiting forever with the
    // single-user input mutex held. The Process handle tracks the original
    // process even if its numeric PID is later reused.
    internal async Task MonitorClientExitAsync(CancellationTokenSource lifetime)
    {
        try
        {
            using var client = Process.GetProcessById(_clientPid);
            if (client.StartTime.ToUniversalTime() != _clientStartUtc ||
                client.SessionId != _sessionId)
                throw new UnauthorizedAccessException("Windows Host client process changed");
            await client.WaitForExitAsync(lifetime.Token).ConfigureAwait(false);
            lifetime.Cancel();
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
        catch { lifetime.Cancel(); } // A missing or unobservable client fails closed.
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNamedPipeClientProcessId(nint pipe, out uint clientProcessId);
}
