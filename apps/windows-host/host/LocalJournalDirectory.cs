namespace PersonalAgent.WindowsHost.Service;

internal static class LocalJournalDirectory
{
    internal static string Validate(string value)
    {
        if (value.Length < 3 || !char.IsAsciiLetter(value[0]) || value[1] != ':' ||
            (value[2] != '\\' && value[2] != '/') || value.Skip(2).Any(c => c == ':' || c < 32 ||
                c is '"' or '|' or '<' or '>' or '*' or '?'))
            throw new ArgumentException("A local absolute journal directory is required");
        var path = Path.GetFullPath(value);
        if (new DriveInfo(Path.GetPathRoot(path)!).DriveType != DriveType.Fixed)
            throw new ArgumentException("A fixed local journal drive is required");
        for (var directory = new DirectoryInfo(path); directory is not null; directory = directory.Parent)
        {
            if (directory.Exists && (directory.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new ArgumentException("Journal directory links are unavailable");
        }
        return path;
    }
}
