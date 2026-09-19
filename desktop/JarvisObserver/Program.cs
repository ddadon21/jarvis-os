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
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(25) };
    private readonly UIA3Automation _automation = new();
    private readonly string _root;
    private readonly string _configPath;
    private ObserverConfig _config;
    private int _captureBusy;
    private int _controlBusy;
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
    private byte[]? _lastSignature;
    private string? _sessionDir;
    private int _frameNumber;

    // Cloud interpretation must never block the 500ms local observation loop.
    // Keep only the newest pending frame while one cloud request is in flight.
    private readonly object _cloudQueueGate = new();
    private readonly object _logGate = new();
    private readonly object _configGate = new();
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
        NormalizeServerUrl();
        NormalizePerformanceConfig();
        SaveConfig();

        var menu = new ContextMenuStrip();
        menu.Items.Add("Open observer folder", null, (_, _) => OpenFolder(_root));
        menu.Items.Add("Show / New pairing code", null, async (_, _) => await ShowOrCreatePairingCodeAsync());
        menu.Items.Add("Set / replace Vercel access key", null, (_, _) => PromptAndStoreVercelBypassSecret(showSuccess: true));
        menu.Items.Add("Pause / Resume", null, (_, _) => TogglePause());
        menu.Items.Add("Open config", null, (_, _) => OpenFile(_configPath));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => ExitThread());

        _tray = new NotifyIcon
        {
            Icon = SystemIcons.Shield,
            Text = "Jarvis Trading Observer — standby",
            Visible = true,
            ContextMenuStrip = menu,
        };

        EnsureConfigExists();
        Log(new { type = "observer.started", at = DateTime.UtcNow, version = "0.4.8", mode = _config.CloudEnabled ? "CLOUD" : "PAIRING" });
        _captureTimer = new System.Threading.Timer(async _ => await TickAsync(), null, TimeSpan.Zero, TimeSpan.FromMilliseconds(500));
        _controlTimer = new System.Threading.Timer(async _ => await ControlTickAsync(), null, TimeSpan.Zero, TimeSpan.FromMilliseconds(500));
    }

    protected override void ExitThreadCore()
    {
        _captureTimer.Dispose();
        _controlTimer.Dispose();
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

            var semanticNow = DateTime.UtcNow;
            if (semanticNow - _lastSemanticPollUtc >= TimeSpan.FromMilliseconds(_config.SemanticPollMs))
            {
                _lastSemanticPollUtc = semanticNow;
                var semantic = CaptureAccessibleText(target, _config.MaxSemanticChars);
                if (!string.IsNullOrWhiteSpace(semantic))
                {
                    _latestSemanticText = semantic;
                    var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(semantic)));
                    if (!string.Equals(hash, _lastSemanticHash, StringComparison.Ordinal))
                    {
                        _lastSemanticHash = hash;
                        SaveSemanticSnapshot(semantic, semanticNow, hash);
                    }
                }
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
            if (!meaningfulVisualChange && !heartbeatDue) return;

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
                QueueCloudFrame(jpg, now, difference, _latestSemanticText);
                _lastSentUtc = now;
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
        _latestSemanticText = null;
        _lastSemanticHash = null;
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
            observerVersion = "0.4.8",
            semanticText = string.IsNullOrWhiteSpace(semanticText) ? null : SanitizeSensitive(semanticText),
        });

        using var req = new HttpRequestMessage(HttpMethod.Post, endpoint);
        ApplyVercelBypassHeaders(req);
        var bearer = !string.IsNullOrWhiteSpace(_config.DeviceToken) ? _config.DeviceToken : _config.TradingSecret;
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        if (!string.IsNullOrWhiteSpace(_config.DeviceId))
        {
            req.Headers.Add("x-jarvis-device-id", _config.DeviceId);
            req.Headers.Add("x-jarvis-observer-version", "0.4.8");
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
            req.Headers.Add("x-jarvis-observer-version", "0.4.8");
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
                ? "Jarvis Trading Observer — paused"
                : (_tradingViewDetected ? "Jarvis Trading Observer — ACTIVE" : "Jarvis Trading Observer — WATCHING");
        }
        catch (Exception ex)
        {
            LogRateLimited("control.link.unavailable:" + ex.GetType().Name, TimeSpan.FromSeconds(30));
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
        _config.SemanticPollMs = Math.Min(_config.SemanticPollMs, 500);
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
            var priorityLines = new List<string>();
            var lines = new List<string>();
            var elements = root.FindAllDescendants();

            foreach (var element in elements.Take(2400))
            {
                try
                {
                    if (element.Properties.IsPassword.ValueOrDefault) continue;

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
                        string.IsNullOrWhiteSpace(className) ? string.Empty : $"class={className}",
                    }.Where(x => !string.IsNullOrWhiteSpace(x)));

                    if (string.IsNullOrWhiteSpace(payload)) continue;

                    if (Regex.IsMatch(
                        payload,
                        @"\b(buy|sell|limit|stop|market|order|position|quantity|qty|price|cancel|working|filled|flatten|reverse|bracket|take profit|stop loss|pnl|profit|loss)\b",
                        RegexOptions.IgnoreCase))
                    {
                        priorityLines.Add(payload);
                    }
                    else
                    {
                        lines.Add(payload);
                    }
                }
                catch
                {
                    // TradingView's accessibility tree can mutate during a live update.
                }
            }

            // Execution state must never be pushed out of the semantic snapshot by
            // unrelated chart/watchlist elements. Priority lines go first and are
            // deduplicated while preserving their first observed order.
            var ordered = priorityLines
                .Concat(lines)
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
        return maskedLongNumbers.Length > 16000 ? maskedLongNumbers[..16000] : maskedLongNumbers;
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
    public int SemanticPollMs { get; set; } = 500;

    [JsonPropertyName("maxSemanticChars")]
    public int MaxSemanticChars { get; set; } = 12000;

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
