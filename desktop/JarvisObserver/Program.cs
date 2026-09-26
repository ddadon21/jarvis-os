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

// Local Agent release: 0.7.0 — Trading Observer + bidirectional Obsidian bridge

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new ObserverContext());
    }
}

internal sealed class ObserverContext : ApplicationContext
{
    private readonly NotifyIcon _tray;
    private readonly System.Threading.Timer _captureTimer;
    private readonly System.Threading.Timer _controlTimer;
    private readonly System.Threading.Timer _semanticTimer;
    private readonly System.Threading.Timer _ocrTimer;
    private readonly LocalExecutionOcr _executionOcr = new();
    private readonly HttpClient _http = CreateHttpClient();
    private readonly UIA3Automation _automation = new();
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
    private string? _lastObsidianCommandId;
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
        ImportLocalSecretsIfPresent();
        NormalizeServerUrl();
        NormalizeObsidianConfig();
        NormalizePerformanceConfig();
        SaveConfig();

        var menu = new ContextMenuStrip();
        menu.Items.Add("Open observer folder", null, (_, _) => OpenFolder(_root));
        menu.Items.Add("Show / New pairing code", null, async (_, _) => await ShowOrCreatePairingCodeAsync());
        menu.Items.Add("Set / replace Vercel access key", null, (_, _) => PromptAndStoreVercelBypassSecret(showSuccess: true));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Obsidian: Set / replace API key", null, (_, _) => PromptAndStoreObsidianApiKey(showSuccess: true));
        menu.Items.Add("Obsidian: Test connection", null, async (_, _) => await TestObsidianConnectionAsync(showSuccess: true));
        menu.Items.Add("Obsidian: Write Local Agent test note", null, async (_, _) => await WriteObsidianAgentTestNoteAsync(showSuccess: true));
        menu.Items.Add("Pause / Resume", null, (_, _) => TogglePause());
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
        Log(new { type = "observer.started", at = DateTime.UtcNow, version = "0.7.0", mode = _config.CloudEnabled ? "CLOUD" : "PAIRING" });
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
        _ocrTimer = new System.Threading.Timer(async _ => await OcrTickAsync(), null, TimeSpan.FromMilliseconds(350), TimeSpan.FromMilliseconds(650));
        Log(new { type = "observer.local_ocr", at = DateTime.UtcNow, available = _executionOcr.Available });
    }

    protected override void ExitThreadCore()
    {
        _captureTimer.Dispose();
        _controlTimer.Dispose();
        _semanticTimer.Dispose();
        _ocrTimer.Dispose();
        _tray.Visible = false;
        _tray.Dispose();
        _http.Dispose();
        _automation.Dispose();
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
            if (_paused) return Task.CompletedTask;

            var target = FindTradingViewWindow();
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

    private async Task OcrTickAsync()
    {
        if (Interlocked.Exchange(ref _ocrBusy, 1) == 1) return;
        try
        {
            if (_paused || !_executionOcr.Available) return;

            var target = FindTradingViewWindow();
            if (target == IntPtr.Zero) return;

            using var frame = CaptureWindow(target);
            if (frame is null) return;

            Point? pointer = null;
            if (GetCursorPos(out var cursor) && GetWindowRect(target, out var rect))
                pointer = new Point(cursor.X - rect.Left, cursor.Y - rect.Top);
            var ocr = await _executionOcr.ReadAsync(frame, pointer);
            if (string.IsNullOrWhiteSpace(ocr)) return;

            var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(ocr)));
            var changed = false;
            lock (_semanticGate)
            {
                _latestOcrText = ocr;
                _latestOcrAt = DateTime.UtcNow;
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
                    _richExecutionSemanticAt = DateTime.UtcNow;
                }
                else if (ocr.Contains("JARVIS_OCR_EXECUTION|STATUS=FLAT", StringComparison.OrdinalIgnoreCase))
                {
                    // Two consecutive clean OCR scans with no chart order are stronger
                    // than a stale accessibility snapshot. Drop the old pending hold so
                    // cancel returns Jarvis to WAITING on the next upload.
                    _richExecutionSemanticText = null;
                    _richExecutionSemanticAt = DateTime.MinValue;
                }
            }

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
            Volatile.Write(ref _ocrBusy, 0);
        }
    }

    private async Task TickAsync()
    {
        if (Interlocked.Exchange(ref _captureBusy, 1) == 1) return;
        try
        {
            if (_paused) return;

            var target = FindTradingViewWindow();
            if (target == IntPtr.Zero)
            {
                if (_tradingViewDetected)
                {
                    _tradingViewDetected = false;
                    _tray.Text = "Jarvis Trading Observer — standby";
                    Log(new { type = "tradingview.closed", at = DateTime.UtcNow });
                }
                return;
            }

            if (!_tradingViewDetected)
            {
                _tradingViewDetected = true;
                BeginSession();
                _tray.Text = "Jarvis Trading Observer — ACTIVE";
                _tray.ShowBalloonTip(2500, "JARVIS TRADING OBSERVER", "TradingView detected. Read-only observation is active.", ToolTipIcon.Info);
                Log(new { type = "tradingview.detected", at = DateTime.UtcNow });
            }

            using var frame = CaptureWindow(target);
            if (frame is null)
            {
                LogRateLimited("capture.unavailable", TimeSpan.FromSeconds(30));
                return;
            }

            var signature = BuildSignature(frame);
            var difference = _lastSignature is null ? 1d : SignatureDifference(_lastSignature, signature);
            _lastSignature = signature;

            var now = DateTime.UtcNow;
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

            if (_config.CloudEnabled && now - _lastSentUtc >= TimeSpan.FromMilliseconds(_config.MinimumCloudIntervalMs))
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
        var path = Path.Combine(_sessionDir, $"frame_{_frameNumber:0000}_{at:HHmmss}.jpg");
        File.WriteAllBytes(path, jpg);
        File.AppendAllText(Path.Combine(_sessionDir, "frames.jsonl"), JsonSerializer.Serialize(new
        {
            frame = _frameNumber,
            at,
            visualDifference = Math.Round(difference, 5),
            file = Path.GetFileName(path),
        }) + Environment.NewLine);
        TrimSessionFrames(_sessionDir, _config.MaxLocalFrames);
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
        if (semantic.Contains("JARVIS_OCR_EXECUTION|STATUS=PENDING", StringComparison.OrdinalIgnoreCase)) return true;
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
            observerVersion = "0.6.0",
            semanticText = string.IsNullOrWhiteSpace(semanticText) ? null : SanitizeSensitive(semanticText),
        });

        using var req = new HttpRequestMessage(HttpMethod.Post, endpoint);
        ApplyVercelBypassHeaders(req);
        var bearer = !string.IsNullOrWhiteSpace(_config.DeviceToken) ? _config.DeviceToken : _config.TradingSecret;
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        if (!string.IsNullOrWhiteSpace(_config.DeviceId))
        {
            req.Headers.Add("x-jarvis-device-id", _config.DeviceId);
            req.Headers.Add("x-jarvis-observer-version", "0.7.0");
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
            req.Headers.Add("x-jarvis-observer-version", "0.6.0");
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

            var nextPaused = !string.Equals(command, "WATCH", StringComparison.OrdinalIgnoreCase);
            if (_paused != nextPaused)
            {
                _paused = nextPaused;
                Log(new { type = _paused ? "observer.remote_paused" : "observer.remote_watch", at = DateTime.UtcNow });
            }

            if (link.TryGetProperty("obsidianCommand", out var obsidianCommand) &&
                obsidianCommand.ValueKind == JsonValueKind.Object)
            {
                await HandleObsidianCommandAsync(obsidianCommand);
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
                ? "Jarvis Trading Observer — paused"
                : (_tradingViewDetected ? "Jarvis Trading Observer — ACTIVE" : "Jarvis Trading Observer — WATCHING");
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

        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(action)) return;
        if (string.Equals(_lastObsidianCommandId, id, StringComparison.Ordinal)) return;
        _lastObsidianCommandId = id;

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

        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, endpoint);
            ApplyVercelBypassHeaders(req);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _config.DeviceToken);
            req.Headers.Add("x-jarvis-device-id", _config.DeviceId);
            req.Headers.Add("x-jarvis-observer-version", "0.6.0");
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

            if (!response.IsSuccessStatusCode)
            {
                // Allow the command to be attempted again if the cloud could not acknowledge it.
                _lastObsidianCommandId = null;
            }
        }
        catch (Exception ex)
        {
            _lastObsidianCommandId = null;
            Log(new { type = "obsidian.command.result_error", at = DateTime.UtcNow, id, error = ex.Message });
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

    private static string EncodeObsidianPath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return string.Empty;
        var clean = path.Replace('\\', '/').Trim('/');
        if (clean.Split('/', StringSplitOptions.RemoveEmptyEntries).Any(part => part is "." or ".." || part.Equals(".obsidian", StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException("Unsafe Obsidian path.");
        return string.Join("/", clean.Split('/', StringSplitOptions.RemoveEmptyEntries).Select(Uri.EscapeDataString));
    }

    private async Task HandleObsidianCommandAsync(JsonElement commandNode)
    {
        var id = commandNode.TryGetProperty("id", out var idNode) ? idNode.GetString() : null;
        var action = commandNode.TryGetProperty("action", out var actionNode) ? actionNode.GetString()?.ToUpperInvariant() : null;
        var path = commandNode.TryGetProperty("path", out var pathNode) && pathNode.ValueKind != JsonValueKind.Null ? pathNode.GetString() : null;
        var content = commandNode.TryGetProperty("content", out var contentNode) && contentNode.ValueKind != JsonValueKind.Null ? contentNode.GetString() : null;
        var query = commandNode.TryGetProperty("query", out var queryNode) && queryNode.ValueKind != JsonValueKind.Null ? queryNode.GetString() : null;

        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(action)) return;

        var result = await ExecuteObsidianCommandAsync(action, path, content, query);
        await SubmitObsidianCommandResultAsync(id, action, path, result.ok, result.data, result.error);
    }

    private async Task<(bool ok, string? data, string? error)> ExecuteObsidianCommandAsync(
        string action,
        string? path,
        string? content,
        string? query)
    {
        var apiKey = GetObsidianApiKey();
        if (string.IsNullOrWhiteSpace(apiKey))
            return (false, null, "Obsidian API key is not configured on the Local Agent.");

        var baseUrl = ObsidianBaseUrl();
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var baseUri) || !baseUri.IsLoopback)
            return (false, null, "Obsidian URL must be loopback / localhost.");

        try
        {
            HttpRequestMessage req;
            switch (action)
            {
                case "LIST":
                {
                    var encoded = EncodeObsidianPath(path);
                    var url = baseUrl + "/vault/" + (encoded.Length > 0 ? encoded.TrimEnd('/') + "/" : string.Empty);
                    req = new HttpRequestMessage(HttpMethod.Get, url);
                    break;
                }
                case "READ":
                {
                    if (string.IsNullOrWhiteSpace(path)) return (false, null, "READ requires a note path.");
                    req = new HttpRequestMessage(HttpMethod.Get, baseUrl + "/vault/" + EncodeObsidianPath(path));
                    break;
                }
                case "WRITE":
                {
                    if (string.IsNullOrWhiteSpace(path)) return (false, null, "WRITE requires a note path.");
                    if (!path.EndsWith(".md", StringComparison.OrdinalIgnoreCase)) return (false, null, "WRITE only supports Markdown notes.");
                    req = new HttpRequestMessage(HttpMethod.Put, baseUrl + "/vault/" + EncodeObsidianPath(path))
                    {
                        Content = new StringContent(content ?? string.Empty, Encoding.UTF8, "text/markdown"),
                    };
                    break;
                }
                case "SEARCH":
                {
                    if (string.IsNullOrWhiteSpace(query)) return (false, null, "SEARCH requires a query.");
                    var url = baseUrl + "/search/simple/?query=" + Uri.EscapeDataString(query.Trim()) + "&contextLength=180";
                    req = new HttpRequestMessage(HttpMethod.Post, url);
                    break;
                }
                default:
                    return (false, null, "Unsupported Obsidian action.");
            }

            using (req)
            {
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                using var res = await _http.SendAsync(req, cts.Token);
                var body = await res.Content.ReadAsStringAsync(cts.Token);
                if (body.Length > 180_000) body = body[..180_000];

                Log(new
                {
                    type = "obsidian.command",
                    at = DateTime.UtcNow,
                    action,
                    path,
                    status = (int)res.StatusCode,
                    ok = res.IsSuccessStatusCode,
                });

                return res.IsSuccessStatusCode
                    ? (true, body, null)
                    : (false, body, $"Obsidian returned HTTP {(int)res.StatusCode}.");
            }
        }
        catch (Exception ex)
        {
            Log(new { type = "obsidian.command.error", at = DateTime.UtcNow, action, path, error = ex.Message });
            return (false, null, ex.Message);
        }
    }

    private async Task SubmitObsidianCommandResultAsync(
        string id,
        string action,
        string? path,
        bool ok,
        string? data,
        string? error)
    {
        if (string.IsNullOrWhiteSpace(_config.ServerUrl) ||
            string.IsNullOrWhiteSpace(_config.DeviceId) ||
            string.IsNullOrWhiteSpace(_config.DeviceToken)) return;

        try
        {
            var endpoint = _config.ServerUrl.TrimEnd('/') + "/api/obsidian/result";
            var body = JsonSerializer.Serialize(new
            {
                id,
                action,
                ok,
                path,
                data,
                error,
                completedAt = DateTime.UtcNow.ToString("O"),
            });

            using var req = new HttpRequestMessage(HttpMethod.Post, endpoint)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            };
            ApplyVercelBypassHeaders(req);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _config.DeviceToken);
            req.Headers.Add("x-jarvis-device-id", _config.DeviceId);

            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            using var res = await _http.SendAsync(req, cts.Token);
            Log(new
            {
                type = "obsidian.command.result",
                at = DateTime.UtcNow,
                id,
                action,
                ok,
                delivered = res.IsSuccessStatusCode,
                status = (int)res.StatusCode,
            });
        }
        catch (Exception ex)
        {
            Log(new { type = "obsidian.command.result_error", at = DateTime.UtcNow, id, action, error = ex.Message });
        }
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

    private static string? PromptSecret(string prompt, string title)
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
            UseSystemPasswordChar = true,
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

    private void NormalizeServerUrl()
    {
        const string current = "https://jarvis-os-git-claude-jarvis-ai-119654-dwights-projects-8a9a094f.vercel.app";
        _config.ServerUrl = current;
        _config.AccessBootstrapUrl = null;
    }

    private void NormalizePerformanceConfig()
    {
        // Upgrade older local configs to the responsive v0.4.5 observation cadence.
        _config.MinimumCloudIntervalMs = Math.Min(_config.MinimumCloudIntervalMs, 700);
        _config.HeartbeatSeconds = Math.Min(_config.HeartbeatSeconds, 3);
        _config.SemanticPollMs = Math.Min(_config.SemanticPollMs, 250);
    }

    private void SaveConfig()
    {
        lock (_configGate)
        {
            try { File.WriteAllText(_configPath, JsonSerializer.Serialize(_config, ObserverConfig.JsonOptions)); } catch { }
        }
    }

    private void TogglePause()
    {
        _paused = !_paused;
        _tray.Text = _paused ? "Jarvis Trading Observer — paused" : (_tradingViewDetected ? "Jarvis Trading Observer — ACTIVE" : "Jarvis Trading Observer — standby");
        _tray.ShowBalloonTip(1800, "JARVIS TRADING OBSERVER", _paused ? "Observation paused." : "Observation resumed.", ToolTipIcon.Info);
        Log(new { type = _paused ? "observer.paused" : "observer.resumed", at = DateTime.UtcNow });
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

    private static IntPtr FindTradingViewWindow()
    {
        foreach (var process in Process.GetProcesses())
        {
            try
            {
                var name = process.ProcessName;
                if (!name.Contains("TradingView", StringComparison.OrdinalIgnoreCase)) continue;
                if (process.MainWindowHandle == IntPtr.Zero || !IsWindowVisible(process.MainWindowHandle) || IsIconic(process.MainWindowHandle)) continue;
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

    private static void TrimSessionFrames(string dir, int max)
    {
        var files = Directory.GetFiles(dir, "frame_*.jpg").OrderBy(File.GetCreationTimeUtc).ToArray();
        if (files.Length <= max) return;
        foreach (var file in files.Take(files.Length - max))
        {
            try { File.Delete(file); } catch { }
        }
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

    [JsonPropertyName("maxLocalFrames")]
    public int MaxLocalFrames { get; set; } = 600;

    [JsonPropertyName("semanticPollMs")]
    public int SemanticPollMs { get; set; } = 250;

    [JsonPropertyName("maxSemanticChars")]
    public int MaxSemanticChars { get; set; } = 20000;

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

