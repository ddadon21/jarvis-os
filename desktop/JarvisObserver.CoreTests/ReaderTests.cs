using System.Globalization;

namespace JarvisObserver;

/// <summary>
/// Order-reader, phase and diagnostics fixtures. Layouts are OCR rows modelled on
/// TradingView Desktop (the MYM and NQ position layouts are taken from real
/// screenshots). Platform-neutral: runs on Linux and Windows CI.
/// </summary>
internal static class ReaderTests
{
    private sealed record Instrument(string Root, double Price, double Tick, string Description);

    // The eight mandatory acceptance instruments, plus prices in their real formats.
    private static readonly Instrument[] Mandatory =
    {
        new("NQ", 21345.25, 0.25, "E-mini Nasdaq-100 Futures"),
        new("MNQ", 21345.25, 0.25, "Micro E-mini Nasdaq-100 Index Futures"),
        new("ES", 5950.25, 0.25, "E-mini S&P 500 Futures"),
        new("MES", 5950.25, 0.25, "Micro E-mini S&P 500 Index Futures"),
        new("YM", 42350, 1, "E-mini Dow ($5) Futures"),
        new("MYM", 42350, 1, "Micro E-mini Dow Jones Industrial Average Index Futures"),
        new("GC", 2650.4, 0.1, "Gold Futures"),
        new("MGC", 2650.4, 0.1, "Micro Gold Futures"),
    };

    public static void Run(Action<string, bool, string?> check)
    {
        void Check(string name, bool ok, string? detail = null) => check(name, ok, detail);
        string P(double value) => value.ToString(value % 1 == 0 ? "#,0" : "#,0.0#", CultureInfo.InvariantCulture);
        string F(double value) => value.ToString("0.####", CultureInfo.InvariantCulture);

        Dictionary<string, string> Read(List<OcrRow> rows, (double, double)? pointer, string? title = null)
        {
            var anchor = ExecutionParser.FindActiveOrderAnchor(rows, pointer);
            var scoped = ExecutionParser.ScopeToOrderPane(rows, anchor);
            var text = ExecutionParser.TryBuildExecution(scoped, title) ?? ExecutionParser.TryBuildPreparation(scoped, title);
            return text is null ? new() : Fields(text);
        }

        // Background chart text so a scan counts as a healthy surface (≥15 rows).
        List<OcrRow> Chart(Instrument i, double x = 40, double width = 1800)
        {
            var rows = new List<OcrRow>
            {
                new(i.Description + " · 5 · CME", x, 90, 520, 14),
                new(i.Root + "1!, 5", x, 116, 90, 14),
                new("Last: " + P(i.Price), x, 140, 140, 14),
            };
            // Toolbar and time-axis text (no prices, so nothing competes with order labels).
            foreach (var (text, k) in new[] { "Indicators", "Alert", "Replay", "Trade", "09:30", "09:45", "10:00", "10:15", "10:30", "10:45", "11:00", "11:15", "11:30", "11:45" }.Select((t, k) => (t, k)))
                rows.Add(new(text, x + 60 + k * 60, k < 4 ? 60 : 980, 50, 14));
            return rows;
        }

        // ---- Mandatory instruments: draft, dragged draft, pending, long fill, short fill, cancel ----
        foreach (var i in Mandatory)
        {
            foreach (var buy in new[] { true, false })
            {
                var entry = i.Price - (buy ? 20 : -20) * i.Tick;
                var stop = buy ? entry - 40 * i.Tick : entry + 40 * i.Tick;
                var target = buy ? entry + 80 * i.Tick : entry - 80 * i.Tick;
                var side = buy ? "LONG" : "SHORT";
                var label = $"{i.Root} {side}";

                // 1. On-chart draft before submission (preview widget with bracket chips).
                var draft = Chart(i);
                draft.Add(new((buy ? "Buy" : "Sell") + " 2 Limit x", 550, 500, 120, 14));
                draft.Add(new(P(entry), 1750, 500, 70, 14));
                draft.Add(new("2 - 500.00 USD x", 1300, buy ? 560 : 440, 120, 14));
                draft.Add(new(P(stop), 1750, buy ? 560 : 440, 70, 14));
                draft.Add(new("2 + 1,000.00 USD x", 1300, buy ? 380 : 620, 130, 14));
                draft.Add(new(P(target), 1750, buy ? 380 : 620, 70, 14));
                var d = Read(draft, (600, 500));
                Check($"draft status {label}", d.GetValueOrDefault("STATUS") == "PREPARING", Dump(d));
                Check($"draft chart {label}", d.GetValueOrDefault("SYMBOL") == i.Root && d.GetValueOrDefault("SIDE") == side &&
                    d.GetValueOrDefault("QTY") == "2" && d.GetValueOrDefault("TYPE") == "LIMIT" && d.GetValueOrDefault("ENTRY") == F(entry) &&
                    d.GetValueOrDefault("CURRENT") == F(i.Price) && d.GetValueOrDefault("STOP") == F(stop) && d.GetValueOrDefault("TARGET") == F(target), Dump(d));

                // 2. Order being dragged from the "+" widget: no Buy/Sell row yet, only the
                //    hover tooltip, quantity and type editors. Fields fill in as they appear.
                var drag = Chart(i);
                drag.Add(new($"Add order on {i.Root}1! at {P(entry)}", 520, 470, 260, 14));
                drag.Add(new("change order quantity", 520, 500, 150, 14));
                drag.Add(new("3", 690, 500, 12, 14));
                drag.Add(new("change order type", 520, 530, 130, 14));
                drag.Add(new("Stop", 690, 530, 40, 14));
                var g = Read(drag, (560, 500));
                Check($"dragged draft {label}", g.GetValueOrDefault("STATUS") == "PREPARING" && g.GetValueOrDefault("SYMBOL") == i.Root &&
                    g.GetValueOrDefault("QTY") == "3" && g.GetValueOrDefault("TYPE") == "STOP" && g.GetValueOrDefault("ENTRY") == F(entry) &&
                    g.GetValueOrDefault("CURRENT") == F(i.Price), Dump(g));

                // 3. Submitted working order: chart label plus TradingView's full order text.
                var pending = Chart(i);
                pending.Add(new((buy ? "Buy" : "Sell") + " 1 Limit x", 550, 500, 120, 14));
                pending.Add(new(P(entry), 1750, 500, 70, 14));
                pending.Add(new($"{(buy ? "Buy" : "Sell")} 1 {i.Root}Z2026 @ {P(entry)} limit", 60, 900, 320, 14));
                pending.Add(new("1 -250.00 USD x", 1300, buy ? 560 : 440, 120, 14));
                pending.Add(new(P(stop), 1750, buy ? 560 : 440, 70, 14));
                pending.Add(new("1 +500.00 USD x", 1300, buy ? 380 : 620, 120, 14));
                pending.Add(new(P(target), 1750, buy ? 380 : 620, 70, 14));
                var w = Read(pending, (600, 500));
                Check($"pending {label}", w.GetValueOrDefault("STATUS") == "PENDING" && w.GetValueOrDefault("SYMBOL") == i.Root &&
                    w.GetValueOrDefault("SIDE") == side && w.GetValueOrDefault("QTY") == "1" && w.GetValueOrDefault("TYPE") == "LIMIT" &&
                    w.GetValueOrDefault("ENTRY") == F(entry) && w.GetValueOrDefault("STOP") == F(stop) && w.GetValueOrDefault("TARGET") == F(target), Dump(w));
            }

            // 4. Filled long (real MYM layout): exits as "1 Sell Limit/Stop", one money chip.
            {
                var entry = i.Price - 10 * i.Tick;
                var stop = entry - 30 * i.Tick;
                var target = entry + 60 * i.Tick;
                var rows = Chart(i);
                rows.Add(new("1 Sell Limit x", 1541, 300, 154, 14) { MarkerColor = "RED" });
                rows.Add(new(P(target), 1778, 296, 58, 14) { MarkerColor = "RED" });
                rows.Add(new("1 Sell Stop x", 1546, 700, 150, 14) { MarkerColor = "RED" });
                rows.Add(new(P(stop), 1778, 700, 58, 14) { MarkerColor = "RED" });
                rows.Add(new("1 +69.50 USD x", 1524, 560, 172, 14) { MarkerColor = "BLUE" });
                rows.Add(new(P(entry), 1778, 560, 58, 14) { MarkerColor = "BLUE" });
                var o = Read(rows, (1500, 560));
                Check($"filled long {i.Root}", o.GetValueOrDefault("STATUS") == "OPEN" && o.GetValueOrDefault("SYMBOL") == i.Root &&
                    o.GetValueOrDefault("SIDE") == "LONG" && o.GetValueOrDefault("QTY") == "1" && o.GetValueOrDefault("ENTRY") == F(entry) &&
                    o.GetValueOrDefault("CURRENT") == F(i.Price) && o.GetValueOrDefault("STOP") == F(stop) && o.GetValueOrDefault("TARGET") == F(target) &&
                    o.GetValueOrDefault("TYPE") == "", Dump(o));
            }

            // 5. Filled short (real NQ layout): signed "-1" position chip, USD-only bracket chips.
            {
                var entry = i.Price + 10 * i.Tick;
                var stop = entry + 30 * i.Tick;
                var target = entry - 60 * i.Tick;
                var rows = Chart(i);
                rows.Add(new("1 -1,175.00 USD x", 1280, 300, 170, 14));
                rows.Add(new(P(stop), 1510, 300, 78, 14));
                rows.Add(new("-1 +620.00 USD x", 1280, 460, 175, 14) { MarkerColor = "RED" });
                rows.Add(new(P(entry), 1510, 460, 78, 14) { MarkerColor = "RED" });
                rows.Add(new("1 +1,575.00 USD x", 1280, 640, 170, 14));
                rows.Add(new(P(target), 1510, 640, 78, 14));
                var o = Read(rows, (1350, 460));
                Check($"filled short {i.Root}", o.GetValueOrDefault("STATUS") == "OPEN" && o.GetValueOrDefault("SYMBOL") == i.Root &&
                    o.GetValueOrDefault("SIDE") == "SHORT" && o.GetValueOrDefault("ENTRY") == F(entry) && o.GetValueOrDefault("STOP") == F(stop) &&
                    o.GetValueOrDefault("TARGET") == F(target) && o.GetValueOrDefault("PNL") == "620", Dump(o));
            }

            // 6. Cancel: two clean scans clear a working order to FLAT, back-dated to the first.
            {
                var parser = new ExecutionParser();
                var t = new DateTime(2026, 10, 6, 14, 0, 0, DateTimeKind.Utc);
                var pending = Chart(i);
                pending.Add(new("Buy 1 Limit x", 550, 500, 120, 14));
                pending.Add(new(P(i.Price - 5), 1750, 500, 70, 14));
                pending.Add(new($"Buy 1 {i.Root}Z2026 @ {P(i.Price - 5)} limit", 60, 900, 320, 14));
                var first = parser.Canonical(pending, t);
                var clean1 = parser.Canonical(Chart(i), t.AddMilliseconds(700));
                var clean2 = parser.Canonical(Chart(i), t.AddMilliseconds(1400));
                Check($"cancel {i.Root}", first?.Contains("STATUS=PENDING") == true && clean1 is null && clean2?.Contains("STATUS=FLAT") == true, $"{first} | {clean1} | {clean2}");
                var flat = ExecutionRead.Parse(clean2, t.AddMilliseconds(1400));
                Check($"cancel back-dated {i.Root}", flat?.At == t.AddMilliseconds(700), flat?.At.ToString("o"));
            }
        }

        // ---- Draft vs. submitted: the same chart label without TradingView's order text stays a draft ----
        {
            var i = Mandatory[1];
            var rows = Chart(i);
            rows.Add(new("Buy 1 Limit x", 550, 500, 120, 14));
            rows.Add(new(P(i.Price), 1750, 500, 70, 14));
            Check("chart label alone is not proof of submission", Read(rows, (600, 500)).GetValueOrDefault("STATUS") == "PREPARING");
            rows.Add(new("change order quantity", 520, 470, 150, 14));
            rows.Add(new($"Buy 1 {i.Root}Z2026 @ {P(i.Price)} limit", 60, 900, 320, 14));
            Check("open draft editors keep it a draft", Read(rows, (600, 500)).GetValueOrDefault("STATUS") == "PREPARING");
        }

        // ---- Split screen: the pane with the active order wins over panes, watchlist and title ----
        {
            var es = Mandatory[2];
            var mes = Mandatory[3];
            var rows = Chart(es, 40, 900);
            rows.AddRange(Chart(mes, 980, 900));
            rows.Add(new("NQ1!", 1920, 130, 50, 14));          // watchlist
            rows.Add(new("21,345.25", 1980, 130, 70, 14));
            rows.Add(new("Sell 4 Limit x", 1450, 500, 120, 14));
            rows.Add(new(P(mes.Price + 5), 1790, 500, 70, 14));
            var r = Read(rows, (1480, 500), title: "ES");
            Check("split screen: order pane symbol", r.GetValueOrDefault("SYMBOL") == "MES" && r.GetValueOrDefault("QTY") == "4" && r.GetValueOrDefault("SIDE") == "SHORT", Dump(r));

            var left = Chart(Mandatory[0], 40, 900);
            left.AddRange(Chart(Mandatory[1], 980, 900));
            left.Add(new("Buy 2 Limit x", 500, 450, 120, 14));
            left.Add(new("21,300.25", 820, 450, 70, 14));
            var l = Read(left, (1500, 300));
            Check("split screen: left-pane order with pointer elsewhere", l.GetValueOrDefault("SYMBOL") == "NQ" && l.GetValueOrDefault("QTY") == "2", Dump(l));
        }

        // ---- Window title: fallback when the pane header is not readable, never over a pane header ----
        {
            var rows = new List<OcrRow>
            {
                new("ES1!", 1920, 130, 50, 14),                     // watchlist ticker above the order
                new("Buy 1 Limit x", 550, 500, 120, 14),
                new("21,345.25", 1750, 500, 70, 14),
            };
            Check("title symbol beats a watchlist ticker", Read(rows, (600, 500), title: "MNQ").GetValueOrDefault("SYMBOL") == "MNQ");
            Check("title parse continuous", InstrumentCatalog.FromWindowTitle("MNQ1! 21,345.25 ▲ +0.31% Unnamed") == "MNQ");
            Check("title parse exchange-prefixed contract", InstrumentCatalog.FromWindowTitle("CME_MINI:ESZ2026 5,950.25 ▼ −0.10%") == "ES");
            Check("title parse gold", InstrumentCatalog.FromWindowTitle("MGC1! 2,650.4 ▲") == "MGC");
            Check("title without a symbol", InstrumentCatalog.FromWindowTitle("TradingView") is null);
        }

        // ---- Broader recognition is preserved (not limited to the mandatory eight) ----
        foreach (var (root, description, price) in new[] { ("CL", "Crude Oil Futures", 71.42 * 100), ("RTY", "E-mini Russell 2000 Index Futures", 2250.1), ("M2K", "Micro E-mini Russell 2000 Index Futures", 2250.1), ("SI", "Silver Futures", 3150.5) })
        {
            var i = new Instrument(root, price, 0.1, description);
            var rows = Chart(i);
            rows.Add(new("Buy 1 Limit x", 550, 500, 120, 14));
            rows.Add(new(P(price), 1750, 500, 70, 14));
            Check($"broader instrument {root}", Read(rows, (600, 500)).GetValueOrDefault("SYMBOL") == root, Dump(Read(rows, (600, 500))));
        }
        Check("description-only header", InstrumentCatalog.FromDescription("Micro Gold Futures · 1 · COMEX") == "MGC" && InstrumentCatalog.FromDescription("Gold Futures · 1 · COMEX") == "GC");

        // ---- Position needs more negative evidence than an order (no false exits) ----
        {
            var i = Mandatory[0];
            var parser = new ExecutionParser();
            var t = new DateTime(2026, 10, 6, 15, 0, 0, DateTimeKind.Utc);
            var open = Chart(i);
            open.Add(new("-1 +620.00 USD x", 1280, 460, 175, 14));
            open.Add(new(P(i.Price), 1510, 460, 78, 14));
            var s0 = parser.Canonical(open, t);
            var after = Enumerable.Range(1, 4).Select(k => parser.Canonical(Chart(i), t.AddMilliseconds(700 * k))).ToList();
            Check("position not cleared by three clean scans", s0?.Contains("STATUS=OPEN") == true && after.Take(3).All(x => x is null), string.Join(" | ", after));
            Check("position cleared after four clean scans", after[3]?.Contains("STATUS=FLAT") == true);
            Check("unhealthy surface is not negative evidence", new ExecutionParser().Canonical(new List<OcrRow> { new("menu", 0, 0, 10, 10) }, t) is null);
        }

        PhaseTests(Check);
        DiagnosticsTests(Check);
        LegacyRegressions(Check);
    }

    private static void PhaseTests(Action<string, bool, string?> check)
    {
        var t0 = new DateTime(2026, 10, 6, 14, 0, 0, DateTimeKind.Utc);
        ExecutionRead R(string line, double s) => ExecutionRead.Parse("JARVIS_OCR_EXECUTION|" + line, t0.AddSeconds(s))!;
        var life = new TradeLifecycle { DevicePrefix = "phase" };
        var phase = new PhaseTracker();
        var seen = new List<string>();
        string Feed(string line, double s)
        {
            var read = R(line, s);
            life.Observe(read);
            var change = phase.Update(read, life.ConfirmedStatus, t0.AddSeconds(s));
            if (change is not null) seen.Add(change.To);
            return phase.Phase;
        }
        const string Prep = "STATUS=PREPARING|SYMBOL=MNQ|SIDE=LONG|QTY=1|TYPE=LIMIT|ENTRY=21000";
        const string Pend = "STATUS=PENDING|SYMBOL=MNQ|SIDE=LONG|QTY=1|TYPE=LIMIT|ENTRY=21000|STOP=20980|TARGET=21040";
        const string Open = "STATUS=OPEN|SYMBOL=MNQ|SIDE=LONG|QTY=1|ENTRY=21000|CURRENT=21002|STOP=20980|TARGET=21040|PNL=4";

        check("phase starts WAITING", phase.Phase == ObserverPhases.Waiting, null);
        check("draft shows on the first read", Feed(Prep, 0) == ObserverPhases.PreparingOrder, phase.Phase);
        check("working order shows on the first read", Feed(Pend, 1) == ObserverPhases.PendingOrder, phase.Phase);
        Feed(Pend, 2);
        check("single OPEN read is not a fill", Feed(Open, 3) == ObserverPhases.PendingOrder, phase.Phase);
        check("confirmed fill shows ORDER_FILLED", Feed(Open, 3.7) == ObserverPhases.OrderFilled, phase.Phase);
        check("ORDER_FILLED holds briefly", Feed(Open, 6) == ObserverPhases.OrderFilled, phase.Phase);
        check("then TRADE_IN_PROGRESS", Feed(Open, 8) == ObserverPhases.TradeInProgress, phase.Phase);
        check("hover/modify while in a trade stays TRADE_IN_PROGRESS", Feed(Prep, 9) == ObserverPhases.TradeInProgress, phase.Phase);
        Feed(Open, 10);
        check("one FLAT read while in a trade does not drop the trade", Feed("STATUS=FLAT", 11) == ObserverPhases.TradeInProgress, phase.Phase);
        check("confirmed exit returns to WAITING", Feed("STATUS=FLAT", 12) == ObserverPhases.Waiting, phase.Phase);
        check("phase sequence", string.Join(">", seen) == "PREPARING_ORDER>PENDING_ORDER>ORDER_FILLED>TRADE_IN_PROGRESS>WAITING", string.Join(">", seen));

        // Cancel clears immediately (first FLAT read), before the journal confirms.
        Feed(Pend, 20);
        Feed(Pend, 21);
        check("cancel clears to WAITING on the first FLAT read", Feed("STATUS=FLAT", 22) == ObserverPhases.Waiting, phase.Phase);

        // Time-only tick ends ORDER_FILLED even without new reads.
        var tracker = new PhaseTracker();
        tracker.Update(R(Open, 0), "OPEN", t0);
        check("tick keeps ORDER_FILLED inside the hold", tracker.Tick("OPEN", t0.AddSeconds(2)) is null && tracker.Phase == ObserverPhases.OrderFilled, tracker.Phase);
        check("tick moves to TRADE_IN_PROGRESS after the hold", tracker.Tick("OPEN", t0.AddSeconds(5))?.To == ObserverPhases.TradeInProgress, tracker.Phase);
        check("exactly five external phases", ObserverPhases.All.Length == 5 && ObserverPhases.All.Distinct().Count() == 5, null);
    }

    private static void DiagnosticsTests(Action<string, bool, string?> check)
    {
        var t0 = new DateTime(2026, 10, 6, 14, 0, 0, DateTimeKind.Utc);
        ExecutionRead R(string line, double s) => ExecutionRead.Parse("JARVIS_OCR_EXECUTION|" + line, t0.AddSeconds(s))!;
        var diag = new ObserverDiagnostics();
        diag.RecordRead(R("STATUS=PREPARING|SYMBOL=MES|SIDE=SHORT|QTY=1|TYPE=LIMIT|ENTRY=5950", 0), 120, "MES", t0);
        diag.RecordRead(R("STATUS=PENDING|SYMBOL=MES|SIDE=SHORT|QTY=1|TYPE=LIMIT|ENTRY=5950|CURRENT=5951|STOP=5960|TARGET=5930", 1), 80, "ES", t0.AddSeconds(1));
        diag.RecordRead(R("STATUS=FLAT", 2), 60, "ES", t0.AddSeconds(2));
        diag.RecordTransition(new PhaseTransition(ObserverPhases.Waiting, ObserverPhases.PreparingOrder, t0, t0, "MES"));
        diag.RecordTransition(new PhaseTransition(ObserverPhases.PreparingOrder, ObserverPhases.Waiting, t0.AddSeconds(1.7), t0.AddSeconds(2.4), "MES"));
        diag.RecordTransition(new PhaseTransition(ObserverPhases.Waiting, ObserverPhases.PendingOrder, t0.AddSeconds(10), t0.AddSeconds(10), "MES"));
        diag.RecordTransition(new PhaseTransition(ObserverPhases.PendingOrder, ObserverPhases.Waiting, t0.AddSeconds(10.5), t0.AddSeconds(11), "MES"));
        diag.RecordFill("MES", t0.AddSeconds(20), t0.AddSeconds(21.3));
        diag.RecordExit("MES", t0.AddSeconds(20), t0.AddSeconds(25));
        var snap = diag.Snapshot("test", t0.AddSeconds(30));
        check("diagnostics read count and latency", snap.Reads == 3 && snap.ActiveReads == 2 && snap.ReadMsP50 == 80 && snap.ReadMsP95 == 120, System.Text.Json.JsonSerializer.Serialize(snap));
        check("missing-field rate", snap.MissingFieldRate["stop"] == 0.5 && snap.MissingFieldRate["symbol"] == 0, null);
        check("wrong-symbol proxy against window title", snap.TitleComparableReads == 2 && snap.WrongSymbolRate == 0.5, null);
        check("cancel-clear latency from last order scan", snap.CancelClears == 2 && snap.CancelClearMsP50 == 1400, $"{snap.CancelClearMsP50}");
        check("blip order counted as suspect", snap.SuspectedFalseOrderEvents == 1, null);
        check("sub-10s trade counted as suspect", snap.SuspectedFalseTrades == 1, null);
        check("fill confirmation latency", snap.FillConfirmMsP50 == 1300, $"{snap.FillConfirmMsP50}");
        check("per-symbol stats", snap.PerSymbol["MES"].Episodes == 2 && snap.PerSymbol["MES"].CompleteReads == 1 && snap.PerSymbol["MES"].Fills == 1, null);
    }

    /// <summary>Scenarios from the previous reflection-based test project, unchanged in intent.</summary>
    private static void LegacyRegressions(Action<string, bool, string?> check)
    {
        Dictionary<string, string> Read(List<OcrRow> rows, (double, double) pointer)
        {
            var anchor = ExecutionParser.FindActiveOrderAnchor(rows, pointer);
            var scoped = ExecutionParser.ScopeToOrderPane(rows, anchor);
            var text = ExecutionParser.TryBuildExecution(scoped) ?? ExecutionParser.TryBuildPreparation(scoped);
            return text is null ? new() : Fields(text);
        }
        OcrRow Row(string text, double x, double y, double w = 120, double h = 14) => new(text, x, y, w, h);
        OcrRow Colored(string text, double x, double y, string color, double w = 120) => new(text, x, y, w, 14) { MarkerColor = color };

        foreach (var symbol in new[] { "NQ", "MNQ", "YM", "MYM", "ES", "MES", "GC", "MGC" })
            foreach (var action in new[] { "Buy", "Sell" })
            {
                var rows = new List<OcrRow>
                {
                    Row(symbol + "1!, 10", 40, 150), Row("Last: 3,005.25", 40, 180),
                    Row(action + " 10 Limit x", 550, 500), Row("3,000.25", 820, 500, 70),
                    Row("10 - 500.00 USD x", 550, 550), Row(action == "Buy" ? "2,975.25" : "3,025.25", 820, 550, 70),
                    Row("10 + 1,000.00 USD x", 550, 400), Row(action == "Buy" ? "3,050.25" : "2,950.25", 820, 400, 70),
                };
                var r = Read(rows, (600, 500));
                check($"legacy draft {symbol} {action}", r.GetValueOrDefault("STATUS") == "PREPARING" && r.GetValueOrDefault("SYMBOL") == symbol &&
                    r.GetValueOrDefault("SIDE") == (action == "Buy" ? "LONG" : "SHORT") && r.GetValueOrDefault("QTY") == "10" && r.GetValueOrDefault("TYPE") == "LIMIT" &&
                    r.GetValueOrDefault("ENTRY") == "3000.25" && r.GetValueOrDefault("CURRENT") == "3005.25" &&
                    r.GetValueOrDefault("STOP") == (action == "Buy" ? "2975.25" : "3025.25") && r.GetValueOrDefault("TARGET") == (action == "Buy" ? "3050.25" : "2950.25"), Dump(r));
            }

        var split = new List<OcrRow> { Row("NQ1!, 10", 40, 150), Row("MNQ1!, 10", 960, 150), Row("Buy 2 Limit x", 500, 450), Row("29,000.25", 820, 450), Row("Sell 8 Limit x", 1440, 500), Row("29,733.75", 1800, 500) };
        var active = Read(split, (1460, 500));
        check("legacy split", active.GetValueOrDefault("SYMBOL") == "MNQ" && active.GetValueOrDefault("QTY") == "8" && active.GetValueOrDefault("SIDE") == "SHORT", Dump(active));

        var live = new List<OcrRow>
        {
            Row("Micro E-mini Dow Jones Industrial Average Index Futures", 940, 90, 720),
            Colored("1 Sell Limit x", 1541, 154, "RED", 154), Colored("52,571", 1778, 150, "RED", 58),
            Colored("1 Sell Stop x", 1546, 573, "RED", 150), Row("52,304", 1778, 573, 58), Colored("52,303", 1778, 593, "RED", 58),
            Colored("1 +69.50 USD x", 1524, 665, "BLUE", 172), Colored("52,244", 1778, 665, "BLUE", 58),
            Row("MYMZ2026", 1695, 449, 77), Colored("52,383", 1778, 449, "BLUE", 58),
        };
        var position = Read(live, (1300, 650));
        check("legacy live MYM", position.GetValueOrDefault("STATUS") == "OPEN" && position.GetValueOrDefault("SYMBOL") == "MYM" && position.GetValueOrDefault("SIDE") == "LONG" &&
            position.GetValueOrDefault("QTY") == "1" && position.GetValueOrDefault("ENTRY") == "52244" && position.GetValueOrDefault("CURRENT") == "52383" &&
            position.GetValueOrDefault("STOP") == "52303" && position.GetValueOrDefault("TARGET") == "52571" && position.GetValueOrDefault("PNL") == "69.5" &&
            position.GetValueOrDefault("TYPE") == "", Dump(position));
        live.RemoveAt(6);
        var noPosition = ExecutionParser.TryBuildExecution(live);
        check("legacy exits alone never fabricate a fill", noPosition is null || !noPosition.Contains("STATUS=OPEN"), noPosition);

        var signedShort = new List<OcrRow>
        {
            Row("NASDAQ 100 E-mini Futures · 5 · CME", 920, 90, 620), Row("NQ1!, 5", 940, 116, 120), Row("Last: 30,609.25", 1000, 138, 140),
            Row("1 -1,175.00 USD x", 1280, 235, 170), Row("30,699.00", 1510, 235, 78),
            Colored("-1 +620.00 USD x", 1280, 390, "RED", 175), Colored("30,640.25", 1510, 390, "RED", 78),
            Row("1 +1,575.00 USD x", 1280, 555, 170), Row("30,562.75", 1510, 555, 78),
        };
        var shortPosition = Read(signedShort, (1350, 390));
        check("legacy signed NQ short", shortPosition.GetValueOrDefault("STATUS") == "OPEN" && shortPosition.GetValueOrDefault("SYMBOL") == "NQ" &&
            shortPosition.GetValueOrDefault("SIDE") == "SHORT" && shortPosition.GetValueOrDefault("QTY") == "1" && shortPosition.GetValueOrDefault("ENTRY") == "30640.25" &&
            shortPosition.GetValueOrDefault("CURRENT") == "30609.25" && shortPosition.GetValueOrDefault("STOP") == "30699" &&
            shortPosition.GetValueOrDefault("TARGET") == "30562.75" && shortPosition.GetValueOrDefault("PNL") == "620", Dump(shortPosition));
    }

    private static Dictionary<string, string> Fields(string canonical) =>
        canonical.Split('|').Skip(1).Select(part => part.Split('=', 2)).Where(p => p.Length == 2).ToDictionary(p => p[0], p => p[1]);

    private static string Dump(Dictionary<string, string> fields) => string.Join("|", fields.Select(kv => kv.Key + "=" + kv.Value));
}
