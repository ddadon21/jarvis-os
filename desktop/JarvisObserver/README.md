# JARVIS Local Agent 0.8.0

Windows x64 companion for JARVIS. It contains the read-only TradingView Observer, the local Obsidian bridge, and the first JARVIS Desktop Action Runtime.

## Update
1. Right-click the existing JARVIS / Observer tray icon and choose Exit.
2. Extract this ZIP to a new folder and run JarvisObserver.exe.
3. Keep the existing configuration in %LOCALAPPDATA%\JarvisObserver. Do not delete that folder.
4. Refresh JARVIS. The paired Local Agent should report 0.8.0 after the new agent reconnects.

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

Version 0.8.0 also lets paired JARVIS send authenticated LIST, READ, WRITE/update, and SEARCH commands through the Local Agent. Obsidian remains local; JARVIS Cloud only queues the command and receives the result.

## Desktop Action Runtime
The same paired device link now gives JARVIS a bounded Windows action layer.

Read-only actions:
- Capture desktop context: active window, focused control, cursor position, and visible app windows.
- Capture the primary screen on demand as a compressed JPEG.
- Read clipboard text.

Explicitly user-authorized actions:
- Open common apps such as Chrome, Edge, VS Code, Obsidian, Terminal, Explorer, Notepad, Calculator, and Spotify.
- Focus an existing visible window.
- Open a local file/folder or an HTTP/HTTPS URL.
- Write clipboard text.
- Click a UI control by accessibility name.
- Type explicit quoted text into the focused app.
- Run a small allowlist of diagnostic commands such as git status, Node/.NET/Python version checks, and git diff stats.

The Desktop Runtime does not expose arbitrary shell execution. Interactive actions require an authenticated paired controller command marked USER_AUTHORIZED, and every action returns a success/failure result plus evidence to JARVIS Core.

Natural-language desktop reflexes are intentionally narrow. Commands such as `open chrome`, `focus vscode window`, `click "Save"`, or `type "hello"` can route locally; ordinary writing requests are not treated as computer-control commands.

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
