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
Console.WriteLine($"Observer parser: {checks} regression scenarios passed.");
