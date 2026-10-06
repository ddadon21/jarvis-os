namespace JarvisObserver;

/// <summary>The five external Observer states Dwight sees. Nothing else is ever shown.</summary>
internal static class ObserverPhases
{
    public const string Waiting = "WAITING";
    public const string PreparingOrder = "PREPARING_ORDER";
    public const string PendingOrder = "PENDING_ORDER";
    public const string OrderFilled = "ORDER_FILLED";
    public const string TradeInProgress = "TRADE_IN_PROGRESS";

    public static readonly string[] All = { Waiting, PreparingOrder, PendingOrder, OrderFilled, TradeInProgress };

    public static string Label(string phase) => phase.Replace('_', ' ');

    public static bool IsActive(string phase) => phase != Waiting;
}

/// <param name="At">When the change happened on screen (FLAT is back-dated to the first clean scan).</param>
/// <param name="DetectedAt">When the Observer recognized it.</param>
internal sealed record PhaseTransition(string From, string To, DateTime At, DateTime DetectedAt, string? Symbol);

/// <summary>
/// Maps raw screen reads plus the journal's confirmed state onto the five
/// external phases, without touching the internal journal.
///
/// - Draft and working orders show on the first read (fast; a stray read only
///   flickers the display and never writes a journal event).
/// - Fills and positions come from the journal's confirmed OPEN (two reads),
///   so one bad read can never show a fake trade.
/// - ORDER_FILLED is always shown for <see cref="FilledHold"/> after a confirmed
///   fill, then TRADE_IN_PROGRESS.
/// - A FLAT read (already several clean scans) returns to WAITING immediately
///   unless the journal still holds a confirmed position.
/// Pure logic: no IO, no clock.
/// </summary>
internal sealed class PhaseTracker
{
    public static readonly TimeSpan FilledHold = TimeSpan.FromSeconds(4);

    public string Phase { get; private set; } = ObserverPhases.Waiting;
    public DateTime PhaseSince { get; private set; } = DateTime.MinValue;
    public ExecutionRead? LastRead { get; private set; }

    /// <summary>Applies one read. Returns the transition when the phase changed.</summary>
    public PhaseTransition? Update(ExecutionRead read, string confirmedStatus, DateTime now)
    {
        LastRead = read;
        string next;
        if (confirmedStatus == "OPEN")
        {
            next = Filled(now);
        }
        else
        {
            next = read.Status switch
            {
                "PENDING" => ObserverPhases.PendingOrder,
                "PREPARING" => ObserverPhases.PreparingOrder,
                "FLAT" => ObserverPhases.Waiting,
                // An unconfirmed OPEN read keeps the current phase until the journal confirms the fill.
                _ => Phase,
            };
        }
        return Set(next, read.Status == "FLAT" ? read.At : now, now, read.Symbol);
    }

    /// <summary>Time-only update (no new read): ends the ORDER_FILLED transient.</summary>
    public PhaseTransition? Tick(string confirmedStatus, DateTime now)
    {
        if (confirmedStatus != "OPEN" || Phase != ObserverPhases.OrderFilled) return null;
        return Set(Filled(now), now, now, LastRead?.Symbol);
    }

    private string Filled(DateTime now) => Phase switch
    {
        ObserverPhases.TradeInProgress => ObserverPhases.TradeInProgress,
        ObserverPhases.OrderFilled => now - PhaseSince >= FilledHold ? ObserverPhases.TradeInProgress : ObserverPhases.OrderFilled,
        _ => ObserverPhases.OrderFilled,
    };

    private PhaseTransition? Set(string next, DateTime at, DateTime detectedAt, string? symbol)
    {
        if (next == Phase) return null;
        var transition = new PhaseTransition(Phase, next, at, detectedAt, symbol);
        Phase = next;
        PhaseSince = detectedAt;
        return transition;
    }
}
