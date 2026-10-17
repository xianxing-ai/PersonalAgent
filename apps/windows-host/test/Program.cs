using PersonalAgent.WindowsHost;

const string expected = "synthetic";
uint tick = 10;
var readCount = 0;
var permitted = NotepadAction.PrewriteStable(tick, expected,
    () =>
    {
        readCount++;
        if (readCount == 1) tick = 11; // User input interleaves after expected-value read.
        return expected;
    },
    () => tick,
    () => true);
if (permitted || readCount != 1)
    throw new Exception("Input after expected-value read must refuse mutation");

tick = 10;
readCount = 0;
var text = expected;
permitted = NotepadAction.PrewriteStable(tick, expected,
    () =>
    {
        readCount++;
        if (readCount == 2) text = "programmatic-change"; // UIA change without input tick.
        return text;
    },
    () => tick,
    () => true);
if (permitted || readCount != 2)
    throw new Exception("Programmatic target change must refuse mutation");

// The window can disappear while slow process metadata remains valid. No user
// input or cancellation is needed, so those later guards cannot catch this case.
foreach (var change in new[] { "closed window", "foreground", "window owner" })
{
    var window = (Exists: true, Foreground: (nint)123, Owner: 456);
    var original = window;
    var accepted = NotepadAction.TargetIdentityCurrent(() => window == original, () =>
    {
        window = change switch
        {
            "closed window" => window with { Exists = false },
            "foreground" => window with { Foreground = 0 },
            _ => window with { Owner = 789 },
        };
        return true; // Same live process and start time throughout the query.
    });
    if (accepted) throw new Exception($"Slow process lookup accepted {change}");
}
if (!NotepadAction.TargetIdentityCurrent(() => true, () => true))
    throw new Exception("Stable window and process identity must remain usable");
var processQueries = 0;
if (NotepadAction.TargetIdentityCurrent(() => false, () => { processQueries++; return true; }) || processQueries != 0)
    throw new Exception("Already stale window must not query process metadata");
if (NotepadAction.TargetIdentityCurrent(() => true, () => false))
    throw new Exception("Exited or restarted process must not confirm a target");

Console.WriteLine("PASS: prewrite input and target identity changes rejected");
