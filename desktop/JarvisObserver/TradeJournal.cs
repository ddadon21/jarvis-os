using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace JarvisObserver;

/// <summary>
/// One reading of the TradingView order/position surface, parsed from the
/// canonical "JARVIS_OCR_EXECUTION|STATUS=...|..." line.
/// </summary>
internal sealed record ExecutionRead(
    string Status,
    string? Symbol,
    string? Side,
    double? Quantity,
    string? OrderType,
    double? Entry,
    double? Current,
    double? Stop,
    double? Target,
    double? Pnl,
    DateTime At)
{
    public static ExecutionRead? Parse(string? text, DateTime at)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var line = text.Split('\n').Select(l => l.Trim()).FirstOrDefault(l => l.StartsWith("JARVIS_OCR_EXECUTION|", StringComparison.Ordinal));
        if (line is null) return null;
        var fields = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var part in line.Split('|').Skip(1))
        {
            var kv = part.Split('=', 2);
            if (kv.Length == 2) fields[kv[0].Trim()] = kv[1].Trim();
        }
        if (!fields.TryGetValue("STATUS", out var status) || string.IsNullOrWhiteSpace(status)) return null;
        status = status.ToUpperInvariant();
        if (status is not ("FLAT" or "PREPARING" or "PENDING" or "OPEN")) return null;
        string? Text(string key) => fields.TryGetValue(key, out var v) && !string.IsNullOrWhiteSpace(v) ? v.ToUpperInvariant() : null;
        double? Number(string key) => fields.TryGetValue(key, out var v) && double.TryParse(v.Replace(",", ""), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) && double.IsFinite(n) ? n : null;
        var side = Text("SIDE");
        if (side is not (null or "LONG" or "SHORT")) side = null;
        // FLAT is only emitted after several clean scans; SINCE is the first of
        // them, so a cancel/exit is time-stamped when the order actually vanished.
        if (status == "FLAT" && fields.TryGetValue("SINCE", out var since) &&
            DateTime.TryParse(since, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var sinceAt) &&
            sinceAt <= at.ToUniversalTime() && at.ToUniversalTime() - sinceAt < TimeSpan.FromMinutes(1))
        {
            at = sinceAt;
        }
        return new ExecutionRead(status, Text("SYMBOL"), side, Number("QTY"), Text("TYPE"), Number("ENTRY"), Number("CURRENT"), Number("STOP"), Number("TARGET"), Number("PNL"), at);
    }
}

internal sealed class JournalEvent
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("tradeId")] public string? TradeId { get; set; }
    [JsonPropertyName("type")] public string Type { get; set; } = "";
    [JsonPropertyName("at")] public DateTime At { get; set; }
    [JsonPropertyName("symbol")] public string? Symbol { get; set; }
    [JsonPropertyName("side")] public string? Side { get; set; }
    [JsonPropertyName("quantity")] public double? Quantity { get; set; }
    [JsonPropertyName("price")] public double? Price { get; set; }
    [JsonPropertyName("stopPrice")] public double? StopPrice { get; set; }
    [JsonPropertyName("targetPrice")] public double? TargetPrice { get; set; }
    [JsonPropertyName("currentPrice")] public double? CurrentPrice { get; set; }
    [JsonPropertyName("pnl")] public double? Pnl { get; set; }
    [JsonPropertyName("payload")] public Dictionary<string, object?> Payload { get; set; } = new();
}

internal sealed class JournalTrade
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("symbol")] public string Symbol { get; set; } = "";
    [JsonPropertyName("side")] public string Side { get; set; } = "";
    [JsonPropertyName("quantity")] public double Quantity { get; set; }
    [JsonPropertyName("maxQuantity")] public double MaxQuantity { get; set; }
    [JsonPropertyName("entryPrice")] public double? EntryPrice { get; set; }
    [JsonPropertyName("initialStop")] public double? InitialStop { get; set; }
    [JsonPropertyName("initialTarget")] public double? InitialTarget { get; set; }
    [JsonPropertyName("stopPrice")] public double? StopPrice { get; set; }
    [JsonPropertyName("targetPrice")] public double? TargetPrice { get; set; }
    [JsonPropertyName("preparedAt")] public DateTime? PreparedAt { get; set; }
    [JsonPropertyName("openedAt")] public DateTime OpenedAt { get; set; }
    [JsonPropertyName("closedAt")] public DateTime? ClosedAt { get; set; }
    [JsonPropertyName("exitPrice")] public double? ExitPrice { get; set; }
    [JsonPropertyName("lastPnl")] public double? LastPnl { get; set; }
    [JsonPropertyName("mfePrice")] public double? MfePrice { get; set; }
    [JsonPropertyName("maePrice")] public double? MaePrice { get; set; }
    [JsonPropertyName("lastCurrent")] public double? LastCurrent { get; set; }
}

/// <summary>
/// Debounced trade lifecycle state machine over local screen reads.
///
/// Without broker API access this is the ground truth for what Dwight did:
/// PREPARING → ORDER_WORKING → ENTRY → STOP/TARGET/SIZE changes → EXIT, plus
/// ORDER_CANCELLED. A state must be read <see cref="ConfirmReads"/> times in a
/// row before it counts, so single OCR misreads never create phantom trades.
/// Pure logic: no IO, no clock, fully unit-testable.
/// </summary>
internal sealed class TradeLifecycle
{
    public const int ConfirmReads = 2;

    private string _confirmedStatus = "FLAT";
    private string? _candidateKey;
    private int _candidateCount;
    private DateTime _candidateFirstAt;
    private ExecutionRead? _lastConfirmed;
    private DateTime? _stagedSince;
    private (double? Stop, double? Target, double? Qty)? _pendingManagement;
    private int _managementCount;
    private int _sequence;

    public JournalTrade? OpenTrade { get; private set; }
    public string ConfirmedStatus => _confirmedStatus;
    public DateTime? StagedSince => _stagedSince;
    public string DevicePrefix { get; init; } = "obs";

    private static string Key(ExecutionRead read) => read.Status == "OPEN"
        ? $"OPEN|{read.Symbol}|{read.Side}"
        : read.Status;

    public List<JournalEvent> Observe(ExecutionRead read)
    {
        var events = new List<JournalEvent>();

        // Track price excursion and last values every read while a position is open.
        if (OpenTrade is not null && read.Status == "OPEN" && SamePosition(OpenTrade, read))
        {
            if (read.Current is double px)
            {
                OpenTrade.LastCurrent = px;
                OpenTrade.MfePrice = OpenTrade.MfePrice is null ? px : OpenTrade.Side == "LONG" ? Math.Max(OpenTrade.MfePrice.Value, px) : Math.Min(OpenTrade.MfePrice.Value, px);
                OpenTrade.MaePrice = OpenTrade.MaePrice is null ? px : OpenTrade.Side == "LONG" ? Math.Min(OpenTrade.MaePrice.Value, px) : Math.Max(OpenTrade.MaePrice.Value, px);
            }
            if (read.Pnl is double pnl) OpenTrade.LastPnl = pnl;
            DetectManagement(read, events);
        }

        var key = Key(read);
        if (key == _candidateKey) _candidateCount++;
        else
        {
            _candidateKey = key;
            _candidateCount = 1;
            _candidateFirstAt = read.At;
        }
        var currentKey = _lastConfirmed is null ? "FLAT" : Key(_lastConfirmed);
        if (_candidateCount < ConfirmReads || key == currentKey)
        {
            if (key == currentKey) _lastConfirmed = read;
            return events;
        }

        // Time-stamp the transition when the new state first appeared, not when it was confirmed.
        Transition(_lastConfirmed, read with { At = _candidateFirstAt }, events);
        _lastConfirmed = read;
        _confirmedStatus = read.Status;
        return events;
    }

    private static bool SamePosition(JournalTrade trade, ExecutionRead read) =>
        (read.Symbol is null || string.Equals(trade.Symbol, read.Symbol, StringComparison.OrdinalIgnoreCase)) &&
        (read.Side is null || trade.Side == read.Side);

    private void DetectManagement(ExecutionRead read, List<JournalEvent> events)
    {
        var trade = OpenTrade!;
        var candidate = (read.Stop ?? trade.StopPrice, read.Target ?? trade.TargetPrice, read.Quantity ?? trade.Quantity);
        var differs = Diff(candidate.Item1, trade.StopPrice) || Diff(candidate.Item2, trade.TargetPrice) || Diff(candidate.Item3, trade.Quantity);
        if (!differs)
        {
            _pendingManagement = null;
            _managementCount = 0;
            return;
        }
        if (_pendingManagement is { } pending && !Diff(pending.Stop, candidate.Item1) && !Diff(pending.Target, candidate.Item2) && !Diff(pending.Qty, candidate.Item3))
        {
            _managementCount++;
        }
        else
        {
            _pendingManagement = candidate;
            _managementCount = 1;
        }
        if (_managementCount < ConfirmReads) return;

        if (Diff(candidate.Item1, trade.StopPrice))
        {
            var from = trade.StopPrice;
            trade.StopPrice = candidate.Item1;
            events.Add(Event("STOP_MOVED", read, trade, payload: new() { ["from"] = from }));
        }
        if (Diff(candidate.Item2, trade.TargetPrice))
        {
            var from = trade.TargetPrice;
            trade.TargetPrice = candidate.Item2;
            events.Add(Event("TARGET_MOVED", read, trade, payload: new() { ["from"] = from }));
        }
        if (Diff(candidate.Item3, trade.Quantity))
        {
            var from = trade.Quantity;
            trade.Quantity = candidate.Item3;
            trade.MaxQuantity = Math.Max(trade.MaxQuantity, candidate.Item3);
            events.Add(Event("SIZE_CHANGED", read, trade, payload: new() { ["from"] = from }));
        }
        _pendingManagement = null;
        _managementCount = 0;
    }

    private void Transition(ExecutionRead? from, ExecutionRead to, List<JournalEvent> events)
    {
        var fromStatus = from?.Status ?? "FLAT";

        // Leaving an open position (flat, or a different position = reversal).
        if (OpenTrade is not null && (to.Status != "OPEN" || !SamePosition(OpenTrade, to)))
        {
            CloseTrade(to, events);
        }

        switch (to.Status)
        {
            case "PREPARING":
                _stagedSince ??= to.At;
                if (fromStatus != "PREPARING") events.Add(Event("PREPARING", to, null));
                break;
            case "PENDING":
                _stagedSince ??= to.At;
                events.Add(Event("ORDER_WORKING", to, null));
                break;
            case "OPEN":
                if (OpenTrade is null) OpenNewTrade(to, events);
                break;
            case "FLAT":
                if (fromStatus is "PREPARING" or "PENDING")
                {
                    events.Add(Event("ORDER_CANCELLED", from!, null));
                }
                _stagedSince = null;
                break;
        }
    }

    private void OpenNewTrade(ExecutionRead read, List<JournalEvent> events)
    {
        var symbol = read.Symbol ?? "UNKNOWN";
        var side = read.Side ?? "LONG";
        var trade = new JournalTrade
        {
            Id = $"{DevicePrefix}:{read.At:yyyyMMddTHHmmss}:{symbol}:{side}",
            Symbol = symbol,
            Side = side,
            Quantity = read.Quantity ?? 0,
            MaxQuantity = read.Quantity ?? 0,
            EntryPrice = read.Entry,
            InitialStop = read.Stop,
            InitialTarget = read.Target,
            StopPrice = read.Stop,
            TargetPrice = read.Target,
            PreparedAt = _stagedSince,
            OpenedAt = read.At,
            LastCurrent = read.Current,
            MfePrice = read.Current,
            MaePrice = read.Current,
            LastPnl = read.Pnl,
        };
        OpenTrade = trade;
        _stagedSince = null;
        events.Add(Event("ENTRY", read, trade, price: read.Entry, payload: new() { ["preparedAt"] = trade.PreparedAt }));
    }

    private void CloseTrade(ExecutionRead read, List<JournalEvent> events)
    {
        var trade = OpenTrade!;
        trade.ClosedAt = read.At;
        trade.ExitPrice = trade.LastCurrent;
        events.Add(Event("EXIT", read, trade, price: trade.ExitPrice, payload: new()
        {
            ["realizedPnl"] = trade.LastPnl,
            ["pnlSource"] = trade.LastPnl is null ? null : "OBSERVED_LAST_OPEN_PNL",
            ["mfePrice"] = trade.MfePrice,
            ["maePrice"] = trade.MaePrice,
            ["entryPrice"] = trade.EntryPrice,
            ["initialStop"] = trade.InitialStop,
            ["initialTarget"] = trade.InitialTarget,
            ["maxQuantity"] = trade.MaxQuantity,
            ["preparedAt"] = trade.PreparedAt,
            ["openedAt"] = trade.OpenedAt,
        }));
        LastClosedTrade = trade;
        OpenTrade = null;
    }

    public JournalTrade? LastClosedTrade { get; private set; }

    private JournalEvent Event(string type, ExecutionRead read, JournalTrade? trade, double? price = null, Dictionary<string, object?>? payload = null)
    {
        _sequence++;
        return new JournalEvent
        {
            Id = $"{DevicePrefix}:{read.At:yyyyMMddTHHmmssfff}:{_sequence}:{type}",
            TradeId = trade?.Id,
            Type = type,
            At = read.At,
            Symbol = trade?.Symbol ?? read.Symbol,
            Side = trade?.Side ?? read.Side,
            Quantity = trade?.Quantity ?? read.Quantity,
            Price = price ?? read.Entry,
            StopPrice = trade?.StopPrice ?? read.Stop,
            TargetPrice = trade?.TargetPrice ?? read.Target,
            CurrentPrice = read.Current ?? trade?.LastCurrent,
            Pnl = trade?.LastPnl ?? read.Pnl,
            Payload = payload ?? new(),
        };
    }

    private static bool Diff(double? a, double? b)
    {
        if (a is null && b is null) return false;
        if (a is null || b is null) return a is not null; // a value appearing counts; a value disappearing (OCR miss) does not
        return Math.Abs(a.Value - b.Value) > 1e-6;
    }
}

/// <summary>Persists journal events locally (append-only) so nothing is lost when offline.</summary>
internal sealed class TradeJournalStore
{
    private readonly string _dir;
    private readonly object _gate = new();
    public static readonly JsonSerializerOptions Json = new() { DefaultIgnoreCondition = JsonIgnoreCondition.Never };

    public TradeJournalStore(string root)
    {
        _dir = Path.Combine(root, "journal");
        Directory.CreateDirectory(_dir);
    }

    public string EventsPath => Path.Combine(_dir, "events.jsonl");

    public void Append(IEnumerable<JournalEvent> events)
    {
        lock (_gate)
        {
            foreach (var item in events)
            {
                File.AppendAllText(EventsPath, JsonSerializer.Serialize(item, Json) + Environment.NewLine);
            }
        }
    }

    public void SaveTrade(JournalTrade trade)
    {
        lock (_gate)
        {
            var path = Path.Combine(_dir, "trades.jsonl");
            File.AppendAllText(path, JsonSerializer.Serialize(trade, Json) + Environment.NewLine);
        }
    }
}
