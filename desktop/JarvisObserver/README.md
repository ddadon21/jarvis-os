# JARVIS Local Agent 0.5.0

Windows x64 companion for JARVIS. It keeps the existing read-only TradingView Observer and now adds the local Obsidian bridge.

## Update
1. Right-click the existing JARVIS / Observer tray icon and choose Exit.
2. Extract this ZIP to a new folder and run JarvisObserver.exe.
3. Keep the existing configuration in %LOCALAPPDATA%\JarvisObserver. Do not delete that folder.
4. Refresh JARVIS. Trading Observer Link should show 0.5.0 after the new agent reconnects.

## Obsidian bridge
JARVIS keeps Supabase as the authoritative structured database. Obsidian is the long-form knowledge vault.

1. In Obsidian, install and enable the community plugin **Local REST API** by Adam Coddington.
2. Open Obsidian → Settings → Local REST API.
3. Enable the plugin's HTTP server for loopback access. JARVIS defaults to http://127.0.0.1:27123.
4. Copy the API key from that Obsidian settings page.
5. In the JARVIS Local Agent tray menu choose **Obsidian: Set / replace API key** and paste it into the local dialog. Do not put this key into JARVIS Cloud or a chat.
6. Choose **Obsidian: Test connection**.

The Obsidian API key is encrypted with Windows DPAPI for the current Windows user and is never uploaded to JARVIS Cloud. The bridge rejects non-loopback Obsidian URLs.

## Trading Observer
- Waiting: no visible order setup or position.
- Preparing order: an on-chart draft/hover widget or an order awaiting a fill.
- Trade in progress: a visibly confirmed open position.

The reader captures the active TradingView chart pane and supplies symbol, direction, contracts, order type, entry, current chart price, stop and target. It is read-only: it never clicks, places, cancels, changes, or closes orders.

Local calibration frames remain under %LOCALAPPDATA%\JarvisObserver\sessions.

## Build
```powershell
dotnet run --project .\desktop\JarvisObserver.Tests\JarvisObserver.Tests.csproj -c Release
dotnet publish .\desktop\JarvisObserver\JarvisObserver.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
```
