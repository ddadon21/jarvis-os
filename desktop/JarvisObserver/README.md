# JARVIS Local Agent 0.6.0

Windows x64 companion for JARVIS. It keeps the existing read-only TradingView Observer and now adds the local Obsidian bridge.

## Update
1. Right-click the existing JARVIS / Observer tray icon and choose Exit.
2. Extract this ZIP to a new folder and run JarvisObserver.exe.
3. Keep the existing configuration in %LOCALAPPDATA%\JarvisObserver. Do not delete that folder.
4. Refresh JARVIS. Trading Observer Link should show 0.6.0 after the new agent reconnects.

## Obsidian bridge
JARVIS keeps Supabase as the authoritative structured database. Obsidian is the long-form knowledge vault.

1. In Obsidian, install and enable the community plugin **Local REST API** by Adam Coddington.
2. Open Obsidian → Settings → Local REST API.
3. JARVIS defaults to the plugin's HTTPS loopback endpoint: https://127.0.0.1:27124.
4. If %USERPROFILE%\.jarvis\secrets.env contains OBSIDIAN_BASE_URL, OBSIDIAN_API_KEY, and OBSIDIAN_VAULT, the Local Agent imports them automatically on first launch.
5. The API key is immediately re-encrypted with Windows DPAPI and removed from secrets.env after a successful import.
6. Otherwise choose **Obsidian: Set / replace API key** from the tray menu and paste the API key locally.
7. Choose **Obsidian: Test connection**.
8. Choose **Obsidian: Write Local Agent test note** to prove the Windows agent itself can write into 00 Inbox.

The Obsidian API key is encrypted with Windows DPAPI for the current Windows user and is never uploaded to JARVIS Cloud. The bridge rejects non-loopback Obsidian URLs. Self-signed TLS is accepted only for loopback connections.

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
