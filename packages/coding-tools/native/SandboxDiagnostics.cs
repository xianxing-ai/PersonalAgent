using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text.Json;

namespace PersonalAgent.CodingTools.Native;

internal static partial class Program
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
    private static extern IntPtr LoadLibraryExW(string name, IntPtr file, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Ansi, SetLastError = true, ExactSpelling = true)]
    private static extern IntPtr GetProcAddress(IntPtr module, string name);
    [DllImport("kernel32.dll", ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool FreeLibrary(IntPtr module);

    // Fixed, read-only diagnostics. No caller path, PSEC environment, child process,
    // account identifier, exception message, environment block or enforcement claim.
    private static int DiagnoseSandbox()
    {
        string[] names = ["IsProcessSecurityEnvironmentVersionSupported", "QueryProcessSecurityEnvironmentSupport",
            "CreateProcessSecurityEnvironment", "CloseProcessSecurityEnvironment"];
        string system = Environment.GetFolderPath(Environment.SpecialFolder.System);
        string dll = Path.Combine(system, "processmodel.dll");
        var exports = names.ToDictionary(name => name, _ => false);
        IntPtr module = IntPtr.Zero;
        int? loadError = null;
        string stage = "dll-missing";
        object token;
        try
        {
            using var identity = WindowsIdentity.GetCurrent();
            token = new { available = true,
                elevated = TokenValue(Process.GetCurrentProcess().Handle, 20) != 0,
                appContainer = TokenValue(Process.GetCurrentProcess().Handle, 29) != 0,
                administrator = new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator) };
        }
        catch (Exception error)
        {
            token = new { available = false, error = error.GetType().Name,
                code = error is Win32Exception native ? native.NativeErrorCode : error.HResult };
        }
        try
        {
            // Match the production DllImport search restriction exactly.
            module = LoadLibraryExW("processmodel.dll", IntPtr.Zero, 0x00000800);
            if (module == IntPtr.Zero)
            {
                loadError = Marshal.GetLastWin32Error();
                stage = File.Exists(dll) ? "dll-load-failed" : "dll-missing";
            }
            else
            {
                foreach (string name in names) exports[name] = GetProcAddress(module, name) != IntPtr.Zero;
                stage = exports.Values.All(value => value) ? "exports-present" : "exports-missing";
            }
        }
        finally { if (module != IntPtr.Zero) FreeLibrary(module); }
        static string? Version(string file)
        {
            try { return File.Exists(file) ? FileVersionInfo.GetVersionInfo(file).FileVersion : null; }
            catch { return null; }
        }
        Console.WriteLine(JsonSerializer.Serialize(new { backend = "windows-psec", diagnosticOnly = true, enforced = false,
            runtime = new { framework = RuntimeInformation.FrameworkDescription },
            os = new { version = Environment.OSVersion.Version.ToString(),
                kernelVersion = Version(Path.Combine(system, "kernel32.dll")),
                architecture = RuntimeInformation.OSArchitecture.ToString(), processArchitecture = RuntimeInformation.ProcessArchitecture.ToString() },
            token, loader = new { stage, exists = File.Exists(dll), version = Version(dll),
                loaded = module != IntPtr.Zero, win32 = loadError, exports } }));
        return 0;
    }
}
