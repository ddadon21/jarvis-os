using System.Text.Json;

namespace JarvisObserver;

/// <summary>
/// Direct, plugin-free Obsidian command bridge. Cloud commands are restricted to
/// JARVIS-managed Markdown notes inside the vault chosen by the Windows owner.
/// The legacy Local REST API path remains available when no vault folder is set.
/// </summary>
internal static class ObsidianDirectBridge
{
    private const int MaxContentChars = 200_000;
    private const int MaxReadChars = 200_000;

    private static string RelativeManagedPath(string raw)
    {
        var relative = VaultBridge.SafeRelative(raw)
            ?? throw new InvalidOperationException("A safe Markdown vault path is required.");
        return relative.StartsWith(VaultBridge.ManagedFolder + "/", StringComparison.OrdinalIgnoreCase)
            ? relative
            : VaultBridge.ManagedFolder + "/" + relative;
    }

    private static string ManagedFile(string vault, string relative)
    {
        var basePath = Path.GetFullPath(Path.Combine(vault, VaultBridge.ManagedFolder));
        var root = basePath + Path.DirectorySeparatorChar;
        var full = Path.GetFullPath(Path.Combine(vault, relative));
        if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The requested note is outside the JARVIS-managed folder.");
        return full;
    }

    public static string Execute(string vault, string action, string? path, string? content, string? query)
    {
        if (string.IsNullOrWhiteSpace(vault) || !Directory.Exists(vault))
            throw new InvalidOperationException("Choose an existing Obsidian vault in the Observer tray menu first.");

        var root = Path.Combine(vault, VaultBridge.ManagedFolder);
        switch (action.Trim().ToUpperInvariant())
        {
            case "WRITE":
            {
                var relative = RelativeManagedPath(path ?? "");
                if ((content ?? "").Length > MaxContentChars)
                    throw new InvalidOperationException("The note is too large.");
                var changed = VaultBridge.WriteManaged(vault, new[] { (relative, content ?? "") });
                var full = ManagedFile(vault, relative);
                // A successful write must be observed on disk, not inferred from a queued command.
                if (!File.Exists(full))
                    throw new IOException("The note did not appear in the selected vault.");
                return JsonSerializer.Serialize(new { path = relative, written = changed > 0, verified = true });
            }
            case "READ":
            {
                var relative = RelativeManagedPath(path ?? "");
                var full = ManagedFile(vault, relative);
                if (!File.Exists(full)) throw new FileNotFoundException("The JARVIS note was not found.", relative);
                var info = new FileInfo(full);
                if (info.Length > MaxReadChars * 4L) throw new IOException("The note is too large to read.");
                var text = File.ReadAllText(full);
                if (text.Length > MaxReadChars) throw new IOException("The note is too large to read.");
                return text;
            }
            case "LIST":
            {
                if (!Directory.Exists(root))
                    return JsonSerializer.Serialize(new { files = Array.Empty<string>() });
                var files = Directory.EnumerateFiles(root, "*.md", SearchOption.AllDirectories)
                    .Take(201)
                    .Select(file => Path.GetRelativePath(vault, file).Replace('\\', '/'))
                    .Where(file => VaultBridge.SafeRelative(file) is not null)
                    .OrderBy(file => file, StringComparer.OrdinalIgnoreCase)
                    .Take(200)
                    .ToArray();
                return JsonSerializer.Serialize(new { files });
            }
            case "SEARCH":
            {
                var term = (query ?? "").Trim();
                if (term.Length is < 1 or > 160) throw new InvalidOperationException("Enter a search phrase of 1–160 characters.");
                if (!Directory.Exists(root))
                    return JsonSerializer.Serialize(new { results = Array.Empty<object>() });
                var matches = new List<object>();
                foreach (var file in Directory.EnumerateFiles(root, "*.md", SearchOption.AllDirectories).Take(500))
                {
                    if (new FileInfo(file).Length > MaxReadChars * 4L) continue;
                    var text = File.ReadAllText(file);
                    var foundAt = text.IndexOf(term, StringComparison.OrdinalIgnoreCase);
                    if (foundAt < 0) continue;
                    var start = Math.Max(0, foundAt - 80);
                    var excerpt = text.Substring(start, Math.Min(220, text.Length - start));
                    matches.Add(new { path = Path.GetRelativePath(vault, file).Replace('\\', '/'), excerpt });
                    if (matches.Count >= 20) break;
                }
                return JsonSerializer.Serialize(new { results = matches });
            }
            default:
                throw new InvalidOperationException("Unsupported Obsidian command.");
        }
    }
}
