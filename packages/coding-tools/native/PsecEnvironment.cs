using System.Buffers.Binary;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace PersonalAgent.CodingTools.Native;

/** Own binding to the public Windows PSEC ABI; no MXC/Codex runtime dependency. */
internal sealed class PsecEnvironment : IDisposable
{
    internal IntPtr Handle { get; private set; }
    internal uint Minor { get; }
    internal ulong SupportFlags { get; }

    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("processmodel.dll", ExactSpelling = true)]
    private static extern int QueryProcessSecurityEnvironmentSupport(out ulong flags);

    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("processmodel.dll", ExactSpelling = true)]
    private static extern int IsProcessSecurityEnvironmentVersionSupported(uint major, out byte available, out uint minor);

    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("processmodel.dll", ExactSpelling = true)]
    private static extern int CreateProcessSecurityEnvironment(byte[] specification, uint bytes, uint flags, out IntPtr environment);

    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("processmodel.dll", ExactSpelling = true)]
    private static extern void CloseProcessSecurityEnvironment(IntPtr environment);

    internal static (uint Minor, ulong Flags) Probe()
    {
        int hr = IsProcessSecurityEnvironmentVersionSupported(1, out byte available, out uint minor);
        if (hr < 0) Marshal.ThrowExceptionForHR(hr);
        if (available == 0) throw new NotSupportedException("PSEC version 1 is unavailable");
        hr = QueryProcessSecurityEnvironmentSupport(out ulong flags);
        if (hr < 0) Marshal.ThrowExceptionForHR(hr);
        return (minor, flags);
    }

    internal PsecEnvironment(string[] readRoots, string[] writeRoots)
    {
        var support = Probe();
        Minor = support.Minor;
        SupportFlags = support.Flags;
        // Version 1.0 suffices for path grants and capability-free deny-all networking.
        byte[] spec = PsecBuffer.Create(readRoots, writeRoots);
        int hr = CreateProcessSecurityEnvironment(spec, checked((uint)spec.Length), 0, out IntPtr handle);
        if (hr < 0) Marshal.ThrowExceptionForHR(hr);
        if (handle == IntPtr.Zero) throw new Win32Exception("PSEC returned no environment");
        Handle = handle;
    }

    public void Dispose()
    {
        if (Handle == IntPtr.Zero) return;
        CloseProcessSecurityEnvironment(Handle);
        Handle = IntPtr.Zero;
    }
}

/** A bounded forward FlatBuffer writer for our fixed PSEC 1.0 subset.
 * Layout reference: microsoft/mxc external/windows-sdk/ProcessSecurityEnvironment.fbs.
 * No capability string, proxy, loopback exemption, or network allow rule is encoded.
 */
internal sealed class PsecBuffer
{
    private readonly List<byte> bytes = new(new byte[8]);

    private int Reserve(int count, int alignment = 4)
    {
        while (bytes.Count % alignment != 0) bytes.Add(0);
        int start = bytes.Count;
        bytes.AddRange(new byte[count]);
        return start;
    }

    private void U16(int at, ushort value)
    {
        bytes[at] = (byte)value;
        bytes[at + 1] = (byte)(value >> 8);
    }

    private void U32(int at, uint value)
    {
        for (int i = 0; i < 4; i++) bytes[at + i] = (byte)(value >> (i * 8));
    }

    private int Table(ushort size, params ushort[] fields)
    {
        int vtable = Reserve(4 + fields.Length * 2, 2);
        U16(vtable, checked((ushort)(4 + fields.Length * 2)));
        U16(vtable + 2, size);
        for (int i = 0; i < fields.Length; i++) U16(vtable + 4 + i * 2, fields[i]);
        int table = Reserve(size, 8);
        U32(table, checked((uint)(table - vtable)));
        return table;
    }

    private void Pointer(int at, int target) => U32(at, checked((uint)(target - at)));

    private int Strings(string[] values)
    {
        int vector = Reserve(4 + values.Length * 4);
        U32(vector, checked((uint)values.Length));
        for (int i = 0; i < values.Length; i++)
        {
            byte[] text = Encoding.UTF8.GetBytes(values[i]);
            if (text.Length > 32768) throw new InvalidDataException("PSEC path is too long");
            int value = Reserve(4 + text.Length + 1);
            U32(value, checked((uint)text.Length));
            for (int j = 0; j < text.Length; j++) bytes[value + 4 + j] = text[j];
            Pointer(vector + 4 + i * 4, value);
        }
        return vector;
    }

    internal static byte[] Create(string[] readRoots, string[] writeRoots)
    {
        if (readRoots.Length > 64 || writeRoots.Length > 32) throw new InvalidDataException("Too many PSEC roots");
        var b = new PsecBuffer();
        // version, capabilities, win32k, ui, read/write, read-only, deny, network.
        int root = b.Table(40, 4, 0, 0, 0, writeRoots.Length == 0 ? (ushort)0 : (ushort)24,
            readRoots.Length == 0 ? (ushort)0 : (ushort)28, 0, 36);
        b.U32(0, checked((uint)root));
        b.bytes[4] = (byte)'P'; b.bytes[5] = (byte)'S'; b.bytes[6] = (byte)'E'; b.bytes[7] = (byte)'C';
        b.U16(root + 4, 1); b.U16(root + 6, 0);
        if (writeRoots.Length > 0) b.Pointer(root + 24, b.Strings(writeRoots));
        if (readRoots.Length > 0) b.Pointer(root + 28, b.Strings(readRoots));
        int network = b.Table(20, 0, 8, 0, 0);
        b.Pointer(root + 36, network);
        int egress = b.Table(4); // default_action=deny, no allow/deny endpoints.
        b.Pointer(network + 8, egress);
        return b.bytes.ToArray();
    }
}
