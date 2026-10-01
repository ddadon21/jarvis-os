export type DesktopIntent = {
  action:
    | "GET_CONTEXT"
    | "SCREEN_CAPTURE"
    | "OPEN_APP"
    | "FOCUS_WINDOW"
    | "OPEN_PATH"
    | "OPEN_URI"
    | "CLIPBOARD_READ"
    | "CLIPBOARD_WRITE"
    | "UI_CLICK_TEXT"
    | "UI_TYPE_TEXT"
    | "BROWSER_READ_PAGE"
    | "BROWSER_NAVIGATE"
    | "BROWSER_SEARCH"
    | "BROWSER_BACK"
    | "RUN_CODING_AGENT"
    | "RUN_APPROVED_COMMAND";
  target?: string | null;
  text?: string | null;
  args?: string[];
};

type DesktopResult = {
  id: string;
  action: DesktopIntent["action"];
  ok: boolean;
  summary: string;
  data: string | null;
  evidence: string[];
  error: string | null;
  completedAt: string;
};

const CONTROLLER_KEY = "jarvis-observer-controller-v1";

function stripJarvis(value: string) {
  return value
    .trim()
    .replace(/^(?:hey|okay|ok|yo)?\s*jarvis[,:\s-]*/i, "")
    .trim();
}

export function parseDesktopIntent(raw: string): DesktopIntent | null {
  const text = stripJarvis(raw);
  const lower = text.toLowerCase();

  if (/^(?:what(?:'s| is) on my screen|what do you see(?: on my screen)?|look at my screen)\??$/.test(lower)) {
    return { action: "SCREEN_CAPTURE" };
  }
  if (/^(?:what(?:'s| is) open|desktop context|computer context)\??$/.test(lower)) {
    return { action: "GET_CONTEXT" };
  }
  if (/^(?:take (?:a )?screenshot|capture (?:my|the) screen|screenshot my screen)$/.test(lower)) {
    return { action: "SCREEN_CAPTURE" };
  }
  if (/^(?:read|what(?:'s| is) on) (?:my )?clipboard\??$/.test(lower)) {
    return { action: "CLIPBOARD_READ" };
  }

  if (/^(?:read|inspect|summarize|what(?:'s| is) on) (?:this|the current) (?:web )?page\??$/i.test(text)) {
    return { action: "BROWSER_READ_PAGE" };
  }

  const webSearch = text.match(/^(?:search|google|search the web for|look up)\s+(.+)$/i);
  if (webSearch) return { action: "BROWSER_SEARCH", target: webSearch[1].trim() };

  const navigateDomain = text.match(/^(?:go to|navigate to|open)\s+((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?)$/i);
  if (navigateDomain) {
    const target = /^https?:\/\//i.test(navigateDomain[1]) ? navigateDomain[1] : "https://" + navigateDomain[1];
    return { action: "BROWSER_NAVIGATE", target };
  }

  if (/^(?:go back|browser back|back one page)$/i.test(text)) {
    return { action: "BROWSER_BACK" };
  }

  const codeAgent = text.match(/^(?:have|ask|run)\s+(codex|claude code|claude)\s+(?:to\s+)?([\s\S]+)$/i);
  if (codeAgent) {
    const provider = /codex/i.test(codeAgent[1]) ? "CODEX" : "CLAUDE";
    let prompt = codeAgent[2].trim();
    const pathMatch = prompt.match(/\s+in\s+((?:[a-zA-Z]:\\|\\\\).+)$/);
    const args: string[] = [];
    if (pathMatch) {
      args.push(pathMatch[1].trim());
      prompt = prompt.slice(0, pathMatch.index).trim();
    }
    return { action: "RUN_CODING_AGENT", target: provider, text: prompt, args };
  }

  const clipboard = text.match(/^(?:put|copy|set)\s+(.+?)\s+(?:on|to|as)\s+(?:my\s+)?clipboard$/i);
  if (clipboard) return { action: "CLIPBOARD_WRITE", text: clipboard[1] };

  const focus = text.match(/^(?:focus(?: the)?|switch to)\s+(.+?)(?:\s+window)?$/i);
  if (focus && /(?:chrome|edge|vscode|visual studio code|obsidian|terminal|explorer|notepad|calculator|spotify|window)$/i.test(focus[1])) {
    return { action: "FOCUS_WINDOW", target: focus[1] };
  }

  const openUrl = text.match(/^(?:open|go to|navigate to)\s+(https?:\/\/\S+)$/i);
  if (openUrl) return { action: "OPEN_URI", target: openUrl[1] };

  const knownApp = text.match(/^(?:open|launch|start)\s+(chrome|google chrome|edge|microsoft edge|vscode|vs code|visual studio code|obsidian|terminal|windows terminal|explorer|file explorer|notepad|calculator|spotify)$/i);
  if (knownApp) return { action: "OPEN_APP", target: knownApp[1] };

  const openPath = text.match(/^(?:open|show)\s+((?:[a-zA-Z]:\\|\\\\|%[^%]+%\\).+)$/);
  if (openPath) return { action: "OPEN_PATH", target: openPath[1] };

  const click = text.match(/^(?:click|press)\s+(?:the\s+)?(?:button\s+)?["'](.+?)["'](?:\s+in\s+(.+))?$/i);
  if (click) return { action: "UI_CLICK_TEXT", target: click[1], args: click[2] ? [click[2]] : [] };

  const typeQuoted = text.match(/^(?:type|enter)\s+["']([\s\S]+)["'](?:\s+in(?:to)?\s+(.+))?$/i);
  if (typeQuoted) return { action: "UI_TYPE_TEXT", text: typeQuoted[1], target: typeQuoted[2] ?? null };

  const typeExplicit = text.match(/^(?:type this|enter this)\s*:\s*([\s\S]+)$/i);
  if (typeExplicit) return { action: "UI_TYPE_TEXT", text: typeExplicit[1], target: null };

  if (/^(?:check\s+)?git status$/i.test(text)) return { action: "RUN_APPROVED_COMMAND", target: "git-status" };
  if (/^(?:check\s+)?git diff(?: stat)?$/i.test(text)) return { action: "RUN_APPROVED_COMMAND", target: "git-diff-stat" };
  if (/^(?:check\s+)?node version$/i.test(text)) return { action: "RUN_APPROVED_COMMAND", target: "node-version" };
  if (/^(?:check\s+)?npm version$/i.test(text)) return { action: "RUN_APPROVED_COMMAND", target: "npm-version" };
  if (/^(?:check\s+)?dotnet info$/i.test(text)) return { action: "RUN_APPROVED_COMMAND", target: "dotnet-info" };
  if (/^(?:check\s+)?python version$/i.test(text)) return { action: "RUN_APPROVED_COMMAND", target: "python-version" };

  return null;
}

function explainContext(data: string | null, fallback: string) {
  if (!data) return fallback;
  try {
    const parsed = JSON.parse(data) as {
      activeWindow?: { title?: string; process?: string };
      focusedElement?: string;
      visibleWindows?: Array<{ title?: string }>;
    };
    const active = parsed.activeWindow?.title?.trim();
    const process = parsed.activeWindow?.process?.trim();
    const focused = parsed.focusedElement?.trim();
    const count = parsed.visibleWindows?.length ?? 0;
    return [
      active ? `Your active window is ${active}${process ? ` (${process})` : ""}.` : "I captured the desktop context.",
      focused ? `Focused control: ${focused}.` : "",
      `${count} visible app window${count === 1 ? "" : "s"} detected.`,
    ].filter(Boolean).join(" ");
  } catch {
    return fallback;
  }
}

async function analyzeScreen(image: string) {
  try {
    const response = await fetch("/api/desktop/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
    });
    if (!response.ok) return null;
    const body = await response.json() as { analysis?: string };
    return body.analysis?.trim() || null;
  } catch {
    return null;
  }
}

function formatResult(result: DesktopResult) {
  if (!result.ok) return result.error ? `I couldn't complete that: ${result.error}` : "I couldn't complete that desktop action.";
  if (result.action === "GET_CONTEXT") return explainContext(result.data, result.summary);
  if (result.action === "CLIPBOARD_READ") {
    const value = result.data?.trim() ?? "";
    return value ? `Your clipboard contains: ${value.slice(0, 500)}` : "Your clipboard is empty.";
  }
  if (result.action === "SCREEN_CAPTURE") {
    return "I captured your primary screen. The desktop runtime can now provide screenshots on demand; visual reasoning over those captures is the next eyes layer.";
  }
  if (result.action === "BROWSER_READ_PAGE" && result.data?.trim()) {
    return result.data.trim().slice(0, 8000);
  }
  if (result.action === "RUN_CODING_AGENT") {
    const output = result.data?.trim();
    return output ? `${result.summary}\n${output.slice(0, 8000)}` : result.summary;
  }
  if (result.action === "RUN_APPROVED_COMMAND" && result.data?.trim()) {
    return `${result.summary}\n${result.data.trim().slice(0, 1200)}`;
  }
  return result.summary;
}

async function pollResult(token: string, id: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await new Promise(resolve => window.setTimeout(resolve, 250));
    const response = await fetch("/api/desktop/command?id=" + encodeURIComponent(id), {
      cache: "no-store",
      headers: { Authorization: "Bearer " + token },
    });
    if (!response.ok) break;
    const body = await response.json() as { result?: DesktopResult | null; pending?: boolean };
    if (body.result?.id === id) return body.result;
    if (body.pending === false) break;
  }
  return null;
}

export async function executeDesktopIntent(intent: DesktopIntent) {
  const token = window.localStorage.getItem(CONTROLLER_KEY) ?? "";
  if (!token) {
    return {
      handled: true,
      ok: false,
      message: "The Windows Local Agent isn't paired to this browser yet. Pair it from Trading first, then I can control the PC through the same secure link.",
    };
  }

  const response = await fetch("/api/desktop/command", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({
      ...intent,
      userAuthorized: !["GET_CONTEXT", "SCREEN_CAPTURE", "CLIPBOARD_READ", "BROWSER_READ_PAGE"].includes(intent.action),
    }),
  });

  const body = await response.json().catch(() => ({})) as {
    ok?: boolean;
    command?: { id?: string };
    error?: string;
    requiresApproval?: boolean;
  };

  if (!response.ok || !body.command?.id) {
    return {
      handled: true,
      ok: false,
      message: body.error || "The Desktop Runtime rejected that command.",
    };
  }

  const result = await pollResult(token, body.command.id);
  if (!result) {
    return {
      handled: true,
      ok: false,
      message: "The command was accepted, but the Windows Local Agent didn't return evidence within 10 seconds.",
    };
  }

  let message = formatResult(result);
  if (result.ok && result.action === "SCREEN_CAPTURE" && result.data?.startsWith("data:image/jpeg;base64,")) {
    const analysis = await analyzeScreen(result.data);
    if (analysis) message = analysis;
  }

  return {
    handled: true,
    ok: result.ok,
    message,
    result,
  };
}

export async function tryExecuteDesktopText(text: string) {
  const intent = parseDesktopIntent(text);
  if (!intent) return null;
  return executeDesktopIntent(intent);
}
