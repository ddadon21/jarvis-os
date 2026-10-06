using JarvisObserver;

var failures = 0;
var passed = 0;
void Check(string name, bool condition, string? detail = null)
{
    if (condition) { passed++; return; }
    failures++;
    Console.Error.WriteLine($"FAIL {name}{(detail is null ? "" : ": " + detail)}");
}

var t0 = new DateTime(2026, 10, 5, 14, 0, 0, DateTimeKind.Utc);
DateTime T(double seconds) => t0.AddSeconds(seconds);
ExecutionRead R(string line, double s) => ExecutionRead.Parse("JARVIS_OCR_EXECUTION|" + line, T(s))!;

// ---- Parser ----
var parsed = R("STATUS=OPEN|SYMBOL=MNQ|SIDE=LONG|QTY=2|TYPE=|ENTRY=21,000.25|CURRENT=21004.5|STOP=20980|TARGET=21040|PNL=8.5", 0);
Check("parse status", parsed.Status == "OPEN");
Check("parse entry with comma", parsed.Entry == 21000.25);
Check("parse empty type is null", parsed.OrderType is null);
Check("parse pnl", parsed.Pnl == 8.5);
Check("parse rejects garbage", ExecutionRead.Parse("hello", T(0)) is null);
Check("parse multi-line picks execution line", ExecutionRead.Parse("noise\nJARVIS_OCR_EXECUTION|STATUS=FLAT\nmore", T(0))?.Status == "FLAT");

// ---- Full lifecycle ----
var life = new TradeLifecycle { DevicePrefix = "test" };
var events = new List<JournalEvent>();
void Feed(string line, double s) => events.AddRange(life.Observe(R(line, s)));

Feed("STATUS=FLAT", 0);
Feed("STATUS=PREPARING|SYMBOL=MNQ|SIDE=LONG|QTY=2|TYPE=LIMIT|ENTRY=21000|STOP=20980|TARGET=21040", 1);
Check("single preparing read is not confirmed", events.Count == 0);
Feed("STATUS=PREPARING|SYMBOL=MNQ|SIDE=LONG|QTY=2|TYPE=LIMIT|ENTRY=21000|STOP=20980|TARGET=21040", 2);
Check("preparing confirmed after two reads", events.Count == 1 && events[0].Type == "PREPARING", string.Join(",", events.Select(e => e.Type)));
Feed("STATUS=PENDING|SYMBOL=MNQ|SIDE=LONG|QTY=2|TYPE=LIMIT|ENTRY=21000|STOP=20980|TARGET=21040", 3);
Feed("STATUS=PENDING|SYMBOL=MNQ|SIDE=LONG|QTY=2|TYPE=LIMIT|ENTRY=21000|STOP=20980|TARGET=21040", 4);
Check("working order", events.Last().Type == "ORDER_WORKING");
var open = "STATUS=OPEN|SYMBOL=MNQ|SIDE=LONG|QTY=2|ENTRY=21000|CURRENT={0}|STOP={1}|TARGET=21040|PNL={2}";
Feed(string.Format(open, 21001, 20980, 4), 10);
Feed(string.Format(open, 21002, 20980, 8), 11);
Check("entry confirmed", events.Last().Type == "ENTRY" && events.Last().Price == 21000);
Check("trade remembers prep time", life.OpenTrade?.PreparedAt == T(1));
Feed(string.Format(open, 21020, 20980, 80), 20);
Feed(string.Format(open, 20990, 20980, -40), 30);
Feed(string.Format(open, 21010, 21000, 40), 40);
Check("one stop flicker is ignored", !events.Any(e => e.Type == "STOP_MOVED"));
Feed(string.Format(open, 21012, 21000, 48), 41);
Check("stop move confirmed", events.Count(e => e.Type == "STOP_MOVED") == 1 && events.Last().StopPrice == 21000);
Feed(string.Format(open, 21030, 21000, 120), 60);
Feed("STATUS=FLAT", 61);
Check("single flat read does not exit", !events.Any(e => e.Type == "EXIT"));
Feed("STATUS=FLAT", 62);
var exit = events.Last();
Check("exit confirmed", exit.Type == "EXIT");
Check("exit uses last seen price", exit.Price == 21030);
Check("exit reports last observed pnl", Equals(exit.Payload["realizedPnl"], 120d));
Check("mfe tracked", Equals(exit.Payload["mfePrice"], 21030d));
Check("mae tracked", Equals(exit.Payload["maePrice"], 20990d));
Check("initial stop preserved", Equals(exit.Payload["initialStop"], 20980d));
Check("no open trade after exit", life.OpenTrade is null);
Check("all events share one trade id", events.Where(e => e.TradeId is not null).Select(e => e.TradeId).Distinct().Count() == 1);

// ---- Trade note ----
var closedTrade = life.LastClosedTrade!;
var note = TradeNotes.Render(closedTrade, events);
Check("note has frontmatter id", note.Contains($"trade_id: \"{closedTrade.Id}\""));
Check("note R multiple (30 pts / 20 risk = 1.50R)", note.Contains("result_r: 1.5"), note.Split('\n').FirstOrDefault(l => l.StartsWith("result_r")));
Check("note timeline lists stop move", note.Contains("**STOP MOVED** stop → 21000"));
Check("note file name is filesystem safe", !TradeNotes.FileName(closedTrade).Contains(':'));

// ---- Cancel ----
var cancelLife = new TradeLifecycle { DevicePrefix = "test" };
var cancelEvents = new List<JournalEvent>();
foreach (var (line, s) in new[] { ("STATUS=PREPARING|SYMBOL=MNQ|SIDE=SHORT", 0.0), ("STATUS=PREPARING|SYMBOL=MNQ|SIDE=SHORT", 1), ("STATUS=FLAT", 2), ("STATUS=FLAT", 3) })
    cancelEvents.AddRange(cancelLife.Observe(R(line, s)));
Check("cancel recorded", cancelEvents.Select(e => e.Type).SequenceEqual(new[] { "PREPARING", "ORDER_CANCELLED" }), string.Join(",", cancelEvents.Select(e => e.Type)));

// ---- Reversal ----
var rev = new TradeLifecycle { DevicePrefix = "test" };
var revEvents = new List<JournalEvent>();
foreach (var (line, s) in new[] {
    ("STATUS=OPEN|SYMBOL=MNQ|SIDE=LONG|QTY=1|ENTRY=100|CURRENT=101", 0.0), ("STATUS=OPEN|SYMBOL=MNQ|SIDE=LONG|QTY=1|ENTRY=100|CURRENT=101", 1),
    ("STATUS=OPEN|SYMBOL=MNQ|SIDE=SHORT|QTY=1|ENTRY=99|CURRENT=99", 2), ("STATUS=OPEN|SYMBOL=MNQ|SIDE=SHORT|QTY=1|ENTRY=99|CURRENT=98", 3) })
    revEvents.AddRange(rev.Observe(R(line, s)));
Check("reversal closes then opens", revEvents.Select(e => e.Type).SequenceEqual(new[] { "ENTRY", "EXIT", "ENTRY" }), string.Join(",", revEvents.Select(e => e.Type)));

// ---- Outbox ----
var tmp = Path.Combine(Path.GetTempPath(), "jarvis-core-tests-" + Guid.NewGuid().ToString("N"));
var now = t0;
var outbox = new OutboxQueue(Path.Combine(tmp, "outbox"), () => now);
outbox.Enqueue("a", "{\"n\":1}");
now = now.AddMilliseconds(1);
outbox.Enqueue("b", "{\"n\":2}");
outbox.Enqueue("b", "{\"n\":2}");
Check("outbox dedupes ids", outbox.Count == 2);
var due = outbox.TakeDue(10);
Check("outbox fifo", due.Count == 2 && due[0].Json.Contains("1"));
outbox.Fail(new[] { due[0].File });
Check("failed item backs off", outbox.TakeDue(10).Count == 1);
now = now.AddMinutes(10);
Check("failed item retried later", outbox.TakeDue(10).Count == 2);
outbox.Ack(due.Select(d => d.File));
Check("ack removes", outbox.Count == 0);
var reopened = new OutboxQueue(Path.Combine(tmp, "outbox"), () => now);
reopened.Enqueue("c", "{}");
Check("outbox survives restart", new OutboxQueue(Path.Combine(tmp, "outbox"), () => now).Count == 1);

// ---- Frame store ----
var clock = t0.AddMinutes(60);
var frames = new FrameStore(Path.Combine(tmp, "store"), () => clock) { RollingMinutes = 45 };
for (var i = 0; i < 70 * 60; i += 5) frames.Save(new byte[] { 1, 2, 3 }, t0.AddSeconds(i - 600));
frames.Pin(t0.AddMinutes(2));
frames.Cleanup();
var oldest = Directory.GetFiles(frames.RollingDir).Select(FrameStore.ParseTime).Min();
Check("pin keeps pre-entry frames older than the rolling window", oldest is not null && oldest <= t0.AddMinutes(2) && oldest >= t0.AddMinutes(2).AddSeconds(-5), oldest?.ToString("O"));
frames.SetPin(null);
frames.Cleanup();
oldest = Directory.GetFiles(frames.RollingDir).Select(FrameStore.ParseTime).Min();
Check("unpinned rolling window trimmed to 45 min", oldest >= clock.AddMinutes(-45), oldest?.ToString("O"));
Check("context keeps one frame per minute", Directory.GetFiles(frames.ContextDir, "*.jpg", SearchOption.AllDirectories).Length is >= 69 and <= 71);
var bundle = frames.BundleTrade("test:trade/1", clock.AddMinutes(-20), clock.AddMinutes(-5),
    new List<JournalEvent> { new() { Type = "ENTRY", At = clock.AddMinutes(-15) }, new() { Type = "EXIT", At = clock.AddMinutes(-6) } }, "{}");
Check("bundle folder is safe", Path.GetFileName(bundle.Folder) == "test_trade_1");
Check("bundle has key frames", bundle.KeyFrames.Count is > 2 and <= 40, bundle.KeyFrames.Count.ToString());
Check("bundle copied frames", Directory.GetFiles(Path.Combine(bundle.Folder, "frames")).Length > 0);

// ---- Ledger ----
var ledgerPath = Path.Combine(tmp, "ledger.json");
var ledger = new CommandLedger(ledgerPath);
Check("first sighting executes", ledger.TryBegin("cmd1", out _));
Check("second sighting does not", !ledger.TryBegin("cmd1", out var running) && running?.State == "RUNNING");
ledger.Complete("cmd1", "{\"ok\":true}");
var restarted = new CommandLedger(ledgerPath);
Check("ledger survives restart", !restarted.TryBegin("cmd1", out var done) && done?.ResultJson == "{\"ok\":true}");

// ---- Vault bridge ----
var vault = Path.Combine(tmp, "vault");
Directory.CreateDirectory(Path.Combine(vault, ".obsidian"));
Directory.CreateDirectory(Path.Combine(vault, "Trading"));
File.WriteAllText(Path.Combine(vault, "Trading", "plan.md"), "my plan");
File.WriteAllText(Path.Combine(vault, ".obsidian", "app.md"), "config");
Check("unsafe paths rejected", VaultBridge.SafeRelative("../evil.md") is null && VaultBridge.SafeRelative(".obsidian/x.md") is null && VaultBridge.SafeRelative("a/b.txt") is null);
Check("safe path normalized", VaultBridge.SafeRelative("Daily\\2026-10-05.md") == "Daily/2026-10-05.md");
Check("writes changed notes", VaultBridge.WriteManaged(vault, new[] { ("Daily/today.md", "generated v1") }) == 1);
var managed = Path.Combine(vault, "JARVIS", "Daily", "today.md");
Check("managed notes live under JARVIS/", File.Exists(managed));
File.AppendAllText(managed, "\nDwight's own line\n");
Check("unchanged content is not rewritten", VaultBridge.WriteManaged(vault, new[] { ("Daily/today.md", "generated v1") }) == 0);
VaultBridge.WriteManaged(vault, new[] { ("JARVIS/Daily/today.md", "generated v2") });
var text = File.ReadAllText(managed);
Check("regeneration replaces only the marked block", text.Contains("generated v2") && !text.Contains("generated v1") && text.Contains("Dwight's own line"), text);
Check("cannot escape the JARVIS folder", VaultBridge.WriteManaged(vault, new[] { ("../../outside.md", "x") }) == 0 && !File.Exists(Path.Combine(tmp, "outside.md")));
var changedNotes = VaultBridge.ScanChanged(vault, DateTime.MinValue, Array.Empty<string>());
Check("index scan skips .obsidian and JARVIS", changedNotes.Count == 1 && changedNotes[0].Path == "Trading/plan.md", string.Join(",", changedNotes.Select(n => n.Path)));
Check("index scan respects folder allowlist", VaultBridge.ScanChanged(vault, DateTime.MinValue, new[] { "Daily" }).Count == 0);
var tradeNote = TradeNotes.RenderGenerated(closedTrade, events);
Check("generated trade note excludes the review questions", !tradeNote.Contains("Why I took it") && TradeNotes.Template().Contains("Why I took it"));

ReaderTests.Run(Check);

try { Directory.Delete(tmp, true); } catch { }
Console.WriteLine($"Observer core tests: {passed} passed, {failures} failed");
return failures == 0 ? 0 : 1;
