# Jarvis Trading Observer 0.4.16

Read-only Windows x64 companion for TradingView Desktop.

## Update
1. Right-click the existing Observer tray icon and choose Exit.
2. Extract this ZIP to a new folder and run JarvisObserver.exe.
3. Keep the existing pairing/configuration in %LOCALAPPDATA%\JarvisObserver. Do not delete that folder.
4. Refresh Jarvis's Work page. Observer Link should show 0.4.16.

## Current State
- Waiting: no visible order setup or position.
- Preparing order: an on-chart draft/hover widget or an order awaiting a fill.
- Trade in progress: a visibly confirmed open position.

The reader captures the active chart pane and supplies symbol, direction, contracts, order type, entry, current chart price, stop and target. It keeps accessibility values ahead of OCR text, recognizes compact Buy/Sell + quantity + type widgets, and prevents other panes or old trades from filling the current setup's fields.

Unreadable or unset values remain blank. The current-price field is not fabricated from the bid/ask midpoint. Full screenshot completion needs a working server-side vision provider; a provider failure is displayed in Current State rather than hidden behind a successful connection indicator.

## Verification
The Windows build runs order-reader regression fixtures for all eight requested futures roots in both directions and a split-chart scenario. The web build runs state/merge regression checks. These fixtures do not replace a live end-to-end TradingView test on the user's Windows desktop.

## Behavior
The companion observes only the TradingView window. It never clicks, places, cancels, changes or closes orders. Local calibration frames remain under %LOCALAPPDATA%\JarvisObserver\sessions.

## Build
```powershell
dotnet run --project .\desktop\JarvisObserver.Tests\JarvisObserver.Tests.csproj -c Release
dotnet publish .\desktop\JarvisObserver\JarvisObserver.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
```
