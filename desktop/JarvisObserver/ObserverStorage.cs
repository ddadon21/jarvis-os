using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace JarvisObserver;

/// <summary>
/// Disk-backed outbox. Items survive restarts and network outages and are
/// retried with exponential backoff until the cloud acknowledges them.
/// </summary>
internal sealed class OutboxQueue
{
    private readonly string _dir;
    private readonly object _gate = new();
    private readonly Dictionary<string, (int Attempts, DateTime NextAt)> _backoff = new();
    private readonly Func<DateTime> _clock;

    public OutboxQueue(string dir, Func<DateTime>? clock = null)
    {
        _dir = dir;
        _clock = clock ?? (() => DateTime.UtcNow);
        Directory.CreateDirectory(_dir);
    }

    public int Count
    {
        get { lock (_gate) return Directory.GetFiles(_dir, "*.json").Length; }
    }

    public void Enqueue(string id, string json)
    {
        lock (_gate)
        {
            var safe = string.Concat(id.Select(ch => char.IsLetterOrDigit(ch) || ch is '-' or '_' ? ch : '_'));
            var name = $"{_clock().Ticks:D19}_{safe}.json";
            if (Directory.GetFiles(_dir, $"*_{safe}.json").Length > 0) return; // idempotent
            File.WriteAllText(Path.Combine(_dir, name), json);
        }
    }

    /// <summary>Oldest items that are due for (re)delivery.</summary>
    public List<(string File, string Json)> TakeDue(int max)
    {
        lock (_gate)
        {
            var now = _clock();
            var result = new List<(string, string)>();
            foreach (var file in Directory.GetFiles(_dir, "*.json").OrderBy(f => f, StringComparer.Ordinal))
            {
                if (_backoff.TryGetValue(file, out var state) && state.NextAt > now) continue;
                try { result.Add((file, File.ReadAllText(file))); } catch { }
                if (result.Count >= max) break;
            }
            return result;
        }
    }

    public void Ack(IEnumerable<string> files)
    {
        lock (_gate)
        {
            foreach (var file in files)
            {
                try { File.Delete(file); } catch { }
                _backoff.Remove(file);
            }
        }
    }

    public void Fail(IEnumerable<string> files)
    {
        lock (_gate)
        {
            var now = _clock();
            foreach (var file in files)
            {
                var attempts = _backoff.TryGetValue(file, out var state) ? state.Attempts + 1 : 1;
                var delay = TimeSpan.FromSeconds(Math.Min(300, Math.Pow(2, Math.Min(attempts, 9))));
                _backoff[file] = (attempts, now + delay);
            }
        }
    }
}

/// <summary>
/// Local frame storage.
/// - rolling/: every captured frame (about 1/sec on change) for the last N minutes, so
///   the setup BEFORE an entry is always available.
/// - context/: one frame per minute, kept for <see cref="RetentionDays"/> days.
/// - trades/&lt;id&gt;/: the full window around each trade (prep - 15 min → exit + 5 min), kept indefinitely.
/// Frame file names encode their UTC capture time so ranges can be selected without an index.
/// </summary>
internal sealed class FrameStore
{
    private const string Stamp = "yyyyMMdd'T'HHmmssfff'Z'";
    private readonly string _root;
    private readonly Func<DateTime> _clock;
    private DateTime _lastContextAt = DateTime.MinValue;
    private DateTime? _pinFrom;

    public int RollingMinutes { get; set; } = 45;
    public int RetentionDays { get; set; } = 30;
    public TimeSpan ContextInterval { get; set; } = TimeSpan.FromMinutes(1);

    public FrameStore(string root, Func<DateTime>? clock = null)
    {
        _root = root;
        _clock = clock ?? (() => DateTime.UtcNow);
        Directory.CreateDirectory(RollingDir);
        Directory.CreateDirectory(ContextDir);
        Directory.CreateDirectory(TradesDir);
    }

    public string RollingDir => Path.Combine(_root, "frames", "rolling");
    public string ContextDir => Path.Combine(_root, "frames", "context");
    public string TradesDir => Path.Combine(_root, "trades");

    public static string FileName(DateTime at) => at.ToUniversalTime().ToString(Stamp, CultureInfo.InvariantCulture) + ".jpg";

    public static DateTime? ParseTime(string path)
    {
        var name = Path.GetFileNameWithoutExtension(path);
        return DateTime.TryParseExact(name, Stamp, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var at) ? at : null;
    }

    public string Save(byte[] jpg, DateTime at)
    {
        var path = Path.Combine(RollingDir, FileName(at));
        File.WriteAllBytes(path, jpg);
        if (at - _lastContextAt >= ContextInterval)
        {
            _lastContextAt = at;
            var day = Path.Combine(ContextDir, at.ToUniversalTime().ToString("yyyyMMdd", CultureInfo.InvariantCulture));
            Directory.CreateDirectory(day);
            File.WriteAllBytes(Path.Combine(day, FileName(at)), jpg);
        }
        return path;
    }

    /// <summary>Keep rolling frames from this time onward until <see cref="Unpin"/> (a trade is being staged or is open).</summary>
    public void Pin(DateTime from)
    {
        if (_pinFrom is null || from < _pinFrom) _pinFrom = from;
    }

    public void Unpin() => _pinFrom = null;

    /// <summary>Sets (or clears) the oldest rolling frame that must be kept.</summary>
    public void SetPin(DateTime? from) => _pinFrom = from;

    public void Cleanup()
    {
        var now = _clock();
        var rollingCutoff = now - TimeSpan.FromMinutes(RollingMinutes);
        if (_pinFrom is DateTime pin && pin < rollingCutoff) rollingCutoff = pin;
        foreach (var file in Directory.GetFiles(RollingDir, "*.jpg"))
        {
            var at = ParseTime(file);
            if (at is DateTime time && time < rollingCutoff)
            {
                try { File.Delete(file); } catch { }
            }
        }
        var contextCutoff = now.Date - TimeSpan.FromDays(RetentionDays);
        foreach (var day in Directory.GetDirectories(ContextDir))
        {
            if (DateTime.TryParseExact(Path.GetFileName(day), "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var date) && date < contextCutoff)
            {
                try { Directory.Delete(day, recursive: true); } catch { }
            }
        }
    }

    public List<string> RollingRange(DateTime from, DateTime to) => Directory.GetFiles(RollingDir, "*.jpg")
        .Select(file => (file, at: ParseTime(file)))
        .Where(item => item.at is DateTime time && time >= from && time <= to)
        .OrderBy(item => item.at)
        .Select(item => item.file)
        .ToList();

    /// <summary>
    /// Copies the trade window into trades/&lt;id&gt;/frames (thinned to one frame per
    /// <paramref name="spacing"/>, plus every frame within 10 s of a lifecycle event)
    /// and returns the key frames to upload (nearest to each event + one per minute, max <paramref name="maxKeyFrames"/>).
    /// </summary>
    public (string Folder, List<string> KeyFrames) BundleTrade(string tradeId, DateTime from, DateTime to, IReadOnlyList<JournalEvent> events, string tradeJson, TimeSpan? spacing = null, int maxKeyFrames = 40)
    {
        var gap = spacing ?? TimeSpan.FromSeconds(2);
        var folder = Path.Combine(TradesDir, SafeName(tradeId));
        var framesDir = Path.Combine(folder, "frames");
        Directory.CreateDirectory(framesDir);
        File.WriteAllText(Path.Combine(folder, "trade.json"), tradeJson);
        File.WriteAllText(Path.Combine(folder, "events.json"), JsonSerializer.Serialize(events, TradeJournalStore.Json));

        var eventTimes = events.Select(item => item.At.ToUniversalTime()).ToList();
        DateTime? lastKept = null;
        var copied = new List<(string Path, DateTime At)>();
        foreach (var file in RollingRange(from, to))
        {
            var at = ParseTime(file)!.Value;
            var nearEvent = eventTimes.Any(time => Math.Abs((time - at).TotalSeconds) <= 10);
            if (!nearEvent && lastKept is DateTime previous && at - previous < gap) continue;
            var target = Path.Combine(framesDir, Path.GetFileName(file));
            try { File.Copy(file, target, overwrite: true); } catch { continue; }
            lastKept = at;
            copied.Add((target, at));
        }

        var keys = new List<string>();
        foreach (var time in eventTimes)
        {
            var nearest = copied.OrderBy(item => Math.Abs((item.At - time).TotalMilliseconds)).FirstOrDefault();
            if (nearest.Path is not null && !keys.Contains(nearest.Path)) keys.Add(nearest.Path);
        }
        DateTime? lastMinute = null;
        foreach (var item in copied)
        {
            if (keys.Count >= maxKeyFrames) break;
            if (lastMinute is DateTime minute && item.At - minute < TimeSpan.FromMinutes(1)) continue;
            lastMinute = item.At;
            if (!keys.Contains(item.Path)) keys.Add(item.Path);
        }
        return (folder, keys.Take(maxKeyFrames).OrderBy(path => path, StringComparer.Ordinal).ToList());
    }

    public static string SafeName(string value) => string.Concat(value.Select(ch => char.IsLetterOrDigit(ch) || ch is '-' or '_' ? ch : '_'));
}

/// <summary>
/// Remembers which cloud commands already ran so a re-delivered command is
/// never executed twice; its stored result is re-posted instead.
/// </summary>
internal sealed class CommandLedger
{
    private readonly string _path;
    private readonly object _gate = new();
    private readonly Dictionary<string, LedgerEntry> _entries;

    internal sealed class LedgerEntry
    {
        [JsonPropertyName("state")] public string State { get; set; } = "RUNNING";
        [JsonPropertyName("at")] public DateTime At { get; set; }
        [JsonPropertyName("result")] public string? ResultJson { get; set; }
    }

    public CommandLedger(string path)
    {
        _path = path;
        try
        {
            _entries = File.Exists(path)
                ? JsonSerializer.Deserialize<Dictionary<string, LedgerEntry>>(File.ReadAllText(path)) ?? new()
                : new();
        }
        catch
        {
            _entries = new();
        }
    }

    /// <summary>Returns true if the caller should execute the command now (first sighting).</summary>
    public bool TryBegin(string id, out LedgerEntry? existing)
    {
        lock (_gate)
        {
            if (_entries.TryGetValue(id, out existing)) return false;
            _entries[id] = new LedgerEntry { State = "RUNNING", At = DateTime.UtcNow };
            Save();
            existing = null;
            return true;
        }
    }

    public void Complete(string id, string resultJson)
    {
        lock (_gate)
        {
            _entries[id] = new LedgerEntry { State = "DONE", At = DateTime.UtcNow, ResultJson = resultJson };
            Save();
        }
    }

    private void Save()
    {
        if (_entries.Count > 500)
        {
            foreach (var key in _entries.OrderBy(kv => kv.Value.At).Take(_entries.Count - 500).Select(kv => kv.Key).ToList())
                _entries.Remove(key);
        }
        try
        {
            var tmp = _path + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(_entries));
            File.Move(tmp, _path, overwrite: true);
        }
        catch
        {
            // Ledger is best-effort; worst case the cloud queue's idempotent status still applies.
        }
    }
}
