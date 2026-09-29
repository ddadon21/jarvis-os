using System.Collections;
using System.Drawing;
using System.Reflection;

var parser = Assembly.Load("JarvisObserver").GetType("JarvisObserver.LocalExecutionOcr")!;
var rowType = parser.GetNestedType("OcrRow", BindingFlags.NonPublic)!;
var listType = typeof(List<>).MakeGenericType(rowType);
object Row(string text, double x, double y, double w = 120, double h = 14) => Activator.CreateInstance(rowType, text, x, y, w, h)!;
object? Call(string name, params object?[] args) => parser.GetMethod(name, BindingFlags.NonPublic | BindingFlags.Static)!.Invoke(null, args);
void Equal(string label, string? actual, string expected) { if (actual != expected) throw new Exception($"{label}: expected {expected}, got {actual}"); }
Dictionary<string,string> Read(IList rows, Point pointer) {
    var anchor = Call("FindActiveOrderAnchor", rows, pointer);
    var scoped = Call("ScopeToOrderPane", rows, anchor)!;
    var text = (string?)Call("TryBuildExecution", scoped) ?? (string?)Call("TryBuildPreparation", scoped);
    if (text is null) throw new Exception("No draft recognized");
    return text.Split('|').Skip(1).Select(part => part.Split('=', 2)).ToDictionary(p => p[0], p => p[1]);
}
var checks = 0;
foreach (var symbol in new[] { "NQ", "MNQ", "YM", "MYM", "ES", "MES", "GC", "MGC" }) {
  foreach (var action in new[] { "Buy", "Sell" }) {
    var rows = (IList)Activator.CreateInstance(listType)!;
    rows.Add(Row(symbol + "1!, 10", 40, 150));
    rows.Add(Row("Last: 3,005.25", 40, 180));
    rows.Add(Row(action + " 10 Limit x", 550, 500));
    rows.Add(Row("3,000.25", 820, 500, 70));
    rows.Add(Row("10 - 500.00 USD x", 550, 550));
    rows.Add(Row(action == "Buy" ? "2,975.25" : "3,025.25", 820, 550, 70));
    rows.Add(Row("10 + 1,000.00 USD x", 550, 400));
    rows.Add(Row(action == "Buy" ? "3,050.25" : "2,950.25", 820, 400, 70));
    var result = Read(rows, new Point(600, 500));
    Equal("status", result["STATUS"], "PREPARING");
    Equal("symbol", result["SYMBOL"], symbol);
    Equal("side", result["SIDE"], action == "Buy" ? "LONG" : "SHORT");
    Equal("qty", result["QTY"], "10");
    Equal("type", result["TYPE"], "LIMIT");
    Equal("entry", result["ENTRY"], "3000.25");
    Equal("current", result["CURRENT"], "3005.25");
    Equal("stop", result["STOP"], action == "Buy" ? "2975.25" : "3025.25");
    Equal("target", result["TARGET"], action == "Buy" ? "3050.25" : "2950.25");
    checks++;
  }
}
var split = (IList)Activator.CreateInstance(listType)!;
split.Add(Row("NQ1!, 10", 40, 150));
split.Add(Row("MNQ1!, 10", 960, 150));
split.Add(Row("Buy 2 Limit x", 500, 450));
split.Add(Row("29,000.25", 820, 450));
split.Add(Row("Sell 8 Limit x", 1440, 500));
split.Add(Row("29,733.75", 1800, 500));
var active = Read(split, new Point(1460, 500));
Equal("split symbol", active["SYMBOL"], "MNQ");
Equal("split size", active["QTY"], "8");
Equal("split side", active["SIDE"], "SHORT");
checks++;
// Exact live MYM screenshot: qty-first exits, a profit-protecting stop above
// entry, and a neutral indicator at 52,304 next to the red stop at 52,303.
object Colored(string text, double x, double y, string color, double w = 120) {
    var row = Row(text, x, y, w);
    rowType.GetProperty("MarkerColor")!.SetValue(row, color);
    return row;
}
var live = (IList)Activator.CreateInstance(listType)!;
live.Add(Row("Micro E-mini Dow Jones Industrial Average Index Futures", 940, 90, 720));
live.Add(Colored("1 Sell Limit x", 1541, 154, "RED", 154));
live.Add(Colored("52,571", 1778, 150, "RED", 58));
live.Add(Colored("1 Sell Stop x", 1546, 573, "RED", 150));
live.Add(Row("52,304", 1778, 573, 58));
live.Add(Colored("52,303", 1778, 593, "RED", 58));
live.Add(Colored("1 +69.50 USD x", 1524, 665, "BLUE", 172));
live.Add(Colored("52,244", 1778, 665, "BLUE", 58));
live.Add(Row("MYMZ2026", 1695, 449, 77));
live.Add(Colored("52,383", 1778, 449, "BLUE", 58));
var position = Read(live, new Point(1300, 650));
Equal("live status", position["STATUS"], "OPEN");
Equal("live symbol", position["SYMBOL"], "MYM");
Equal("live side", position["SIDE"], "LONG");
Equal("live qty", position["QTY"], "1");
Equal("live entry", position["ENTRY"], "52244");
Equal("live current", position["CURRENT"], "52383");
Equal("live stop", position["STOP"], "52303");
Equal("live target", position["TARGET"], "52571");
Equal("live pnl", position["PNL"], "69.5");
Equal("entry type not inferred from exit", position["TYPE"], "");
checks++;
// Exit orders without the position row never prove an open position.
live.RemoveAt(6);
var noPosition = Call("TryBuildExecution", live);
if (noPosition is string unsafeRead && unsafeRead.Contains("STATUS=OPEN")) throw new Exception("Exit orders fabricated a fill");
checks++;

// Exact NQ chart-position layout: the filled short position uses a signed
// quantity while the stop/target chips only show projected USD loss/profit.
var signedShort = (IList)Activator.CreateInstance(listType)!;
signedShort.Add(Row("NASDAQ 100 E-mini Futures · 5 · CME", 920, 90, 620));
signedShort.Add(Row("NQ1!, 5", 940, 116, 120));
signedShort.Add(Row("Last: 30,609.25", 1000, 138, 140));
signedShort.Add(Row("1 -1,175.00 USD x", 1280, 235, 170));
signedShort.Add(Row("30,699.00", 1510, 235, 78));
signedShort.Add(Colored("-1 +620.00 USD x", 1280, 390, "RED", 175));
signedShort.Add(Colored("30,640.25", 1510, 390, "RED", 78));
signedShort.Add(Row("1 +1,575.00 USD x", 1280, 555, 170));
signedShort.Add(Row("30,562.75", 1510, 555, 78));
var shortPosition = Read(signedShort, new Point(1350, 390));
Equal("signed short status", shortPosition["STATUS"], "OPEN");
Equal("signed short symbol", shortPosition["SYMBOL"], "NQ");
Equal("signed short side", shortPosition["SIDE"], "SHORT");
Equal("signed short qty", shortPosition["QTY"], "1");
Equal("signed short entry", shortPosition["ENTRY"], "30640.25");
Equal("signed short current", shortPosition["CURRENT"], "30609.25");
Equal("signed short stop", shortPosition["STOP"], "30699");
Equal("signed short target", shortPosition["TARGET"], "30562.75");
Equal("signed short pnl", shortPosition["PNL"], "620");
checks++;

Console.WriteLine($"Observer parser: {checks} regression scenarios passed.");
