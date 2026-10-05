using System.Text;

namespace JarvisObserver;

/// <summary>
/// Direct Obsidian vault access (a vault is just a folder of Markdown files):
/// - JARVIS writes only inside &lt;vault&gt;/JARVIS/ and only between its own markers,
///   so anything Dwight writes outside the markers is never overwritten.
/// - Changed notes in the folders Dwight allows are collected for the search index.
/// No Obsidian plugin is required.
/// </summary>
internal static class VaultBridge
{
    public const string ManagedFolder = "JARVIS";
    public const string StartMarker = "<!-- jarvis:start (generated — edits inside are replaced) -->";
    public const string EndMarker = "<!-- jarvis:end — write your own notes below this line -->";

    public sealed record VaultNote(string Path, string Title, string Content, DateTime ModifiedUtc);

    /// <summary>Normalizes a vault-relative path and rejects anything that escapes the vault or touches .obsidian.</summary>
    public static string? SafeRelative(string path)
    {
        var parts = path.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0 || parts.Any(p => p == ".." || p == "." || p.StartsWith(".obsidian", StringComparison.OrdinalIgnoreCase))) return null;
        if (parts.Any(p => p.IndexOfAny(System.IO.Path.GetInvalidFileNameChars().Where(c => c != '/').ToArray()) >= 0)) return null;
        var joined = string.Join('/', parts);
        return joined.EndsWith(".md", StringComparison.OrdinalIgnoreCase) ? joined : null;
    }

    /// <summary>Merges generated content into an existing note, keeping everything outside the markers.</summary>
    public static string Merge(string? existing, string generated)
    {
        var block = StartMarker + "\n" + generated.TrimEnd() + "\n" + EndMarker;
        if (string.IsNullOrEmpty(existing)) return block + "\n";
        var start = existing.IndexOf(StartMarker, StringComparison.Ordinal);
        var end = existing.IndexOf(EndMarker, StringComparison.Ordinal);
        if (start >= 0 && end > start)
        {
            return existing[..start] + block + existing[(end + EndMarker.Length)..];
        }
        // Existing file without markers: keep Dwight's text and append JARVIS's block after it.
        return existing.TrimEnd() + "\n\n" + block + "\n";
    }

    /// <summary>Writes JARVIS notes under vault/JARVIS. Returns the number of files that changed.</summary>
    public static int WriteManaged(string vault, IEnumerable<(string Path, string Content)> notes)
    {
        var changed = 0;
        foreach (var (rawPath, content) in notes)
        {
            var relative = SafeRelative(rawPath);
            if (relative is null) continue;
            if (!relative.StartsWith(ManagedFolder + "/", StringComparison.OrdinalIgnoreCase)) relative = ManagedFolder + "/" + relative;
            var full = System.IO.Path.GetFullPath(System.IO.Path.Combine(vault, relative));
            var root = System.IO.Path.GetFullPath(System.IO.Path.Combine(vault, ManagedFolder)) + System.IO.Path.DirectorySeparatorChar;
            if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue;
            var existing = File.Exists(full) ? File.ReadAllText(full) : null;
            var merged = Merge(existing, content);
            if (existing == merged) continue;
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(full)!);
            File.WriteAllText(full, merged, new UTF8Encoding(false));
            changed++;
        }
        return changed;
    }

    /// <summary>
    /// Notes modified after <paramref name="sinceUtc"/> inside the allowed folders
    /// (empty list = whole vault). Skips .obsidian, the JARVIS folder and large files.
    /// </summary>
    public static List<VaultNote> ScanChanged(string vault, DateTime sinceUtc, IReadOnlyCollection<string> includeFolders, int maxBytes = 100_000, int maxNotes = 200)
    {
        var results = new List<VaultNote>();
        if (!Directory.Exists(vault)) return results;
        var roots = includeFolders.Count == 0
            ? new[] { vault }
            : includeFolders.Select(f => SafeFolder(vault, f)).Where(f => f is not null).Cast<string>().ToArray();
        foreach (var root in roots)
        {
            if (!Directory.Exists(root)) continue;
            foreach (var file in Directory.EnumerateFiles(root, "*.md", SearchOption.AllDirectories))
            {
                var relative = System.IO.Path.GetRelativePath(vault, file).Replace('\\', '/');
                if (relative.StartsWith(".obsidian/", StringComparison.OrdinalIgnoreCase) || relative.StartsWith(ManagedFolder + "/", StringComparison.OrdinalIgnoreCase) || relative.Split('/').Any(p => p.StartsWith('.'))) continue;
                var info = new FileInfo(file);
                if (info.LastWriteTimeUtc <= sinceUtc || info.Length > maxBytes) continue;
                string content;
                try { content = File.ReadAllText(file); } catch { continue; }
                results.Add(new VaultNote(relative, System.IO.Path.GetFileNameWithoutExtension(file), content, info.LastWriteTimeUtc));
            }
        }
        return results.OrderBy(n => n.ModifiedUtc).Take(maxNotes).ToList();
    }

    private static string? SafeFolder(string vault, string folder)
    {
        var parts = folder.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0 || parts.Any(p => p == ".." || p.StartsWith('.'))) return null;
        var full = System.IO.Path.GetFullPath(System.IO.Path.Combine(vault, string.Join(System.IO.Path.DirectorySeparatorChar, parts)));
        return full.StartsWith(System.IO.Path.GetFullPath(vault), StringComparison.OrdinalIgnoreCase) ? full : null;
    }
}
