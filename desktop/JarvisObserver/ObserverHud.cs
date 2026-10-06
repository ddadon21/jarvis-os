using System.Drawing;
using System.Runtime.InteropServices;

namespace JarvisObserver;

/// <summary>
/// Optional, movable, read-only Observer HUD: current phase, the eight Current
/// State Chart fields, read completeness and age. It never takes focus and
/// is not part of the captured frame (capture uses PrintWindow on TradingView
/// only). Ctrl+Alt+J toggles it from anywhere; Ctrl+Alt+K opens Jarvis Trading.
/// </summary>
internal sealed class ObserverHud : Form
{
    private const int WmHotkey = 0x0312;
    private const int HotkeyToggle = 0x4A01;
    private const int HotkeyOpenJarvis = 0x4A02;
    private const uint ModAlt = 0x0001, ModControl = 0x0002, ModNoRepeat = 0x4000;

    private static readonly Color Crimson = Color.FromArgb(0xB7, 0x1F, 0x26);
    private readonly Label _phase = new();
    private readonly Label _fields = new();
    private readonly Label _footer = new();
    private readonly Action _openJarvis;
    private readonly Action<Point> _moved;
    private Point _dragOffset;
    private bool _dragging;

    public ObserverHud(Point location, Action openJarvis, Action<Point> moved)
    {
        _openJarvis = openJarvis;
        _moved = moved;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        Location = location;
        Size = new Size(300, 176);
        BackColor = Color.FromArgb(10, 8, 9);
        Opacity = 0.92;
        Padding = new Padding(10, 8, 10, 8);

        var mono = new Font(FontFamily.GenericMonospace, 8.5f);
        _phase.Font = new Font(FontFamily.GenericMonospace, 11f, FontStyle.Bold);
        _phase.ForeColor = Color.White;
        _phase.Dock = DockStyle.Top;
        _phase.Height = 26;
        _fields.Font = mono;
        _fields.ForeColor = Color.FromArgb(225, 214, 215);
        _fields.Dock = DockStyle.Fill;
        _footer.Font = new Font(FontFamily.GenericMonospace, 7.5f);
        _footer.ForeColor = Color.FromArgb(160, 120, 124);
        _footer.Dock = DockStyle.Bottom;
        _footer.Height = 18;
        Controls.Add(_fields);
        Controls.Add(_footer);
        Controls.Add(_phase);

        // Drag from anywhere on the panel; screen coordinates keep it stable whichever label is grabbed.
        foreach (Control control in new Control[] { this, _phase, _fields, _footer })
        {
            control.MouseDown += (_, e) =>
            {
                if (e.Button != MouseButtons.Left) return;
                _dragging = true;
                _dragOffset = new Point(Cursor.Position.X - Location.X, Cursor.Position.Y - Location.Y);
            };
            control.MouseMove += (_, _) =>
            {
                if (_dragging) Location = new Point(Cursor.Position.X - _dragOffset.X, Cursor.Position.Y - _dragOffset.Y);
            };
            control.MouseUp += (_, _) => { if (_dragging) { _dragging = false; _moved(Location); } };
        }
        Render(ObserverPhases.Waiting, null, DateTime.UtcNow);
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            const int WsExToolWindow = 0x00000080, WsExNoActivate = 0x08000000, WsExTopmost = 0x00000008;
            var cp = base.CreateParams;
            cp.ExStyle |= WsExToolWindow | WsExNoActivate | WsExTopmost;
            return cp;
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        RegisterHotKey(Handle, HotkeyToggle, ModControl | ModAlt | ModNoRepeat, (uint)Keys.J);
        RegisterHotKey(Handle, HotkeyOpenJarvis, ModControl | ModAlt | ModNoRepeat, (uint)Keys.K);
    }

    protected override void OnHandleDestroyed(EventArgs e)
    {
        UnregisterHotKey(Handle, HotkeyToggle);
        UnregisterHotKey(Handle, HotkeyOpenJarvis);
        base.OnHandleDestroyed(e);
    }

    public event Action? ToggleRequested;

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WmHotkey)
        {
            if (m.WParam.ToInt32() == HotkeyToggle) ToggleRequested?.Invoke();
            else if (m.WParam.ToInt32() == HotkeyOpenJarvis) _openJarvis();
            return;
        }
        base.WndProc(ref m);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        using var pen = new Pen(Crimson, 1);
        e.Graphics.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
    }

    /// <summary>Safe to call from any thread.</summary>
    public void Render(string phase, ExecutionRead? read, DateTime now)
    {
        if (IsDisposed) return;
        if (InvokeRequired)
        {
            try { BeginInvoke(() => Render(phase, read, now)); } catch (InvalidOperationException) { }
            return;
        }
        _phase.Text = ObserverPhases.Label(phase);
        _phase.ForeColor = phase switch
        {
            ObserverPhases.TradeInProgress or ObserverPhases.OrderFilled => Color.FromArgb(84, 216, 164),
            ObserverPhases.PendingOrder => Color.FromArgb(224, 160, 64),
            ObserverPhases.PreparingOrder => Color.FromArgb(255, 138, 144),
            _ => Color.White,
        };
        var active = ObserverPhases.IsActive(phase) && read is not null && read.Status != "FLAT";
        string V(object? value) => active && value is not null ? Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture)! : "—";
        _fields.Text =
            $"SYMBOL {V(read?.Symbol),-9} DIR   {V(read?.Side)}\n" +
            $"QTY    {V(read?.Quantity),-9} TYPE  {V(read?.OrderType)}\n" +
            $"ENTRY  {V(read?.Entry),-9} NOW   {V(read?.Current)}\n" +
            $"STOP   {V(read?.Stop),-9} TGT   {V(read?.Target)}";
        var filled = read is null ? 0 : new object?[] { read.Symbol, read.Side, read.Quantity, read.OrderType ?? (read.Status == "OPEN" ? "" : null), read.Entry, read.Current, read.Stop, read.Target }.Count(v => v is not null);
        var age = read is null ? "no read yet" : $"{Math.Max(0, (now - read.At).TotalSeconds):0.0}s ago";
        _footer.Text = active ? $"{filled}/8 fields · read {age} · Ctrl+Alt+J hide" : $"read {age} · Ctrl+Alt+J hide · Ctrl+Alt+K Jarvis";
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);
}
