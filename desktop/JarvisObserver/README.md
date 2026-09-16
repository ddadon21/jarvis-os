# Jarvis Trading Observer

Windows x64 tray companion for TradingView Desktop.

## What v0.1 does
- Detects when a visible `TradingView` desktop process is open.
- Activates automatically; there is no daily Start Journal button.
- Captures only the TradingView window using Win32 `PrintWindow` (no keyboard capture, no mouse control, no full-desktop screen recording).
- Uses a low-resolution visual signature locally to avoid processing unchanged frames.
- Keeps capped local snapshots under `%LOCALAPPDATA%\JarvisObserver\sessions` for calibration and verification.
- Can send materially changed frames to Jarvis `/api/trading/observe-frame` when the secure cloud secret is configured.
- Never places, cancels, modifies, or closes orders.

## First run
Run `JarvisObserver.exe`. A shield icon appears in the Windows system tray.

States:
- `standby` — TradingView is closed.
- `ACTIVE` — TradingView Desktop is visible and Jarvis is observing it.
- `paused` — observation is manually paused from the tray menu.

Right-click the tray icon to open the observer folder, pause/resume, open config, or exit.

## Cloud pairing
The observer records locally even when cloud pairing is not enabled. Cloud vision remains disabled until the server and local app share `JARVIS_TRADING_SECRET` securely. Do not commit that secret to GitHub or paste it into chat.

Config path: `%LOCALAPPDATA%\JarvisObserver\config.json`

## Privacy / safety
The companion does not request Tradovate or Lucid credentials. It does not log keystrokes and contains no order-execution code. `PrintWindow` is intentionally used instead of full-screen capture so unrelated apps are not recorded. If TradingView does not permit reliable window capture on a particular machine/GPU configuration, the observer logs `capture.unavailable` instead of falling back to whole-desktop recording.

## Build
```powershell
dotnet publish .\desktop\JarvisObserver\JarvisObserver.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
```

Output is under `desktop\JarvisObserver\bin\Release\net8.0-windows\win-x64\publish`.
