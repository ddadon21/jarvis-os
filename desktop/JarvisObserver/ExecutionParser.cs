using System.Globalization;
using System.Text.RegularExpressions;

namespace JarvisObserver;

/// <summary>One OCR text line (or word) with window-relative coordinates.</summary>
internal sealed record OcrRow(string Text, double X, double Y, double Width, double Height)
{
    public string? MarkerColor { get; init; }
}

/// <summary>
/// Futures roots the Observer recognizes. The eight acceptance instruments
/// (NQ, MNQ, ES, MES, YM, MYM, GC, MGC) are not special-cased: every root here
/// goes through the same header, contract-code and price-marker paths.
/// </summary>
internal static class InstrumentCatalog
{
    public static readonly string[] Roots =
    {
        "MNQ", "NQ", "MES", "ES", "MYM", "YM", "M2K", "RTY", "MGC", "GC",
        "MCL", "CL", "SIL", "SI", "HG", "ZB", "ZN", "ZF", "ZT",
    };

    private static readonly HashSet<string> RootSet = new(Roots, StringComparer.OrdinalIgnoreCase);

    /// <summary>Longest roots first so MNQ is tried before NQ inside an alternation.</summary>
    public static readonly string RootAlternation = string.Join("|", Roots.OrderByDescending(r => r.Length).Select(Regex.Escape));

    /// <summary>Chart-pane header: "MNQ1!, 5", "MNQZ2026, 5" or a futures description line.</summary>
    public static readonly Regex PaneHeader = new(
        @"(?:E.?mini|Micro).*?(?:Futures|CME|CBOT|COMEX|NYMEX)" +
        @"|(?:Gold|Dow|Crude|Silver|Copper|Russell|Nasdaq|Treasury).*?Futures" +
        $@"|\b(?:{RootAlternation})(?:[12]!|[FGHJKMNQUVXZ]\d{{2,4}})\s*,",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>Right-axis current-price marker label such as "MYMZ2026".</summary>
    public static readonly Regex ContractMarker = new(
        $@"^(?:{RootAlternation})[FGHJKMNQUVXZ]\d{{2,4}}(?:\s|$)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static string? NormalizeTicker(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var symbol = Regex.Replace(raw.ToUpperInvariant(), @"[^A-Z0-9!]", "");
        if (RootSet.Contains(symbol)) return symbol;
        // Continuous contracts and common OCR confusions: NQ1!, NQ1, NQI!, NQI.
        var root = Regex.Replace(symbol, @"(?:[12I]!?|!)$", "");
        return RootSet.Contains(root) ? root.ToUpperInvariant() : null;
    }

    /// <summary>"MNQZ2026" → MNQ, "NQ1!" → NQ.</summary>
    public static string? NormalizeContractRoot(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var symbol = Regex.Replace(raw.ToUpperInvariant(), @"[^A-Z0-9!]", "");
        var contract = Regex.Match(symbol, $@"^({RootAlternation})[FGHJKMNQUVXZ]\d{{2,4}}$");
        if (contract.Success) return contract.Groups[1].Value;
        return NormalizeTicker(symbol);
    }

    /// <summary>
    /// TradingView Desktop puts the focused chart's symbol first in the window
    /// title ("MNQ1! 21,345.25 ▲ +0.31% …"). Independent of OCR, so it is both a
    /// fallback and a cross-check for wrong-symbol diagnostics.
    /// </summary>
    public static string? FromWindowTitle(string? title)
    {
        if (string.IsNullOrWhiteSpace(title)) return null;
        var first = title.Trim().Split(new[] { ' ', '\t', '·', '|' }, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
        if (first is null) return null;
        if (first.Contains(':')) first = first[(first.IndexOf(':') + 1)..];
        return NormalizeContractRoot(first);
    }

    /// <summary>Description-based recognition, used only on chart header text.</summary>
    public static string? FromDescription(string text)
    {
        if (Regex.IsMatch(text, @"Micro.*Nasdaq", RegexOptions.IgnoreCase)) return "MNQ";
        if (Regex.IsMatch(text, @"Nasdaq.*100|E-?mini.*Nasdaq", RegexOptions.IgnoreCase)) return "NQ";
        if (Regex.IsMatch(text, @"Micro.*S\s*&?\s*P", RegexOptions.IgnoreCase)) return "MES";
        if (Regex.IsMatch(text, @"E-?mini.*S\s*&?\s*P", RegexOptions.IgnoreCase)) return "ES";
        if (Regex.IsMatch(text, @"Micro.*Dow", RegexOptions.IgnoreCase)) return "MYM";
        if (Regex.IsMatch(text, @"(?:E-?mini|Mini).*Dow", RegexOptions.IgnoreCase)) return "YM";
        if (Regex.IsMatch(text, @"Micro.*Russell", RegexOptions.IgnoreCase)) return "M2K";
        if (Regex.IsMatch(text, @"Russell.*2000", RegexOptions.IgnoreCase)) return "RTY";
        if (Regex.IsMatch(text, @"Micro.*Gold", RegexOptions.IgnoreCase)) return "MGC";
        if (Regex.IsMatch(text, @"Gold.*Futures", RegexOptions.IgnoreCase)) return "GC";
        if (Regex.IsMatch(text, @"Micro.*Crude", RegexOptions.IgnoreCase)) return "MCL";
        if (Regex.IsMatch(text, @"Crude.*Oil", RegexOptions.IgnoreCase)) return "CL";
        return null;
    }
}

/// <summary>
/// Deterministic TradingView order/position reader over OCR rows. Pure logic
/// (no Windows APIs), so every fixture runs on Linux CI as well as Windows.
///
/// Output is the canonical line consumed by the journal and the server:
/// JARVIS_OCR_EXECUTION|STATUS=PREPARING|PENDING|OPEN|FLAT|SIDE|QTY|TYPE|SYMBOL|ENTRY|CURRENT|STOP|TARGET[|PNL][|SINCE]
/// </summary>
internal sealed class ExecutionParser
{
    /// <summary>Clean scans with no order before a draft/working order counts as cancelled.</summary>
    public const int ClearScansAfterOrder = 2;
    /// <summary>A live position needs more negative evidence before it is reported flat (a false exit is worse than a slow one).</summary>
    public const int ClearScansAfterPosition = 4;

    private int _missingScans;
    private string? _lastActiveStatus;
    private DateTime? _missingSince;

    /// <summary>Builds the full semantic payload for one scan: canonical line first, then the OCR rows.</summary>
    public string BuildSemantic(List<OcrRow> rows, DateTime scanAt, string? titleSymbol = null)
    {
        var output = new List<string> { "JARVIS_OCR_SURFACE|OK=1" };
        foreach (var row in rows.Take(400))
            output.Add($"JARVIS_OCR|X={Math.Round(row.X)}|Y={Math.Round(row.Y)}|W={Math.Round(row.Width)}|H={Math.Round(row.Height)}|TEXT={Sanitize(row.Text)}");

        var canonical = Canonical(rows, scanAt, titleSymbol);
        if (canonical is not null) output.Insert(0, canonical);
        return string.Join(Environment.NewLine, output);
    }

    /// <summary>The canonical execution line for one scan, or null when there is no evidence either way.</summary>
    public string? Canonical(List<OcrRow> rows, DateTime scanAt, string? titleSymbol = null)
    {
        var canonical = TryBuildExecution(rows, titleSymbol) ?? TryBuildPreparation(rows, titleSymbol);
        if (canonical is not null)
        {
            _missingScans = 0;
            _missingSince = null;
            _lastActiveStatus = Field(canonical, "STATUS");
            return canonical;
        }

        // Negative evidence needs a healthy chart surface: enough text and a
        // recognizable instrument (from the pane or the window title).
        var healthy = rows.Count >= 15 && (InferSymbol(rows, null, null) is not null || titleSymbol is not null);
        if (!healthy)
        {
            _missingScans = 0;
            _missingSince = null;
            return null;
        }

        _missingScans++;
        _missingSince ??= scanAt;
        var needed = _lastActiveStatus == "OPEN" ? ClearScansAfterPosition : ClearScansAfterOrder;
        if (_missingScans < needed) return null;

        // Emitted continuously so a pending state confirmed by the accessibility
        // lane can still be cleared right after cancel. SINCE back-dates the
        // cancel/exit to the first scan without the order.
        _missingScans = needed;
        _lastActiveStatus = null;
        return "JARVIS_OCR_EXECUTION|STATUS=FLAT|SINCE=" + _missingSince.Value.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture);
    }

    internal static string? Field(string canonical, string key)
    {
        var match = Regex.Match(canonical, $@"(?:^|\|){Regex.Escape(key)}=([^|]*)");
        return match.Success ? match.Groups[1].Value : null;
    }

    public static OcrRow? FindActiveOrderAnchor(List<OcrRow> rows, (double X, double Y)? pointer = null)
    {
        var candidates = rows.Where(row => Regex.IsMatch(row.Text,
            @"\b(change order type|change order quantity|add order on)\b|^(Buy|Sell)\s+\d|^\d+\s+(Buy|Sell)\b|^[+−-]?\d+(?:\.\d+)?\s+[+−-].*USD|^(Buy|Sell)$",
            RegexOptions.IgnoreCase)).Where(row => row.Y > 120).ToList();
        if (candidates.Count == 0) return null;
        if (pointer is not null)
        {
            var near = candidates.OrderBy(row => Math.Abs(row.X - pointer.Value.X) + Math.Abs(row.Y - pointer.Value.Y)).First();
            if (Math.Abs(near.X - pointer.Value.X) + Math.Abs(near.Y - pointer.Value.Y) < 220) return near;
        }
        return candidates.OrderByDescending(row => Regex.IsMatch(row.Text, @"change order|add order on", RegexOptions.IgnoreCase))
            .ThenByDescending(row => row.Y).First();
    }

    /// <summary>
    /// Restricts rows to the chart pane that contains the active order. Chart
    /// headers, not browser tabs or watchlist tickers, define pane bounds.
    /// </summary>
    public static List<OcrRow> ScopeToOrderPane(List<OcrRow> rows, OcrRow? anchor)
    {
        if (anchor is null) return rows;
        var headers = rows.Where(row => InstrumentCatalog.PaneHeader.IsMatch(row.Text)).ToList();
        var header = headers.Where(row => row.X <= anchor.X + 30 && row.Y < anchor.Y)
            .OrderByDescending(row => row.Y).ThenByDescending(row => row.X).FirstOrDefault();
        if (header is null) return rows;
        var right = headers.Where(row => Math.Abs(row.Y - header.Y) < 40 && row.X > header.X + 120)
            .Select(row => row.X - 15).DefaultIfEmpty(double.MaxValue).Min();
        var bottom = headers.Where(row => Math.Abs(row.X - header.X) < 100 && row.Y > header.Y + 80)
            .Select(row => row.Y - 10).DefaultIfEmpty(double.MaxValue).Min();
        return rows.Where(row => row.X >= header.X - 40 && row.X < right && row.Y >= header.Y - 10 && row.Y < bottom).ToList();
    }

    public static List<OcrRow> MergeRows(List<OcrRow> primary, List<OcrRow> extra)
    {
        var merged = new List<OcrRow>(primary);
        foreach (var row in extra)
        {
            var duplicate = merged.Any(existing =>
                string.Equals(NormalizeText(existing.Text), NormalizeText(row.Text), StringComparison.OrdinalIgnoreCase) &&
                Math.Abs(existing.X - row.X) <= 16 &&
                Math.Abs(existing.Y - row.Y) <= 16);
            if (!duplicate) merged.Add(row);
        }
        return merged.OrderBy(row => row.Y).ThenBy(row => row.X).ToList();
    }

    public static bool IsRichCanonical(string? canonical)
    {
        if (string.IsNullOrWhiteSpace(canonical)) return false;
        if (!canonical.StartsWith("JARVIS_OCR_EXECUTION|", StringComparison.Ordinal)) return false;
        return new[] { "SYMBOL", "SIDE", "QTY", "ENTRY" }.All(key => !string.IsNullOrWhiteSpace(Field(canonical, key)));
    }

    private static string NormalizeText(string value) => Regex.Replace(value.Trim(), @"\s+", " ");

    public static string? TryBuildExecution(List<OcrRow> rows, string? titleSymbol = null)
    {
        var combinedOrders = rows
            .Select(ParseCombinedOrder)
            .Where(order => order is not null)
            .Cast<ReconstructedOrder>()
            .ToList();

        var reconstructed = rows
            .Where(row => Regex.IsMatch(row.Text.Trim(), @"^(Buy|Sell)$", RegexOptions.IgnoreCase))
            .Select(actionRow =>
            {
                var centerY = actionRow.Y + actionRow.Height / 2;
                var peers = rows
                    .Where(row => !ReferenceEquals(row, actionRow))
                    .Where(row => Math.Abs((row.Y + row.Height / 2) - centerY) <= Math.Max(16, actionRow.Height * 1.8))
                    .Where(row => row.X >= actionRow.X - 8 && row.X <= actionRow.X + 520)
                    .OrderBy(row => row.X)
                    .ToList();

                var quantityRow = peers
                    .Where(row => row.X >= actionRow.X + actionRow.Width - 4)
                    .FirstOrDefault(row => Regex.IsMatch(row.Text.Trim(), @"^\d+(?:\.\d+)?$"));

                var typeRow = peers
                    .Where(row => row.X >= actionRow.X + actionRow.Width - 4)
                    .FirstOrDefault(row => Regex.IsMatch(row.Text.Trim(), @"^(Limit|Stop|Market)$", RegexOptions.IgnoreCase));

                if (quantityRow is null || typeRow is null) return null;

                var quantity = ParseNumber(quantityRow.Text.Trim());
                var type = typeRow.Text.Trim().ToUpperInvariant();
                var price = FindNearestPrice(rows, typeRow, preferRight: true)
                    ?? FindNearestPrice(rows, actionRow, preferRight: true);

                return new ReconstructedOrder(
                    actionRow.Text.Trim().Equals("Buy", StringComparison.OrdinalIgnoreCase) ? "BUY" : "SELL",
                    quantity, type, price, null, null, actionRow);
            })
            .Where(order => order is not null)
            .Cast<ReconstructedOrder>()
            .ToList();

        var compact = rows.Select(row =>
        {
            var match = Regex.Match(row.Text.Trim(), @"^(Buy|Sell)\s+(\d+(?:\.\d+)?)\s+(Limit|Stop|Market)\b", RegexOptions.IgnoreCase);
            if (!match.Success)
            {
                var reversed = Regex.Match(row.Text.Trim(), @"^(\d+(?:\.\d+)?)\s+(Buy|Sell)\s+(Limit|Stop|Market)\b", RegexOptions.IgnoreCase);
                if (!reversed.Success) return null;
                return new ReconstructedOrder(reversed.Groups[2].Value.ToUpperInvariant(), ParseNumber(reversed.Groups[1].Value),
                    reversed.Groups[3].Value.ToUpperInvariant(), FindOrderPrice(rows, row), null, null, row);
            }
            return new ReconstructedOrder(match.Groups[1].Value.ToUpperInvariant(), ParseNumber(match.Groups[2].Value),
                match.Groups[3].Value.ToUpperInvariant(), FindOrderPrice(rows, row), null, null, row);
        }).Where(order => order is not null).Cast<ReconstructedOrder>();

        reconstructed = combinedOrders
            .Concat(compact)
            .Concat(reconstructed)
            .GroupBy(order => new
            {
                order.Action,
                order.Quantity,
                order.Type,
                Price = order.Price is null ? (double?)null : Math.Round(order.Price.Value, 4),
                order.Contract,
            })
            .Select(group => group.First())
            .ToList();

        // A filled TradingView position can be visible even when the chart does not
        // expose explicit "Buy/Sell Stop/Limit" text. Detect the live position row
        // before requiring reconstructed working orders.
        var liveAnchor = FindLivePositionAnchor(rows);
        var symbol = InstrumentCatalog.NormalizeContractRoot(reconstructed.Select(order => order.Contract).FirstOrDefault(contract => !string.IsNullOrWhiteSpace(contract)))
            ?? InferSymbol(rows, liveAnchor ?? reconstructed.OrderByDescending(order => order.Anchor.Y).FirstOrDefault()?.Anchor, titleSymbol);

        // A live position has its own quantity/P&L/close row. Exit orders alone
        // cannot prove a fill, and the exit's LIMIT/STOP is not the entry type.
        var live = TryBuildLivePosition(rows, reconstructed, symbol);
        if (live is not null) return live;

        if (reconstructed.Count == 0) return null;

        // A live bracketed position presents as two same-side exit orders: one STOP
        // and one LIMIT, with the original opposite-side entry order gone.
        var bracket = reconstructed
            .Where(order => order.Quantity is not null)
            .GroupBy(order => new { order.Action, Quantity = order.Quantity!.Value })
            .Select(group => new
            {
                Stop = group.FirstOrDefault(order => order.Type == "STOP"),
                Limit = group.FirstOrDefault(order => order.Type == "LIMIT"),
                HasOpposite = reconstructed.Any(order => order.Action != group.Key.Action),
            })
            .FirstOrDefault(group => group.Stop is not null && group.Limit is not null && !group.HasOpposite);

        // Two same-side orders can be an unsubmitted bracket preview. They do not
        // establish a fill or a live position's entry/remaining size.
        if (bracket is not null) return null;

        // If an opposite-side entry is still present alongside its protective exits,
        // the position has not filled yet. Prefer that entry as the pending order.
        var bracketWithEntry = reconstructed
            .Where(order => order.Quantity is not null)
            .GroupBy(order => new { order.Action, Quantity = order.Quantity!.Value })
            .Select(group => new
            {
                Stop = group.FirstOrDefault(order => order.Type == "STOP"),
                Limit = group.FirstOrDefault(order => order.Type == "LIMIT"),
                Entry = reconstructed.FirstOrDefault(order => order.Action != group.Key.Action && order.Quantity == group.Key.Quantity),
            })
            .FirstOrDefault(group => group.Stop is not null && group.Limit is not null && group.Entry is not null);

        ReconstructedOrder entry;
        double? stop;
        double? target;

        if (bracketWithEntry is not null)
        {
            entry = bracketWithEntry.Entry!;
            stop = FindRiskRewardPrice(rows, entry.Anchor, negative: true) ?? bracketWithEntry.Stop!.Price;
            target = FindRiskRewardPrice(rows, entry.Anchor, negative: false) ?? bracketWithEntry.Limit!.Price;
        }
        else
        {
            var protectiveAction = combinedOrders
                .Where(order => order.Type == "STOP")
                .GroupBy(order => order.Action)
                .OrderByDescending(group => group.Count())
                .Select(group => group.Key)
                .FirstOrDefault();

            var inferredEntryAction =
                protectiveAction == "SELL" ? "BUY" :
                protectiveAction == "BUY" ? "SELL" :
                null;

            entry =
                (inferredEntryAction is not null
                    ? combinedOrders.FirstOrDefault(order =>
                        order.Action == inferredEntryAction &&
                        (order.Type == "LIMIT" || order.Type == "STOP" || order.Type == "MARKET"))
                    : null)
                ?? combinedOrders.OrderBy(order => order.Anchor.Y).FirstOrDefault()
                ?? reconstructed.OrderBy(order => order.Anchor.Y).First();

            stop = FindRiskRewardPrice(rows, entry.Anchor, negative: true);
            target = FindRiskRewardPrice(rows, entry.Anchor, negative: false);
        }

        var pendingSide = entry.Action == "BUY" ? "LONG" : "SHORT";
        var hasFullOrderLine = combinedOrders.Count > 0;
        var hasDraftControls = rows.Any(row =>
            Regex.IsMatch(row.Text, @"\b(change order type|change order quantity|^quantity$)\b", RegexOptions.IgnoreCase));

        return string.Join("|", new[]
        {
            "JARVIS_OCR_EXECUTION",
            $"STATUS={(hasFullOrderLine && !hasDraftControls ? "PENDING" : "PREPARING")}",
            $"SIDE={pendingSide}",
            $"QTY={entry.Quantity?.ToString(CultureInfo.InvariantCulture) ?? ""}",
            $"TYPE={entry.Type}",
            $"SYMBOL={symbol ?? ""}",
            $"ENTRY={Format(entry.Price)}",
            $"CURRENT={Format(FindCurrentPrice(rows, entry.Anchor))}",
            $"STOP={Format(stop)}",
            $"TARGET={Format(target)}"
        });
    }

    private sealed record ReconstructedOrder(
        string Action,
        double? Quantity,
        string Type,
        double? Price,
        string? Contract,
        double? SecondaryLimitPrice,
        OcrRow Anchor);

    private static OcrRow? FindLivePositionAnchor(List<OcrRow> rows)
    {
        var candidates = LiveMoneyRows(rows);
        var signedQuantity = candidates
            .Where(item => IsSigned(item.QuantityToken))
            .OrderByDescending(item => item.Row.Y)
            .FirstOrDefault();
        return signedQuantity?.Row ?? (candidates.Count == 1 ? candidates[0].Row : null);
    }

    private static bool IsSigned(string token) =>
        token.StartsWith("+", StringComparison.Ordinal) || token.StartsWith("-", StringComparison.Ordinal) || token.StartsWith("−", StringComparison.Ordinal);

    private static List<LiveMoneyRow> LiveMoneyRows(List<OcrRow> rows)
    {
        return rows.Select(row =>
        {
            var match = Regex.Match(
                row.Text.Trim(),
                @"^([+−-]?\d+(?:\.\d+)?)\s+([+−-]?)\s*([\d,]+(?:\.\d+)?)\s+USD\s*[x×✕]?$",
                RegexOptions.IgnoreCase);
            if (!match.Success) return null;
            var signedQuantity = ParseSignedNumber(match.Groups[1].Value);
            var pnl = ParseNumber(match.Groups[3].Value.Replace(",", ""));
            if (signedQuantity is null || pnl is null) return null;
            if (match.Groups[2].Value is "-" or "−") pnl = -pnl;
            return new LiveMoneyRow(row, match.Groups[1].Value, signedQuantity.Value, pnl.Value);
        }).Where(item => item is not null).Cast<LiveMoneyRow>().ToList();
    }

    private static string? TryBuildLivePosition(List<OcrRow> rows, List<ReconstructedOrder> orders, string? symbol)
    {
        if (rows.Any(row => Regex.IsMatch(row.Text, @"change order quantity|change order type", RegexOptions.IgnoreCase))) return null;

        var moneyRows = LiveMoneyRows(rows);
        if (moneyRows.Count == 0) return null;

        // TradingView's filled-position chip uses a signed quantity for shorts
        // (for example "-1 +620.00 USD"). Bracket risk/reward chips keep an
        // unsigned quantity, so the signed row is the strongest position anchor.
        var signedRows = moneyRows.Where(item => IsSigned(item.QuantityToken)).ToList();

        LiveMoneyRow? position = signedRows.Count == 1
            ? signedRows[0]
            : moneyRows.Count == 1
                ? moneyRows[0]
                : null;
        if (position is null) return null;

        var quantity = Math.Abs(position.SignedQuantity);
        if (quantity <= 0 || symbol is null) return null;

        var exits = orders.Where(order => order.Quantity == quantity).ToList();
        var actions = exits.Select(order => order.Action).Distinct().ToList();

        string? side = position.SignedQuantity < 0
            ? "SHORT"
            : position.QuantityToken.StartsWith("+", StringComparison.Ordinal)
                ? "LONG"
                : actions.Count == 1
                    ? (actions[0] == "SELL" ? "LONG" : "SHORT")
                    : null;
        if (side is null) return null;

        var entry = FindOrderPrice(rows, position.Row);
        if (entry is null) return null;

        // In the compact chart-position widget the stop/target rows may only show
        // quantity + projected USD loss/profit. Recover those prices directly.
        var stop = exits.FirstOrDefault(order => order.Type == "STOP")?.Price
            ?? FindLiveBracketPrice(rows, position.Row, quantity, negative: true);
        var target = exits.FirstOrDefault(order => order.Type == "LIMIT")?.Price
            ?? FindLiveBracketPrice(rows, position.Row, quantity, negative: false);

        return string.Join("|", new[] {
            "JARVIS_OCR_EXECUTION", "STATUS=OPEN", $"SYMBOL={symbol}", $"SIDE={side}",
            $"QTY={Format(quantity)}", "TYPE=", $"ENTRY={Format(entry)}",
            $"CURRENT={Format(FindCurrentPrice(rows, position.Row))}",
            $"STOP={Format(stop)}",
            $"TARGET={Format(target)}", $"PNL={Format(position.Pnl)}"
        });
    }

    private static double? FindLiveBracketPrice(List<OcrRow> rows, OcrRow positionAnchor, double quantity, bool negative)
    {
        var candidates = LiveMoneyRows(rows)
            .Where(item => !ReferenceEquals(item.Row, positionAnchor))
            .Where(item => Math.Abs(Math.Abs(item.SignedQuantity) - quantity) < 0.0001)
            .Where(item => negative ? item.Pnl < 0 : item.Pnl > 0)
            .OrderBy(item => VerticalDistance(item.Row, positionAnchor))
            .ToList();

        foreach (var candidate in candidates)
        {
            var price = FindOrderPrice(rows, candidate.Row) ?? FindNearestPriceWide(rows, candidate.Row);
            if (price is not null) return price;
        }
        return null;
    }

    private static double? ParseSignedNumber(string raw)
    {
        var normalized = raw.Replace("−", "-").Replace(",", "");
        return double.TryParse(normalized, NumberStyles.Any, CultureInfo.InvariantCulture, out var value) ? value : null;
    }

    private sealed record LiveMoneyRow(OcrRow Row, string QuantityToken, double SignedQuantity, double Pnl);

    private static double? FindOrderPrice(List<OcrRow> rows, OcrRow anchor)
    {
        // Price-axis labels may be displaced slightly to avoid collisions with
        // indicator labels. Prefer the matching colored order label, not the
        // neutral indicator that happens to sit exactly at the line's height.
        if (anchor.MarkerColor is not null)
        {
            var colored = rows.Where(row => row.X > anchor.X + anchor.Width && row.MarkerColor == anchor.MarkerColor)
                .Where(row => Regex.IsMatch(row.Text.Trim(), @"^[\d,]+(?:\.\d+)?$") && VerticalDistance(row, anchor) <= 36)
                .OrderBy(row => VerticalDistance(row, anchor)).Select(row => ExtractPrice(row.Text)).FirstOrDefault(price => price is not null);
            if (colored is not null) return colored;
        }
        return FindNearestPrice(rows, anchor, true);
    }

    private static ReconstructedOrder? ParseCombinedOrder(OcrRow row)
    {
        var match = Regex.Match(
            row.Text.Trim(),
            @"^(Buy|Sell)\s+(\d+(?:\.\d+)?)\s+([A-Z]{1,8}[A-Z0-9!]{0,10})\s+@\s+([\d,]+(?:\.\d+)?)\s+(limit|stop|market)\b(?:\s+([\d,]+(?:\.\d+)?)\s+limit\b)?",
            RegexOptions.IgnoreCase);
        if (!match.Success) return null;

        return new ReconstructedOrder(
            match.Groups[1].Value.Equals("Buy", StringComparison.OrdinalIgnoreCase) ? "BUY" : "SELL",
            ParseNumber(match.Groups[2].Value),
            match.Groups[5].Value.ToUpperInvariant(),
            ParseNumber(match.Groups[4].Value.Replace(",", "")),
            match.Groups[3].Value.ToUpperInvariant(),
            match.Groups[6].Success ? ParseNumber(match.Groups[6].Value.Replace(",", "")) : null,
            row);
    }

    public static string? TryBuildPreparation(List<OcrRow> rows, string? titleSymbol = null)
    {
        var ticketAnchor = rows
            .Where(row => Regex.IsMatch(row.Text, @"\b(change order type|change order quantity|^quantity$|stop loss|take profit)\b", RegexOptions.IgnoreCase))
            .OrderByDescending(row => row.Y)
            .FirstOrDefault();
        if (ticketAnchor is null) return null;

        var symbol = InferSymbol(rows, ticketAnchor, null);
        var addOrder = rows
            .Select(row => Regex.Match(row.Text, @"Add order on\s+([A-Z0-9! ]{2,20}?)\s+at\s+([\d,]+(?:\.\d+)?)", RegexOptions.IgnoreCase))
            .FirstOrDefault(match => match.Success);

        if (symbol is null && addOrder is not null && addOrder.Success)
            symbol = InstrumentCatalog.NormalizeTicker(addOrder.Groups[1].Value);
        symbol ??= titleSymbol;

        var entryPrice = addOrder is not null && addOrder.Success
            ? ParseNumber(addOrder.Groups[2].Value.Replace(",", ""))
            : (double?)null;

        var quantityAnchor = rows
            .Where(row => Regex.IsMatch(row.Text, @"\b(change order quantity|^quantity$)\b", RegexOptions.IgnoreCase))
            .OrderByDescending(row => row.Y)
            .FirstOrDefault();
        var quantity = quantityAnchor is null ? null : FindNearestPlainNumber(rows, quantityAnchor, 140, 75, 1, 1000);

        var orderTypeAnchor = rows
            .Where(row => Regex.IsMatch(row.Text, @"\bchange order type\b", RegexOptions.IgnoreCase))
            .OrderByDescending(row => row.Y)
            .FirstOrDefault();
        var orderType = orderTypeAnchor is null ? null : FindNearestOrderType(rows, orderTypeAnchor);

        var stopPrice = FindRiskRewardPrice(rows, ticketAnchor, negative: true);
        var targetPrice = FindRiskRewardPrice(rows, ticketAnchor, negative: false);

        string? side = null;
        var action = rows
            .Where(row => row.Y >= ticketAnchor.Y - 180 && row.Y <= ticketAnchor.Y + 180)
            .Where(row => Regex.IsMatch(row.Text.Trim(), @"^(Buy|Sell)$", RegexOptions.IgnoreCase))
            .OrderBy(row => VerticalDistance(row, ticketAnchor))
            .FirstOrDefault();

        if (action is not null)
        {
            side = action.Text.Equals("Buy", StringComparison.OrdinalIgnoreCase) ? "LONG" : "SHORT";
        }
        else if (entryPrice is not null && stopPrice is not null && Math.Abs(entryPrice.Value - stopPrice.Value) > 0.000001)
        {
            side = stopPrice < entryPrice ? "LONG" : "SHORT";
        }

        var hasDetails =
            symbol is not null ||
            quantity is not null ||
            orderType is not null ||
            entryPrice is not null ||
            stopPrice is not null ||
            targetPrice is not null;
        if (!hasDetails) return null;

        return string.Join("|", new[]
        {
            "JARVIS_OCR_EXECUTION",
            "STATUS=PREPARING",
            $"SIDE={side ?? ""}",
            $"QTY={quantity?.ToString(CultureInfo.InvariantCulture) ?? ""}",
            $"TYPE={orderType ?? ""}",
            $"SYMBOL={symbol ?? ""}",
            $"ENTRY={Format(entryPrice)}",
            $"CURRENT={Format(FindCurrentPrice(rows, ticketAnchor))}",
            $"STOP={Format(stopPrice)}",
            $"TARGET={Format(targetPrice)}"
        });
    }

    private static double? FindNearestPlainNumber(List<OcrRow> rows, OcrRow anchor, double maxDx, double maxDy, double min, double max)
    {
        return rows
            .Where(row => !ReferenceEquals(row, anchor))
            .Select(row => new
            {
                value = Regex.IsMatch(row.Text.Trim(), @"^\d+(?:\.\d+)?$") ? ParseNumber(row.Text.Trim()) : null,
                dx = Math.Abs((row.X + row.Width / 2) - (anchor.X + anchor.Width / 2)),
                dy = Math.Abs((row.Y + row.Height / 2) - (anchor.Y + anchor.Height / 2)),
            })
            .Where(item => item.value is not null && item.value >= min && item.value <= max)
            .Where(item => item.dx <= maxDx && item.dy <= maxDy)
            .OrderBy(item => item.dy * 4 + item.dx)
            .Select(item => item.value)
            .FirstOrDefault();
    }

    private static string? FindNearestOrderType(List<OcrRow> rows, OcrRow anchor)
    {
        var candidates = rows
            .Where(row => !ReferenceEquals(row, anchor))
            .Where(row => Regex.IsMatch(row.Text.Trim(), @"^(Limit|Stop|Market)$", RegexOptions.IgnoreCase))
            .Select(row => new
            {
                row,
                dx = Math.Abs((row.X + row.Width / 2) - (anchor.X + anchor.Width / 2)),
                dy = Math.Abs((row.Y + row.Height / 2) - (anchor.Y + anchor.Height / 2)),
            })
            .Where(item => item.dx <= 180 && item.dy <= 95)
            .OrderBy(item => item.dy * 4 + item.dx)
            .ToList();

        if (candidates.Count == 0) return null;
        if (candidates.Count > 1 && Math.Abs(candidates[0].dy - candidates[1].dy) < 8) return null;
        return candidates[0].row.Text.Trim().ToUpperInvariant();
    }

    private static double? FindRiskRewardPrice(List<OcrRow> rows, OcrRow anchor, bool negative)
    {
        var signPattern = negative
            ? @"(^|\s)-\s*\$?\d[\d,]*(?:\.\d+)?\s*(USD)?\b|\bstop loss\b"
            : @"(^|\s)\+\s*\$?\d[\d,]*(?:\.\d+)?\s*(USD)?\b|\b(take profit|target)\b";

        var riskAnchor = rows
            .Where(row => Regex.IsMatch(row.Text, signPattern, RegexOptions.IgnoreCase))
            .OrderBy(row => VerticalDistance(row, anchor))
            .FirstOrDefault();

        return riskAnchor is null ? null : FindNearestPriceWide(rows, riskAnchor);
    }

    private static double? FindNearestPriceWide(List<OcrRow> rows, OcrRow anchor)
    {
        return rows
            .Where(row => !ReferenceEquals(row, anchor))
            .Select(row => new
            {
                price = Regex.IsMatch(row.Text, @"USD|\$", RegexOptions.IgnoreCase) ? null : ExtractPrice(row.Text),
                dy = Math.Abs((row.Y + row.Height / 2) - (anchor.Y + anchor.Height / 2)),
                dx = row.X - (anchor.X + anchor.Width),
            })
            .Where(item => item.price is not null && item.dy <= Math.Max(12, anchor.Height) && item.dx >= -8 && item.dx <= 520)
            .OrderBy(item => item.dy * 5 + Math.Abs(item.dx))
            .Select(item => item.price)
            .FirstOrDefault();
    }

    /// <summary>
    /// Instrument of the active pane. Order of trust: the pane's own header
    /// (ticker or description), then the focused-window title, then any
    /// recognizable ticker/contract inside the (already pane-scoped) rows.
    /// </summary>
    public static string? InferSymbol(List<OcrRow> rows, OcrRow? activeAnchor, string? titleSymbol)
    {
        var scoped = rows.Take(400).ToList();

        var headers = scoped.Where(row => InstrumentCatalog.PaneHeader.IsMatch(row.Text));
        if (activeAnchor is not null)
            headers = headers.Where(row => row.Y < activeAnchor.Y).OrderByDescending(row => row.Y);
        foreach (var header in headers)
        {
            var fromHeader = TickerIn(header.Text) ?? InstrumentCatalog.FromDescription(header.Text);
            if (fromHeader is not null) return fromHeader;
        }

        if (titleSymbol is not null) return titleSymbol;

        foreach (var row in scoped.Take(220))
        {
            var found = TickerIn(row.Text);
            if (found is not null) return found;
        }

        return InstrumentCatalog.FromDescription(string.Join(" ", scoped.Take(220).Select(r => r.Text)));
    }

    private static string? TickerIn(string text)
    {
        var upper = text.ToUpperInvariant();
        var contract = Regex.Match(upper, $@"\b((?:{InstrumentCatalog.RootAlternation})[FGHJKMNQUVXZ]\d{{2,4}})\b");
        if (contract.Success)
        {
            var normalized = InstrumentCatalog.NormalizeContractRoot(contract.Groups[1].Value);
            if (normalized is not null) return normalized;
        }
        foreach (Match continuous in Regex.Matches(upper, @"\b([A-Z0-9]{2,6}[1I]?!?)\b"))
        {
            var normalized = InstrumentCatalog.NormalizeTicker(continuous.Groups[1].Value);
            if (normalized is not null) return normalized;
        }
        return null;
    }

    private static double? FindCurrentPrice(List<OcrRow> rows, OcrRow activeAnchor)
    {
        // Only explicitly labelled last/current values. Bid/ask midpoints and
        // nearby indicator/crosshair prices are not the current chart price.
        foreach (var row in rows)
        {
            var match = Regex.Match(row.Text, @"\b(?:Last|Current)\s*:?\s*([\d,]+(?:\.\d+)?)", RegexOptions.IgnoreCase);
            if (match.Success)
            {
                var value = ParseNumber(match.Groups[1].Value.Replace(",", ""));
                if (value >= 100) return value;
            }
        }
        // TradingView's current price marker pairs a contract name with its
        // price on the right axis (for example MYMZ2026 | 52,383).
        foreach (var row in rows.Where(row => InstrumentCatalog.ContractMarker.IsMatch(row.Text.Trim())))
        {
            var inline = Regex.Match(row.Text.Trim(), @"^\S+\s+([\d,]+(?:\.\d+)?)$");
            if (inline.Success) return ParseNumber(inline.Groups[1].Value.Replace(",", ""));
            var price = rows.Where(other => other.X >= row.X + row.Width - 4 && other.X <= row.X + row.Width + 100)
                .Where(other => Regex.IsMatch(other.Text.Trim(), @"^[\d,]+(?:\.\d+)?$") && VerticalDistance(other, row) < 10)
                .OrderBy(other => VerticalDistance(other, row)).Select(other => ExtractPrice(other.Text)).FirstOrDefault(value => value is not null);
            if (price is not null) return price;
        }
        return null;
    }

    private static double? FindNearestPrice(List<OcrRow> rows, OcrRow anchor, bool preferRight)
    {
        var candidates = rows
            .Where(row => !ReferenceEquals(row, anchor))
            .Select(row => new
            {
                price = Regex.IsMatch(row.Text, @"USD|\$", RegexOptions.IgnoreCase) ? null : ExtractPrice(row.Text),
                dy = Math.Abs((row.Y + row.Height / 2) - (anchor.Y + anchor.Height / 2)),
                dx = row.X - (anchor.X + anchor.Width)
            })
            .Where(x => x.price is not null && x.dy <= Math.Max(12, anchor.Height))
            .Where(x => !preferRight || x.dx >= -20)
            .OrderBy(x => x.dy * 4 + Math.Abs(x.dx))
            .FirstOrDefault();

        return candidates?.price;
    }

    private static double? ExtractPrice(string text)
    {
        var matches = Regex.Matches(text, @"(?<![\d$])\d{1,3}(?:,\d{3})+(?:\.\d{1,4})?|(?<![\d$])\d{4,6}(?:\.\d{1,4})?");
        foreach (Match match in matches)
        {
            var raw = match.Value.Replace(",", "");
            if (!double.TryParse(raw, NumberStyles.Any, CultureInfo.InvariantCulture, out var value)) continue;
            if (value >= 100 && value <= 1_000_000) return value;
        }
        return null;
    }

    private static double? ParseNumber(string raw) =>
        double.TryParse(raw, NumberStyles.Any, CultureInfo.InvariantCulture, out var value) ? value : null;

    private static double VerticalDistance(OcrRow a, OcrRow b) =>
        Math.Abs((a.Y + a.Height / 2) - (b.Y + b.Height / 2));

    private static string Format(double? value) =>
        value?.ToString("0.####", CultureInfo.InvariantCulture) ?? "";

    private static string Sanitize(string value) =>
        value.Replace("|", "/").Replace("\r", " ").Replace("\n", " ").Trim();
}
