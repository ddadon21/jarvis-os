using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text.Json;
using FlaUI.Core.AutomationElements;
using FlaUI.UIA3;

namespace JarvisObserver;

internal sealed record DesktopActionCommand(
    string Id,
    string Action,
    string? Target,
    string? Text,
    string[] Args,
    string Authorization);

internal sealed record DesktopActionResult(
    string Id,
    string Action,
    bool Ok,
    string Summary,
    string? Data,
    string[] Evidence,
    string? Error,
    DateTime CompletedAt);

internal sealed class DesktopActionRuntime
{
    private readonly UIA3Automation _automation;
    private readonly Control _uiInvoker;

    private static readonly Dictionary<string, string> AppAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["chrome"] = "chrome.exe",
        ["google chrome"] = "chrome.exe",
        ["edge"] = "msedge.exe",
        ["microsoft edge"] = "msedge.exe",
        ["vscode"] = "code",
        ["vs code"] = "code",
        ["visual studio code"] = "code",
        ["obsidian"] = "obsidian",
        ["terminal"] = "wt.exe",
        ["windows terminal"] = "wt.exe",
        ["explorer"] = "explorer.exe",
        ["file explorer"] = "explorer.exe",
        ["notepad"] = "notepad.exe",
        ["calculator"] = "calc.exe",
        ["spotify"] = "spotify",
    };

    public DesktopActionRuntime(UIA3Automation automation, Control uiInvoker)
    {
        _automation = automation;
        _uiInvoker = uiInvoker;
    }

    public async Task<DesktopActionResult> ExecuteAsync(DesktopActionCommand command)
    {
        try
        {
            return command.Action.ToUpperInvariant() switch
            {
                "GET_CONTEXT" => GetContext(command),
                "SCREEN_CAPTURE" => CaptureScreen(command),
                "OPEN_APP" => OpenApp(command),
                "FOCUS_WINDOW" => FocusWindow(command),
                "OPEN_PATH" => OpenPath(command),
                "OPEN_URI" => OpenUri(command),
                "CLIPBOARD_READ" => await ClipboardReadAsync(command),
                "CLIPBOARD_WRITE" => await ClipboardWriteAsync(command),
                "UI_CLICK_TEXT" => ClickText(command),
                "UI_TYPE_TEXT" => await TypeTextAsync(command),
                "RUN_APPROVED_COMMAND" => await RunApprovedCommandAsync(command),
                _ => Fail(command, "Unsupported desktop action."),
            };
        }
        catch (Exception ex)
        {
            return Fail(command, ex.Message);
        }
    }

    private DesktopActionResult GetContext(DesktopActionCommand command)
    {
        var foreground = GetForegroundWindow();
        var activeTitle = WindowTitle(foreground);
        var activePid = 0u;
        if (foreground != IntPtr.Zero) GetWindowThreadProcessId(foreground, out activePid);

        string? processName = null;
        if (activePid > 0)
        {
            try { processName = Process.GetProcessById((int)activePid).ProcessName; } catch { }
        }

        var windows = Process.GetProcesses()
            .Select(process =>
            {
                try
                {
                    return new
                    {
                        process = process.ProcessName,
                        pid = process.Id,
                        title = process.MainWindowTitle,
                        handle = process.MainWindowHandle,
                    };
                }
                catch
                {
                    return null;
                }
            })
            .Where(item => item is not null && item.handle != IntPtr.Zero && !string.IsNullOrWhiteSpace(item.title))
            .OrderBy(item => item!.process)
            .Take(30)
            .Select(item => new { item!.process, item.pid, item.title })
            .ToArray();

        var focusedName = "";
        try { focusedName = _automation.FocusedElement()?.Name ?? ""; } catch { }

        GetCursorPos(out var cursor);
        var payload = JsonSerializer.Serialize(new
        {
            activeWindow = new { title = activeTitle, process = processName, pid = activePid },
            focusedElement = focusedName,
            cursor = new { x = cursor.X, y = cursor.Y },
            visibleWindows = windows,
            capturedAt = DateTime.UtcNow,
        });

        return Ok(command,
            string.IsNullOrWhiteSpace(activeTitle) ? "Desktop context captured." : $"Desktop context captured. Active window: {activeTitle}.",
            payload,
            new[]
            {
                $"activeWindow={activeTitle}",
                $"activeProcess={processName ?? "unknown"}",
                $"visibleWindows={windows.Length}",
            });
    }

    private DesktopActionResult CaptureScreen(DesktopActionCommand command)
    {
        var screen = Screen.PrimaryScreen ?? throw new InvalidOperationException("No primary screen is available.");
        using var original = new Bitmap(screen.Bounds.Width, screen.Bounds.Height, PixelFormat.Format24bppRgb);
        using (var graphics = Graphics.FromImage(original))
        {
            graphics.CopyFromScreen(screen.Bounds.Left, screen.Bounds.Top, 0, 0, screen.Bounds.Size, CopyPixelOperation.SourceCopy);
        }

        const int maxWidth = 1280;
        const int maxHeight = 720;
        var scale = Math.Min(1d, Math.Min((double)maxWidth / original.Width, (double)maxHeight / original.Height));
        var width = Math.Max(1, (int)Math.Round(original.Width * scale));
        var height = Math.Max(1, (int)Math.Round(original.Height * scale));

        using var resized = new Bitmap(width, height, PixelFormat.Format24bppRgb);
        using (var graphics = Graphics.FromImage(resized))
        {
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            graphics.DrawImage(original, 0, 0, width, height);
        }

        using var stream = new MemoryStream();
        var codec = ImageCodecInfo.GetImageEncoders().First(x => x.FormatID == ImageFormat.Jpeg.Guid);
        using var parameters = new EncoderParameters(1);
        parameters.Param[0] = new EncoderParameter(Encoder.Quality, 48L);
        resized.Save(stream, codec, parameters);
        var bytes = stream.ToArray();
        var dataUri = "data:image/jpeg;base64," + Convert.ToBase64String(bytes);

        return Ok(command,
            $"Captured primary screen at {width}×{height}.",
            dataUri,
            new[] { $"screen={screen.DeviceName}", $"size={width}x{height}", $"jpegBytes={bytes.Length}" });
    }

    private DesktopActionResult OpenApp(DesktopActionCommand command)
    {
        RequireAuthorized(command);
        var target = Required(command.Target, "OPEN_APP requires an application name.");
        var launch = AppAliases.TryGetValue(target, out var alias) ? alias : target;

        if (Path.IsPathRooted(launch) && !File.Exists(launch))
            throw new FileNotFoundException("Application path does not exist.", launch);

        Process.Start(new ProcessStartInfo(launch) { UseShellExecute = true });
        return Ok(command, $"Opened {target}.", null, new[] { $"launch={launch}" });
    }

    private DesktopActionResult FocusWindow(DesktopActionCommand command)
    {
        RequireAuthorized(command);
        var target = Required(command.Target, "FOCUS_WINDOW requires a window title.");

        var match = Process.GetProcesses()
            .Select(process =>
            {
                try { return new { Process = process, Title = process.MainWindowTitle, Handle = process.MainWindowHandle }; }
                catch { return null; }
            })
            .FirstOrDefault(item =>
                item is not null &&
                item.Handle != IntPtr.Zero &&
                item.Title.Contains(target, StringComparison.OrdinalIgnoreCase));

        if (match is null) throw new InvalidOperationException($"No visible window matched '{target}'.");

        if (IsIconic(match.Handle)) ShowWindowAsync(match.Handle, 9);
        ShowWindowAsync(match.Handle, 5);
        if (!SetForegroundWindow(match.Handle))
            throw new InvalidOperationException($"Windows did not allow JARVIS to focus '{match.Title}'.");

        return Ok(command, $"Focused {match.Title}.", null, new[] { $"process={match.Process.ProcessName}", $"window={match.Title}" });
    }

    private DesktopActionResult OpenPath(DesktopActionCommand command)
    {
        RequireAuthorized(command);
        var raw = Required(command.Target, "OPEN_PATH requires a path.");
        var expanded = Environment.ExpandEnvironmentVariables(raw);
        var full = Path.GetFullPath(expanded);
        if (!File.Exists(full) && !Directory.Exists(full))
            throw new FileNotFoundException("The requested local path does not exist.", full);

        Process.Start(new ProcessStartInfo(full) { UseShellExecute = true });
        return Ok(command, $"Opened {full}.", null, new[] { $"path={full}" });
    }

    private DesktopActionResult OpenUri(DesktopActionCommand command)
    {
        RequireAuthorized(command);
        var raw = Required(command.Target, "OPEN_URI requires a URL.");
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            throw new InvalidOperationException("JARVIS Desktop only opens HTTP or HTTPS URLs through OPEN_URI.");

        Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        return Ok(command, $"Opened {uri.Host}.", null, new[] { $"uri={uri.AbsoluteUri}" });
    }

    private async Task<DesktopActionResult> ClipboardReadAsync(DesktopActionCommand command)
    {
        var text = await OnUiAsync(() => Clipboard.ContainsText() ? Clipboard.GetText() : "");
        return Ok(command, "Clipboard read completed.", text, new[] { $"characters={text.Length}" });
    }

    private async Task<DesktopActionResult> ClipboardWriteAsync(DesktopActionCommand command)
    {
        RequireAuthorized(command);
        var text = command.Text ?? "";
        await OnUiAsync(() =>
        {
            Clipboard.SetText(text);
            return true;
        });
        return Ok(command, "Clipboard updated.", null, new[] { $"characters={text.Length}" });
    }

    private DesktopActionResult ClickText(DesktopActionCommand command)
    {
        RequireAuthorized(command);
        var controlName = Required(command.Target, "UI_CLICK_TEXT requires an accessibility name.");
        var windowHint = command.Args.FirstOrDefault();

        var hwnd = string.IsNullOrWhiteSpace(windowHint) ? GetForegroundWindow() : FindWindowByTitle(windowHint);
        if (hwnd == IntPtr.Zero) throw new InvalidOperationException("No target window is available for UI automation.");

        var root = _automation.FromHandle(hwnd);
        var element = root.FindFirstDescendant(cf => cf.ByName(controlName));
        if (element is null)
            throw new InvalidOperationException($"No accessible control named '{controlName}' was found in the target window.");

        element.Click();
        return Ok(command, $"Clicked '{controlName}'.", null, new[]
        {
            $"window={WindowTitle(hwnd)}",
            $"control={element.Name}",
            $"automationId={element.AutomationId}",
        });
    }

    private async Task<DesktopActionResult> TypeTextAsync(DesktopActionCommand command)
    {
        RequireAuthorized(command);
        var text = command.Text ?? "";
        if (!string.IsNullOrWhiteSpace(command.Target))
        {
            var hwnd = FindWindowByTitle(command.Target);
            if (hwnd == IntPtr.Zero) throw new InvalidOperationException($"No visible window matched '{command.Target}'.");
            if (IsIconic(hwnd)) ShowWindowAsync(hwnd, 9);
            ShowWindowAsync(hwnd, 5);
            SetForegroundWindow(hwnd);
            await Task.Delay(80);
        }

        await OnUiAsync(() =>
        {
            var hadText = Clipboard.ContainsText();
            var previous = hadText ? Clipboard.GetText() : null;
            Clipboard.SetText(text);
            SendKeys.SendWait("^v");
            if (previous is not null) Clipboard.SetText(previous);
            else Clipboard.Clear();
            return true;
        });

        return Ok(command, "Typed text into the focused control.", null, new[] { $"characters={text.Length}", $"window={WindowTitle(GetForegroundWindow())}" });
    }

    private async Task<DesktopActionResult> RunApprovedCommandAsync(DesktopActionCommand command)
    {
        RequireAuthorized(command);
        var name = Required(command.Target, "RUN_APPROVED_COMMAND requires a command alias.");
        var (fileName, arguments) = ApprovedCommand(name);

        var psi = new ProcessStartInfo(fileName)
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        foreach (var arg in arguments) psi.ArgumentList.Add(arg);

        if (command.Args.FirstOrDefault() is { Length: > 0 } workingDirectory)
        {
            var full = Path.GetFullPath(Environment.ExpandEnvironmentVariables(workingDirectory));
            if (!Directory.Exists(full)) throw new DirectoryNotFoundException(full);
            psi.WorkingDirectory = full;
        }

        using var process = Process.Start(psi) ?? throw new InvalidOperationException("Windows could not start the approved command.");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        var stdoutTask = process.StandardOutput.ReadToEndAsync(timeout.Token);
        var stderrTask = process.StandardError.ReadToEndAsync(timeout.Token);
        await process.WaitForExitAsync(timeout.Token);
        var stdout = await stdoutTask;
        var stderr = await stderrTask;
        var output = (stdout + (string.IsNullOrWhiteSpace(stderr) ? "" : Environment.NewLine + stderr)).Trim();
        if (output.Length > 40_000) output = output[..40_000];

        var ok = process.ExitCode == 0;
        return new DesktopActionResult(
            command.Id,
            command.Action,
            ok,
            ok ? $"Approved command '{name}' completed." : $"Approved command '{name}' exited with code {process.ExitCode}.",
            output,
            new[] { $"command={name}", $"exitCode={process.ExitCode}" },
            ok ? null : $"Process exited with code {process.ExitCode}.",
            DateTime.UtcNow);
    }

    private static (string FileName, string[] Args) ApprovedCommand(string name)
    {
        return name.ToLowerInvariant() switch
        {
            "git-status" => ("git", new[] { "status", "--short", "--branch" }),
            "git-diff-stat" => ("git", new[] { "diff", "--stat" }),
            "node-version" => ("node", new[] { "--version" }),
            "npm-version" => ("npm", new[] { "--version" }),
            "dotnet-info" => ("dotnet", new[] { "--info" }),
            "python-version" => ("python", new[] { "--version" }),
            _ => throw new InvalidOperationException($"'{name}' is not in the JARVIS approved local-command allowlist."),
        };
    }

    private IntPtr FindWindowByTitle(string title)
    {
        return Process.GetProcesses()
            .Select(process =>
            {
                try { return new { Title = process.MainWindowTitle, Handle = process.MainWindowHandle }; }
                catch { return null; }
            })
            .Where(item => item is not null && item.Handle != IntPtr.Zero)
            .FirstOrDefault(item => item!.Title.Contains(title, StringComparison.OrdinalIgnoreCase))
            ?.Handle ?? IntPtr.Zero;
    }

    private Task<T> OnUiAsync<T>(Func<T> func)
    {
        if (_uiInvoker.InvokeRequired)
        {
            var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
            _uiInvoker.BeginInvoke(new Action(() =>
            {
                try { tcs.SetResult(func()); }
                catch (Exception ex) { tcs.SetException(ex); }
            }));
            return tcs.Task;
        }
        return Task.FromResult(func());
    }

    private static void RequireAuthorized(DesktopActionCommand command)
    {
        if (!string.Equals(command.Authorization, "USER_AUTHORIZED", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("This desktop action requires explicit user authorization.");
    }

    private static string Required(string? value, string message)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new InvalidOperationException(message);
        return value.Trim();
    }

    private static DesktopActionResult Ok(DesktopActionCommand command, string summary, string? data, string[] evidence)
        => new(command.Id, command.Action, true, summary, data, evidence, null, DateTime.UtcNow);

    private static DesktopActionResult Fail(DesktopActionCommand command, string error)
        => new(command.Id, command.Action, false, "Desktop action failed.", null, Array.Empty<string>(), error, DateTime.UtcNow);

    private static string WindowTitle(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return "";
        var length = GetWindowTextLength(hwnd);
        if (length <= 0) return "";
        var buffer = new System.Text.StringBuilder(length + 1);
        GetWindowText(hwnd, buffer, buffer.Capacity);
        return buffer.ToString();
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int maxCount);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindowAsync(IntPtr hWnd, int command);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetCursorPos(out Point point);
}
