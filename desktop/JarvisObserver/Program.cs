using System.Diagnostics;
using System.Drawing.Imaging;
using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

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
    private readonly string _root;
    private readonly string _configPath;
    private ObserverConfig _config;
    private int _busy;
    private bool _paused;
    private bool _tradingViewDetected;
    private DateTime _lastSentUtc = DateTime.MinValue;
    private DateTime _lastSavedUtc = DateTime.MinValue;
    private DateTime _lastEventSavedUtc = DateTime.MinValue;
    private byte[]? _lastSignature;
    private string? _sessionDir;
    private int _frameNumber;

    public ObserverContext()
    {
        _root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "JarvisObserver");
        Directory.CreateDirectory(_root);
        _configPath = Path.Combine(_root, "config.json");
        _config = ObserverConfig.Load(_configPath);

        var menu = new ContextMenuStrip();
        menu.Items.Add("Open observer folder", null, (_, _) => OpenFolder(_root));
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
        Log(new { type = "observer.started", at = DateTime.UtcNow, version = "0.2.0", mode = _config.CloudEnabled ? "CLOUD" : "LOCAL_ONLY" });
        _timer = new System.Threading.Timer(async _ => await TickAsync(), null, TimeSpan.Zero, TimeSpan.FromMilliseconds(500));
    }

    protected override void ExitThreadCore()
    {
        _timer.Dispose();
        _tray.Visible = false;
        _tray.Dispose();
        _http.Dispose();
        base.ExitThreadCore();
    }

    private async Task TickAsync()
    {
        if (_paused || Interlocked.Exchange(ref _busy, 1) == 1) return;
        try
        {
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
                await UploadFrameAsync(jpg, now, difference);
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

    private async Task UploadFrameAsync(byte[] jpg, DateTime at, double difference)
    {
        var endpoint = _config.ServerUrl!.TrimEnd('/') + "/api/trading/observe-frame";
        var body = JsonSerializer.Serialize(new
        {
            capturedAt = at,
            imageBase64 = Convert.ToBase64String(jpg),
            visualDifference = difference,
            source = "TradingView Desktop",
            observerVersion = "0.2.0",
        });

        using var req = new HttpRequestMessage(HttpMethod.Post, endpoint);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _config.TradingSecret);
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
        File.WriteAllText(_configPath, JsonSerializer.Serialize(_config, ObserverConfig.JsonOptions));
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
    public string? ServerUrl { get; init; } = "https://jarvis-os-git-claude-jarvis-ai-119654-dwights-projects-8a9a094f.vercel.app";

    [JsonPropertyName("tradingSecret")]
    public string? TradingSecret { get; init; }

    [JsonPropertyName("minimumCloudIntervalMs")]
    public int MinimumCloudIntervalMs { get; init; } = 1500;

    [JsonPropertyName("heartbeatSeconds")]
    public int HeartbeatSeconds { get; init; } = 10;

    [JsonPropertyName("localSnapshotSeconds")]
    public int LocalSnapshotSeconds { get; init; } = 5;

    [JsonPropertyName("minimumLocalEventIntervalMs")]
    public int MinimumLocalEventIntervalMs { get; init; } = 1000;

    [JsonPropertyName("visualChangeThreshold")]
    public double VisualChangeThreshold { get; init; } = 0.003;

    [JsonPropertyName("jpegQuality")]
    public long JpegQuality { get; init; } = 62;

    [JsonPropertyName("maxLocalFrames")]
    public int MaxLocalFrames { get; init; } = 600;

    [JsonIgnore]
    public bool CloudEnabled => Uri.TryCreate(ServerUrl, UriKind.Absolute, out _) && !string.IsNullOrWhiteSpace(TradingSecret);

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
