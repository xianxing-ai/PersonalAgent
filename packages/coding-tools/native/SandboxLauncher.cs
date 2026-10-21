using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Win32.SafeHandles;

namespace PersonalAgent.CodingTools.Native;

internal static partial class Program
{
    private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const uint WAIT_TIMEOUT = 258;
    private const uint TOKEN_QUERY = 8;
    private static readonly object FrameLock = new();

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr AttributeList; }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref nuint bytes);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, nuint attribute, IntPtr value,
        nuint size, IntPtr previous, IntPtr returnedSize);
    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateSandboxProcess(string application, StringBuilder command,
        IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles,
        uint flags, IntPtr environment, string cwd, ref STARTUPINFOEX startup, out PROCESS_INFORMATION process);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryInformationJobObject(IntPtr job, int informationClass, IntPtr information,
        uint bytes, IntPtr returnedLength);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetTokenInformation(IntPtr token, int informationClass, out int value,
        uint bytes, out uint returnedBytes);
    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenNativeFile(string path, uint access, uint share, ref SECURITY_ATTRIBUTES attributes,
        uint disposition, uint flags, IntPtr template);

    private static void LockPath(string path, bool directory, List<IntPtr> locks)
    {
        string current = Path.GetFullPath(path);
        for (;;)
        {
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException("Reparse path is not permitted");
            var attributes = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf<SECURITY_ATTRIBUTES>(), bInheritHandle = false };
            // Deny FILE_SHARE_DELETE for the entire lifetime, including all directory ancestors.
            // READ_ATTRIBUTES alone does not participate in all Windows sharing checks.
            // Directory LIST_DIRECTORY / file GENERIC_READ keeps delete/replace sharing denied.
            IntPtr handle = OpenNativeFile(current, directory ? 0x81u : 0x80000000u, directory ? 3u : 1u,
                ref attributes, 3, directory ? 0x02200000u : 0x00200000u, IntPtr.Zero);
            if (handle == new IntPtr(-1)) throw new Win32Exception();
            locks.Add(handle);
            string? parent = Path.GetDirectoryName(current);
            if (parent == null || parent == current) break;
            current = parent; directory = true;
        }
    }

    private sealed class SandboxInput
    {
        public required string Nonce { get; init; }
        public required string Mode { get; init; }
        public required string[] ReadRoots { get; init; }
        public required string[] WriteRoots { get; init; }
        public required string Executable { get; init; }
        public required string[] Argv { get; init; }
        public required Dictionary<string, string> Env { get; init; }
        public required string Cwd { get; init; }
        public required DateTimeOffset Deadline { get; init; }
        public required int MaxOutputBytes { get; init; }
    }

    private static void Frame(object frame)
    {
        lock (FrameLock) { Console.WriteLine(JsonSerializer.Serialize(frame)); Console.Out.Flush(); }
    }

    private static int TokenValue(IntPtr process, int type)
    {
        if (!OpenProcessToken(process, TOKEN_QUERY, out IntPtr token)) throw new Win32Exception();
        try
        {
            if (!GetTokenInformation(token, type, out int value, 4, out _)) throw new Win32Exception();
            return value;
        }
        finally { CloseHandle(token); }
    }

    private static bool TreeStopped(IntPtr job)
    {
        // JOBOBJECT_BASIC_ACCOUNTING_INFORMATION: ActiveProcesses at offset 40.
        IntPtr accounting = Marshal.AllocHGlobal(48);
        try
        {
            if (!QueryInformationJobObject(job, 1, accounting, 48, IntPtr.Zero)) return false;
            return Marshal.ReadInt32(accounting, 40) == 0;
        }
        finally { Marshal.FreeHGlobal(accounting); }
    }

    private static int RunSandbox()
    {
        SandboxInput? input = null;
        IntPtr job = IntPtr.Zero, process = IntPtr.Zero, thread = IntPtr.Zero;
        IntPtr attributes = IntPtr.Zero, securityValue = IntPtr.Zero, handleValues = IntPtr.Zero, environment = IntPtr.Zero;
        var handles = new List<IntPtr>();
        var pathLocks = new List<IntPtr>();
        bool started = false, constrained = false, attributesInitialized = false;
        string stage = "request";
        try
        {
            string? line = Console.ReadLine();
            if (line == null || line.Length > 262144) throw new InvalidDataException("Invalid request size");
            input = JsonSerializer.Deserialize<SandboxInput>(line, new JsonSerializerOptions {
                PropertyNameCaseInsensitive = false, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow });
            if (input == null || input.Nonce.Length != 64 || input.MaxOutputBytes < 1 || input.MaxOutputBytes > 262144 ||
                input.Argv.Length > 128 || input.ReadRoots.Length > 64 || input.WriteRoots.Length > 32 ||
                input.Deadline <= DateTimeOffset.UtcNow || input.Mode is not ("read-only" or "workspace-write" or "full-access"))
                throw new InvalidDataException("Invalid sandbox request");
            if (input.Mode == "read-only" && input.WriteRoots.Length != 0) throw new InvalidDataException("Read-only grants write access");
            if (TokenValue(System.Diagnostics.Process.GetCurrentProcess().Handle, 20) != 0)
                throw new InvalidOperationException("Elevated helper is not permitted");
            constrained = input.Mode != "full-access";
            stage = "lock-paths";
            foreach (string root in input.ReadRoots.Concat(input.WriteRoots).Append(input.Cwd).Distinct(StringComparer.OrdinalIgnoreCase))
                LockPath(root, true, pathLocks);
            LockPath(input.Executable, false, pathLocks);
            stage = "create-environment";
            using PsecEnvironment? psec = constrained ? new PsecEnvironment(input.ReadRoots, input.WriteRoots) : null;
            stage = "job-and-pipes";
            job = CreateJobObjectW(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new Win32Exception();
            var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION { BasicLimitInformation =
                new JOBOBJECT_BASIC_LIMIT_INFORMATION { LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE } };
            IntPtr limitsBuffer = Marshal.AllocHGlobal(Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>());
            try
            {
                Marshal.StructureToPtr(limits, limitsBuffer, false);
                if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, limitsBuffer,
                    checked((uint)Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>()))) throw new Win32Exception();
            }
            finally { Marshal.FreeHGlobal(limitsBuffer); }
            var inherit = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf<SECURITY_ATTRIBUTES>(), bInheritHandle = true };
            if (!CreatePipe(out IntPtr stdoutRead, out IntPtr stdoutWrite, ref inherit, 0)) throw new Win32Exception();
            handles.Add(stdoutRead); handles.Add(stdoutWrite);
            if (!CreatePipe(out IntPtr stderrRead, out IntPtr stderrWrite, ref inherit, 0)) throw new Win32Exception();
            handles.Add(stderrRead); handles.Add(stderrWrite);
            if (!SetHandleInformation(stdoutRead, HANDLE_FLAG_INHERIT, 0) ||
                !SetHandleInformation(stderrRead, HANDLE_FLAG_INHERIT, 0)) throw new Win32Exception();
            IntPtr stdin = OpenNativeFile("NUL", 0x80000000, 3, ref inherit, 3, 0, IntPtr.Zero);
            if (stdin == new IntPtr(-1)) throw new Win32Exception();
            handles.Add(stdin);
            stage = "attributes";
            nuint attributeBytes = 0;
            InitializeProcThreadAttributeList(IntPtr.Zero, constrained ? 2 : 1, 0, ref attributeBytes);
            attributes = Marshal.AllocHGlobal(checked((int)attributeBytes));
            if (!InitializeProcThreadAttributeList(attributes, constrained ? 2 : 1, 0, ref attributeBytes)) throw new Win32Exception();
            attributesInitialized = true;
            handleValues = Marshal.AllocHGlobal(IntPtr.Size * 3);
            Marshal.WriteIntPtr(handleValues, 0, stdin); Marshal.WriteIntPtr(handleValues, IntPtr.Size, stdoutWrite);
            Marshal.WriteIntPtr(handleValues, IntPtr.Size * 2, stderrWrite);
            if (!UpdateProcThreadAttribute(attributes, 0, 0x20002, handleValues, (nuint)(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception();
            if (constrained)
            {
                securityValue = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(securityValue, psec!.Handle);
                if (!UpdateProcThreadAttribute(attributes, 0, 0x20023, securityValue, (nuint)IntPtr.Size, IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception();
            }
            var startup = new STARTUPINFOEX { AttributeList = attributes, StartupInfo = new STARTUPINFO {
                cb = Marshal.SizeOf<STARTUPINFOEX>(), dwFlags = (int)STARTF_USESTDHANDLES,
                hStdInput = stdin, hStdOutput = stdoutWrite, hStdError = stderrWrite } };
            string env = string.Join('\0', input.Env.OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase)
                .Select(pair => pair.Key + "=" + pair.Value)) + "\0\0";
            environment = Marshal.StringToHGlobalUni(env);
            var command = new StringBuilder(QuoteArgument(input.Executable));
            foreach (string argument in input.Argv) command.Append(' ').Append(QuoteArgument(argument));
            stage = "create-process";
            if (!CreateSandboxProcess(input.Executable, command, IntPtr.Zero, IntPtr.Zero, true,
                CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
                environment, input.Cwd, ref startup, out PROCESS_INFORMATION created)) throw new Win32Exception();
            process = created.hProcess; thread = created.hThread;
            stage = "assign-job";
            if (!AssignProcessToJobObject(job, process)) throw new Win32Exception();
            stage = "verify-token";
            int appContainer = TokenValue(process, 29);
            if (TokenValue(process, 20) != 0 || (constrained && appContainer != 1))
                throw new InvalidOperationException("Target token does not match requested isolation");
            Frame(new { type = "ready", nonce = input.Nonce, backend = constrained ? "windows-psec" : "none",
                enforced = constrained, pid = created.dwProcessId, appContainer = appContainer == 1 });
            Task<string?> control = Task.Run(Console.ReadLine);
            var handshakeDeadline = DateTimeOffset.UtcNow.AddSeconds(10);
            while (!control.IsCompleted && DateTimeOffset.UtcNow < input.Deadline && DateTimeOffset.UtcNow < handshakeDeadline) Thread.Sleep(10);
            if (!control.IsCompleted || control.Result != "GO " + input.Nonce) throw new InvalidOperationException("Execution was not authorized at resume");
            if (DateTimeOffset.UtcNow >= input.Deadline) throw new TimeoutException();
            if (ResumeThread(thread) == uint.MaxValue) throw new Win32Exception();
            started = true;
            CloseHandle(thread); thread = IntPtr.Zero;
            foreach (IntPtr handle in new[] { stdoutWrite, stderrWrite, stdin }) { CloseHandle(handle); handles.Remove(handle); }
            int totalOutput = 0, outputExceeded = 0;
            Task Pump(IntPtr read, string stream)
            {
                handles.Remove(read);
                return Task.Run(() => {
                    using var pipe = new FileStream(new SafeFileHandle(read, true), FileAccess.Read);
                    var buffer = new byte[4096]; int count;
                    while ((count = pipe.Read(buffer)) > 0)
                    {
                        int end = Interlocked.Add(ref totalOutput, count);
                        int take = Math.Clamp(input.MaxOutputBytes - (end - count), 0, count);
                        if (take > 0) Frame(new { type = "data", nonce = input.Nonce, stream, data = Convert.ToBase64String(buffer, 0, take) });
                        if (end > input.MaxOutputBytes) Interlocked.Exchange(ref outputExceeded, 1);
                    }
                });
            }
            Task stdout = Pump(stdoutRead, "stdout"), stderr = Pump(stderrRead, "stderr");
            control = Task.Run(Console.ReadLine);
            string outcome = "exited";
            while (WaitForSingleObject(process, 20) == WAIT_TIMEOUT)
            {
                if (DateTimeOffset.UtcNow >= input.Deadline) { outcome = "timeout"; break; }
                if (Volatile.Read(ref outputExceeded) != 0) { outcome = "unknown"; break; }
                if (control.IsCompleted) { outcome = "cancelled"; break; }
            }
            if (!GetExitCodeProcess(process, out uint exit)) throw new Win32Exception();
            // End descendants even when the root exited normally. No breakaway flag was granted.
            TerminateJobObject(job, outcome == "exited" ? 0u : 1u);
            var stopDeadline = DateTimeOffset.UtcNow.AddSeconds(3);
            while (!TreeStopped(job) && DateTimeOffset.UtcNow < stopDeadline) Thread.Sleep(10);
            bool stopped = TreeStopped(job);
            bool drained = Task.WaitAll(new[] { stdout, stderr }, 3000);
            Frame(new { type = "result", nonce = input.Nonce, backend = constrained ? "windows-psec" : "none",
                enforced = constrained, outcome = stopped && drained && outputExceeded == 0 ? outcome : "unknown",
                exitCode = exit == STILL_ACTIVE ? (long?)null : exit, executionStarted = true,
                stopped, sideEffects = stopped ? "possible" : "unknown" });
            return stopped && drained ? 0 : 6;
        }
        catch (Exception error)
        {
            if (job != IntPtr.Zero) TerminateJobObject(job, 1);
            if (process != IntPtr.Zero && !started) TerminateProcess(process, 1);
            Frame(new { type = "result", nonce = input?.Nonce, backend = constrained ? "windows-psec" : "none",
                enforced = false, outcome = started ? "unknown" : "unavailable", exitCode = (int?)null,
                executionStarted = started, stopped = !started, sideEffects = started ? "unknown" : "none",
                reason = error.GetType().Name, stage, hresult = error.HResult,
                win32 = error is Win32Exception native ? native.NativeErrorCode : (int?)null });
            return 5;
        }
        finally
        {
            if (job != IntPtr.Zero) CloseHandle(job);
            if (thread != IntPtr.Zero) CloseHandle(thread);
            if (process != IntPtr.Zero) CloseHandle(process);
            foreach (IntPtr handle in handles) CloseHandle(handle);
            foreach (IntPtr handle in pathLocks) CloseHandle(handle);
            if (attributesInitialized) DeleteProcThreadAttributeList(attributes);
            foreach (IntPtr allocation in new[] { attributes, securityValue, handleValues, environment })
                if (allocation != IntPtr.Zero) Marshal.FreeHGlobal(allocation);
        }
    }
}
