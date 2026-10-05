using System.Globalization;
using System.Text;

namespace JarvisObserver;

/// <summary>Renders a journaled trade as a Markdown note (trade folder + Obsidian vault).</summary>
internal static class TradeNotes
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    public static string FileName(JournalTrade trade) =>
        $"{trade.OpenedAt.ToLocalTime():yyyy-MM-dd HHmm} {trade.Symbol} {trade.Side}.md";

    private static string N(double? value, string format = "0.##") => value is double v ? v.ToString(format, Inv) : "—";

    public static double? RiskPoints(JournalTrade trade) =>
        trade.EntryPrice is double entry && trade.InitialStop is double stop ? Math.Abs(entry - stop) : null;

    public static double? Points(JournalTrade trade, double? price) =>
        trade.EntryPrice is double entry && price is double p ? (trade.Side == "LONG" ? p - entry : entry - p) : null;

    public static string Render(JournalTrade trade, IReadOnlyList<JournalEvent> events) =>
        RenderGenerated(trade, events) + "\n" + Template();

    /// <summary>Facts JARVIS measured (frontmatter, table, timeline).</summary>
    public static string RenderGenerated(JournalTrade trade, IReadOnlyList<JournalEvent> events)
    {
        var risk = RiskPoints(trade);
        double? R(double? points) => points is double pts && risk is double r && r > 0 ? pts / r : null;
        var result = Points(trade, trade.ExitPrice);
        var mfe = Points(trade, trade.MfePrice);
        var mae = Points(trade, trade.MaePrice);
        var duration = trade.ClosedAt is DateTime closed ? closed - trade.OpenedAt : (TimeSpan?)null;
        var prepLead = trade.PreparedAt is DateTime prep ? trade.OpenedAt - prep : (TimeSpan?)null;

        var sb = new StringBuilder();
        sb.AppendLine("---");
        sb.AppendLine("type: trade");
        sb.AppendLine($"trade_id: \"{trade.Id}\"");
        sb.AppendLine($"symbol: {trade.Symbol}");
        sb.AppendLine($"side: {trade.Side}");
        sb.AppendLine($"opened: {trade.OpenedAt:O}");
        if (trade.ClosedAt is DateTime c) sb.AppendLine($"closed: {c:O}");
        sb.AppendLine($"entry: {N(trade.EntryPrice)}");
        sb.AppendLine($"exit: {N(trade.ExitPrice)}");
        sb.AppendLine($"initial_stop: {N(trade.InitialStop)}");
        sb.AppendLine($"initial_target: {N(trade.InitialTarget)}");
        sb.AppendLine($"max_quantity: {N(trade.MaxQuantity)}");
        sb.AppendLine($"pnl_observed: {N(trade.LastPnl)}");
        sb.AppendLine($"result_r: {N(R(result), "0.00")}");
        sb.AppendLine("source: jarvis-observer");
        sb.AppendLine("tags: [trade, jarvis]");
        sb.AppendLine("---");
        sb.AppendLine();
        sb.AppendLine($"# {trade.Symbol} {trade.Side} · {trade.OpenedAt.ToLocalTime():ddd MMM d, h:mm tt}");
        sb.AppendLine();
        sb.AppendLine("| | |");
        sb.AppendLine("|---|---|");
        sb.AppendLine($"| Entry → Exit | {N(trade.EntryPrice)} → {N(trade.ExitPrice)} |");
        sb.AppendLine($"| Size (max) | {N(trade.MaxQuantity)} |");
        sb.AppendLine($"| Initial stop / target | {N(trade.InitialStop)} / {N(trade.InitialTarget)} |");
        sb.AppendLine($"| Result | {N(result)} pts · {N(R(result), "0.00")}R · P&L {N(trade.LastPnl, "0.00")} (last seen) |");
        sb.AppendLine($"| Best / worst excursion | +{N(mfe)} pts ({N(R(mfe), "0.00")}R) / {N(mae)} pts ({N(R(mae), "0.00")}R) |");
        sb.AppendLine($"| Prepared before entry | {(prepLead is TimeSpan lead ? $"{lead.TotalSeconds:0}s" : "—")} |");
        sb.AppendLine($"| Time in trade | {(duration is TimeSpan d ? $"{(int)d.TotalMinutes}m {d.Seconds}s" : "—")} |");
        sb.AppendLine();
        sb.AppendLine("## Timeline");
        foreach (var e in events.OrderBy(e => e.At))
        {
            var detail = e.Type switch
            {
                "PREPARING" => $"order drafted {N(e.Quantity)} @ {N(e.Price)}",
                "ORDER_WORKING" => $"order working @ {N(e.Price)}",
                "ENTRY" => $"filled {N(e.Quantity)} @ {N(e.Price)} · stop {N(e.StopPrice)} · target {N(e.TargetPrice)}",
                "STOP_MOVED" => $"stop → {N(e.StopPrice)}",
                "TARGET_MOVED" => $"target → {N(e.TargetPrice)}",
                "SIZE_CHANGED" => $"size → {N(e.Quantity)}",
                "EXIT" => $"flat @ {N(e.Price)} · P&L {N(e.Pnl, "0.00")}",
                _ => e.Type,
            };
            sb.AppendLine($"- `{e.At.ToLocalTime():HH:mm:ss}` **{e.Type.Replace('_', ' ')}** {detail}");
        }
        return sb.ToString();
    }

    /// <summary>Questions for Dwight. Written once, outside JARVIS's markers, so answers are never overwritten.</summary>
    public static string Template()
    {
        var sb = new StringBuilder();
        sb.AppendLine("## Why I took it");
        sb.AppendLine("- HTF zone (4H / 1D):");
        sb.AppendLine("- Trend:");
        sb.AppendLine("- Who lost / liquidity taken:");
        sb.AppendLine("- Confirmation back:");
        sb.AppendLine("- Entry trigger:");
        sb.AppendLine();
        sb.AppendLine("## Review");
        sb.AppendLine("- Followed rules? ");
        sb.AppendLine("- What I'd repeat / change:");
        return sb.ToString();
    }
}
