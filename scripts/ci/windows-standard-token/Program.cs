using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Security.AccessControl;
using System.Text;

// CI-only: never imported by a product package. No credentials or general command input.
internal static class Program
{
    const uint Query = 8, Duplicate = 2, AssignPrimary = 1, AdjustDefault = 0x80;
    const uint Infinite = 0xffffffff, Suspended = 4, UnicodeEnvironment = 0x400, ExtendedStartup = 0x80000;
    const int StdInput = -10, StdOutput = -11, StdError = -12;
    static readonly IntPtr Current = new(-1);
    static bool useCurrentToken;
    static bool privateRestrictedToken;
    static string stage = "arguments";
    static string Self => CanonicalFile(Environment.ProcessPath ?? throw new InvalidOperationException());
    static string Cwd => CanonicalDirectory(Environment.CurrentDirectory);

    public static int Main(string[] args)
    {
        if (!OperatingSystem.IsWindows()) { Console.Error.WriteLine("standard-token: Windows required"); return 125; }
        try
        {
            if (args.Length != 1) throw new InvalidOperationException();
            if (args[0] == "--architecture")
            {
                Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(NativeArchitecture())); return 0;
            }
            if (args[0] is "--smoke-probe" or "--smoke-tree" or "--smoke-grandchild") return SmokeChild(args[0]);
            if (args[0] is not ("--smoke" or "--run-check" or "--run-psec-acceptance" or "--smoke-supervisor" or "--compatibility")) throw new InvalidOperationException();
            stage = "open-current-token";
            using var own = OpenToken(GetCurrentProcess(), Query | Duplicate | AssignPrimary | AdjustDefault);
            string sid = Sid(own.Value); int session = Integer(own.Value, 12);
            using var token = SelectToken(own.Value, sid, session);
            // Keep a private pre-change copy only for the fixed A/B diagnostics. Never
            // mutate the current token or a pre-existing linked token/default object ACL.
            using var beforeDefault = args[0] == "--compatibility" && privateRestrictedToken ? DuplicatePrimary(token.Value) : null;
            if (privateRestrictedToken) SetPrivateDefaultDacl(token.Value, sid);
            if (args[0] == "--compatibility") return Compatibility(own.Value, token.Value, sid, session, beforeDefault?.Value ?? IntPtr.Zero);
            if (args[0] == "--smoke") return Smoke(token.Value, sid, session);
            if (args[0] == "--smoke-supervisor")
            {
                using var treeChild = Start(token.Value, sid, session, Self, Quote(Self) + " --smoke-tree",
                    GetStdHandle(StdInput), GetStdHandle(StdOutput), GetStdHandle(StdError));
                Console.WriteLine("tree-parent:" + GetProcessId(treeChild.Process)); Console.Out.Flush();
                return unchecked((int)treeChild.Wait(60000));
            }
            // Fixed CI operations; no caller-supplied command line, script, token, user or path.
            if (args[0] == "--run-psec-acceptance")
            {
                NativeArchitecture();
                string node = CanonicalFile(Path.Combine(Path.GetDirectoryName(ResolveNpm())!, "node.exe"));
                string script = CanonicalFile(Path.Combine(Cwd, "scripts", "ci", "windows-standard-token", "psec-acceptance.mjs"));
                using var acceptance = Start(token.Value, sid, session, node, Quote(node) + " " + Quote(script),
                    GetStdHandle(StdInput), GetStdHandle(StdOutput), GetStdHandle(StdError));
                return unchecked((int)acceptance.Wait());
            }
            string cmd = CanonicalFile(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "cmd.exe"));
            string npm = ResolveNpm();
            string command = Quote(cmd) + " /d /s /c \"\"" + npm + "\" run check\"";
            // Capture the fixed pin before ordinary-token code can change the checkout.
            string? diagnosticNodeVersion = NativeFailureMetadata.ReadPinnedNodeVersion(Path.Combine(Cwd, ".node-version"));
            DateTimeOffset checkStartedUtc = DateTimeOffset.UtcNow;
            uint exit;
            DateTimeOffset checkFinishedUtc;
            using (var child = Start(token.Value, sid, session, cmd, command,
                GetStdHandle(StdInput), GetStdHandle(StdOutput), GetStdHandle(StdError)))
            {
                exit = child.Wait();
                checkFinishedUtc = DateTimeOffset.UtcNow;
            } // Close the original Job before spending any time collecting metadata.
            // The already loaded launcher reads fixed event metadata itself. Never run
            // a mutable checkout script/executable from the original runner token here.
            try { exit = NativeFailureMetadata.PreserveExit(exit, () => NativeFailureMetadata.AfterCheck(exit, checkStartedUtc, checkFinishedUtc, diagnosticNodeVersion)); }
            catch { /* Diagnostics, including type initialization, cannot replace the original exit. */ }
            return unchecked((int)exit);
        }
        catch (Exception error)
        {
            // Do not leak paths, usernames, SID, environment or native exception messages.
            Console.Error.WriteLine("standard-token: failed closed (" + stage + "," + error.GetType().Name + ","
                + (error is Win32Exception native ? native.NativeErrorCode : error.HResult) + ")");
            return 125;
        }
    }

    static object NativeArchitecture()
    {
        stage = "native-architecture";
        string process = RuntimeInformation.ProcessArchitecture.ToString().ToLowerInvariant();
        string os = RuntimeInformation.OSArchitecture.ToString().ToLowerInvariant();
        string? expected = Environment.GetEnvironmentVariable("PA_PSEC_EXPECTED_ARCH");
        if (process is not ("x64" or "arm64") || process != os
            || (expected != null && (expected is not ("x64" or "arm64") || expected != process)))
            throw new InvalidOperationException();
        return new { processArchitecture = process, osArchitecture = os, framework = RuntimeInformation.FrameworkDescription };
    }

    static Handle SelectToken(IntPtr own, string sid, int session)
    {
        stage = "validate-current-token";
        if (Integer(own, 20) == 0) { Validate(own, sid, session); useCurrentToken = true; return CopyHandle(own, false); }
        // Only a missing linked token permits the own-token restricted alternative. Malformed
        // or wrong-user linked tokens are failures, never an excuse to select another identity.
        IntPtr linked = IntPtr.Zero;
        stage = "read-linked-token";
        IntPtr buffer = Marshal.AllocHGlobal(IntPtr.Size);
        try
        {
            if (GetTokenInformation(own, 19, buffer, IntPtr.Size, out _)) linked = Marshal.ReadIntPtr(buffer);
            else if (Marshal.GetLastWin32Error() is not (87 or 1312)) throw new Win32Exception();
        }
        finally { Marshal.FreeHGlobal(buffer); }
        if (linked != IntPtr.Zero)
        {
            var result = new Handle(linked);
            try { stage = "validate-linked-token"; Validate(linked, sid, session); if (Integer(linked, 18) != 3) throw new InvalidOperationException(); Console.WriteLine("standard-token: existing-linked"); return result; }
            catch { result.Dispose(); throw; }
        }
        // LUA_TOKEN + DISABLE_MAX_PRIVILEGE. Neither flag is accepted as proof of elevation:
        // validate the returned token and actual child below. No login or privilege grant.
        stage = "create-restricted-own-token";
        if (!CreateRestrictedToken(own, 5, 0, IntPtr.Zero, 0, IntPtr.Zero, 0, IntPtr.Zero, out IntPtr restricted))
            throw new Win32Exception();
        var filtered = new Handle(restricted);
        try
        {
            stage = "set-restricted-integrity"; SetMediumIntegrity(restricted);
            stage = "validate-restricted-own-token";
            Validate(restricted, sid, session);
            privateRestrictedToken = true;
            Console.WriteLine("standard-token: restricted-own"); return filtered;
        }
        catch { filtered.Dispose(); throw; }
    }

    static void Validate(IntPtr token, string expectedSid, int session)
    {
        if (Sid(token) != expectedSid || Integer(token, 8) != 1 || Integer(token, 20) != 0 || Integer(token, 18) is not (1 or 3)
            || Integer(token, 26) != 0 || Integer(token, 12) != session) throw new InvalidOperationException();
        using var integrity = Information(token, 25);
        IntPtr label = Marshal.ReadIntPtr(integrity.Value);
        byte count = Marshal.ReadByte(GetSidSubAuthorityCount(label));
        if (count == 0 || Marshal.ReadInt32(GetSidSubAuthority(label, (uint)(count - 1))) != 0x2000)
            throw new InvalidOperationException();
        using var groups = Information(token, 2);
        int length = Marshal.ReadInt32(groups.Value);
        int offset = IntPtr.Size == 8 ? 8 : 4, size = Marshal.SizeOf<SidAttributes>();
        for (int i = 0; i < length; i++)
        {
            var group = Marshal.PtrToStructure<SidAttributes>(IntPtr.Add(groups.Value, offset + i * size));
            if (new SecurityIdentifier(group.Sid).IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid)
                && ((group.Attributes & 0x10) == 0 || (group.Attributes & 4) != 0)) throw new InvalidOperationException();
        }
    }

    static void SetMediumIntegrity(IntPtr token)
    {
        var sid = new SecurityIdentifier("S-1-16-8192");
        byte[] binary = new byte[sid.BinaryLength]; sid.GetBinaryForm(binary, 0);
        int size = Marshal.SizeOf<SidAttributes>(); IntPtr buffer = Marshal.AllocHGlobal(size + binary.Length);
        try
        {
            IntPtr sidPointer = IntPtr.Add(buffer, size); Marshal.Copy(binary, 0, sidPointer, binary.Length);
            var label = new SidAttributes { Sid = sidPointer, Attributes = 0x20 };
            Marshal.StructureToPtr(label, buffer, false);
            if (!SetTokenInformation(token, 25, buffer, size + binary.Length)) throw new Win32Exception();
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    static Child Start(IntPtr token, string sid, int session, string executable, string command,
        IntPtr input, IntPtr output, IntPtr error, bool originalDiagnostic = false,
        bool compatibilityNoWindow = false, bool compatibilityHidden = false)
    {
        stage = "duplicate-stdio";
        using var stdin = CopyHandle(input, true); using var stdout = CopyHandle(output, true); using var stderr = CopyHandle(error, true);
        IntPtr list = IntPtr.Zero, values = IntPtr.Zero, environment = IntPtr.Zero;
        bool initialized = false; IntPtr bytes = IntPtr.Zero;
        using var job = NewJob(); ProcessInfo process = default;
        try
        {
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref bytes);
            list = Marshal.AllocHGlobal(bytes); values = Marshal.AllocHGlobal(3 * IntPtr.Size);
            if (!InitializeProcThreadAttributeList(list, 1, 0, ref bytes)) throw new Win32Exception();
            initialized = true;
            Marshal.Copy(new[] { stdin.Value, stdout.Value, stderr.Value }, 0, values, 3);
            if (!UpdateProcThreadAttribute(list, 0, new IntPtr(0x20002), values, new IntPtr(3 * IntPtr.Size), IntPtr.Zero, IntPtr.Zero))
                throw new Win32Exception();
            var startup = new StartupEx { Info = new Startup { Size = Marshal.SizeOf<StartupEx>(), Flags = 0x100u | (compatibilityHidden ? 1u : 0u),
                Input = stdin.Value, Output = stdout.Value, Error = stderr.Value }, Attributes = list };
            environment = GetEnvironmentStringsW(); if (environment == IntPtr.Zero) throw new Win32Exception();
            uint flags = Suspended | UnicodeEnvironment | ExtendedStartup | (compatibilityNoWindow ? 0x08000000u : 0u);
            stage = useCurrentToken ? "create-current-child" : "create-token-child";
            bool created = useCurrentToken
                ? CreateProcessW(executable, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, true, flags, environment, Cwd, ref startup, out process)
                : CreateProcessAsUserW(token, executable, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, true, flags, environment, Cwd, ref startup, out process);
            if (!created) throw new Win32Exception();
            stage = "assign-child-job";
            if (!AssignProcessToJobObject(job.Value, process.Process)) throw new Win32Exception();
            stage = "validate-actual-child-token";
            using (var actual = OpenToken(process.Process, Query))
            {
                if (originalDiagnostic)
                {
                    if (!useCurrentToken || Sid(actual.Value) != sid || Integer(actual.Value, 12) != session
                        || Integer(actual.Value, 20) != Integer(token, 20)) throw new InvalidOperationException();
                }
                else Validate(actual.Value, sid, session);
            }
            stage = "resume-child";
            if (ResumeThread(process.Thread) == uint.MaxValue) throw new Win32Exception();
            var result = new Child(process.Process, job.Detach()); process.Process = IntPtr.Zero; return result;
        }
        finally
        {
            if (process.Thread != IntPtr.Zero) CloseHandle(process.Thread);
            if (process.Process != IntPtr.Zero) { TerminateProcess(process.Process, 125); WaitForSingleObject(process.Process, 10000); CloseHandle(process.Process); }
            if (environment != IntPtr.Zero) FreeEnvironmentStringsW(environment);
            if (initialized) DeleteProcThreadAttributeList(list);
            if (list != IntPtr.Zero) Marshal.FreeHGlobal(list);
            if (values != IntPtr.Zero) Marshal.FreeHGlobal(values);
        }
    }

    static Handle NewJob()
    {
        stage = "create-kill-on-close-job";
        var job = new Handle(CreateJobObjectW(IntPtr.Zero, null));
        try
        {
            var limits = new JobLimits { Basic = new BasicLimits { Flags = 0x2000 } };
            int size = Marshal.SizeOf<JobLimits>(); IntPtr buffer = Marshal.AllocHGlobal(size);
            try { Marshal.StructureToPtr(limits, buffer, false); if (!SetInformationJobObject(job.Value, 9, buffer, (uint)size)) throw new Win32Exception(); }
            finally { Marshal.FreeHGlobal(buffer); }
            return job;
        }
        catch { job.Dispose(); throw; }
    }

    static int Smoke(IntPtr token, string sid, int session)
    {
        Environment.SetEnvironmentVariable("PA_CI_TOKEN_SMOKE", "fixed-inherited-value");
        using (var output = new Pipe()) using (var error = new Pipe())
        {
            using var child = Start(token, sid, session, Self, Quote(Self) + " --smoke-probe",
                GetStdHandle(StdInput), output.Write.Value, error.Write.Value);
            output.Write.Dispose(); error.Write.Dispose();
            Task<string> stdout = Task.Run(output.ReadAll), stderr = Task.Run(error.ReadAll);
            if (child.Wait(30000) != 23) throw new InvalidOperationException();
            if (!Task.WaitAll(new Task[] { stdout, stderr }, 10000)) throw new TimeoutException();
            if (stdout.Result.Trim() != "stdout:" + CwdDigest() || stderr.Result.Trim() != "stderr:fixed-inherited-value") throw new InvalidOperationException();
        }
        using (var output = new Pipe()) using (var error = new Pipe())
        {
            using var child = Start(token, sid, session, Self, Quote(Self) + " --smoke-tree",
                GetStdHandle(StdInput), output.Write.Value, error.Write.Value);
            output.Write.Dispose(); error.Write.Dispose();
            Task<string> firstLine = Task.Run(output.ReadLine);
            if (!firstLine.Wait(15000) || !uint.TryParse(firstLine.Result, out uint pid)) throw new InvalidOperationException();
            using var descendant = new Handle(OpenProcess(0x100000 | 0x1000, false, pid));
            using (var actual = OpenToken(descendant.Value, Query)) Validate(actual.Value, sid, session);
            child.KillTree(); child.Wait(10000);
            if (WaitForSingleObject(descendant.Value, 10000) != 0) throw new InvalidOperationException();
        }
        // A separate launcher instance owns this Job. Kill just that launcher, then wait
        // on already-opened identities of both descendants, not recycled PID lookups.
        using (var supervisor = Process.Start(new ProcessStartInfo(Self, "--smoke-supervisor") {
            UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true,
            WorkingDirectory = Cwd }) ?? throw new InvalidOperationException())
        {
            Handle? parent = null, descendant = null;
            Task<string> errors = supervisor.StandardError.ReadToEndAsync();
            try
            {
                var deadline = Stopwatch.StartNew();
                while ((parent == null || descendant == null) && deadline.ElapsedMilliseconds < 20000)
                {
                    var lineTask = supervisor.StandardOutput.ReadLineAsync();
                    if (!lineTask.Wait(20000 - (int)deadline.ElapsedMilliseconds)) throw new TimeoutException();
                    string? line = lineTask.Result;
                    if (line == null) throw new InvalidOperationException();
                    if (line.StartsWith("tree-parent:", StringComparison.Ordinal) && uint.TryParse(line[12..], out uint directPid))
                        parent = new Handle(OpenProcess(0x100000 | 0x1000, false, directPid));
                    else if (uint.TryParse(line, out uint descendantPid))
                        descendant = new Handle(OpenProcess(0x100000 | 0x1000, false, descendantPid));
                }
                if (parent == null || descendant == null) throw new InvalidOperationException();
                using (var actual = OpenToken(parent.Value, Query)) Validate(actual.Value, sid, session);
                using (var actual = OpenToken(descendant.Value, Query)) Validate(actual.Value, sid, session);
                supervisor.Kill();
                if (!supervisor.WaitForExit(10000) || WaitForSingleObject(parent.Value, 10000) != 0
                    || WaitForSingleObject(descendant.Value, 10000) != 0) throw new InvalidOperationException();
                if (!errors.Wait(10000) || errors.Result.Length != 0) throw new InvalidOperationException();
            }
            finally
            {
                if (!supervisor.HasExited) { supervisor.Kill(); supervisor.WaitForExit(10000); }
                parent?.Dispose(); descendant?.Dispose();
            }
        }
        Console.WriteLine("standard-token smoke: stdio, exit23, env/cwd, job-close and killed-launcher descendant termination verified");
        if (!NativeFailureMetadata.VerifyForSmoke(NativeFailureMetadata.ReadPinnedNodeVersion(Path.Combine(Cwd, ".node-version")))) return 125;
        return 0;
    }

    static int SmokeChild(string mode)
    {
        if (mode == "--smoke-probe")
        {
            if (Environment.GetEnvironmentVariable("PA_CI_TOKEN_SMOKE") != "fixed-inherited-value") return 124;
            Console.WriteLine("stdout:" + CwdDigest()); Console.Error.WriteLine("stderr:fixed-inherited-value"); return 23;
        }
        if (mode == "--smoke-tree")
        {
            using var descendant = Process.Start(new ProcessStartInfo(Self, "--smoke-grandchild") { UseShellExecute = false }) ?? throw new InvalidOperationException();
            Console.WriteLine(descendant.Id); Console.Out.Flush(); descendant.WaitForExit(); return 124;
        }
        Thread.Sleep(60000); return 124;
    }

    static string CwdDigest() => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Cwd)));
    static int Compatibility(IntPtr own, IntPtr selected, string sid, int session, IntPtr beforeDefault)
    {
        bool selectedUsesCurrent = useCurrentToken;
        string node = CanonicalFile(Path.Combine(Path.GetDirectoryName(ResolveNpm())!, "node.exe"));
        string script = CanonicalFile(Path.Combine(Cwd, "scripts", "ci", "windows-standard-token", "compatibility-probe.mjs"));
        string cmd = CanonicalFile(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "cmd.exe"));
        string csc = CanonicalFile(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),
            "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"));
        try
        {
            var cases = new List<(string Name, IntPtr Token, bool Baseline, bool Required)> {
                ("original-token", own, true, true) };
            if (beforeDefault != IntPtr.Zero) cases.Add(("selected-before-default-dacl", beforeDefault, false, false));
            cases.Add(("selected-token", selected, false, true));
            foreach (var test in cases)
            {
                try
                {
                    bool baseline = test.Baseline;
                    useCurrentToken = baseline || selectedUsesCurrent;
                    IntPtr token = test.Token;
                    bool passed = true;
                    Console.WriteLine("standard-token compatibility: " + test.Name);
                    Console.WriteLine("standard-token default-dacl-config: " + System.Text.Json.JsonSerializer.Serialize(DefaultDaclConfiguration(token, sid)));
                    Console.WriteLine("standard-token desktop-access: " + System.Text.Json.JsonSerializer.Serialize(DesktopAccess(token, own)));
                    foreach (bool noWindow in new[] { false, true })
                    {
                    // Only console connection changes. SW_HIDE is explicit in both variants;
                    // no CREATE_NEW_CONSOLE, DETACHED_PROCESS, visible UI or ACL change.
                    Console.WriteLine("standard-token compatibility-flags: createNoWindow=" + noWindow.ToString().ToLowerInvariant());
                    passed &= DirectProbe(token, sid, session, cmd, Quote(cmd) + " /d /s /c \"\"" + ResolveNpm() + "\" prefix\"",
                        "direct-cmd-npm-prefix", baseline, noWindow);
                    passed &= DirectProbe(token, sid, session, csc, Quote(csc) + " /help",
                        "direct-framework-csc-help-full-env", baseline, noWindow);
                    // Keep Node's second-generation shell:false/windowsHide:true fixed, and
                    // compare only how its first-generation parent is attached to a console.
                    using var probe = Start(token, sid, session, node, Quote(node) + " " + Quote(script) + (test.Required ? " --require-success" : ""),
                        GetStdHandle(StdInput), GetStdHandle(StdOutput), GetStdHandle(StdError), baseline, noWindow, true);
                    uint exit = probe.Wait(60000);
                    Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { stage = "first-generation-node-probe", createNoWindow = noWindow, exitCode = exit }));
                    passed &= exit == 0;
                    }
                    if (test.Required && !passed) return 125;
                }
                catch (Exception error) when (!test.Required)
                {
                    // The old private copy is evidence only. A known broken control must
                    // not hide the candidate; candidate/original required failures propagate.
                    Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new {
                        stage = "old-default-dacl-control-failure", failedStage = stage,
                        errorCode = error is Win32Exception native ? native.NativeErrorCode : error.HResult }));
                }
            }
            return 0;
        }
        finally { useCurrentToken = selectedUsesCurrent; }
    }

    static bool DirectProbe(IntPtr token, string sid, int session, string executable, string command,
        string label, bool baseline, bool noWindow)
    {
        using var output = new Pipe(); using var error = new Pipe();
        using var child = Start(token, sid, session, executable, command, GetStdHandle(StdInput),
            output.Write.Value, error.Write.Value, baseline, noWindow, true);
        output.Write.Dispose(); error.Write.Dispose();
        Task<string> stdout = Task.Run(output.ReadAll), stderr = Task.Run(error.ReadAll);
        uint exit = child.Wait(30000);
        if (!Task.WaitAll(new Task[] { stdout, stderr }, 10000)) throw new TimeoutException();
        Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { stage = label, createNoWindow = noWindow,
            exitCode = exit, stdoutPresent = stdout.Result.Length > 0, stderrPresent = stderr.Result.Length > 0 }));
        return exit == 0 && stdout.Result.Length > 0 && stderr.Result.Length == 0
            && (label != "direct-cmd-npm-prefix" || string.Equals(stdout.Result.Trim(), Cwd, StringComparison.OrdinalIgnoreCase));
    }

    static Handle DuplicatePrimary(IntPtr token)
    {
        if (!DuplicateTokenEx(token, Query | Duplicate | AssignPrimary | AdjustDefault, IntPtr.Zero, 2, 1, out IntPtr copy)) throw new Win32Exception();
        return new Handle(copy);
    }
    static void SetPrivateDefaultDacl(IntPtr token, string sid)
    {
        stage = "set-new-restricted-token-default-dacl";
        var acl = new RawAcl(2, 2);
        acl.InsertAce(0, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, 0x10000000, new SecurityIdentifier(sid), false, null));
        acl.InsertAce(1, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, 0x10000000, new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), false, null));
        byte[] bytes = new byte[acl.BinaryLength]; acl.GetBinaryForm(bytes, 0);
        using var data = new Memory(bytes.Length); using var wrapper = new Memory(IntPtr.Size);
        Marshal.Copy(bytes, 0, data.Value, bytes.Length); Marshal.WriteIntPtr(wrapper.Value, data.Value);
        // TOKEN_DEFAULT_DACL is a PACL wrapper. The kernel copies its contents here;
        // this sets defaults for future objects, never the ACL of any existing object.
        // https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-token_default_dacl
        if (!SetTokenInformation(token, 6, wrapper.Value, IntPtr.Size)) throw new Win32Exception();
        Validate(token, sid, Integer(token, 12));
    }
    static object DefaultDaclConfiguration(IntPtr token, string sid)
    {
        using var info = Information(token, 6); IntPtr pointer = Marshal.ReadIntPtr(info.Value);
        if (pointer == IntPtr.Zero) return new { nullDacl = true, selectedUserGenericAllAce = false, systemGenericAllAce = false };
        int length = (ushort)Marshal.ReadInt16(pointer, 2); byte[] bytes = new byte[length]; Marshal.Copy(pointer, bytes, 0, length);
        var acl = new RawAcl(bytes, 0); bool user = false, system = false;
        foreach (GenericAce ace in acl)
        {
            if (ace is not CommonAce common || common.AceQualifier != AceQualifier.AccessAllowed
                || (common.AceFlags & AceFlags.InheritOnly) != 0 || (common.AccessMask & 0x10000000) == 0) continue;
            user |= common.SecurityIdentifier.Value == sid;
            system |= common.SecurityIdentifier.IsWellKnown(WellKnownSidType.LocalSystemSid);
        }
        // Configuration only, not an effective-rights calculation or CSRSS identity test.
        return new { nullDacl = false, selectedUserGenericAllAce = user, systemGenericAllAce = system };
    }

    static object DesktopAccess(IntPtr token, IntPtr original)
    {
        string? originalLogon = LogonSid(original), selectedLogon = LogonSid(token);
        return new { originalEnabledLogonSidPresent = originalLogon != null, selectedEnabledLogonSidPresent = selectedLogon != null,
            logonSidRetained = originalLogon != null && originalLogon == selectedLogon,
            windowStation = StationAccess(token),
            // https://learn.microsoft.com/en-us/windows/win32/winstation/desktop-security-and-access-rights
            // Read: ENUMERATE|READOBJECTS; Write: CREATEMENU|CREATEWINDOW|HOOKCONTROL|
            // JOURNALPLAYBACK|JOURNALRECORD|WRITEOBJECTS; Execute: SWITCHDESKTOP.
            desktop = ObjectAccess(GetThreadDesktop(GetCurrentThreadId()), token,
                new GenericMapping { Read = 0x20041, Write = 0x200be, Execute = 0x20100, All = 0xf01ff }) };
    }
    static string? LogonSid(IntPtr token)
    {
        using var groups = Information(token, 2); int count = Marshal.ReadInt32(groups.Value);
        for (int i = 0; i < count; i++)
        {
            var group = Marshal.PtrToStructure<SidAttributes>(IntPtr.Add(groups.Value, (IntPtr.Size == 8 ? 8 : 4) + i * Marshal.SizeOf<SidAttributes>()));
            if ((group.Attributes & 0xc0000000) == 0xc0000000 && (group.Attributes & 4) != 0 && (group.Attributes & 0x10) == 0)
                return new SecurityIdentifier(group.Sid).Value;
        }
        return null;
    }
    static object StationAccess(IntPtr token)
    {
        IntPtr station = GetProcessWindowStation();
        // WinSta0 is the only interactive station. Read its name solely to choose the
        // documented object-type mapping; never log it or change any existing ACL.
        GetUserObjectInformationW(station, 2, IntPtr.Zero, 0, out uint bytes);
        if (bytes == 0) return new { known = false, allowed = false, error = Marshal.GetLastWin32Error() };
        using var name = new Memory(checked((int)bytes));
        if (!GetUserObjectInformationW(station, 2, name.Value, bytes, out _))
            return new { known = false, allowed = false, error = Marshal.GetLastWin32Error() };
        bool interactive = string.Equals(Marshal.PtrToStringUni(name.Value), "WinSta0", StringComparison.OrdinalIgnoreCase);
        // Microsoft Window Station Security and Access Rights: interactive/noninteractive
        // mappings differ in READSCREEN and WRITEATTRIBUTES. STANDARD_RIGHTS_READ/WRITE/
        // EXECUTE are READ_CONTROL (0x20000); STANDARD_RIGHTS_REQUIRED is 0xf0000.
        // https://learn.microsoft.com/en-us/windows/win32/winstation/window-station-security-and-access-rights
        var mapping = interactive
            ? new GenericMapping { Read = 0x20303, Write = 0x2001c, Execute = 0x20060, All = 0xf037f }
            : new GenericMapping { Read = 0x20103, Write = 0x2000c, Execute = 0x20060, All = 0xf016f };
        return ObjectAccess(station, token, mapping);
    }
    static object ObjectAccess(IntPtr handle, IntPtr token, GenericMapping mapping)
    {
        // DACL/owner/group only: no SACL privilege, no ACL change, no identity/name logging.
        uint information = 7; GetUserObjectSecurity(handle, ref information, IntPtr.Zero, 0, out uint bytes);
        if (bytes == 0) return new { known = false, allowed = false, error = Marshal.GetLastWin32Error() };
        using var descriptor = new Memory(checked((int)bytes));
        if (!GetUserObjectSecurity(handle, ref information, descriptor.Value, bytes, out _))
            return new { known = false, allowed = false, error = Marshal.GetLastWin32Error() };
        if (!DuplicateToken(token, 2, out IntPtr impersonation))
            return new { known = false, allowed = false, error = Marshal.GetLastWin32Error() };
        using var copy = new Handle(impersonation); uint size = 1024;
        using var privileges = new Memory((int)size);
        if (!AccessCheck(descriptor.Value, impersonation, mapping.All, ref mapping, privileges.Value, ref size, out _, out bool allowed))
            return new { known = false, allowed = false, error = Marshal.GetLastWin32Error() };
        return new { known = true, allowed, error = 0 };
    }
    static string Quote(string value)
    {
        if (value.IndexOfAny(new[] { '"', '\r', '\n', '%', '!', '&', '|', '<', '>', '^' }) >= 0) throw new InvalidOperationException();
        return "\"" + value + "\"";
    }
    static string ResolveNpm()
    {
        foreach (string directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
        {
            if (!Path.IsPathFullyQualified(directory)) continue;
            string candidate = Path.Combine(directory, "npm.cmd");
            if (File.Exists(candidate)) { string result = CanonicalFile(candidate); Quote(result); return result; }
        }
        throw new InvalidOperationException();
    }
    static string CanonicalFile(string value) { string full = Canonical(value); if (!File.Exists(full)) throw new InvalidOperationException(); return full; }
    static string CanonicalDirectory(string value) { string full = Canonical(value); if (!Directory.Exists(full)) throw new InvalidOperationException(); return full; }
    static string Canonical(string value)
    {
        if (!Path.IsPathFullyQualified(value) || value.StartsWith("\\\\", StringComparison.Ordinal)) throw new InvalidOperationException();
        string full = Path.GetFullPath(value);
        for (string? current = full; current != null; current = Path.GetDirectoryName(current))
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException();
        return full;
    }

    static string Sid(IntPtr token) { using var value = Information(token, 1); return new SecurityIdentifier(Marshal.ReadIntPtr(value.Value)).Value; }
    static int Integer(IntPtr token, int kind) { using var value = Information(token, kind); return Marshal.ReadInt32(value.Value); }
    static Memory Information(IntPtr token, int kind)
    {
        GetTokenInformation(token, kind, IntPtr.Zero, 0, out int size); if (size <= 0) throw new Win32Exception();
        var memory = new Memory(size); try { if (!GetTokenInformation(token, kind, memory.Value, size, out _)) throw new Win32Exception(); return memory; }
        catch { memory.Dispose(); throw; }
    }
    static Handle OpenToken(IntPtr process, uint access) { if (!OpenProcessToken(process, access, out IntPtr token)) throw new Win32Exception(); return new Handle(token); }
    static Handle CopyHandle(IntPtr value, bool inherit)
    {
        if (!DuplicateHandle(Current, value, Current, out IntPtr copy, 0, inherit, 2)) throw new Win32Exception(); return new Handle(copy);
    }
    sealed class Memory : IDisposable { public IntPtr Value; public Memory(int size) { Value = Marshal.AllocHGlobal(size); } public void Dispose() { if (Value != IntPtr.Zero) { Marshal.FreeHGlobal(Value); Value = IntPtr.Zero; } } }
    sealed class Handle : IDisposable
    {
        public IntPtr Value; public Handle(IntPtr value) { if (value == IntPtr.Zero || value == new IntPtr(-1)) throw new Win32Exception(); Value = value; }
        public IntPtr Detach() { IntPtr value = Value; Value = IntPtr.Zero; return value; }
        public void Dispose() { if (Value != IntPtr.Zero) { CloseHandle(Value); Value = IntPtr.Zero; } }
    }
    sealed class Child : IDisposable
    {
        readonly Handle process; readonly Handle job;
        public IntPtr Process => process.Value;
        public Child(IntPtr process, IntPtr job) { this.process = new Handle(process); this.job = new Handle(job); }
        public uint Wait(uint timeout = Infinite) { if (WaitForSingleObject(process.Value, timeout) != 0) throw new TimeoutException(); if (!GetExitCodeProcess(process.Value, out uint code)) throw new Win32Exception(); return code; }
        public void KillTree() => job.Dispose();
        public void Dispose() { job.Dispose(); process.Dispose(); }
    }
    sealed class Pipe : IDisposable
    {
        public readonly Handle Write; readonly Handle read;
        public Pipe() { if (!CreatePipe(out IntPtr r, out IntPtr w, IntPtr.Zero, 0)) throw new Win32Exception(); read = new Handle(r); Write = new Handle(w); }
        public string ReadAll() => Read(false);
        public string ReadLine() => Read(true);
        string Read(bool line)
        {
            var bytes = new List<byte>(); var buffer = new byte[1];
            while (ReadFile(read.Value, buffer, 1, out uint size, IntPtr.Zero) && size == 1)
            { bytes.Add(buffer[0]); if (bytes.Count > 65536) throw new InvalidOperationException(); if (line && buffer[0] == 10) break; }
            return Encoding.UTF8.GetString(bytes.ToArray()).TrimEnd('\r', '\n');
        }
        public void Dispose() { Write.Dispose(); read.Dispose(); }
    }

    [StructLayout(LayoutKind.Sequential)] struct SidAttributes { public IntPtr Sid; public uint Attributes; }
    [StructLayout(LayoutKind.Sequential)] struct GenericMapping { public uint Read, Write, Execute, All; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Startup { public int Size; public IntPtr Reserved, Desktop, Title; public uint X,Y,Width,Height,CharsX,CharsY,Fill,Flags; public ushort Show, ReservedSize; public IntPtr ReservedBytes, Input, Output, Error; }
    [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup Info; public IntPtr Attributes; }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits { public long ProcessTime, JobTime; public uint Flags; public UIntPtr Min, Max; public uint Active; public UIntPtr Affinity; public uint Priority, Scheduling; }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOps,WriteOps,OtherOps,ReadBytes,WriteBytes,OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct JobLimits { public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob; }
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool DuplicateHandle(IntPtr sourceProcess,IntPtr source,IntPtr targetProcess,out IntPtr target,uint access,bool inherit,uint options);
    [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
    [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int kind,IntPtr value,int bytes,out int returned);
    [DllImport("advapi32.dll",SetLastError=true)] static extern bool SetTokenInformation(IntPtr token,int kind,IntPtr value,int bytes);
    [DllImport("advapi32.dll",SetLastError=true)] static extern bool CreateRestrictedToken(IntPtr existing,uint flags,uint disabled,IntPtr disable,uint deleted,IntPtr delete,uint restricted,IntPtr restrict,out IntPtr token);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSidToSidW(string text,out IntPtr sid);
    [DllImport("advapi32.dll")] static extern uint GetLengthSid(IntPtr sid);
    [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
    [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthority(IntPtr sid,uint index);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessAsUserW(IntPtr token,string application,StringBuilder command,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,uint flags,IntPtr environment,string cwd,ref StartupEx startup,out ProcessInfo process);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string application,StringBuilder command,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,uint flags,IntPtr environment,string cwd,ref StartupEx startup,out ProcessInfo process);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr security,string? name);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,IntPtr value,uint bytes);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
    [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint exit);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,uint flags,ref IntPtr bytes);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr kind,IntPtr value,IntPtr bytes,IntPtr previous,IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr GetEnvironmentStringsW();
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool FreeEnvironmentStringsW(IntPtr environment);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,IntPtr security,uint bytes);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool ReadFile(IntPtr file,byte[] buffer,uint bytes,out uint read,IntPtr overlapped);
    [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
    [DllImport("kernel32.dll",SetLastError=true)] static extern uint GetProcessId(IntPtr process);
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr GetThreadDesktop(uint thread);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll",SetLastError=true)] static extern bool GetUserObjectSecurity(IntPtr handle,ref uint information,IntPtr descriptor,uint bytes,out uint needed);
    [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetUserObjectInformationW(IntPtr handle,int information,IntPtr value,uint bytes,out uint needed);
    [DllImport("advapi32.dll",SetLastError=true)] static extern bool DuplicateToken(IntPtr token,int level,out IntPtr copy);
    [DllImport("advapi32.dll",SetLastError=true)] static extern bool DuplicateTokenEx(IntPtr token,uint access,IntPtr security,int level,int type,out IntPtr copy);
    [DllImport("advapi32.dll",SetLastError=true)] static extern bool AccessCheck(IntPtr descriptor,IntPtr token,uint desired,ref GenericMapping mapping,IntPtr privileges,ref uint bytes,out uint granted,out bool allowed);
}
