using System.Diagnostics;
using System.Drawing.Imaging;
using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using FlaUI.Core.AutomationElements;
using FlaUI.UIA3;

namespace JarvisObserver;

// Local Agent release: see ObserverInfo.Version — Trading Observer + trade journal + Obsidian + Desktop Action Runtime

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new ObserverContext());
    }
}

internal static class ObserverInfo
{
    public const string Version = "1.1.0";
}

internal sealed class ObserverContext : ApplicationContext
{
    private readonly NotifyIcon _tray;
    private readonly System.Threading.Timer _captureTimer;
    private readonly System.Threading.Timer _controlTimer;
    private readonly System.Threading.Timer _semanticTimer;
    private readonly System.Threading.Timer _syncTimer;
    private readonly System.Threading.Timer _vaultTimer;
    private int _vaultBusy;
    private readonly LocalExecutionOcr _executionOcr = new();
    private readonly HttpClient _http = CreateHttpClient();
    private readonly UIA3Automation _automation = new();
    private readonly Control _uiInvoker = new();
    private readonly DesktopActionRuntime _desktopRuntime;
    private readonly string[] _agentCapabilities;
    private readonly FrameStore _frames;
    private readonly TradeLifecycle _lifecycle;
    private readonly TradeJournalStore _journal;
    private readonly OutboxQueue _eventOutbox;
    private readonly OutboxQueue _frameOutbox;
    private readonly CommandLedger _ledger;
    private readonly object _journalGate = new();
    private readonly List<JournalEvent> _currentTradeEvents = new();
    private readonly List<PendingBundle> _pendingBundles = new();
    private volatile bool _localPaused;
    private int _syncBusy;
    private DateTime _lastCleanupUtc = DateTime.MinValue;
    private DateTime _lastOcrStartUtc = DateTime.MinValue;
    private IntPtr _cachedWindow;
    private DateTime _lastWindowScanUtc = DateTime.MinValue;
    private readonly PhaseTracker _phase = new();
    private readonly ObserverDiagnostics _diagnostics = new();
    private ObserverHud? _hud;
    private DateTime _lastDiagnosticsSavedUtc = DateTime.MinValue;
    private DateTime _lastDiagnosticsUploadUtc = DateTime.MinValue;

    private sealed record PendingBundle(JournalTrade Trade, List<JournalEvent> Events, DateTime DueAt);

    /// <summary>Local recording never depends on the cloud link unless the owner chose FOLLOW_CLOUD.</summary>
    private bool RecordingActive => !_localPaused && (!string.Equals(_config.LocalRecordingMode, "FOLLOW_CLOUD", StringComparison.OrdinalIgnoreCase) || !_paused);
    private readonly string _root;
    private readonly string _configPath;
    private ObserverConfig _config;
    private int _captureBusy;
    private int _controlBusy;
    private int _semanticBusy;
    private int _ocrBusy;
    private int _semanticChangedPending;
    private volatile bool _paused = true;
    private volatile bool _tradingViewDetected;
    private DateTime _lastSentUtc = DateTime.MinValue;
    private DateTime _lastSavedUtc = DateTime.MinValue;
    private DateTime _lastEventSavedUtc = DateTime.MinValue;
    private DateTime _lastSemanticPollUtc = DateTime.MinValue;
    private DateTime _lastControlPollUtc = DateTime.MinValue;
    private DateTime _lastPairAttemptUtc = DateTime.MinValue;
    private string? _pairDialogShownForCode;
    private bool _deploymentAccessPrimed;
    private string? _latestSemanticText;
    private string? _lastSemanticHash;
    private string? _latestOcrText;
    private DateTime _latestOcrAt;
    private DateTime _latestSemanticAt;
    private string? _lastOcrHash;
    private string? _richExecutionSemanticText;
    private DateTime _richExecutionSemanticAt = DateTime.MinValue;
    private byte[]? _lastSignature;
    private string? _sessionDir;
    private int _frameNumber;

    // Cloud interpretation must never block the 500ms local observation loop.
    // Keep only the newest pending frame while one cloud request is in flight.
    private readonly object _cloudQueueGate = new();
    private readonly object _logGate = new();
    private readonly object _configGate = new();
    private readonly object _semanticGate = new();
    private byte[]? _pendingCloudFrame;
    private DateTime _pendingCloudAt;
    private double _pendingCloudDifference;
    private string? _pendingCloudSemanticText;
    private bool _cloudUploadWorkerRunning;

    public ObserverContext()
    {
        _root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "JarvisObserver");
        Directory.CreateDirectory(_root);
        _configPath = Path.Combine(_root, "config.json");
        _config = ObserverConfig.Load(_configPath);
        _uiInvoker.CreateControl();
        _desktopRuntime = new DesktopActionRuntime(_automation, _uiInvoker);
        _agentCapabilities = DetectAgentCapabilities();
        ImportLocalSecretsIfPresent();
        NormalizeServerUrl();
        NormalizeObsidianConfig();
        NormalizePerformanceConfig();
        SaveConfig();
        _frames = new FrameStore(_root) { RollingMinutes = _config.RollingMinutes, RetentionDays = _config.RetentionDays };
        _journal = new TradeJournalStore(_root);
        _lifecycle = new TradeLifecycle { DevicePrefix = "obs-" + _config.InstallId };
        _eventOutbox = new OutboxQueue(Path.Combine(_root, "outbox", "events"));
        _frameOutbox = new OutboxQueue(Path.Combine(_root, "outbox", "frames"));
        _ledger = new CommandLedger(Path.Combine(_root, "command-ledger.json"));

        var menu = new ContextMenuStrip();
        menu.Items.Add("Open observer folder", null, (_, _) => OpenFolder(_root));
        menu.Items.Add("Show / New pairing code", null, async (_, _) => await ShowOrCreatePairingCodeAsync());
        menu.Items.Add("Set / replace Vercel access key", null, (_, _) => PromptAndStoreVercelBypassSecret(showSuccess: true));
        menu.Items.Add("Set JARVIS server address", null, (_, _) => PromptServerUrl());
        menu.Items.Add("Open trade journal folder", null, (_, _) => OpenFolder(Path.Combine(_root, "trades")));
        menu.Items.Add("Obsidian: Choose vault folder (direct sync)", null, (_, _) => ChooseVaultFolder());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Obsidian: Set / replace API key", null, (_, _) => PromptAndStoreObsidianApiKey(showSuccess: true));
        menu.Items.Add("Obsidian: Test connection", null, async (_, _) => await TestObsidianConnectionAsync(showSuccess: true));
        menu.Items.Add("Obsidian: Write Local Agent test note", null, async (_, _) => await WriteObsidianAgentTestNoteAsync(showSuccess: true));
        menu.Items.Add("Pause / Resume local recording", null, (_, _) => TogglePause());
        menu.Items.Add("Show / Hide Observer HUD (Ctrl+Alt+J)", null, (_, _) => ToggleHud());
        menu.Items.Add("Open Observer diagnostics", null, (_, _) => OpenFolder(Path.Combine(_root, "diagnostics")));
        menu.Items.Add("Open config", null, (_, _) => OpenFile(_configPath));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => ExitThread());

        _tray = new NotifyIcon
        {
            Icon = SystemIcons.Shield,
            Text = "JARVIS Local Agent — standby",
            Visible = true,
            ContextMenuStrip = menu,
        };

        EnsureConfigExists();
        _hud = new ObserverHud(new Point(_config.HudX, _config.HudY), OpenJarvisTrading, location =>
        {
            lock (_configGate) { _config.HudX = location.X; _config.HudY = location.Y; }
            SaveConfig();
        });
        _hud.ToggleRequested += ToggleHud;
        _ = _hud.Handle; // registers the global hotkeys even while hidden
        if (_config.HudEnabled) _hud.Show();
        Log(new { type = "observer.started", at = DateTime.UtcNow, version = ObserverInfo.Version, mode = _config.CloudEnabled ? "CLOUD" : "PAIRING" });
        _ = Task.Run(async () =>
        {
            await Task.Delay(1200);
            if (!string.IsNullOrWhiteSpace(GetObsidianApiKey()))
            {
                await TestObsidianConnectionAsync(showSuccess: false);
            }
        });
        _captureTimer = new System.Threading.Timer(async _ => await TickAsync(), null, TimeSpan.Zero, TimeSpan.FromMilliseconds(500));
        _controlTimer = new System.Threading.Timer(async _ => await ControlTickAsync(), null, TimeSpan.Zero, TimeSpan.FromMilliseconds(500));
        _semanticTimer = new System.Threading.Timer(async _ => await SemanticTickAsync(), null, TimeSpan.Zero, TimeSpan.FromMilliseconds(_config.SemanticPollMs));
        _syncTimer = new System.Threading.Timer(async _ => await SyncTickAsync(), null, TimeSpan.FromSeconds(3), TimeSpan.FromSeconds(3));
        _vaultTimer = new System.Threading.Timer(async _ => await VaultTickAsync(), null, TimeSpan.FromSeconds(30), TimeSpan.FromMinutes(10));
        Log(new { type = "observer.local_ocr", at = DateTime.UtcNow, available = _executionOcr.Available });
    }

    protected override void ExitThreadCore()
    {
        _captureTimer.Dispose();
        _controlTimer.Dispose();
        _semanticTimer.Dispose();
        _syncTimer.Dispose();
        _vaultTimer.Dispose();
        _hud?.Dispose();
        _tray.Visible = false;
        _tray.Dispose();
        _http.Dispose();
        _automation.Dispose();
        _uiInvoker.Dispose();
        base.ExitThreadCore();
    }

    private async Task ControlTickAsync()
    {
        if (Interlocked.Exchange(ref _controlBusy, 1) == 1) return;
        try
        {
            await EnsurePairingAndControlAsync();
        }
        catch (Exception ex)
        {
            LogRateLimited("control.tick.error:" + ex.GetType().Name, TimeSpan.FromSeconds(15));
        }
        finally
        {
            Volatile.Write(ref _controlBusy, 0);
        }
    }

    private Task SemanticTickAsync()
    {
        if (Interlocked.Exchange(ref _semanticBusy, 1) == 1) return Task.CompletedTask;
        try
        {
            if (!RecordingActive) return Task.CompletedTask;

            var target = TradingViewWindow();
            if (target == IntPtr.Zero) return Task.CompletedTask;

            var now = DateTime.UtcNow;
            var semantic = CaptureAccessibleText(target, _config.MaxSemanticChars);
            if (string.IsNullOrWhiteSpace(semantic)) return Task.CompletedTask;

            var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(semantic)));
            var changed = false;

            lock (_semanticGate)
            {
                _latestSemanticText = semantic;
                _latestSemanticAt = now;
                if (IsRichExecutionSemantic(semantic))
                {
                    _richExecutionSemanticText = semantic;
                    _richExecutionSemanticAt = now;
                }

                if (!string.Equals(hash, _lastSemanticHash, StringComparison.Ordinal))
                {
                    _lastSemanticHash = hash;
                    changed = true;
                }
            }

            if (changed)
            {
                Interlocked.Exchange(ref _semanticChangedPending, 1);
                SaveSemanticSnapshot(semantic, now, hash);
            }
        }
        catch (Exception ex)
        {
            LogRateLimited("semantic.tick.error:" + ex.GetType().Name, TimeSpan.FromSeconds(15));
        }
        finally
        {
            Volatile.Write(ref _semanticBusy, 0);
        }

        return Task.CompletedTask;
    }

    /// <summary>OCR runs on a clone of the frame TickAsync already captured (one capture per cycle).</summary>
    private async Task RunOcrAsync(Bitmap frame, IntPtr target)
    {
        try
        {
            Point? pointer = null;
            if (GetCursorPos(out var cursor) && GetWindowRect(target, out var rect))
                pointer = new Point(cursor.X - rect.Left, cursor.Y - rect.Top);
            var titleSymbol = InstrumentCatalog.FromWindowTitle(WindowTitle(target));
            var watch = Stopwatch.StartNew();
            var ocr = await _executionOcr.ReadAsync(frame, pointer, titleSymbol);
            var readMs = watch.Elapsed.TotalMilliseconds;
            if (string.IsNullOrWhiteSpace(ocr)) return;
            var readAt = DateTime.UtcNow;

            var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(ocr)));
            var changed = false;
            lock (_semanticGate)
            {
                _latestOcrText = ocr;
                _latestOcrAt = readAt;
                if (!string.Equals(hash, _lastOcrHash, StringComparison.Ordinal))
                {
                    _lastOcrHash = hash;
                    changed = true;
                }

                if (
                    ocr.Contains("JARVIS_OCR_EXECUTION|STATUS=PENDING", StringComparison.OrdinalIgnoreCase) ||
                    ocr.Contains("JARVIS_OCR_EXECUTION|STATUS=OPEN", StringComparison.OrdinalIgnoreCase) ||
                    ocr.Contains("JARVIS_OCR_EXECUTION|STATUS=PREPARING", StringComparison.OrdinalIgnoreCase))
                {
                    _richExecutionSemanticText = ocr;
                    _richExecutionSemanticAt = readAt;
                }
                else if (ocr.Contains("JARVIS_OCR_EXECUTION|STATUS=FLAT", StringComparison.OrdinalIgnoreCase))
                {
                    // Clean OCR scans with no chart order are stronger than a stale accessibility
                    // snapshot. Drop the old pending hold so cancel returns Jarvis to WAITING.
                    _richExecutionSemanticText = null;
                    _richExecutionSemanticAt = DateTime.MinValue;
                }
            }

            ObserveExecution(ocr, readAt, readMs, titleSymbol);

            if (changed)
            {
                Interlocked.Exchange(ref _semanticChangedPending, 1);
                LogRateLimited("observer.ocr.changed", TimeSpan.FromSeconds(1));
            }
        }
        catch (Exception ex)
        {
            LogRateLimited("ocr.tick.error:" + ex.GetType().Name, TimeSpan.FromSeconds(15));
        }
        finally
        {
            frame.Dispose();
            Volatile.Write(ref _ocrBusy, 0);
        }
    }

    /// <summary>Feeds the local trade journal. Works fully offline; events sync later.</summary>
    private void ObserveExecution(string ocr, DateTime at, double readMs, string? titleSymbol)
    {
        var read = ExecutionRead.Parse(ocr, at);
        List<JournalEvent> events;
        PhaseTransition? transition;
        lock (_journalGate)
        {
            _diagnostics.RecordRead(read, readMs, titleSymbol, at);
            if (read is null)
            {
                transition = _phase.Tick(_lifecycle.ConfirmedStatus, at);
                if (transition is not null) RecordPhase(transition);
                _hud?.Render(_phase.Phase, _phase.LastRead, at);
                return;
            }
            events = _lifecycle.Observe(read);
            foreach (var item in events)
            {
                if (item.Type == "ENTRY") _diagnostics.RecordFill(item.Symbol, item.At, at);
                if (item.Type == "EXIT" && _lifecycle.LastClosedTrade is { } exited) _diagnostics.RecordExit(exited.Symbol, exited.OpenedAt, item.At);
            }
            transition = _phase.Update(read, _lifecycle.ConfirmedStatus, at);
            if (transition is not null) RecordPhase(transition);
            _hud?.Render(_phase.Phase, read, at);
            foreach (var item in events)
            {
                if (item.Type == "ORDER_CANCELLED")
                {
                    _currentTradeEvents.Clear();
                    continue;
                }
                _currentTradeEvents.Add(item);
                if (item.Type == "EXIT" && _lifecycle.LastClosedTrade is { } closed)
                {
                    var tradeEvents = _currentTradeEvents.Where(e => e.TradeId == null || e.TradeId == closed.Id).ToList();
                    _pendingBundles.Add(new PendingBundle(closed, tradeEvents, item.At.AddMinutes(5)));
                    _journal.SaveTrade(closed);
                    _currentTradeEvents.Clear();
                }
            }
        }
        if (events.Count == 0) return;
        _journal.Append(events);
        foreach (var item in events)
        {
            _eventOutbox.Enqueue(item.Id, JsonSerializer.Serialize(item, TradeJournalStore.Json));
            Log(new { type = "journal." + item.Type.ToLowerInvariant(), at = item.At, tradeId = item.TradeId, item.Symbol, item.Side, item.Quantity, item.Price, item.StopPrice, item.TargetPrice });
        }
        if (events.Any(e => e.Type == "ENTRY"))
            _tray.ShowBalloonTip(1800, "JARVIS TRADE JOURNAL", "Entry recorded. The setup before it is being kept.", ToolTipIcon.Info);
    }

    /// <summary>Caller holds _journalGate.</summary>
    private void RecordPhase(PhaseTransition transition)
    {
        _diagnostics.RecordTransition(transition);
        try
        {
            var dir = Path.Combine(_root, "diagnostics");
            Directory.CreateDirectory(dir);
            File.AppendAllText(Path.Combine(dir, $"transitions-{transition.DetectedAt.ToLocalTime():yyyy-MM-dd}.jsonl"), JsonSerializer.Serialize(new
            {
                from = transition.From,
                to = transition.To,
                at = transition.At,
                detectedAt = transition.DetectedAt,
                symbol = transition.Symbol,
            }) + Environment.NewLine);
        }
        catch (IOException) { }
        Log(new { type = "observer.phase", from = transition.From, to = transition.To, at = transition.At, transition.Symbol });
    }

    /// <summary>Writes the day's diagnostics locally every minute and uploads them every five minutes (latest wins).</summary>
    private async Task DiagnosticsTickAsync(DateTime now)
    {
        if (now - _lastDiagnosticsSavedUtc < TimeSpan.FromMinutes(1)) return;
        _lastDiagnosticsSavedUtc = now;
        DiagnosticsSnapshot snapshot;
        lock (_journalGate) snapshot = _diagnostics.Snapshot(ObserverInfo.Version, now);
        var json = JsonSerializer.Serialize(snapshot);
        try
        {
            var dir = Path.Combine(_root, "diagnostics");
            Directory.CreateDirectory(dir);
            File.WriteAllText(Path.Combine(dir, $"summary-{snapshot.Day}.json"), json);
        }
        catch (IOException) { }

        if (now - _lastDiagnosticsUploadUtc < TimeSpan.FromMinutes(5) || !_config.CloudEnabled) return;
        _lastDiagnosticsUploadUtc = now;
        try
        {
            using var response = await PostDeviceJsonAsync("/api/trading/observer-diagnostics", json, TimeSpan.FromSeconds(15));
            if (response is null || !response.IsSuccessStatusCode) _lastDiagnosticsUploadUtc = now - TimeSpan.FromMinutes(4);
        }
        catch (Exception ex)
        {
            LogRateLimited("diagnostics.upload.error:" + ex.GetType().Name, TimeSpan.FromMinutes(5));
        }
    }

    private async Task TickAsync()
    {
        if (Interlocked.Exchange(ref _captureBusy, 1) == 1) return;
        try
        {
            if (!RecordingActive) return;

            var target = TradingViewWindow();
            if (target == IntPtr.Zero)
            {
                // Minimized is not closed: keep the session and journal state.
                if (_tradingViewDetected && TradingViewRunning()) return;
                if (_tradingViewDetected)
                {
                    _tradingViewDetected = false;
                    _tray.Text = "JARVIS Local Agent — standby";
                    Log(new { type = "tradingview.closed", at = DateTime.UtcNow });
                }
                return;
            }

            if (!_tradingViewDetected)
            {
                _tradingViewDetected = true;
                BeginSession();
                _tray.Text = "JARVIS Local Agent — ACTIVE";
                _tray.ShowBalloonTip(2500, "JARVIS TRADING OBSERVER", "TradingView detected. Read-only observation is active.", ToolTipIcon.Info);
                Log(new { type = "tradingview.detected", at = DateTime.UtcNow });
            }

            using var frame = CaptureWindow(target);
            if (frame is null)
            {
                LogRateLimited("capture.unavailable", TimeSpan.FromSeconds(30));
                return;
            }

            var now = DateTime.UtcNow;
            if (_executionOcr.Available &&
                now - _lastOcrStartUtc >= TimeSpan.FromMilliseconds(650) &&
                Interlocked.CompareExchange(ref _ocrBusy, 1, 0) == 0)
            {
                _lastOcrStartUtc = now;
                var clone = (Bitmap)frame.Clone();
                _ = Task.Run(() => RunOcrAsync(clone, target));
            }

            var signature = BuildSignature(frame);
            var difference = _lastSignature is null ? 1d : SignatureDifference(_lastSignature, signature);
            _lastSignature = signature;

            var meaningfulVisualChange = difference >= _config.VisualChangeThreshold;
            var heartbeatDue = now - _lastSentUtc >= TimeSpan.FromSeconds(_config.HeartbeatSeconds);
            var semanticChangeDue = Volatile.Read(ref _semanticChangedPending) == 1;
            if (!meaningfulVisualChange && !heartbeatDue && !semanticChangeDue) return;

            var jpg = EncodeJpeg(frame, _config.JpegQuality);
            var eventSaveDue = meaningfulVisualChange && now - _lastEventSavedUtc >= TimeSpan.FromMilliseconds(_config.MinimumLocalEventIntervalMs);
            var snapshotDue = now - _lastSavedUtc >= TimeSpan.FromSeconds(_config.LocalSnapshotSeconds);
            if (eventSaveDue || snapshotDue)
            {
                SaveFrame(jpg, now, difference);
                _lastSavedUtc = now;
                if (eventSaveDue) _lastEventSavedUtc = now;
            }

            if (_config.CloudEnabled && !_paused && now - _lastSentUtc >= TimeSpan.FromMilliseconds(_config.MinimumCloudIntervalMs))
            {
                var semanticForUpload = GetSemanticForUpload(now);
                QueueCloudFrame(jpg, now, difference, semanticForUpload);
                _lastSentUtc = now;
                Interlocked.Exchange(ref _semanticChangedPending, 0);
            }
        }
        catch (Exception ex)
        {
            Log(new { type = "observer.error", at = DateTime.UtcNow, error = ex.Message });
        }
        finally
        {
            Volatile.Write(ref _captureBusy, 0);
        }
    }

    private void BeginSession()
    {
        var stamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss");
        _sessionDir = Path.Combine(_root, "sessions", stamp);
        Directory.CreateDirectory(_sessionDir);
        _frameNumber = 0;
        _lastSignature = null;
        _lastSentUtc = DateTime.MinValue;
        _lastSavedUtc = DateTime.MinValue;
        _lastEventSavedUtc = DateTime.MinValue;
        _lastSemanticPollUtc = DateTime.MinValue;
        lock (_semanticGate)
        {
            _latestSemanticText = null;
            _lastSemanticHash = null;
            _latestOcrText = null;
            _lastOcrHash = null;
            _richExecutionSemanticText = null;
            _richExecutionSemanticAt = DateTime.MinValue;
        }
        Interlocked.Exchange(ref _semanticChangedPending, 0);
    }

    private void SaveFrame(byte[] jpg, DateTime at, double difference)
    {
        if (_sessionDir is null) return;
        _frameNumber++;
        var path = _frames.Save(jpg, at);
        File.AppendAllText(Path.Combine(_sessionDir, "frames.jsonl"), JsonSerializer.Serialize(new
        {
            frame = _frameNumber,
            at,
            visualDifference = Math.Round(difference, 5),
            file = path,
        }) + Environment.NewLine);
    }

    private string? GetSemanticForUpload(DateTime now)
    {
        lock (_semanticGate)
        {
            var parts = new List<string>();
            // Fresh accessibility values come before verbose OCR coordinates. Previously
            // OCR plus a retained copy could consume the entire upload budget, truncating
            // the exact Buy/qty/type/price values at the end of the payload.
            var ocrFresh = now - _latestOcrAt <= TimeSpan.FromSeconds(4);
            if (ocrFresh && !string.IsNullOrWhiteSpace(_latestOcrText))
                parts.AddRange(_latestOcrText.Split('\n').Where(line => line.StartsWith("JARVIS_OCR_EXECUTION|")));
            if (now - _latestSemanticAt <= TimeSpan.FromSeconds(4) && !string.IsNullOrWhiteSpace(_latestSemanticText))
                parts.Add(_latestSemanticText);
            if (ocrFresh && !string.IsNullOrWhiteSpace(_latestOcrText))
                parts.AddRange(_latestOcrText.Split('\n').Where(line => !line.StartsWith("JARVIS_OCR_EXECUTION|")));
            // Never append a second old snapshot: it may describe another pane or order.
            return parts.Count == 0 ? null : string.Join(Environment.NewLine, parts);
        }
    }

    private static bool IsRichExecutionSemantic(string semantic)
    {
        if (Regex.IsMatch(semantic, @"JARVIS_OCR_EXECUTION\|STATUS=(?:PREPARING|PENDING|OPEN)", RegexOptions.IgnoreCase)) return true;
        if (semantic.Contains("Cancel project order", StringComparison.OrdinalIgnoreCase)) return true;
        return Regex.IsMatch(
            semantic,
            @"\b(Buy|Sell)\s+\d+(?:\.\d+)?\s+[A-Z]{1,8}[A-Z0-9!]{0,10}\s+@\s+[\d,]+(?:\.\d+)?\s+(limit|stop|market)\b",
            RegexOptions.IgnoreCase);
    }

    private void SaveSemanticSnapshot(string semantic, DateTime at, string hash)
    {
        if (_sessionDir is null) return;
        var safe = SanitizeSensitive(semantic);
        var row = JsonSerializer.Serialize(new
        {
            at,
            hash,
            chars = safe.Length,
            text = safe,
        });
        File.AppendAllText(Path.Combine(_sessionDir, "semantic.jsonl"), row + Environment.NewLine);
        File.WriteAllText(Path.Combine(_sessionDir, "semantic-latest.txt"), safe);
        Log(new { type = "semantic.changed", at, hash = hash[..Math.Min(12, hash.Length)], chars = safe.Length });
    }

    private void QueueCloudFrame(byte[] jpg, DateTime at, double difference, string? semanticText)
    {
        lock (_cloudQueueGate)
        {
            // Latest-frame-wins: if vision is still processing an older frame, replace
            // any queued intermediate frame with the newest state of TradingView.
            _pendingCloudFrame = jpg;
            _pendingCloudAt = at;
            _pendingCloudDifference = difference;
            _pendingCloudSemanticText = semanticText;

            if (_cloudUploadWorkerRunning) return;
            _cloudUploadWorkerRunning = true;
        }

        _ = DrainCloudQueueAsync();
    }

    private async Task DrainCloudQueueAsync()
    {
        while (true)
        {
            byte[]? frame;
            DateTime at;
            double difference;
            string? semanticText;

            lock (_cloudQueueGate)
            {
                if (_pendingCloudFrame is null)
                {
                    _cloudUploadWorkerRunning = false;
                    return;
                }

                frame = _pendingCloudFrame;
                at = _pendingCloudAt;
                difference = _pendingCloudDifference;
                semanticText = _pendingCloudSemanticText;

                _pendingCloudFrame = null;
                _pendingCloudSemanticText = null;
            }

            try
            {
                await UploadFrameAsync(frame, at, difference, semanticText);
            }
            catch (Exception ex)
            {
                Log(new { type = "cloud.upload.error", at = DateTime.UtcNow, error = ex.Message });
            }
        }
    }

    private async Task UploadFrameAsync(byte[] jpg, DateTime at, double difference, string? semanticText)
    {
        var endpoint = _config.ServerUrl!.TrimEnd('/') + "/api/trading/observe-frame";
        var body = JsonSerializer.Serialize(new
        {
            capturedAt = at,
            imageBase64 = Convert.ToBase64String(jpg),
            visualDifference = difference,
            source = "TradingView Desktop",
            observerVersion = ObserverInfo.Version,
            semanticText = string.IsNullOrWhiteSpace(semanticText) ? null : SanitizeSensitive(semanticText),
        });

        using var req = new HttpRequestMessage(HttpMethod.Post, endpoint);
        ApplyVercelBypassHeaders(req);
        var bearer = !string.IsNullOrWhiteSpace(_config.DeviceToken) ? _config.DeviceToken : _config.TradingSecret;
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        if (!string.IsNullOrWhiteSpace(_config.DeviceId))
        {
            req.Headers.Add("x-jarvis-device-id", _config.DeviceId);
            req.Headers.Add("x-jarvis-observer-version", ObserverInfo.Version);
            req.Headers.Add("x-jarvis-capabilities", string.Join(",", _agentCapabilities));
        }
        req.Content = new StringContent(body, Encoding.UTF8, "application/json");
        using var res = await _http.SendAsync(req);
        var responseText = await res.Content.ReadAsStringAsync();
        Log(new
        {
            type = "cloud.frame",
            at,
            status = (int)res.StatusCode,
            accepted = res.IsSuccessStatusCode,
            response = responseText.Length > 500 ? responseText[..500] : responseText,
        });

        if (res.IsSuccessStatusCode)
        {
            try { File.WriteAllText(Path.Combine(_root, "live-state.json"), responseText); } catch { }
        }

        if (!res.IsSuccessStatusCode && (int)res.StatusCode is 401 or 503)
        {
            _tray.ShowBalloonTip(3500, "Jarvis cloud link", "Observer is still recording locally, but the secure cloud link is not paired yet.", ToolTipIcon.Warning);
        }
    }

    private async Task EnsurePairingAndControlAsync()
    {
        if (!Uri.TryCreate(_config.ServerUrl, UriKind.Absolute, out _)) return;
        if (string.IsNullOrWhiteSpace(GetVercelBypassSecret())) return;

        var now = DateTime.UtcNow;
        if (string.IsNullOrWhiteSpace(_config.DeviceId) || string.IsNullOrWhiteSpace(_config.DeviceToken))
        {
            if (now - _lastPairAttemptUtc >= TimeSpan.FromSeconds(8))
            {
                _lastPairAttemptUtc = now;
                await RequestPairingAsync();
            }
            return;
        }

        // A device token exists before the human confirms the one-time code.
        // Keep polling control so confirmation is detected immediately, but treat a
        // pre-confirmation 401 as "still pending" rather than invalid credentials.
        var pairingStillPending =
            !string.IsNullOrWhiteSpace(_config.PairingCode) &&
            DateTime.TryParse(_config.PairingExpiresAt, out var pendingExpiry) &&
            pendingExpiry.ToUniversalTime() > now;

        if (now - _lastControlPollUtc < TimeSpan.FromSeconds(2)) return;
        _lastControlPollUtc = now;

        try
        {
            var endpoint = _config.ServerUrl!.TrimEnd('/') + "/api/trading/device/control";
            using var req = new HttpRequestMessage(HttpMethod.Get, endpoint);
            ApplyVercelBypassHeaders(req);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _config.DeviceToken);
            req.Headers.Add("x-jarvis-device-id", _config.DeviceId);
            req.Headers.Add("x-jarvis-observer-version", ObserverInfo.Version);
            req.Headers.Add("x-jarvis-capabilities", string.Join(",", _agentCapabilities));
            using var controlCts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            using var res = await _http.SendAsync(req, controlCts.Token);

            if ((int)res.StatusCode == 401)
            {
                if (pairingStillPending)
                {
                    LogRateLimited("observer.pairing_waiting_confirmation", TimeSpan.FromSeconds(10));
                    return;
                }

                Log(new { type = "observer.pairing_invalid", at = DateTime.UtcNow });
                ClearPairingState();
                if (DateTime.UtcNow - _lastPairAttemptUtc >= TimeSpan.FromSeconds(3))
                {
                    _lastPairAttemptUtc = DateTime.UtcNow;
                    await RequestPairingAsync(forceNew: true);
                }
                return;
            }

            if (!res.IsSuccessStatusCode) return;

            var json = await res.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(json);
            var link = doc.RootElement.GetProperty("link");
            var command = link.TryGetProperty("command", out var commandNode) ? commandNode.GetString() : "PAUSE";

            if (link.TryGetProperty("obsidianCommand", out var obsidianCommandNode) &&
                obsidianCommandNode.ValueKind == JsonValueKind.Object)
            {
                await HandleObsidianCommandAsync(obsidianCommandNode);
            }

            if (link.TryGetProperty("desktopCommand", out var desktopCommandNode) &&
                desktopCommandNode.ValueKind == JsonValueKind.Object)
            {
                await HandleDesktopCommandAsync(desktopCommandNode);
            }

            var nextPaused = !string.Equals(command, "WATCH", StringComparison.OrdinalIgnoreCase);
            if (_paused != nextPaused)
            {
                _paused = nextPaused;
                Log(new { type = _paused ? "observer.remote_paused" : "observer.remote_watch", at = DateTime.UtcNow });
            }

            if (!string.IsNullOrWhiteSpace(_config.PairingCode))
            {
                _config.PairingCode = null;
                _config.PairingExpiresAt = null;
                SaveConfig();
                try
                {
                    var pairingFile = Path.Combine(_root, "pairing-code.txt");
                    if (File.Exists(pairingFile)) File.Delete(pairingFile);
                }
                catch
                {
                    // A stale local helper file must never affect a healthy link.
                }
            }

            _tray.Text = _paused
                ? "JARVIS Local Agent — paused"
                : (_tradingViewDetected ? "JARVIS Local Agent — ACTIVE" : "JARVIS Local Agent — WATCHING");
        }
        catch (Exception ex)
        {
            LogRateLimited("control.link.unavailable:" + ex.GetType().Name, TimeSpan.FromSeconds(30));
        }
    }

    private async Task HandleObsidianCommandAsync(JsonElement commandNode)
    {
        var id = commandNode.TryGetProperty("id", out var idNode) ? idNode.GetString() : null;
        var action = commandNode.TryGetProperty("action", out var actionNode) ? actionNode.GetString() : null;
        var path = commandNode.TryGetProperty("path", out var pathNode) && pathNode.ValueKind != JsonValueKind.Null
            ? pathNode.GetString()
            : null;
        var content = commandNode.TryGetProperty("content", out var contentNode) && contentNode.ValueKind != JsonValueKind.Null
            ? contentNode.GetString()
            : null;
        var query = commandNode.TryGetProperty("query", out var queryNode) && queryNode.ValueKind != JsonValueKind.Null
            ? queryNode.GetString()
            : null;

        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(action)) return;
        if (!await ShouldExecuteCommandAsync(id!, "/api/obsidian/result", action!)) return;

        string? data = null;
        string? error = null;
        var ok = false;

        try
        {
            var apiKey = GetObsidianApiKey();
            if (string.IsNullOrWhiteSpace(apiKey))
                throw new InvalidOperationException("Obsidian API key is not configured on this PC.");

            var baseUrl = ObsidianBaseUrl();
            if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var baseUri) || !baseUri.IsLoopback)
                throw new InvalidOperationException("Obsidian bridge must use a loopback URL.");

            var normalizedPath = NormalizeObsidianVaultPath(path);
            var endpoint = baseUrl + "/vault/" + EncodeObsidianVaultPath(normalizedPath);

            if (string.Equals(action, "LIST", StringComparison.OrdinalIgnoreCase))
            {
                if (!string.IsNullOrWhiteSpace(normalizedPath) && !endpoint.EndsWith('/')) endpoint += "/";
                using var request = new HttpRequestMessage(HttpMethod.Get, endpoint);
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
                using var response = await _http.SendAsync(request, cts.Token);
                data = await response.Content.ReadAsStringAsync(cts.Token);
                if (!response.IsSuccessStatusCode)
                    throw new InvalidOperationException($"Obsidian LIST returned HTTP {(int)response.StatusCode}: {TrimForBridge(data, 800)}");
                ok = true;
            }
            else if (string.Equals(action, "READ", StringComparison.OrdinalIgnoreCase))
            {
                if (string.IsNullOrWhiteSpace(normalizedPath))
                    throw new InvalidOperationException("READ requires a vault path.");
                using var request = new HttpRequestMessage(HttpMethod.Get, endpoint);
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
                using var response = await _http.SendAsync(request, cts.Token);
                data = await response.Content.ReadAsStringAsync(cts.Token);
                if (!response.IsSuccessStatusCode)
                    throw new InvalidOperationException($"Obsidian READ returned HTTP {(int)response.StatusCode}: {TrimForBridge(data, 800)}");
                ok = true;
            }
            else if (string.Equals(action, "WRITE", StringComparison.OrdinalIgnoreCase))
            {
                if (string.IsNullOrWhiteSpace(normalizedPath) || !normalizedPath.EndsWith(".md", StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("WRITE requires a Markdown file path.");
                using var request = new HttpRequestMessage(HttpMethod.Put, endpoint);
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
                request.Content = new StringContent(content ?? "", Encoding.UTF8, "text/markdown");
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                using var response = await _http.SendAsync(request, cts.Token);
                data = await response.Content.ReadAsStringAsync(cts.Token);
                if (!response.IsSuccessStatusCode)
                    throw new InvalidOperationException($"Obsidian WRITE returned HTTP {(int)response.StatusCode}: {TrimForBridge(data, 800)}");
                ok = true;
            }
            else if (string.Equals(action, "SEARCH", StringComparison.OrdinalIgnoreCase))
            {
                if (string.IsNullOrWhiteSpace(query))
                    throw new InvalidOperationException("SEARCH requires a query.");
                var searchUrl = baseUrl + "/search/simple/?query=" + Uri.EscapeDataString(query.Trim()) + "&contextLength=180";
                using var request = new HttpRequestMessage(HttpMethod.Post, searchUrl);
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                using var response = await _http.SendAsync(request, cts.Token);
                data = await response.Content.ReadAsStringAsync(cts.Token);
                if (!response.IsSuccessStatusCode)
                    throw new InvalidOperationException($"Obsidian SEARCH returned HTTP {(int)response.StatusCode}: {TrimForBridge(data, 800)}");
                ok = true;
            }
            else
            {
                throw new InvalidOperationException("Unsupported Obsidian command.");
            }
        }
        catch (Exception ex)
        {
            error = ex.Message;
            Log(new { type = "obsidian.command.error", at = DateTime.UtcNow, id, action, path, error });
        }

        await PostObsidianCommandResultAsync(
            id!,
            action!.ToUpperInvariant(),
            ok,
            path,
            data,
            error);
    }

    private async Task HandleDesktopCommandAsync(JsonElement commandNode)
    {
        var id = commandNode.TryGetProperty("id", out var idNode) ? idNode.GetString() : null;
        var action = commandNode.TryGetProperty("action", out var actionNode) ? actionNode.GetString() : null;
        var target = commandNode.TryGetProperty("target", out var targetNode) && targetNode.ValueKind != JsonValueKind.Null
            ? targetNode.GetString()
            : null;
        var text = commandNode.TryGetProperty("text", out var textNode) && textNode.ValueKind != JsonValueKind.Null
            ? textNode.GetString()
            : null;
        var authorization = commandNode.TryGetProperty("authorization", out var authNode)
            ? authNode.GetString()
            : "READ_ONLY";
        var args = commandNode.TryGetProperty("args", out var argsNode) && argsNode.ValueKind == JsonValueKind.Array
            ? argsNode.EnumerateArray().Select(item => item.GetString() ?? "").ToArray()
            : Array.Empty<string>();

        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(action)) return;
        if (!await ShouldExecuteCommandAsync(id!, "/api/desktop/result", action!)) return;

        var command = new DesktopActionCommand(
            id!,
            action!.ToUpperInvariant(),
            target,
            text,
            args,
            authorization ?? "READ_ONLY");

        if (string.Equals(command.Action, "RUN_CODING_AGENT", StringComparison.OrdinalIgnoreCase))
        {
            _ = Task.Run(async () =>
            {
                DesktopActionResult backgroundResult;
                try
                {
                    backgroundResult = await _desktopRuntime.ExecuteAsync(command);
                }
                catch (Exception ex)
                {
                    backgroundResult = new DesktopActionResult(
                        command.Id,
                        command.Action,
                        false,
                        "Coding-agent action failed.",
                        null,
                        Array.Empty<string>(),
                        ex.Message,
                        DateTime.UtcNow);
                }

                Log(new
                {
                    type = "desktop.coding_agent.executed",
                    at = DateTime.UtcNow,
                    id = backgroundResult.Id,
                    action = backgroundResult.Action,
                    ok = backgroundResult.Ok,
                    summary = backgroundResult.Summary,
                    evidence = backgroundResult.Evidence,
                    error = backgroundResult.Error,
                });

                await PostDesktopCommandResultAsync(backgroundResult);
            });
            return;
        }

        DesktopActionResult result;
        try
        {
            result = await _desktopRuntime.ExecuteAsync(command);
        }
        catch (Exception ex)
        {
            result = new DesktopActionResult(
                command.Id,
                command.Action,
                false,
                "Desktop action failed.",
                null,
                Array.Empty<string>(),
                ex.Message,
                DateTime.UtcNow);
        }

        Log(new
        {
            type = "desktop.command.executed",
            at = DateTime.UtcNow,
            id = result.Id,
            action = result.Action,
            ok = result.Ok,
            summary = result.Summary,
            evidence = result.Evidence,
            error = result.Error,
        });

        await PostDesktopCommandResultAsync(result);
    }

    private async Task PostDesktopCommandResultAsync(DesktopActionResult result)
    {
        if (string.IsNullOrWhiteSpace(_config.ServerUrl) ||
            string.IsNullOrWhiteSpace(_config.DeviceId) ||
            string.IsNullOrWhiteSpace(_config.DeviceToken)) return;

        var endpoint = _config.ServerUrl.TrimEnd('/') + "/api/desktop/result";
        var body = JsonSerializer.Serialize(new
        {
            id = result.Id,
            action = result.Action,
            ok = result.Ok,
            summary = result.Summary,
            data = result.Data,
            evidence = result.Evidence,
            error = result.Error,
            completedAt = result.CompletedAt,
        });
        // Record completion first: if the post fails the cloud re-delivers and we re-post, never re-run.
        _ledger.Complete(result.Id, body);

        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, endpoint);
            ApplyVercelBypassHeaders(req);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _config.DeviceToken);
            req.Headers.Add("x-jarvis-device-id", _config.DeviceId);
            req.Headers.Add("x-jarvis-observer-version", ObserverInfo.Version);
            req.Headers.Add("x-jarvis-capabilities", string.Join(",", _agentCapabilities));
            req.Content = new StringContent(body, Encoding.UTF8, "application/json");
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(12));
            using var response = await _http.SendAsync(req, cts.Token);

            Log(new
            {
                type = "desktop.command.result",
                at = DateTime.UtcNow,
                id = result.Id,
                action = result.Action,
                ok = result.Ok,
                status = (int)response.StatusCode,
            });

        }
        catch (Exception ex)
        {
            Log(new { type = "desktop.command.result_error", at = DateTime.UtcNow, id = result.Id, error = ex.Message });
        }
    }

    private static string[] DetectAgentCapabilities()
    {
        var capabilities = new List<string> { "BROWSER" };
        if (ExecutableOnPath("codex.exe")) capabilities.Add("CODEX");
        if (ExecutableOnPath("claude.exe")) capabilities.Add("CLAUDE");
        return capabilities.ToArray();
    }

    private static bool ExecutableOnPath(string fileName)
    {
        var path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var raw in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                if (File.Exists(Path.Combine(raw.Trim(), fileName))) return true;
            }
            catch { }
        }
        return false;
    }

    private static string NormalizeObsidianVaultPath(string? value)
    {
        var path = (value ?? "").Replace('\\', '/').Trim().TrimStart('/');
        if (path.Length > 500) path = path[..500];
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Any(part => part == ".." || part.Equals(".obsidian", StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException("Unsafe Obsidian vault path.");
        return string.Join('/', parts);
    }

    private static string EncodeObsidianVaultPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        return string.Join("/", path.Split('/').Select(Uri.EscapeDataString));
    }

    private static string TrimForBridge(string? value, int max)
    {
        if (string.IsNullOrEmpty(value)) return "";
        return value.Length <= max ? value : value[..max];
    }

    private async Task PostObsidianCommandResultAsync(
        string id,
        string action,
        bool ok,
        string? path,
        string? data,
        string? error)
    {
        if (string.IsNullOrWhiteSpace(_config.ServerUrl) ||
            string.IsNullOrWhiteSpace(_config.DeviceId) ||
            string.IsNullOrWhiteSpace(_config.DeviceToken)) return;

        var endpoint = _config.ServerUrl.TrimEnd('/') + "/api/obsidian/result";
        var body = JsonSerializer.Serialize(new
        {
            id,
            action,
            ok,
            path,
            data = data is null ? null : TrimForBridge(data, 200_000),
            error = error is null ? null : TrimForBridge(error, 2_000),
            completedAt = DateTime.UtcNow,
        });
        _ledger.Complete(id, body);

        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, endpoint);
            ApplyVercelBypassHeaders(req);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _config.DeviceToken);
            req.Headers.Add("x-jarvis-device-id", _config.DeviceId);
            req.Headers.Add("x-jarvis-observer-version", ObserverInfo.Version);
            req.Headers.Add("x-jarvis-capabilities", string.Join(",", _agentCapabilities));
            req.Content = new StringContent(body, Encoding.UTF8, "application/json");
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            using var response = await _http.SendAsync(req, cts.Token);

            Log(new
            {
                type = "obsidian.command.result",
                at = DateTime.UtcNow,
                id,
                action,
                ok,
                status = (int)response.StatusCode,
            });

        }
        catch (Exception ex)
        {
            Log(new { type = "obsidian.command.result_error", at = DateTime.UtcNow, id, error = ex.Message });
        }
    }

    /// <summary>
    /// Idempotency gate for cloud commands. A command id runs at most once on this PC;
    /// if the cloud re-delivers it (its result never arrived) the stored result is re-posted.
    /// </summary>
    private async Task<bool> ShouldExecuteCommandAsync(string id, string resultPath, string action)
    {
        if (_ledger.TryBegin(id, out var prior)) return true;
        if (prior?.ResultJson is string stored)
        {
            await PostDeviceJsonAsync(resultPath, stored, TimeSpan.FromSeconds(10));
            return false;
        }
        if (prior is not null && DateTime.UtcNow - prior.At > TimeSpan.FromMinutes(30))
        {
            // Started but never finished (app restarted mid-command): report failure instead of re-running.
            var failure = JsonSerializer.Serialize(new
            {
                id,
                action = action.ToUpperInvariant(),
                ok = false,
                summary = "Command was interrupted before it finished; JARVIS did not re-run it.",
                data = (string?)null,
                evidence = Array.Empty<string>(),
                error = "INTERRUPTED",
                completedAt = DateTime.UtcNow,
            });
            _ledger.Complete(id, failure);
            await PostDeviceJsonAsync(resultPath, failure, TimeSpan.FromSeconds(10));
        }
        return false;
    }

    private async Task<HttpResponseMessage?> PostDeviceJsonAsync(string path, string json, TimeSpan timeout)
    {
        if (string.IsNullOrWhiteSpace(_config.ServerUrl) || string.IsNullOrWhiteSpace(_config.DeviceId) || string.IsNullOrWhiteSpace(_config.DeviceToken)) return null;
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, _config.ServerUrl.TrimEnd('/') + path);
            ApplyVercelBypassHeaders(req);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _config.DeviceToken);
            req.Headers.Add("x-jarvis-device-id", _config.DeviceId);
            req.Headers.Add("x-jarvis-observer-version", ObserverInfo.Version);
            req.Headers.Add("x-jarvis-capabilities", string.Join(",", _agentCapabilities));
            req.Content = new StringContent(json, Encoding.UTF8, "application/json");
            using var cts = new CancellationTokenSource(timeout);
            return await _http.SendAsync(req, cts.Token);
        }
        catch (Exception ex)
        {
            LogRateLimited("device.post.error:" + path + ":" + ex.GetType().Name, TimeSpan.FromSeconds(30));
            return null;
        }
    }

    /// <summary>
    /// Every 3 s: bundle finished trades, keep pre-entry frames pinned, trim disk,
    /// and sync the journal + key frames (with retry) when the cloud is reachable.
    /// </summary>
    private async Task SyncTickAsync()
    {
        if (Interlocked.Exchange(ref _syncBusy, 1) == 1) return;
        try
        {
            var now = DateTime.UtcNow;
            List<PendingBundle> due;
            DateTime? pin = null;
            lock (_journalGate)
            {
                due = _pendingBundles.Where(b => b.DueAt <= now).ToList();
                _pendingBundles.RemoveAll(b => b.DueAt <= now);
                var open = _lifecycle.OpenTrade;
                var start = open is not null ? (open.PreparedAt ?? open.OpenedAt) : _lifecycle.StagedSince;
                if (start is DateTime s) pin = s.AddMinutes(-15);
                foreach (var bundle in _pendingBundles)
                {
                    var from = (bundle.Trade.PreparedAt ?? bundle.Trade.OpenedAt).AddMinutes(-15);
                    if (pin is null || from < pin) pin = from;
                }
                foreach (var bundle in due)
                {
                    var from = (bundle.Trade.PreparedAt ?? bundle.Trade.OpenedAt).AddMinutes(-15);
                    if (pin is null || from < pin) pin = from;
                }
            }
            _frames.SetPin(pin);

            foreach (var bundle in due)
            {
                try
                {
                    var trade = bundle.Trade;
                    var from = (trade.PreparedAt ?? trade.OpenedAt).AddMinutes(-15);
                    var to = (trade.ClosedAt ?? now).AddMinutes(5);
                    var result = _frames.BundleTrade(trade.Id, from, to, bundle.Events, JsonSerializer.Serialize(trade, TradeJournalStore.Json));
                    foreach (var keyFrame in result.KeyFrames)
                    {
                        var at = FrameStore.ParseTime(keyFrame) ?? now;
                        _frameOutbox.Enqueue(trade.Id + "_" + Path.GetFileNameWithoutExtension(keyFrame), JsonSerializer.Serialize(new { tradeId = trade.Id, capturedAt = at, path = keyFrame }));
                    }
                    WriteTradeNote(trade, bundle.Events, result.Folder);
                    Log(new { type = "journal.trade_bundled", at = now, tradeId = trade.Id, folder = result.Folder, keyFrames = result.KeyFrames.Count });
                }
                catch (Exception ex)
                {
                    Log(new { type = "journal.bundle_error", at = now, tradeId = bundle.Trade.Id, error = ex.Message });
                }
            }

            if (now - _lastCleanupUtc >= TimeSpan.FromMinutes(1))
            {
                _lastCleanupUtc = now;
                _frames.Cleanup();
            }

            if (string.IsNullOrWhiteSpace(_config.DeviceId) || string.IsNullOrWhiteSpace(_config.DeviceToken)) return;

            var batch = _eventOutbox.TakeDue(50);
            if (batch.Count > 0)
            {
                var json = "{\"events\":[" + string.Join(",", batch.Select(item => item.Json)) + "]}";
                using var response = await PostDeviceJsonAsync("/api/trading/observer-events", json, TimeSpan.FromSeconds(20));
                if (response is not null && response.IsSuccessStatusCode)
                {
                    _eventOutbox.Ack(batch.Select(item => item.File));
                }
                else if (response is not null && (int)response.StatusCode == 400)
                {
                    // Invalid payload will never succeed; keep a copy locally (journal) and drop it from the queue.
                    Log(new { type = "journal.sync_rejected", at = now, count = batch.Count });
                    _eventOutbox.Ack(batch.Select(item => item.File));
                }
                else
                {
                    _eventOutbox.Fail(batch.Select(item => item.File));
                }
            }

            if (!_paused)
            {
                foreach (var item in _frameOutbox.TakeDue(3))
                {
                    try
                    {
                        using var doc = JsonDocument.Parse(item.Json);
                        var path = doc.RootElement.GetProperty("path").GetString();
                        if (path is null || !File.Exists(path))
                        {
                            _frameOutbox.Ack(new[] { item.File });
                            continue;
                        }
                        var body = JsonSerializer.Serialize(new
                        {
                            tradeId = doc.RootElement.GetProperty("tradeId").GetString(),
                            capturedAt = doc.RootElement.GetProperty("capturedAt").GetDateTime(),
                            imageBase64 = Convert.ToBase64String(File.ReadAllBytes(path)),
                        });
                        using var response = await PostDeviceJsonAsync("/api/trading/observer-frames", body, TimeSpan.FromSeconds(30));
                        if (response is not null && (response.IsSuccessStatusCode || (int)response.StatusCode == 400)) _frameOutbox.Ack(new[] { item.File });
                        else _frameOutbox.Fail(new[] { item.File });
                    }
                    catch
                    {
                        _frameOutbox.Fail(new[] { item.File });
                    }
                }
            }

            await DiagnosticsTickAsync(now);
        }
        catch (Exception ex)
        {
            LogRateLimited("sync.tick.error:" + ex.GetType().Name, TimeSpan.FromSeconds(30));
        }
        finally
        {
            Volatile.Write(ref _syncBusy, 0);
        }
    }

    /// <summary>
    /// Direct vault sync (no Obsidian plugin): write JARVIS's notes into vault/JARVIS (inside markers only),
    /// then upload notes changed in the allowed folders so Jarvis can search them.
    /// </summary>
    private async Task VaultTickAsync()
    {
        if (Interlocked.Exchange(ref _vaultBusy, 1) == 1) return;
        try
        {
            var vault = _config.ObsidianVaultPath;
            if (string.IsNullOrWhiteSpace(vault) || !Directory.Exists(vault)) return;
            if (string.IsNullOrWhiteSpace(_config.ServerUrl) || string.IsNullOrWhiteSpace(_config.DeviceId) || string.IsNullOrWhiteSpace(_config.DeviceToken)) return;

            using (var req = new HttpRequestMessage(HttpMethod.Get, _config.ServerUrl.TrimEnd('/') + "/api/vault/pull"))
            {
                ApplyVercelBypassHeaders(req);
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _config.DeviceToken);
                req.Headers.Add("x-jarvis-device-id", _config.DeviceId);
                req.Headers.Add("x-jarvis-observer-version", ObserverInfo.Version);
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
                using var res = await _http.SendAsync(req, cts.Token);
                if (res.IsSuccessStatusCode)
                {
                    using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(cts.Token));
                    var notes = doc.RootElement.GetProperty("notes").EnumerateArray()
                        .Select(n => (n.GetProperty("path").GetString() ?? "", n.GetProperty("content").GetString() ?? ""))
                        .Where(n => n.Item1.Length > 0)
                        .ToList();
                    var changed = VaultBridge.WriteManaged(vault, notes);
                    if (changed > 0) Log(new { type = "vault.notes_written", at = DateTime.UtcNow, changed });
                }
            }

            var since = _config.VaultIndexedAt ?? DateTime.MinValue;
            var startedAt = DateTime.UtcNow;
            var changedNotes = VaultBridge.ScanChanged(vault, since, _config.VaultIndexFolders ?? Array.Empty<string>());
            var uploadedAll = true;
            foreach (var batch in changedNotes.Chunk(25))
            {
                var body = JsonSerializer.Serialize(new { notes = batch.Select(n => new { path = n.Path, title = n.Title, content = n.Content, modifiedAt = n.ModifiedUtc }) });
                using var res = await PostDeviceJsonAsync("/api/vault/sync", body, TimeSpan.FromSeconds(30));
                if (res is null || !res.IsSuccessStatusCode) { uploadedAll = false; break; }
            }
            if (uploadedAll)
            {
                _config.VaultIndexedAt = changedNotes.Count == 200 ? changedNotes[^1].ModifiedUtc : startedAt;
                SaveConfig();
                if (changedNotes.Count > 0) Log(new { type = "vault.indexed", at = DateTime.UtcNow, notes = changedNotes.Count });
            }
        }
        catch (Exception ex)
        {
            LogRateLimited("vault.tick.error:" + ex.GetType().Name, TimeSpan.FromMinutes(5));
        }
        finally
        {
            Volatile.Write(ref _vaultBusy, 0);
        }
    }

    private void ChooseVaultFolder()
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = "Choose your Obsidian vault folder. JARVIS writes only inside its JARVIS subfolder and indexes your notes for search.",
            UseDescriptionForTitle = true,
            SelectedPath = _config.ObsidianVaultPath ?? Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
        };
        if (dialog.ShowDialog() != DialogResult.OK || string.IsNullOrWhiteSpace(dialog.SelectedPath)) return;
        _config.ObsidianVaultPath = dialog.SelectedPath;
        _config.VaultIndexedAt = null;
        SaveConfig();
        Log(new { type = "vault.folder_set", at = DateTime.UtcNow });
        _ = Task.Run(VaultTickAsync);
        MessageBox.Show(
            "Vault saved. JARVIS will keep its notes in the JARVIS folder and index your notes for search every 10 minutes.\n\nTo index only some folders, list them in config.json under \"vaultIndexFolders\".",
            "JARVIS Local Agent — Obsidian", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    /// <summary>Human-readable trade note next to the frames (and in the Obsidian vault when configured).</summary>
    private void WriteTradeNote(JournalTrade trade, IReadOnlyList<JournalEvent> events, string folder)
    {
        var note = TradeNotes.Render(trade, events);
        File.WriteAllText(Path.Combine(folder, "trade.md"), note);
        var vault = _config.ObsidianVaultPath;
        if (string.IsNullOrWhiteSpace(vault) || !Directory.Exists(vault)) return;
        try
        {
            var relative = $"{VaultBridge.ManagedFolder}/Trading/Trades/{trade.OpenedAt.ToLocalTime():yyyy-MM}/{TradeNotes.FileName(trade)}";
            var full = Path.Combine(vault, relative.Replace('/', Path.DirectorySeparatorChar));
            var isNew = !File.Exists(full);
            VaultBridge.WriteManaged(vault, new[] { (relative, TradeNotes.RenderGenerated(trade, events)) });
            // The review questions are added once, below JARVIS's block, and never touched again.
            if (isNew && File.Exists(full)) File.AppendAllText(full, "\n" + TradeNotes.Template());
        }
        catch (Exception ex)
        {
            LogRateLimited("vault.trade_note.error:" + ex.GetType().Name, TimeSpan.FromMinutes(5));
        }
    }

    private async Task EnsureDeploymentAccessAsync()
    {
        if (_deploymentAccessPrimed) return;
        if (string.IsNullOrWhiteSpace(_config.AccessBootstrapUrl))
        {
            _deploymentAccessPrimed = true;
            return;
        }

        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, _config.AccessBootstrapUrl);
            ApplyVercelBypassHeaders(req);
            using var res = await _http.SendAsync(req);
            _deploymentAccessPrimed = res.IsSuccessStatusCode || (int)res.StatusCode is >= 300 and < 400;
            Log(new { type = "deployment.access", at = DateTime.UtcNow, status = (int)res.StatusCode, primed = _deploymentAccessPrimed });
        }
        catch (Exception ex)
        {
            LogRateLimited("deployment.access.error:" + ex.GetType().Name, TimeSpan.FromSeconds(30));
        }
    }

    private async Task RequestPairingAsync(bool forceNew = false)
    {
        try
        {
            if (!forceNew &&
                !string.IsNullOrWhiteSpace(_config.PairingCode) &&
                DateTime.TryParse(_config.PairingExpiresAt, out var expiry) &&
                expiry.ToUniversalTime() > DateTime.UtcNow)
            {
                ShowPairingCode(force: true);
                return;
            }

            var endpoint = _config.ServerUrl!.TrimEnd('/') + "/api/trading/pair/start";
            var body = JsonSerializer.Serialize(new { deviceName = Environment.MachineName + " · Dwight PC" });
            using var req = new HttpRequestMessage(HttpMethod.Post, endpoint)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            };
            ApplyVercelBypassHeaders(req);
            using var res = await _http.SendAsync(req);
            if (!res.IsSuccessStatusCode)
            {
                var errorText = await res.Content.ReadAsStringAsync();
                Log(new
                {
                    type = "pair.start.failed",
                    at = DateTime.UtcNow,
                    status = (int)res.StatusCode,
                    response = errorText.Length > 800 ? errorText[..800] : errorText,
                });
                if (forceNew)
                {
                    MessageBox.Show(
                        $"Jarvis could not create a pairing code.\n\nHTTP {(int)res.StatusCode} {res.StatusCode}\n\nIf this is 401, set the Vercel automation bypass secret from the Observer tray menu, then try again.\n\nOpen the Observer folder and check observer.jsonl if this repeats.",
                        "Jarvis Observer pairing failed",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error);
                }
                return;
            }

            var json = await res.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(json);
            var pair = doc.RootElement.GetProperty("pair");
            _config.DeviceId = pair.GetProperty("deviceId").GetString();
            _config.DeviceToken = pair.GetProperty("deviceToken").GetString();
            _config.PairingCode = pair.GetProperty("code").GetString();
            _config.PairingExpiresAt = pair.GetProperty("expiresAt").GetString();
            SaveConfig();

            try
            {
                File.WriteAllText(Path.Combine(_root, "pairing-code.txt"),
                    $"Open Jarvis → Trading and enter this one-time code: {_config.PairingCode}{Environment.NewLine}Expires: {_config.PairingExpiresAt}");
            }
            catch { }

            ShowPairingCode(force: true);
            Log(new { type = "observer.pairing_ready", at = DateTime.UtcNow, expiresAt = _config.PairingExpiresAt });
        }
        catch (Exception ex)
        {
            Log(new { type = "pair.start.error", at = DateTime.UtcNow, error = ex.Message, exception = ex.GetType().Name });
            if (forceNew)
            {
                MessageBox.Show(
                    $"Jarvis could not create a pairing code.\n\n{ex.GetType().Name}: {ex.Message}\n\nOpen the Observer folder and check observer.jsonl if this repeats.",
                    "Jarvis Observer pairing failed",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }
    }

    private async Task ShowOrCreatePairingCodeAsync()
    {
        if (string.IsNullOrWhiteSpace(GetVercelBypassSecret()) && !PromptAndStoreVercelBypassSecret(showSuccess: false))
        {
            return;
        }

        var hasValidCode =
            !string.IsNullOrWhiteSpace(_config.PairingCode) &&
            DateTime.TryParse(_config.PairingExpiresAt, out var expiry) &&
            expiry.ToUniversalTime() > DateTime.UtcNow;

        if (hasValidCode)
        {
            ShowPairingCode(force: true);
            return;
        }

        ClearPairingState();
        _lastPairAttemptUtc = DateTime.UtcNow;
        await RequestPairingAsync(forceNew: true);
    }

    private void ApplyVercelBypassHeaders(HttpRequestMessage req)
    {
        var secret = GetVercelBypassSecret();
        if (string.IsNullOrWhiteSpace(secret)) return;
        req.Headers.Remove("x-vercel-protection-bypass");
        req.Headers.TryAddWithoutValidation("x-vercel-protection-bypass", secret.Trim());
        req.Headers.Remove("x-vercel-set-bypass-cookie");
        req.Headers.TryAddWithoutValidation("x-vercel-set-bypass-cookie", "true");
    }

    private string? GetVercelBypassSecret()
    {
        try
        {
            if (!string.IsNullOrWhiteSpace(_config.VercelBypassSecretProtected))
            {
                var protectedBytes = Convert.FromBase64String(_config.VercelBypassSecretProtected);
                var clearBytes = ProtectedData.Unprotect(protectedBytes, null, DataProtectionScope.CurrentUser);
                return Encoding.UTF8.GetString(clearBytes);
            }

            // One-time compatibility path for an older local config. It is migrated
            // to Windows-protected storage the next time the user saves the key.
            return string.IsNullOrWhiteSpace(_config.VercelBypassSecret) ? null : _config.VercelBypassSecret;
        }
        catch
        {
            return null;
        }
    }

    private string? GetObsidianApiKey()
    {
        try
        {
            if (string.IsNullOrWhiteSpace(_config.ObsidianApiKeyProtected)) return null;
            var protectedBytes = Convert.FromBase64String(_config.ObsidianApiKeyProtected);
            var clearBytes = ProtectedData.Unprotect(protectedBytes, null, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(clearBytes);
        }
        catch
        {
            return null;
        }
    }

    private static HttpClient CreateHttpClient()
    {
        var handler = new HttpClientHandler
        {
            ServerCertificateCustomValidationCallback = (request, _, _, errors) =>
            {
                if (errors == System.Net.Security.SslPolicyErrors.None) return true;
                var uri = request?.RequestUri;
                return uri is not null && uri.IsLoopback;
            },
        };
        return new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(45) };
    }

    private void ImportLocalSecretsIfPresent()
    {
        var path = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".jarvis",
            "secrets.env");
        if (!File.Exists(path)) return;

        try
        {
            var values = File.ReadAllLines(path)
                .Select(line => line.Trim())
                .Where(line => line.Length > 0 && !line.StartsWith("#", StringComparison.Ordinal))
                .Select(line => line.Split('=', 2))
                .Where(parts => parts.Length == 2)
                .ToDictionary(parts => parts[0].Trim(), parts => parts[1].Trim(), StringComparer.OrdinalIgnoreCase);

            if (values.TryGetValue("OBSIDIAN_BASE_URL", out var baseUrl) && !string.IsNullOrWhiteSpace(baseUrl))
                _config.ObsidianApiUrl = baseUrl.TrimEnd('/');

            if (values.TryGetValue("OBSIDIAN_VAULT", out var vault) && !string.IsNullOrWhiteSpace(vault))
                _config.ObsidianVaultName = vault.Trim();

            if (values.TryGetValue("OBSIDIAN_API_KEY", out var apiKey) && !string.IsNullOrWhiteSpace(apiKey))
            {
                var clearBytes = Encoding.UTF8.GetBytes(apiKey.Trim());
                var protectedBytes = ProtectedData.Protect(clearBytes, null, DataProtectionScope.CurrentUser);
                _config.ObsidianApiKeyProtected = Convert.ToBase64String(protectedBytes);

                var safeLines = new[]
                {
                    "# JARVIS Local Agent imported the API key into Windows DPAPI.",
                    $"OBSIDIAN_BASE_URL={_config.ObsidianApiUrl}",
                    $"OBSIDIAN_VAULT={_config.ObsidianVaultName}",
                };
                File.WriteAllLines(path, safeLines, Encoding.UTF8);
                Log(new { type = "obsidian.secret.imported", at = DateTime.UtcNow, storage = "windows-dpapi", source = path });
            }
        }
        catch (Exception ex)
        {
            Log(new { type = "obsidian.secret.import_failed", at = DateTime.UtcNow, error = ex.Message });
        }
    }

    private void NormalizeObsidianConfig()
    {
        if (string.IsNullOrWhiteSpace(_config.ObsidianApiUrl) ||
            string.Equals(_config.ObsidianApiUrl, "http://127.0.0.1:27123", StringComparison.OrdinalIgnoreCase))
        {
            _config.ObsidianApiUrl = "https://127.0.0.1:27124";
        }

        if (string.IsNullOrWhiteSpace(_config.ObsidianVaultName))
            _config.ObsidianVaultName = "Jarvis Knowledge Vault";
    }

    private string ObsidianBaseUrl()
    {
        return string.IsNullOrWhiteSpace(_config.ObsidianApiUrl)
            ? "https://127.0.0.1:27124"
            : _config.ObsidianApiUrl.TrimEnd('/');
    }

    private bool PromptAndStoreObsidianApiKey(bool showSuccess)
    {
        var value = PromptSecret(
            "Paste the API key shown in Obsidian → Settings → Local REST API.\n\nThe key is encrypted with Windows DPAPI for this Windows user and never uploaded to JARVIS Cloud.",
            "JARVIS Local Agent — Obsidian API key");

        if (string.IsNullOrWhiteSpace(value)) return false;

        try
        {
            var clearBytes = Encoding.UTF8.GetBytes(value.Trim());
            var protectedBytes = ProtectedData.Protect(clearBytes, null, DataProtectionScope.CurrentUser);
            _config.ObsidianApiKeyProtected = Convert.ToBase64String(protectedBytes);
            SaveConfig();
            Log(new { type = "obsidian.api_key.saved", at = DateTime.UtcNow, storage = "windows-dpapi" });
        }
        catch (Exception ex)
        {
            Log(new { type = "obsidian.api_key.save_failed", at = DateTime.UtcNow, error = ex.Message });
            MessageBox.Show(
                "Could not securely save the Obsidian API key.\n\n" + ex.Message,
                "JARVIS Local Agent",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return false;
        }

        if (showSuccess)
        {
            MessageBox.Show(
                "Obsidian API key saved locally and encrypted with Windows DPAPI.\n\nNext, choose “Obsidian: Test connection” from the JARVIS tray menu.",
                "JARVIS Local Agent",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }

        return true;
    }

    private async Task<bool> TestObsidianConnectionAsync(bool showSuccess)
    {
        var apiKey = GetObsidianApiKey();
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            if (!PromptAndStoreObsidianApiKey(showSuccess: false)) return false;
            apiKey = GetObsidianApiKey();
        }

        if (string.IsNullOrWhiteSpace(apiKey)) return false;

        var baseUrl = ObsidianBaseUrl();

        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var baseUri) ||
            !(baseUri.IsLoopback || string.Equals(baseUri.Host, "localhost", StringComparison.OrdinalIgnoreCase)))
        {
            MessageBox.Show(
                "For safety, the JARVIS Obsidian bridge only connects to localhost / 127.0.0.1.",
                "JARVIS Local Agent",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
            return false;
        }

        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, baseUrl + "/vault/");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            using var res = await _http.SendAsync(req, cts.Token);
            var responseText = await res.Content.ReadAsStringAsync(cts.Token);

            Log(new
            {
                type = "obsidian.connection.test",
                at = DateTime.UtcNow,
                status = (int)res.StatusCode,
                connected = res.IsSuccessStatusCode,
                url = baseUrl,
            });

            if (!res.IsSuccessStatusCode)
            {
                MessageBox.Show(
                    $"Obsidian responded with HTTP {(int)res.StatusCode}.\n\nMake sure Local REST API is enabled and the saved API key is current.",
                    "JARVIS Local Agent — Obsidian",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
                return false;
            }

            if (showSuccess)
            {
                MessageBox.Show(
                    "Obsidian is connected to the JARVIS Local Agent.\n\nThe API key remains encrypted on this PC and the bridge only talks to loopback.",
                    "JARVIS Local Agent — Obsidian connected",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }

            return true;
        }
        catch (Exception ex)
        {
            Log(new { type = "obsidian.connection.error", at = DateTime.UtcNow, error = ex.Message });
            MessageBox.Show(
                "JARVIS could not reach Obsidian.\n\nIn Obsidian → Settings → Local REST API, confirm the plugin is enabled and HTTPS is listening on 127.0.0.1:27124, then try again.\n\n" + ex.Message,
                "JARVIS Local Agent — Obsidian",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
            return false;
        }
    }

    private async Task<bool> WriteObsidianAgentTestNoteAsync(bool showSuccess)
    {
        var apiKey = GetObsidianApiKey();
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            if (!PromptAndStoreObsidianApiKey(showSuccess: false)) return false;
            apiKey = GetObsidianApiKey();
        }
        if (string.IsNullOrWhiteSpace(apiKey)) return false;

        var baseUrl = ObsidianBaseUrl();
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var baseUri) || !baseUri.IsLoopback)
        {
            MessageBox.Show(
                "For safety, the JARVIS Obsidian bridge only connects to localhost / 127.0.0.1.",
                "JARVIS Local Agent",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
            return false;
        }

        var path = "00%20Inbox/JARVIS%20Local%20Agent.md";
        var markdown = string.Join(Environment.NewLine, new[]
        {
            "# JARVIS Local Agent",
            "",
            $"Connected: {DateTime.Now:yyyy-MM-dd HH:mm:ss}",
            "",
            "Obsidian bridge: ONLINE",
            "",
            "This note was written directly by the JARVIS Windows Local Agent.",
        });

        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Put, baseUrl + "/vault/" + path);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            req.Content = new StringContent(markdown, Encoding.UTF8, "text/markdown");

            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            using var res = await _http.SendAsync(req, cts.Token);
            if (!res.IsSuccessStatusCode)
            {
                Log(new { type = "obsidian.write_test.failed", at = DateTime.UtcNow, status = (int)res.StatusCode });
                if (showSuccess)
                {
                    MessageBox.Show(
                        $"Obsidian write test failed with HTTP {(int)res.StatusCode}.",
                        "JARVIS Local Agent — Obsidian",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Warning);
                }
                return false;
            }

            Log(new { type = "obsidian.write_test.ok", at = DateTime.UtcNow, path = "00 Inbox/JARVIS Local Agent.md" });
            if (showSuccess)
            {
                MessageBox.Show(
                    "JARVIS Local Agent wrote 00 Inbox/JARVIS Local Agent.md successfully.",
                    "JARVIS Local Agent — Obsidian connected",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
            return true;
        }
        catch (Exception ex)
        {
            Log(new { type = "obsidian.write_test.error", at = DateTime.UtcNow, error = ex.Message });
            if (showSuccess)
            {
                MessageBox.Show(
                    "JARVIS could not write the Obsidian test note.\n\n" + ex.Message,
                    "JARVIS Local Agent — Obsidian",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
            }
            return false;
        }
    }

    private bool PromptAndStoreVercelBypassSecret(bool showSuccess)
    {
        var value = PromptSecret(
            "Paste the Vercel Protection Bypass for Automation secret for jarvis-os.\n\nThis stays on this PC and is sent only to Vercel as the protection-bypass header.",
            "Jarvis Observer — Vercel access key");

        if (string.IsNullOrWhiteSpace(value)) return false;
        try
        {
            var clearBytes = Encoding.UTF8.GetBytes(value.Trim());
            var protectedBytes = ProtectedData.Protect(clearBytes, null, DataProtectionScope.CurrentUser);
            _config.VercelBypassSecretProtected = Convert.ToBase64String(protectedBytes);
            _config.VercelBypassSecret = null;
            _config.AccessBootstrapUrl = null;
            _deploymentAccessPrimed = true;
            SaveConfig();
            Log(new { type = "vercel.bypass.saved", at = DateTime.UtcNow, storage = "windows-dpapi" });
        }
        catch (Exception ex)
        {
            Log(new { type = "vercel.bypass.save_failed", at = DateTime.UtcNow, error = ex.Message });
            MessageBox.Show(
                "Could not securely save the Vercel access key.\n\n" + ex.Message,
                "Jarvis Observer",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return false;
        }

        if (showSuccess)
        {
            MessageBox.Show(
                "Vercel access key saved locally. Use Show / New pairing code to pair Observer with Jarvis.",
                "Jarvis Observer",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }
        return true;
    }

    private static string? PromptSecret(string prompt, string title, bool masked = true)
    {
        using var form = new Form
        {
            Width = 560,
            Height = 230,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            Text = title,
            StartPosition = FormStartPosition.CenterScreen,
            MaximizeBox = false,
            MinimizeBox = false,
            TopMost = true,
        };

        var label = new System.Windows.Forms.Label
        {
            Left = 18,
            Top = 18,
            Width = 505,
            Height = 70,
            Text = prompt,
        };
        var box = new System.Windows.Forms.TextBox
        {
            Left = 18,
            Top = 95,
            Width = 505,
            UseSystemPasswordChar = masked,
        };
        var ok = new System.Windows.Forms.Button
        {
            Text = "Save",
            Left = 338,
            Width = 88,
            Top = 135,
            DialogResult = DialogResult.OK,
        };
        var cancel = new System.Windows.Forms.Button
        {
            Text = "Cancel",
            Left = 435,
            Width = 88,
            Top = 135,
            DialogResult = DialogResult.Cancel,
        };

        form.Controls.Add(label);
        form.Controls.Add(box);
        form.Controls.Add(ok);
        form.Controls.Add(cancel);
        form.AcceptButton = ok;
        form.CancelButton = cancel;

        return form.ShowDialog() == DialogResult.OK ? box.Text : null;
    }

    private void ClearPairingState()
    {
        _config.DeviceId = null;
        _config.DeviceToken = null;
        _config.PairingCode = null;
        _config.PairingExpiresAt = null;
        _pairDialogShownForCode = null;
        _paused = true;
        SaveConfig();

        try
        {
            var pairingFile = Path.Combine(_root, "pairing-code.txt");
            if (File.Exists(pairingFile)) File.Delete(pairingFile);
        }
        catch { }
    }

    private void ShowPairingCode(bool force = false)
    {
        if (string.IsNullOrWhiteSpace(_config.PairingCode)) return;
        if (!force && string.Equals(_pairDialogShownForCode, _config.PairingCode, StringComparison.Ordinal)) return;
        _pairDialogShownForCode = _config.PairingCode;

        _tray.ShowBalloonTip(
            8000,
            "PAIR JARVIS OBSERVER",
            $"Enter {_config.PairingCode} in Jarvis → Trading. After pairing, the red/white button controls this observer.",
            ToolTipIcon.Info);

        if (force)
        {
            MessageBox.Show(
                $"Enter this one-time code in Jarvis → Trading:{Environment.NewLine}{Environment.NewLine}{_config.PairingCode}{Environment.NewLine}{Environment.NewLine}Once paired, use the red/white button in Jarvis to Watch or Pause.",
                "Pair Jarvis Trading Observer",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }
    }

    private const string DefaultServerUrl = "https://jarvis-os-git-claude-jarvis-ai-119654-dwights-projects-8a9a094f.vercel.app";

    /// <summary>Respects the configured server; only fills it in when missing. Change it from the tray menu.</summary>
    private void NormalizeServerUrl()
    {
        if (!Uri.TryCreate(_config.ServerUrl, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
        {
            _config.ServerUrl = DefaultServerUrl;
        }
        _config.ServerUrl = _config.ServerUrl!.TrimEnd('/');
        _config.AccessBootstrapUrl = null;
    }

    private void PromptServerUrl()
    {
        var value = PromptSecret(
            "JARVIS server address (https://...). Use your production domain once JARVIS is deployed there.\n\nCurrent: " + _config.ServerUrl,
            "JARVIS Local Agent — server address",
            masked: false);
        if (string.IsNullOrWhiteSpace(value)) return;
        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
        {
            MessageBox.Show("Enter a full https:// address.", "JARVIS Local Agent", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        var changed = !string.Equals(uri.GetLeftPart(UriPartial.Authority), new Uri(_config.ServerUrl!).GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase);
        _config.ServerUrl = uri.GetLeftPart(UriPartial.Authority);
        if (changed) ClearPairingState(); // a different deployment needs its own pairing
        SaveConfig();
        Log(new { type = "observer.server_url_changed", at = DateTime.UtcNow, url = _config.ServerUrl });
        MessageBox.Show(changed ? "Server saved. Pair again: choose Show / New pairing code." : "Server saved.", "JARVIS Local Agent", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private void NormalizePerformanceConfig()
    {
        _config.MinimumCloudIntervalMs = Math.Clamp(_config.MinimumCloudIntervalMs, 500, 5000);
        _config.HeartbeatSeconds = Math.Clamp(_config.HeartbeatSeconds, 2, 30);
        // A full accessibility-tree walk is expensive for TradingView; OCR carries the fast path.
        _config.SemanticPollMs = _config.SemanticPollMs < 500 ? 750 : Math.Min(_config.SemanticPollMs, 3000);
        _config.RollingMinutes = Math.Clamp(_config.RollingMinutes, 20, 240);
        _config.RetentionDays = Math.Clamp(_config.RetentionDays, 3, 365);
        if (string.IsNullOrWhiteSpace(_config.InstallId)) _config.InstallId = Guid.NewGuid().ToString("N")[..10];
        if (!string.Equals(_config.LocalRecordingMode, "FOLLOW_CLOUD", StringComparison.OrdinalIgnoreCase)) _config.LocalRecordingMode = "ALWAYS";
    }

    private void SaveConfig()
    {
        lock (_configGate)
        {
            try { File.WriteAllText(_configPath, JsonSerializer.Serialize(_config, ObserverConfig.JsonOptions)); } catch { }
        }
    }

    private void ToggleHud()
    {
        if (_hud is null || _hud.IsDisposed) return;
        if (_hud.Visible) _hud.Hide(); else _hud.Show();
        lock (_configGate) _config.HudEnabled = _hud.Visible;
        SaveConfig();
    }

    private void OpenJarvisTrading()
    {
        var server = _config.ServerUrl?.TrimEnd('/');
        if (string.IsNullOrWhiteSpace(server)) return;
        try { Process.Start(new ProcessStartInfo(server + "/work") { UseShellExecute = true }); }
        catch (Exception ex) { LogRateLimited("hud.open_jarvis.error:" + ex.GetType().Name, TimeSpan.FromSeconds(30)); }
    }

    private void TogglePause()
    {
        _localPaused = !_localPaused;
        _tray.Text = _localPaused ? "JARVIS Local Agent — recording paused" : (_tradingViewDetected ? "JARVIS Local Agent — ACTIVE" : "JARVIS Local Agent — standby");
        _tray.ShowBalloonTip(1800, "JARVIS TRADING OBSERVER", _localPaused ? "Local recording paused. Nothing is captured." : "Local recording resumed.", ToolTipIcon.Info);
        Log(new { type = _localPaused ? "observer.local_paused" : "observer.local_resumed", at = DateTime.UtcNow });
    }

    private void EnsureConfigExists()
    {
        if (File.Exists(_configPath)) return;
        SaveConfig();
    }

    private void Log(object value)
    {
        lock (_logGate)
        {
            try
            {
                Directory.CreateDirectory(_root);
                File.AppendAllText(Path.Combine(_root, "observer.jsonl"), JsonSerializer.Serialize(value) + Environment.NewLine);
            }
            catch
            {
                // Logging must never take down observation.
            }
        }
    }

    private readonly Dictionary<string, DateTime> _lastRateLimitedLog = new();
    private void LogRateLimited(string type, TimeSpan interval)
    {
        var shouldLog = false;
        var now = DateTime.UtcNow;
        lock (_logGate)
        {
            if (!_lastRateLimitedLog.TryGetValue(type, out var last) || now - last >= interval)
            {
                _lastRateLimitedLog[type] = now;
                shouldLog = true;
            }
        }

        if (shouldLog) Log(new { type, at = now });
    }

    /// <summary>Cached TradingView window: no full process scan on every tick.</summary>
    private IntPtr TradingViewWindow()
    {
        var cached = _cachedWindow;
        if (cached != IntPtr.Zero && IsWindow(cached))
        {
            return IsWindowVisible(cached) && !IsIconic(cached) ? cached : IntPtr.Zero;
        }
        var now = DateTime.UtcNow;
        if (now - _lastWindowScanUtc < TimeSpan.FromSeconds(2)) return IntPtr.Zero;
        _lastWindowScanUtc = now;
        _cachedWindow = FindTradingViewWindowHandle();
        return _cachedWindow != IntPtr.Zero && IsWindowVisible(_cachedWindow) && !IsIconic(_cachedWindow) ? _cachedWindow : IntPtr.Zero;
    }

    /// <summary>True while the TradingView window exists, even minimized.</summary>
    private bool TradingViewRunning() => _cachedWindow != IntPtr.Zero && IsWindow(_cachedWindow);

    private static IntPtr FindTradingViewWindowHandle()
    {
        foreach (var process in Process.GetProcesses())
        {
            try
            {
                if (!process.ProcessName.Contains("TradingView", StringComparison.OrdinalIgnoreCase)) continue;
                if (process.MainWindowHandle == IntPtr.Zero) continue;
                return process.MainWindowHandle;
            }
            catch
            {
                // Process may disappear while enumerating.
            }
            finally
            {
                process.Dispose();
            }
        }
        return IntPtr.Zero;
    }

    private string CaptureAccessibleText(IntPtr hwnd, int maxChars)
    {
        try
        {
            AutomationElement root = _automation.FromHandle(hwnd);
            var semanticItems = new List<string>();
            var priorityIndexes = new HashSet<int>();
            var elements = root.FindAllDescendants();

            foreach (var element in elements.Take(2600))
            {
                try
                {
                    if (element.Properties.IsPassword.ValueOrDefault || element.Properties.IsOffscreen.ValueOrDefault) continue;

                    var control = element.Properties.LocalizedControlType.ValueOrDefault?.Trim()
                        ?? element.ControlType.ToString();
                    var name = element.Properties.Name.ValueOrDefault?.Trim() ?? string.Empty;
                    var automationId = element.Properties.AutomationId.ValueOrDefault?.Trim() ?? string.Empty;
                    var help = element.Properties.HelpText.ValueOrDefault?.Trim() ?? string.Empty;
                    var itemStatus = element.Properties.ItemStatus.ValueOrDefault?.Trim() ?? string.Empty;
                    var className = element.Properties.ClassName.ValueOrDefault?.Trim() ?? string.Empty;

                    var value = string.Empty;
                    try
                    {
                        if (element.Patterns.Value.TryGetPattern(out var valuePattern))
                        {
                            value = valuePattern.Value.Value?.Trim() ?? string.Empty;
                        }
                    }
                    catch
                    {
                        // Some TradingView elements expose a transient Value pattern.
                    }

                    var selection = string.Empty;
                    try
                    {
                        if (element.Patterns.SelectionItem.TryGetPattern(out var selectionPattern) && selectionPattern.IsSelected.Value)
                        {
                            selection = "selected";
                        }
                    }
                    catch
                    {
                        // Selection state can disappear while TradingView re-renders.
                    }

                    var toggle = string.Empty;
                    try
                    {
                        if (element.Patterns.Toggle.TryGetPattern(out var togglePattern))
                        {
                            toggle = $"toggle={togglePattern.ToggleState.Value}";
                        }
                    }
                    catch
                    {
                        // Toggle is optional.
                    }

                    var payload = string.Join(" | ", new[]
                    {
                        control,
                        name,
                        automationId,
                        help,
                        itemStatus,
                        string.IsNullOrWhiteSpace(value) ? string.Empty : $"value={value}",
                        selection,
                        toggle,
                        // CSS class names contain no order values and used most of the text budget.
                    }.Where(x => !string.IsNullOrWhiteSpace(x)));

                    if (string.IsNullOrWhiteSpace(payload)) continue;

                    var index = semanticItems.Count;
                    semanticItems.Add(payload);

                    if (Regex.IsMatch(
                        payload,
                        @"\b(buy|sell|limit|stop|market|order|position|quantity|qty|price|cancel|working|filled|flatten|reverse|bracket|take profit|stop loss|pnl|profit|loss)\b",
                        RegexOptions.IgnoreCase))
                    {
                        priorityIndexes.Add(index);
                    }
                }
                catch
                {
                    // TradingView's accessibility tree can mutate during a live update.
                }
            }

            // Keep the execution label AND its nearby siblings. TradingView often
            // exposes numeric values (qty/price) as separate neighboring elements
            // with no useful label of their own.
            var expandedPriority = new HashSet<int>();
            foreach (var index in priorityIndexes)
            {
                for (var i = Math.Max(0, index - 6); i <= Math.Min(semanticItems.Count - 1, index + 6); i++)
                {
                    expandedPriority.Add(i);
                }
            }

            var priorityLines = semanticItems
                .Where((_, index) => expandedPriority.Contains(index))
                .ToList();
            var remainingLines = semanticItems
                .Where((_, index) => !expandedPriority.Contains(index))
                .ToList();

            var ordered = priorityLines
                .Concat(remainingLines)
                .Distinct(StringComparer.Ordinal)
                .ToList();

            var combined = string.Join(Environment.NewLine, ordered);
            if (combined.Length > maxChars) combined = combined[..maxChars];
            return SanitizeSensitive(combined);
        }
        catch
        {
            return string.Empty;
        }
    }

    private static string SanitizeSensitive(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return string.Empty;
        var maskedLongNumbers = Regex.Replace(text, @"\b\d{7,}\b", "[MASKED-ID]");
        return maskedLongNumbers.Length > 60000 ? maskedLongNumbers[..60000] : maskedLongNumbers;
    }

    private static Bitmap? CaptureWindow(IntPtr hwnd)
    {
        if (!GetWindowRect(hwnd, out var rect)) return null;
        var width = rect.Right - rect.Left;
        var height = rect.Bottom - rect.Top;
        if (width < 320 || height < 240) return null;

        var bitmap = new Bitmap(width, height, PixelFormat.Format24bppRgb);
        using var graphics = Graphics.FromImage(bitmap);
        var hdc = graphics.GetHdc();
        try
        {
            const uint PW_RENDERFULLCONTENT = 0x00000002;
            if (!PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT))
            {
                bitmap.Dispose();
                return null;
            }
        }
        finally
        {
            graphics.ReleaseHdc(hdc);
        }

        if (LooksBlank(bitmap))
        {
            bitmap.Dispose();
            return null;
        }
        return bitmap;
    }

    private static bool LooksBlank(Bitmap bitmap)
    {
        double sum = 0;
        double sumSq = 0;
        var count = 0;
        for (var y = 0; y < bitmap.Height; y += Math.Max(1, bitmap.Height / 18))
        {
            for (var x = 0; x < bitmap.Width; x += Math.Max(1, bitmap.Width / 32))
            {
                var c = bitmap.GetPixel(x, y);
                var l = (c.R + c.G + c.B) / 3d;
                sum += l;
                sumSq += l * l;
                count++;
            }
        }
        if (count == 0) return true;
        var mean = sum / count;
        var variance = (sumSq / count) - (mean * mean);
        return variance < 12;
    }

    private static byte[] BuildSignature(Bitmap bitmap)
    {
        const int w = 48;
        const int h = 27;
        var bytes = new byte[w * h];
        for (var sy = 0; sy < h; sy++)
        {
            var y = Math.Min(bitmap.Height - 1, sy * bitmap.Height / h);
            for (var sx = 0; sx < w; sx++)
            {
                var x = Math.Min(bitmap.Width - 1, sx * bitmap.Width / w);
                var c = bitmap.GetPixel(x, y);
                bytes[(sy * w) + sx] = (byte)((c.R * 30 + c.G * 59 + c.B * 11) / 100);
            }
        }
        return bytes;
    }

    private static double SignatureDifference(byte[] a, byte[] b)
    {
        if (a.Length != b.Length || a.Length == 0) return 1;
        long diff = 0;
        for (var i = 0; i < a.Length; i++) diff += Math.Abs(a[i] - b[i]);
        return diff / (a.Length * 255d);
    }

    private static byte[] EncodeJpeg(Bitmap bitmap, long quality)
    {
        using var stream = new MemoryStream();
        var codec = ImageCodecInfo.GetImageEncoders().First(x => x.FormatID == ImageFormat.Jpeg.Guid);
        using var parameters = new EncoderParameters(1);
        parameters.Param[0] = new EncoderParameter(Encoder.Quality, Math.Clamp(quality, 35, 90));
        bitmap.Save(stream, codec, parameters);
        return stream.ToArray();
    }

    private static void OpenFolder(string path)
    {
        Process.Start(new ProcessStartInfo("explorer.exe", path) { UseShellExecute = true });
    }

    private static void OpenFile(string path)
    {
        if (!File.Exists(path)) return;
        Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetCursorPos(out Point point);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

    private static string? WindowTitle(IntPtr hwnd)
    {
        var buffer = new StringBuilder(256);
        return GetWindowText(hwnd, buffer, buffer.Capacity) > 0 ? buffer.ToString() : null;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}

internal sealed class ObserverConfig
{
    [JsonPropertyName("serverUrl")]
    public string? ServerUrl { get; set; } = "https://jarvis-os-git-claude-jarvis-ai-119654-dwights-projects-8a9a094f.vercel.app";

    [JsonPropertyName("accessBootstrapUrl")]
    public string? AccessBootstrapUrl { get; set; } = "https://jarvis-os-git-claude-jarvis-ai-119654-dwights-projects-8a9a094f.vercel.app/";

    [JsonPropertyName("vercelBypassSecretProtected")]
    public string? VercelBypassSecretProtected { get; set; }

    [JsonPropertyName("obsidianApiUrl")]
    public string? ObsidianApiUrl { get; set; } = "https://127.0.0.1:27124";

    [JsonPropertyName("obsidianVaultName")]
    public string? ObsidianVaultName { get; set; } = "Jarvis Knowledge Vault";

    [JsonPropertyName("obsidianApiKeyProtected")]
    public string? ObsidianApiKeyProtected { get; set; }

    [JsonPropertyName("tradingSecret")]
    public string? TradingSecret { get; set; }

    [JsonPropertyName("vercelBypassSecret")]
    public string? VercelBypassSecret { get; set; }

    [JsonPropertyName("deviceId")]
    public string? DeviceId { get; set; }

    [JsonPropertyName("deviceToken")]
    public string? DeviceToken { get; set; }

    [JsonPropertyName("pairingCode")]
    public string? PairingCode { get; set; }

    [JsonPropertyName("pairingExpiresAt")]
    public string? PairingExpiresAt { get; set; }

    [JsonPropertyName("minimumCloudIntervalMs")]
    public int MinimumCloudIntervalMs { get; set; } = 700;

    [JsonPropertyName("heartbeatSeconds")]
    public int HeartbeatSeconds { get; set; } = 3;

    [JsonPropertyName("localSnapshotSeconds")]
    public int LocalSnapshotSeconds { get; set; } = 5;

    [JsonPropertyName("minimumLocalEventIntervalMs")]
    public int MinimumLocalEventIntervalMs { get; set; } = 1000;

    [JsonPropertyName("visualChangeThreshold")]
    public double VisualChangeThreshold { get; set; } = 0.003;

    [JsonPropertyName("jpegQuality")]
    public long JpegQuality { get; set; } = 62;

    /// <summary>Unused since 1.0 (frames are retained by age, see rollingMinutes/retentionDays). Kept for config compatibility.</summary>
    [JsonPropertyName("maxLocalFrames")]
    public int MaxLocalFrames { get; set; } = 600;

    [JsonPropertyName("semanticPollMs")]
    public int SemanticPollMs { get; set; } = 250;

    [JsonPropertyName("maxSemanticChars")]
    public int MaxSemanticChars { get; set; } = 20000;

    /// <summary>ALWAYS (default): record locally whenever TradingView is open. FOLLOW_CLOUD: only while Jarvis says WATCH.</summary>
    [JsonPropertyName("localRecordingMode")]
    public string LocalRecordingMode { get; set; } = "ALWAYS";

    /// <summary>Minutes of full-rate frames kept on disk so the setup before an entry is always available.</summary>
    [JsonPropertyName("rollingMinutes")]
    public int RollingMinutes { get; set; } = 45;

    /// <summary>Days of one-per-minute context frames kept. Trade folders are kept indefinitely.</summary>
    [JsonPropertyName("retentionDays")]
    public int RetentionDays { get; set; } = 30;

    /// <summary>Stable id for this install, used in journal trade ids.</summary>
    [JsonPropertyName("installId")]
    public string? InstallId { get; set; }

    /// <summary>Optional: absolute path of the Obsidian vault folder. Trade notes are written to JARVIS/Trading/Trades.</summary>
    [JsonPropertyName("obsidianVaultPath")]
    public string? ObsidianVaultPath { get; set; }

    /// <summary>Vault folders to index for Jarvis search (empty = whole vault except .obsidian and JARVIS).</summary>
    [JsonPropertyName("vaultIndexFolders")]
    public string[]? VaultIndexFolders { get; set; }

    [JsonPropertyName("vaultIndexedAt")]
    public DateTime? VaultIndexedAt { get; set; }

    /// <summary>Optional on-screen Observer HUD (off by default). Ctrl+Alt+J toggles it.</summary>
    [JsonPropertyName("hudEnabled")]
    public bool HudEnabled { get; set; }

    [JsonPropertyName("hudX")]
    public int HudX { get; set; } = 40;

    [JsonPropertyName("hudY")]
    public int HudY { get; set; } = 120;

    [JsonIgnore]
    public bool CloudEnabled => Uri.TryCreate(ServerUrl, UriKind.Absolute, out _) && (!string.IsNullOrWhiteSpace(DeviceToken) || !string.IsNullOrWhiteSpace(TradingSecret));

    public static JsonSerializerOptions JsonOptions { get; } = new() { WriteIndented = true };

    public static ObserverConfig Load(string path)
    {
        try
        {
            if (!File.Exists(path)) return new ObserverConfig();
            return JsonSerializer.Deserialize<ObserverConfig>(File.ReadAllText(path), JsonOptions) ?? new ObserverConfig();
        }
        catch
        {
            return new ObserverConfig();
        }
    }
}

