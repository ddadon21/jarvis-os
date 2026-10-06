# JARVIS Local Agent 1.1.0

Windows x64 companion for JARVIS. It contains the read-only TradingView Observer, the local Obsidian bridge, the JARVIS Desktop Action Runtime, controlled Chrome/Edge browser actions, and workspace-scoped Codex / Claude Code execution.

## Update
1. Right-click the existing JARVIS / Observer tray icon and choose Exit.
2. Extract this ZIP to a new folder and run JarvisObserver.exe.
3. Keep the existing configuration in %LOCALAPPDATA%\JarvisObserver. Do not delete that folder.
4. Refresh JARVIS. The paired Local Agent should report 1.1.0 after the new agent reconnects.

## Obsidian direct vault sync (1.0, recommended)
Tray → "Obsidian: Choose vault folder (direct sync)". No Obsidian plugin is needed:
- Every 10 minutes the Local Agent writes JARVIS's notes (daily trading summaries, last-14-days stats, learning status, workforce report, decision log, SentryOps pulse, what Jarvis remembers) into `<vault>/JARVIS/`.
- JARVIS only replaces text between its `jarvis:start` / `jarvis:end` markers. Anything you write below the end marker stays.
- Each trade gets a note in `JARVIS/Trading/Trades/<month>/` with measured facts, plus "Why I took it" / "Review" questions that are written once and never overwritten.
- Notes you change elsewhere in the vault are indexed for Jarvis chat search. To limit it, set `"vaultIndexFolders": ["Trading", "Ideas"]` in config.json. `.obsidian` and `JARVIS/` are never uploaded.

## Obsidian bridge (Local REST API plugin, legacy)
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

Version 0.9.0 also lets paired JARVIS send authenticated LIST, READ, WRITE/update, and SEARCH commands through the Local Agent. Obsidian remains local; JARVIS Cloud only queues the command and receives the result.

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

## Browser Runtime
Version 0.9.0 adds a browser-specific action vocabulary on top of the Desktop Runtime.

Read-only:
- Read accessible text from the current Chrome or Edge page.

User-authorized:
- Navigate to an HTTP/HTTPS page.
- Search Google.
- Go back one page.
- Reuse the existing accessibility click/type actions for explicit user-directed interaction.

JARVIS does not treat generic page content as permission to submit forms, send messages, make purchases, or perform other consequential actions.

## Coding Executors
Version 0.9.0 can dispatch a user-authorized coding task to Codex or Claude Code on the Windows machine.

Security boundaries:
- The target must be a Git repository.
- Set `JARVIS_CODE_WORKSPACE` to the approved repository path if JARVIS cannot find `jarvis-os` in a standard folder.
- Codex is launched with workspace-write sandboxing and no interactive approval expansion.
- Claude Code is limited to read/search/edit/write plus a narrow build/test/git-status command allowlist.
- Arbitrary shell execution is not exposed through the JARVIS command contract.
- Coding work runs in the background so the Local Agent heartbeat and Trading Observer remain responsive.
- JARVIS reports Codex / Claude as available only when their Windows CLI executables are actually present on PATH when the Local Agent starts.

After installing a coding CLI, restart the Local Agent so capability detection is refreshed.

## What's new in 1.0 — the trade journal
Without broker API access, the Observer is the record of every trade. Version 1.0 makes that record durable:

- **Records whenever TradingView is open.** Local recording no longer waits for the cloud. "Pause / Resume local recording" in the tray stops it. Set `"localRecordingMode": "FOLLOW_CLOUD"` in config.json to only record while JARVIS says Watch.
- **Keeps the setup before every entry.** Full-rate frames are kept for the last 45 minutes (`rollingMinutes`). While an order is being prepared or a position is open, nothing from 15 minutes before it is deleted.
- **Local trade journal.** Every prepare, working order, cancel, entry, stop/target/size change and exit is written to `%LOCALAPPDATA%\JarvisObserver\journal\events.jsonl`. A state has to be read twice in a row before it counts, so one bad read never creates a fake trade.
- **Trade folders.** Five minutes after each exit, `trades\<trade id>\` gets the frames from 15 minutes before preparation to 5 minutes after exit, `events.json`, `trade.json` and a readable `trade.md` with R multiple, best/worst excursion and a timeline. Set `"obsidianVaultPath"` to also write the note into `JARVIS/Trading/Trades` in your vault.
- **Nothing is lost offline.** Journal events and key frames wait in `outbox\` and retry with backoff until JARVIS confirms them. Duplicates are ignored by the server.
- **Commands never run twice.** Finished desktop/Obsidian command results are remembered in `command-ledger.json`; if JARVIS re-sends a command, the stored result is re-sent instead of running it again.
- **Server address is a setting.** Tray → "Set JARVIS server address". Changing to a different deployment asks you to pair again.
- **Lighter on your PC.** One window capture per cycle feeds both the change detector and the text reader; the TradingView window is cached instead of scanning every process 4 times a second; the accessibility read runs every 750 ms instead of 250 ms. Minimizing TradingView no longer ends the session.

Disk use: about 45 minutes of full-rate frames, one frame per minute for 30 days (`retentionDays`), plus trade folders (kept until you delete them).

## What's new in 1.1 — explicit states, faster cancel, week-one evidence
- **Five explicit states** (Jarvis shows exactly these):
  - `WAITING` — no draft, working order or position visible.
  - `PREPARING_ORDER` — an on-chart draft or the order widget is open/being dragged, before submission. Shown on the first read.
  - `PENDING_ORDER` — a submitted working order (TradingView's full order text is visible and no draft editors are open).
  - `ORDER_FILLED` — shown for 4 seconds after a confirmed fill.
  - `TRADE_IN_PROGRESS` — a confirmed open position.
- **Cancel clears faster.** Two clean scans (about 1.3 s) clear a draft or working order back to `WAITING`; a live position needs four, because a false exit is worse than a slow one. The cancel/exit is time-stamped at the first clean scan.
- **One bad read still never creates a trade.** Fills and exits come from the journal's two-read confirmation; drafts only flicker the display.
- **Right pane, right symbol.** Split screens use the pane that contains the active order. Symbol order of trust: that pane's header → the TradingView window title → other text in the pane. Recognition covers NQ, MNQ, ES, MES, YM, MYM, GC, MGC and the broader list (RTY/M2K, CL/MCL, SI/SIL, HG, ZB/ZN/ZF/ZT) through one shared catalog.
- **Optional HUD.** Tray → "Show / Hide Observer HUD" or Ctrl+Alt+J: a small, movable, always-on-top panel with the state, the eight Current State Chart fields, completeness and read age. It never takes focus and is not part of the captured frame. Ctrl+Alt+K opens Jarvis.
- **Week-one diagnostics.** `diagnostics\summary-<day>.json` (every minute) and `diagnostics\transitions-<day>.jsonl`: OCR read latency (p50/p95), missing-field rate per field, symbol vs. window-title mismatch rate, suspected false events (orders that vanish within 1.5 s, trades shorter than 10 s), cancel→WAITING latency, fill-confirmation latency and per-symbol completeness. The daily snapshot is uploaded every 5 minutes and shown on the Trading page under OBSERVER RELIABILITY.

No cloud model is in the order-state path on the PC: the five states, the journal and the HUD come from local OCR, the window title and the journal's confirmation. On the server, cloud vision is still a background fallback that can fill missing fields or read a frame when no local reading arrived; it never writes trades.

## Trading Observer
The reader captures the active TradingView chart pane and supplies symbol, direction, contracts, order type, entry, current chart price, stop and target. It is read-only: it never clicks, places, cancels, changes, or closes orders.

Local calibration frames remain under %LOCALAPPDATA%\JarvisObserver\sessions.

## Build
```powershell
dotnet run --project .\desktop\JarvisObserver.CoreTests\JarvisObserver.CoreTests.csproj -c Release
dotnet publish .\desktop\JarvisObserver\JarvisObserver.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
```
