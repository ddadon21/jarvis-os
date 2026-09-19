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
    private readonly System.Threading.Timer _timer;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(25) };
    private readonly UIA3Automation _automation = new();
    private readonly string _root;
    private readonly string _configPath;
    private ObserverConfig _config;
    private int _busy;
    private bool _paused;
    private bool _tradingViewDetected;
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

    public ObserverContext()
    {
        _root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "JarvisObserver");
        Directory.CreateDirectory(_root);
        _configPath = Path.Combine(_root, "config.json");
        _config = ObserverConfig.Load(_configPath);
        NormalizeServerUrl();
        SaveConfig();

        var menu = new ContextMenuStrip();
        menu.Items.Add("Open observer folder", null, (_, _) => OpenFolder(_root));
        menu.Items.Add("Show / New pairing code", null, async (_, _) => await ShowOrCreatePairingCodeAsync());
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
        Log(new { type = "observer.started", at = DateTime.UtcNow, version = "0.4.2", mode = _config.CloudEnabled ? "CLOUD" : "PAIRING" });
        _timer = new System.Threading.Timer(async _ => await TickAsync(), null, TimeSpan.Zero, TimeSpan.FromMilliseconds(500));
    }

    protected override void ExitThreadCore()
    {
        _timer.Dispose();
        _tray.Visible = false;
        _tray.Dispose();
        _http.Dispose();
        _automation.Dispose();
        base.ExitThreadCore();
    }

    private async Task TickAsync()
    {
        if (Interlocked.Exchange(ref _busy, 1) == 1) return;
        try
        {
            await EnsurePairingAndControlAsync();
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
                await UploadFrameAsync(jpg, now, difference, _latestSemanticText);
                _lastSentUtc = now;
            }
        }
        catch (Exception ex)
        {
            Log(new { type = "observer.error", at = DateTime.UtcNow, error = ex.Message });
        }
        finally
        {
            Volatile.Write(ref _busy, 0);
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

    private async Task UploadFrameAsync(byte[] jpg, DateTime at, double difference, string? semanticText)
    {
        var endpoint = _config.ServerUrl!.TrimEnd('/') + "/api/trading/observe-frame";
        var body = JsonSerializer.Serialize(new
        {
            capturedAt = at,
            imageBase64 = Convert.ToBase64String(jpg),
            visualDifference = difference,
            source = "TradingView Desktop",
            observerVersion = "0.4.2",
            semanticText = string.IsNullOrWhiteSpace(semanticText) ? null : SanitizeSensitive(semanticText),
        });

        using var req = new HttpRequestMessage(HttpMethod.Post, endpoint);
        var bearer = !string.IsNullOrWhiteSpace(_config.DeviceToken) ? _config.DeviceToken : _config.TradingSecret;
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        if (!string.IsNullOrWhiteSpace(_config.DeviceId))
        {
            req.Headers.Add("x-jarvis-device-id", _config.DeviceId);
            req.Headers.Add("x-jarvis-observer-version", "0.4.2");
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
        await EnsureDeploymentAccessAsync();

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

        if (now - _lastControlPollUtc < TimeSpan.FromSeconds(2)) return;
        _lastControlPollUtc = now;

        try
        {
            var endpoint = _config.ServerUrl!.TrimEnd('/') + "/api/trading/device/control";
            using var req = new HttpRequestMessage(HttpMethod.Get, endpoint);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _config.DeviceToken);
            req.Headers.Add("x-jarvis-device-id", _config.DeviceId);
            req.Headers.Add("x-jarvis-observer-version", "0.4.2");
            using var res = await _http.SendAsync(req);

            if ((int)res.StatusCode == 401)
            {
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
            using var res = await _http.GetAsync(_config.AccessBootstrapUrl);
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
            using var res = await _http.SendAsync(req);
            if (!res.IsSuccessStatusCode)
            {
                LogRateLimited("pair.start.failed:" + (int)res.StatusCode, TimeSpan.FromSeconds(30));
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
            Log(new { type = "observer.pairing_ready", at = DateTime.UtcNow, code = _config.PairingCode, expiresAt = _config.PairingExpiresAt });
        }
        catch (Exception ex)
        {
            LogRateLimited("pair.start.error:" + ex.GetType().Name, TimeSpan.FromSeconds(30));
        }
    }

    private async Task ShowOrCreatePairingCodeAsync()
    {
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
        const string access = "https://jarvis-os-git-claude-jarvis-ai-119654-dwights-projects-8a9a094f.vercel.app/?_vercel_share=1yQkOpuIMcr4tlwrP37nCgJTxmZmXj5A";
        _config.ServerUrl = current;
        _config.AccessBootstrapUrl = access;
    }

    private void SaveConfig()
    {
        try { File.WriteAllText(_configPath, JsonSerializer.Serialize(_config, ObserverConfig.JsonOptions)); } catch { }
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
        Directory.CreateDirectory(_root);
        File.AppendAllText(Path.Combine(_root, "observer.jsonl"), JsonSerializer.Serialize(value) + Environment.NewLine);
    }

    private readonly Dictionary<string, DateTime> _lastRateLimitedLog = new();
    private void LogRateLimited(string type, TimeSpan interval)
    {
        var now = DateTime.UtcNow;
        if (_lastRateLimitedLog.TryGetValue(type, out var last) && now - last < interval) return;
        _lastRateLimitedLog[type] = now;
        Log(new { type, at = now });
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
            var lines = new List<string>();
            var elements = root.FindAllDescendants();

            foreach (var element in elements.Take(1200))
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

                    var payload = string.Join(" | ", new[] { control, name, automationId, help, itemStatus }
                        .Where(x => !string.IsNullOrWhiteSpace(x)));

                    if (!string.IsNullOrWhiteSpace(payload))
                    {
                        lines.Add(payload);
                    }
                }
                catch
                {
                    // TradingView's accessibility tree can mutate during a live update.
                }

                if (lines.Sum(x => x.Length + 1) >= maxChars) break;
            }

            var combined = string.Join(Environment.NewLine, lines);
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
    public string? AccessBootstrapUrl { get; set; } = "https://jarvis-os-git-claude-jarvis-ai-119654-dwights-projects-8a9a094f.vercel.app/?_vercel_share=1yQkOpuIMcr4tlwrP37nCgJTxmZmXj5A";

    [JsonPropertyName("tradingSecret")]
    public string? TradingSecret { get; set; }

    [JsonPropertyName("deviceId")]
    public string? DeviceId { get; set; }

    [JsonPropertyName("deviceToken")]
    public string? DeviceToken { get; set; }

    [JsonPropertyName("pairingCode")]
    public string? PairingCode { get; set; }

    [JsonPropertyName("pairingExpiresAt")]
    public string? PairingExpiresAt { get; set; }

    [JsonPropertyName("minimumCloudIntervalMs")]
    public int MinimumCloudIntervalMs { get; set; } = 1500;

    [JsonPropertyName("heartbeatSeconds")]
    public int HeartbeatSeconds { get; set; } = 10;

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
    public int SemanticPollMs { get; set; } = 750;

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
