using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;

// Loaded as part of the existing launcher image before ordinary-token test code runs.
// No process launches, mutable-code loads, environment reads, registry writes or ACL changes.
internal static class NativeFailureMetadata
{
    const int MaxXmlBytes = 65536, MaxEvents = 128, MaxCandidates = 16;
    const string EventNamespace = "http://schemas.microsoft.com/win/2004/08/events/event";
    const string Scope = "check_time_window_candidates_without_test_process_correlation";
    const string VersionPattern = @"\A(?:0|[1-9][0-9]{0,4})(?:\.(?:0|[1-9][0-9]{0,4})){2,3}\z";
    internal sealed record Candidate(long EventRecordId, string OccurredUtc, string Application,
        string ApplicationVersion, string Module, string ExceptionCode, string FaultOffset, string? ModuleVersion);
    sealed record Observation(string Status, string Reason, Candidate[] Candidates, bool LimitReached = false);

    internal static uint PreserveExit(uint originalExit, Action diagnostics)
    {
        try { diagnostics(); } catch { /* Deliberately preserve the completed original check. */ }
        return originalExit;
    }

    // The existing --smoke entrypoint checks this return. No new command interface.
    internal static bool VerifyForSmoke(string? pin)
    {
        bool verified = SelfTest();
        try
        {
            var end = DateTimeOffset.UtcNow;
            Observation probe = pin == null ? Unavailable("node_version_unavailable") : ReadWithBudget(end.AddMinutes(-1), end, pin, false);
            Console.WriteLine(JsonSerializer.Serialize(new { schema = "windows-native-candidates/v1", mode = "smoke_validation",
                selfTest = verified ? "passed" : "failed", probeStatus = probe.Status, probeReason = probe.Reason }));
        }
        catch
        {
            try { Console.WriteLine("{\"schema\":\"windows-native-candidates/v1\",\"mode\":\"smoke_validation\",\"probeStatus\":\"unavailable\",\"probeReason\":\"collection_failed\"}"); }
            catch { }
        }
        return verified;
    }

    internal static string? ReadPinnedNodeVersion(string path)
    {
        try
        {
            var file = new FileInfo(path);
            if (file.Length > 32 || (file.Attributes & FileAttributes.ReparsePoint) != 0) return null;
            string pin = File.ReadAllText(path).Trim();
            return Regex.IsMatch(pin, @"\A[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\z", RegexOptions.CultureInvariant) ? pin : null;
        }
        catch { return null; }
    }

    internal static void AfterCheck(uint originalExit, DateTimeOffset start, DateTimeOffset end, string? pin)
    {
        // Even output errors are contained. The caller independently preserves its saved uint exit.
        try
        {
            bool verified = SelfTest();
            Observation result;
            if (!verified) result = Unavailable("self_test_failed");
            else if (pin == null) result = Unavailable("node_version_unavailable");
            else if (start > end || end - start > TimeSpan.FromHours(6)) result = Unavailable("invalid_check_window");
            else result = ReadWithBudget(start, end, pin, originalExit != 0);
            var output = new
            {
                schema = "windows-native-candidates/v1", scope = Scope,
                mode = originalExit == 0 ? "read_only_probe" : "failure_candidates", originalCheckExit = originalExit,
                selfTest = verified ? "passed" : "failed", startedUtc = Utc(start), finishedUtc = Utc(end),
                nodeVersion = pin ?? "unknown", status = result.Status, reason = result.Reason,
                limitReached = result.LimitReached, candidates = result.Candidates
            };
            string json = JsonSerializer.Serialize(output, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
            Console.WriteLine(json.Length <= 16384 ? json : "{\"schema\":\"windows-native-candidates/v1\",\"status\":\"unavailable\",\"reason\":\"output_limit\",\"candidates\":[]}");
        }
        catch
        {
            try { Console.WriteLine("{\"schema\":\"windows-native-candidates/v1\",\"status\":\"unavailable\",\"reason\":\"collection_failed\",\"candidates\":[]}"); }
            catch { /* Closed output channels cannot change the original check result. */ }
        }
    }

    static Observation Unavailable(string reason) => new("unavailable", reason, []);
    static string Utc(DateTimeOffset time) => time.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'", CultureInfo.InvariantCulture);

    static Observation ReadWithBudget(DateTimeOffset start, DateTimeOffset end, string pin, bool includeMetadata)
    {
        try
        {
            // The worker alone owns event handles/buffers. It never logs or writes files.
            // Process exit reclaims resources if a local API remains blocked after the budget.
            var read = Task.Run(() => ReadEvents(start, end, pin, includeMetadata));
            return read.Wait(TimeSpan.FromSeconds(6)) ? read.Result : Unavailable("query_timeout");
        }
        catch { return Unavailable("event_log_unavailable"); }
    }

    static Observation ReadEvents(DateTimeOffset start, DateTimeOffset end, string pin, bool includeMetadata)
    {
        try
        {
            // All XPath values come from in-process UTC clocks, never event text, shell or inputs.
            string query = "*[System[Provider[@Name='Application Error'] and (EventID=1000) and TimeCreated[@SystemTime >= '"
                + Utc(start) + "' and @SystemTime <= '" + Utc(end) + "']]]";
            using var results = new EventHandle(EvtQuery(IntPtr.Zero, "Application", query, 0x201));
            var candidates = new List<Candidate>();
            var budget = Stopwatch.StartNew();
            int inspected = 0;
            while (inspected < MaxEvents && candidates.Count < MaxCandidates)
            {
                if (budget.Elapsed > TimeSpan.FromSeconds(5)) return Unavailable("query_timeout");
                IntPtr[] events = [IntPtr.Zero];
                try
                {
                    if (!EvtNext(results.Value, 1, events, 1000, 0, out int returned))
                    {
                        if (Marshal.GetLastWin32Error() == 259) break; // ERROR_NO_MORE_ITEMS
                        return Unavailable("event_log_unavailable");
                    }
                    if (returned != 1 || events[0] == IntPtr.Zero) return Unavailable("event_log_unavailable");
                    inspected++;
                    string? xml = Render(events[0], out bool readable);
                    if (!readable) return Unavailable("render_unavailable");
                    // Probe actual render access when an event exists, without emitting fault data.
                    if (!includeMetadata) return new("readable", xml == null ? "event_rejected_by_bounds" : "event_read_not_projected", []);
                    Candidate? candidate = xml == null ? null : Project(xml, start, end, pin);
                    if (candidate != null) candidates.Add(candidate);
                }
                finally { if (events[0] != IntPtr.Zero) EvtClose(events[0]); }
            }
            return new(includeMetadata ? candidates.Count > 0 ? "candidate_events" : "no_matching_candidates" : "readable",
                includeMetadata ? "none" : "no_matching_events", candidates.ToArray(), inspected >= MaxEvents || candidates.Count >= MaxCandidates);
        }
        catch { return Unavailable("event_log_unavailable"); }
    }

    static string? Render(IntPtr item, out bool readable)
    {
        readable = false;
        if (EvtRender(IntPtr.Zero, item, 1, 0, IntPtr.Zero, out int bytes, out _)
            || Marshal.GetLastWin32Error() != 122) return null;
        readable = true;
        if (bytes < 2 || bytes > MaxXmlBytes || bytes % 2 != 0) return null;
        IntPtr memory = Marshal.AllocHGlobal(bytes);
        try
        {
            if (!EvtRender(IntPtr.Zero, item, 1, bytes, memory, out int used, out _)) { readable = false; return null; }
            if (used < 2 || used > bytes || used % 2 != 0 || Marshal.ReadInt16(memory, used - 2) != 0) return null;
            return Marshal.PtrToStringUni(memory, used / 2 - 1);
        }
        finally { Marshal.FreeHGlobal(memory); }
    }

    internal static Candidate? Project(string xml, DateTimeOffset start, DateTimeOffset end, string pin)
    {
        try
        {
            if (xml.Length > MaxXmlBytes / 2 || start > end || end - start > TimeSpan.FromHours(6)) return null;
            var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null,
                MaxCharactersInDocument = MaxXmlBytes / 2, MaxCharactersFromEntities = 1024 };
            using var text = new StringReader(xml);
            using var reader = XmlReader.Create(text, settings);
            XElement? root = XDocument.Load(reader, LoadOptions.None).Root;
            XNamespace ns = EventNamespace;
            if (root == null || root.Name != ns + "Event") return null;
            XElement? system = root.Element(ns + "System");
            if ((string?)system?.Element(ns + "Provider")?.Attribute("Name") != "Application Error"
                || (string?)system?.Element(ns + "EventID") != "1000") return null;
            string? rawTime = (string?)system?.Element(ns + "TimeCreated")?.Attribute("SystemTime");
            if (rawTime == null || !Regex.IsMatch(rawTime, @"\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,7})?Z\z", RegexOptions.CultureInvariant)
                || !DateTimeOffset.TryParse(rawTime, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var time)
                || time < start || time > end) return null;
            if (!long.TryParse((string?)system?.Element(ns + "EventRecordID"), NumberStyles.None, CultureInfo.InvariantCulture, out long recordId)
                || recordId < 1 || recordId > 9007199254740991) return null;
            var fields = new Dictionary<string, string>(StringComparer.Ordinal);
            string[] names = ["AppName", "AppVersion", "ModuleName", "ModuleVersion", "ExceptionCode", "FaultingOffset"];
            XElement[] data = root.Element(ns + "EventData")?.Elements(ns + "Data").Take(65).ToArray() ?? [];
            if (data.Length > 64) return null;
            foreach (var field in data)
            {
                string? name = (string?)field.Attribute("Name");
                if (name == null || !names.Contains(name, StringComparer.Ordinal)) continue;
                if (field.Value.Length > 128 || !fields.TryAdd(name, field.Value)) return null;
            }
            string? Value(string name) => fields.GetValueOrDefault(name);
            string? applicationVersion = Value("AppVersion"), module = Value("ModuleName"), exception = Value("ExceptionCode"), offset = Value("FaultingOffset");
            if (!string.Equals(Value("AppName"), "node.exe", StringComparison.OrdinalIgnoreCase)
                || (applicationVersion != pin && applicationVersion != pin + ".0")
                || module == null || !Regex.IsMatch(module, @"\A[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,95}\z", RegexOptions.CultureInvariant)
                || exception == null || !Regex.IsMatch(exception, @"\A(?:0[xX])?[a-fA-F0-9]{8}\z", RegexOptions.CultureInvariant)
                || offset == null || !Regex.IsMatch(offset, @"\A(?:0[xX])?[a-fA-F0-9]{1,16}\z", RegexOptions.CultureInvariant)) return null;
            string Hex(string value) => "0x" + (value.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ? value[2..] : value).ToLowerInvariant();
            string? moduleVersion = Value("ModuleVersion");
            if (moduleVersion == null || !Regex.IsMatch(moduleVersion, VersionPattern, RegexOptions.CultureInvariant)) moduleVersion = null;
            return new(recordId, Utc(time), "node.exe", applicationVersion!, module, Hex(exception), Hex(offset), moduleVersion);
        }
        catch { return null; } // Never return parser errors, XML, paths or unknown properties.
    }

    internal static bool SelfTest()
    {
        try
        {
            var start = new DateTimeOffset(2026, 10, 26, 8, 0, 0, TimeSpan.Zero);
            var end = start.AddMinutes(10);
            const string pin = "24.15.0", secret = "SYNTHETIC_PRIVATE_VALUE_NEVER_LOG";
            foreach (uint exit in new uint[] { 0, 1, 23, 125, 3221226505 })
            {
                if (PreserveExit(exit, () => { }) != exit
                    || PreserveExit(exit, () => throw new InvalidOperationException(secret)) != exit) return false;
            }
            string Event(string module = "ucrtbase.dll", string version = "24.15.0.0", string extra = "") =>
                "<Event xmlns='" + EventNamespace + "'><System><Provider Name='Application Error'/><EventID>1000</EventID>"
                + "<TimeCreated SystemTime='2026-10-26T08:05:00.0000000Z'/><EventRecordID>123</EventRecordID></System><EventData>"
                + "<Data Name='AppName'>node.exe</Data><Data Name='AppVersion'>" + version + "</Data><Data Name='ModuleName'>" + module + "</Data>"
                + "<Data Name='ModuleVersion'>10.0.26100.1</Data><Data Name='ExceptionCode'>C0000409</Data><Data Name='FaultingOffset'>00001234ABCD</Data>" + extra + "</EventData></Event>";
            Candidate? good = Project(Event(extra: "<Data Name='AppPath'>C:/private/" + secret + "</Data><Data Name='Message'>" + secret + "</Data>"), start, end, pin);
            if (good == null || good.Module != "ucrtbase.dll" || good.ExceptionCode != "0xc0000409" || good.FaultOffset != "0x00001234abcd"
                || JsonSerializer.Serialize(good).Contains(secret, StringComparison.Ordinal)) return false;
            string valid = Event();
            Candidate? badOptionalVersion = Project(valid.Replace("10.0.26100.1", "10.0.26100.1\n", StringComparison.Ordinal), start, end, pin);
            if (badOptionalVersion == null || badOptionalVersion.ModuleVersion != null) return false;
            string[] bad = [Event(module: "C:/private/" + secret), Event(module: "../node.exe"), Event(module: "node.exe\n" + secret),
                Event(module: "ucrtbase.dll\n"), valid.Replace("C0000409", "C0000409\n", StringComparison.Ordinal),
                valid.Replace("00001234ABCD", "00001234ABCD\n", StringComparison.Ordinal),
                Event(module: new string('a', 97)), Event(version: "24.15.1.0"), Event(version: "24.15.0.1"),
                Event(extra: "<Data Name='ModuleName'>duplicate.dll</Data>"),
                valid.Replace("C0000409", secret, StringComparison.Ordinal), valid.Replace("00001234ABCD", new string('a', 17), StringComparison.Ordinal),
                valid.Replace("08:05:00", "07:59:00", StringComparison.Ordinal), valid.Replace("08:05:00", "08:11:00", StringComparison.Ordinal),
                valid.Replace("Application Error", secret, StringComparison.Ordinal), valid.Replace("<EventID>1000", "<EventID>1001", StringComparison.Ordinal),
                valid.Replace("<EventRecordID>123", "<EventRecordID>9007199254740992", StringComparison.Ordinal),
                "<!DOCTYPE Event [<!ENTITY external SYSTEM 'file:///never-read-private-data'>]>" + Event(module: "&external;"),
                new string('a', MaxXmlBytes / 2 + 1)];
            return bad.All(value => Project(value, start, end, pin) == null)
                && Project(Event(version: pin), start, end, pin) != null
                && Project(valid, end, start, pin) == null;
        }
        catch { return false; }
    }

    sealed class EventHandle : IDisposable
    {
        public IntPtr Value { get; private set; }
        public EventHandle(IntPtr value) { if (value == IntPtr.Zero) throw new InvalidOperationException(); Value = value; }
        public void Dispose() { if (Value != IntPtr.Zero) { EvtClose(Value); Value = IntPtr.Zero; } }
    }
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("wevtapi.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    static extern IntPtr EvtQuery(IntPtr session, string path, string query, uint flags);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("wevtapi.dll", ExactSpelling = true, SetLastError = true)]
    static extern bool EvtNext(IntPtr results, int count, [Out] IntPtr[] events, int timeout, int flags, out int returned);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("wevtapi.dll", ExactSpelling = true, SetLastError = true)]
    static extern bool EvtRender(IntPtr context, IntPtr item, int flags, int bytes, IntPtr buffer, out int used, out int count);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport("wevtapi.dll", ExactSpelling = true)]
    static extern bool EvtClose(IntPtr handle);
}
