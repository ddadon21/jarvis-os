using System.Text.Json.Serialization;

namespace JarvisObserver;

/// <summary>
/// Week-one reliability evidence (SOP-006): read latency, missing-field rate,
/// wrong-symbol proxy, suspected false events, cancel-clear latency and
/// per-symbol success. Pure logic: the caller supplies times and persists the
/// snapshot. Counts reset when the local day changes.
/// </summary>
internal sealed class ObserverDiagnostics
{
    public static readonly string[] Fields = { "symbol", "direction", "contracts", "orderType", "entry", "current", "stop", "target" };

    /// <summary>A draft/working order that vanishes faster than this is counted as a suspected misread.</summary>
    public static readonly TimeSpan SuspectOrderBlip = TimeSpan.FromSeconds(1.5);
    /// <summary>A recorded trade shorter than this is counted as a suspected false fill.</summary>
    public static readonly TimeSpan SuspectTradeBlip = TimeSpan.FromSeconds(10);

    private const int MaxSamples = 4000;

    private string _day = "";
    private readonly List<double> _readMs = new();
    private readonly List<double> _cancelClearMs = new();
    private readonly List<double> _fillConfirmMs = new();
    private readonly Dictionary<string, int> _missing = Fields.ToDictionary(f => f, _ => 0);
    private readonly Dictionary<string, int> _transitions = new();
    private readonly Dictionary<string, SymbolStats> _symbols = new(StringComparer.OrdinalIgnoreCase);
    private int _reads;
    private int _activeReads;
    private int _titleComparable;
    private int _titleMismatch;
    private int _suspectOrderBlips;
    private int _suspectTradeBlips;
    private DateTime? _lastActiveReadAt;
    private DateTime? _episodeStart;
    private string? _episodeSymbol;

    public sealed class SymbolStats
    {
        [JsonPropertyName("activeReads")] public int ActiveReads { get; set; }
        [JsonPropertyName("completeReads")] public int CompleteReads { get; set; }
        [JsonPropertyName("episodes")] public int Episodes { get; set; }
        [JsonPropertyName("fills")] public int Fills { get; set; }
        [JsonPropertyName("suspect")] public int Suspect { get; set; }
    }

    private void Roll(DateTime at)
    {
        var day = at.ToLocalTime().ToString("yyyy-MM-dd");
        if (day == _day) return;
        _day = day;
        _readMs.Clear(); _cancelClearMs.Clear(); _fillConfirmMs.Clear();
        foreach (var key in Fields) _missing[key] = 0;
        _transitions.Clear(); _symbols.Clear();
        _reads = _activeReads = _titleComparable = _titleMismatch = _suspectOrderBlips = _suspectTradeBlips = 0;
    }

    /// <summary>One OCR scan. <paramref name="read"/> is null when the scan carried no execution evidence.</summary>
    public void RecordRead(ExecutionRead? read, double readMs, string? titleSymbol, DateTime at)
    {
        Roll(at);
        _reads++;
        Add(_readMs, readMs);
        if (read is null || read.Status == "FLAT") return;

        _activeReads++;
        _lastActiveReadAt = at;
        var open = read.Status == "OPEN";
        var values = new Dictionary<string, bool>
        {
            ["symbol"] = read.Symbol is not null,
            ["direction"] = read.Side is not null,
            ["contracts"] = read.Quantity is not null,
            // A filled position no longer shows its entry order type.
            ["orderType"] = open || read.OrderType is not null,
            ["entry"] = read.Entry is not null,
            ["current"] = read.Current is not null,
            ["stop"] = read.Stop is not null,
            ["target"] = read.Target is not null,
        };
        foreach (var (field, present) in values) if (!present) _missing[field]++;

        var symbol = read.Symbol ?? "UNKNOWN";
        var stats = Stats(symbol);
        stats.ActiveReads++;
        if (values.Values.All(v => v)) stats.CompleteReads++;

        if (read.Symbol is not null && titleSymbol is not null)
        {
            _titleComparable++;
            if (!string.Equals(read.Symbol, titleSymbol, StringComparison.OrdinalIgnoreCase)) _titleMismatch++;
        }
    }

    public void RecordTransition(PhaseTransition transition)
    {
        Roll(transition.At);
        var key = transition.From + ">" + transition.To;
        _transitions[key] = _transitions.GetValueOrDefault(key) + 1;

        if (!ObserverPhases.IsActive(transition.From) && ObserverPhases.IsActive(transition.To))
        {
            _episodeStart = transition.At;
            _episodeSymbol = transition.Symbol;
            Stats(transition.Symbol ?? "UNKNOWN").Episodes++;
        }

        if (ObserverPhases.IsActive(transition.From) && transition.To == ObserverPhases.Waiting)
        {
            if (transition.From is ObserverPhases.PreparingOrder or ObserverPhases.PendingOrder)
            {
                // Cancel-clear latency: last scan that still showed the order → WAITING recognized.
                if (_lastActiveReadAt is { } last && transition.DetectedAt >= last) Add(_cancelClearMs, (transition.DetectedAt - last).TotalMilliseconds);
                if (_episodeStart is { } start && transition.At - start < SuspectOrderBlip)
                {
                    _suspectOrderBlips++;
                    Stats(_episodeSymbol ?? "UNKNOWN").Suspect++;
                }
            }
            _episodeStart = null;
            _episodeSymbol = null;
        }
    }

    /// <summary>Journal ENTRY: <paramref name="firstSeen"/> is the back-dated fill time, <paramref name="confirmedAt"/> when it was confirmed.</summary>
    public void RecordFill(string? symbol, DateTime firstSeen, DateTime confirmedAt)
    {
        Roll(confirmedAt);
        Add(_fillConfirmMs, Math.Max(0, (confirmedAt - firstSeen).TotalMilliseconds));
        Stats(symbol ?? "UNKNOWN").Fills++;
    }

    /// <summary>Journal EXIT: very short trades are flagged as suspected false fills.</summary>
    public void RecordExit(string? symbol, DateTime openedAt, DateTime closedAt)
    {
        Roll(closedAt);
        if (closedAt - openedAt < SuspectTradeBlip)
        {
            _suspectTradeBlips++;
            Stats(symbol ?? "UNKNOWN").Suspect++;
        }
    }

    private SymbolStats Stats(string symbol)
    {
        if (!_symbols.TryGetValue(symbol, out var stats)) _symbols[symbol] = stats = new SymbolStats();
        return stats;
    }

    private static void Add(List<double> list, double value)
    {
        if (!double.IsFinite(value)) return;
        if (list.Count >= MaxSamples) list.RemoveAt(0);
        list.Add(value);
    }

    public static double? Percentile(List<double> values, double p)
    {
        if (values.Count == 0) return null;
        var sorted = values.OrderBy(v => v).ToList();
        var index = (int)Math.Ceiling(p * sorted.Count) - 1;
        return Math.Round(sorted[Math.Clamp(index, 0, sorted.Count - 1)], 1);
    }

    public DiagnosticsSnapshot Snapshot(string observerVersion, DateTime at)
    {
        Roll(at);
        return new DiagnosticsSnapshot
        {
            Day = _day,
            ObserverVersion = observerVersion,
            GeneratedAt = at.ToUniversalTime(),
            Reads = _reads,
            ReadMsP50 = Percentile(_readMs, 0.5),
            ReadMsP95 = Percentile(_readMs, 0.95),
            ActiveReads = _activeReads,
            MissingFieldRate = Fields.ToDictionary(f => f, f => _activeReads == 0 ? (double?)null : Math.Round((double)_missing[f] / _activeReads, 4)),
            TitleComparableReads = _titleComparable,
            WrongSymbolRate = _titleComparable == 0 ? null : Math.Round((double)_titleMismatch / _titleComparable, 4),
            SuspectedFalseOrderEvents = _suspectOrderBlips,
            SuspectedFalseTrades = _suspectTradeBlips,
            CancelClears = _cancelClearMs.Count,
            CancelClearMsP50 = Percentile(_cancelClearMs, 0.5),
            CancelClearMsP95 = Percentile(_cancelClearMs, 0.95),
            FillConfirmMsP50 = Percentile(_fillConfirmMs, 0.5),
            FillConfirmMsP95 = Percentile(_fillConfirmMs, 0.95),
            Transitions = new Dictionary<string, int>(_transitions),
            PerSymbol = _symbols.ToDictionary(kv => kv.Key, kv => new SymbolStats
            {
                ActiveReads = kv.Value.ActiveReads,
                CompleteReads = kv.Value.CompleteReads,
                Episodes = kv.Value.Episodes,
                Fills = kv.Value.Fills,
                Suspect = kv.Value.Suspect,
            }),
        };
    }
}

internal sealed class DiagnosticsSnapshot
{
    [JsonPropertyName("day")] public string Day { get; set; } = "";
    [JsonPropertyName("observerVersion")] public string ObserverVersion { get; set; } = "";
    [JsonPropertyName("generatedAt")] public DateTime GeneratedAt { get; set; }
    [JsonPropertyName("reads")] public int Reads { get; set; }
    [JsonPropertyName("readMsP50")] public double? ReadMsP50 { get; set; }
    [JsonPropertyName("readMsP95")] public double? ReadMsP95 { get; set; }
    [JsonPropertyName("activeReads")] public int ActiveReads { get; set; }
    [JsonPropertyName("missingFieldRate")] public Dictionary<string, double?> MissingFieldRate { get; set; } = new();
    [JsonPropertyName("titleComparableReads")] public int TitleComparableReads { get; set; }
    [JsonPropertyName("wrongSymbolRate")] public double? WrongSymbolRate { get; set; }
    [JsonPropertyName("suspectedFalseOrderEvents")] public int SuspectedFalseOrderEvents { get; set; }
    [JsonPropertyName("suspectedFalseTrades")] public int SuspectedFalseTrades { get; set; }
    [JsonPropertyName("cancelClears")] public int CancelClears { get; set; }
    [JsonPropertyName("cancelClearMsP50")] public double? CancelClearMsP50 { get; set; }
    [JsonPropertyName("cancelClearMsP95")] public double? CancelClearMsP95 { get; set; }
    [JsonPropertyName("fillConfirmMsP50")] public double? FillConfirmMsP50 { get; set; }
    [JsonPropertyName("fillConfirmMsP95")] public double? FillConfirmMsP95 { get; set; }
    [JsonPropertyName("transitions")] public Dictionary<string, int> Transitions { get; set; } = new();
    [JsonPropertyName("perSymbol")] public Dictionary<string, ObserverDiagnostics.SymbolStats> PerSymbol { get; set; } = new();
}
