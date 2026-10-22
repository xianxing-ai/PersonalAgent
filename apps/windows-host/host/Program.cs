using PersonalAgent.WindowsHost.Service;

try
{
    var launch = HostLaunchBinding.Parse(args);
    var schemaPath = Path.Combine(AppContext.BaseDirectory, "windows-host.json");
    // #168 supplies the only normative schema. Without it, no pipe is opened.
    var wire = new HostWire(schemaPath);
    var journalDirectory = launch.JournalDirectory ?? Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PersonalAgent", "windows-host");
    var journalPath = Path.Combine(journalDirectory, "runs.jsonl");
    var journal = new RunJournal(journalPath);
    using var singleton = new Mutex(true, "Local\\PersonalAgent.WindowsHost.SingleUserInput", out var first);
    if (!first) return 2;
    using var stop = new CancellationTokenSource();
    Console.CancelKeyPress += (_, eventArgs) => { eventArgs.Cancel = true; stop.Cancel(); };
    Action<NotepadObservationStage>? diagnostic = launch.JournalDirectory is null ? null : stage =>
    {
        try { File.AppendAllText(Path.Combine(journalDirectory, "observation-diagnostic.jsonl"),
            System.Text.Json.JsonSerializer.Serialize(new { stage = stage.ToString() }) + "\n"); }
        catch { /* Diagnostic failure neither changes native authority nor overrides the original result. */ }
    };
    await new HostService(launch, wire, journal, diagnostic).RunAsync(stop.Token);
    return 0;
}
catch (OperationCanceledException) { return 0; }
catch (Exception)
{
    // Never echo target text, paths, pipe names, process metadata or raw frames.
    Console.Error.WriteLine("REFUSED: Windows Host trusted session unavailable");
    return 2;
}
