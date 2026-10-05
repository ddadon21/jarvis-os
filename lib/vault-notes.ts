import { listStoredTrades, type StoredTrade } from "./trading-store";
import { tradeStats } from "./trading-analytics";
import { barCoverage, listModelRuns } from "./learning/store.ts";
import { getOrSeedWorkforceState } from "./jarvis-workforce";
import { getLatestPulse } from "./jarvis-runtime";
import { listMemory } from "./jarvis-memory";

/**
 * Notes JARVIS keeps in Dwight's vault (written by the Local Agent into
 * <vault>/JARVIS/, inside JARVIS's markers only). Generated from server data,
 * so they stay current even when no JARVIS tab is open.
 */
export type VaultOutNote = { path: string; content: string };

const money = (v: number | null | undefined) => (v == null ? "—" : (v >= 0 ? "+" : "-") + "$" + Math.abs(v).toFixed(2));
const px = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }));
const pct = (v: number | null | undefined) => (v == null ? "—" : Math.round(v * 100) + "%");
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }) : "—");

function dailyNote(day: string, trades: StoredTrade[]) {
  const stats = tradeStats(trades as never);
  const lines = [
    `# Trading · ${day}`,
    "",
    `Trades ${stats.trades} · win rate ${pct(stats.winRate)} · net ${money(stats.netPnl)} · avg ${stats.avgR ?? "—"}R`,
    "",
    "| Time (NY) | Side | Qty | Entry → Exit | Stop (initial) | P&L | Source |",
    "|---|---|---|---|---|---|---|",
    ...trades.sort((a, b) => a.opened_at.localeCompare(b.opened_at)).map((t) =>
      `| ${time(t.opened_at)} | ${t.side} ${t.symbol} | ${t.quantity} | ${px(t.entry_price)} → ${t.status === "OPEN" ? "open" : px(t.exit_price)} | ${px(t.initial_stop)} | ${money(t.realized_pnl)} | ${t.pnl_source ?? "—"} |`),
    "",
    "Trade folders with frames and review questions: JARVIS/Trading/Trades.",
  ];
  return lines.join("\n");
}

export async function buildVaultNotes(): Promise<VaultOutNote[]> {
  const notes: VaultOutNote[] = [];
  const [trades, coverage, runs, workforce, pulse, memory] = await Promise.all([
    listStoredTrades({ since: new Date(Date.now() - 14 * 86_400_000).toISOString(), limit: 500 }),
    barCoverage(),
    listModelRuns(5),
    getOrSeedWorkforceState(),
    getLatestPulse(),
    listMemory(200),
  ]);

  if (trades?.length) {
    const byDay = new Map<string, StoredTrade[]>();
    for (const trade of trades) byDay.set(trade.session_day, [...(byDay.get(trade.session_day) ?? []), trade]);
    for (const [day, set] of [...byDay.entries()].sort().slice(-5)) notes.push({ path: `JARVIS/Trading/Daily/${day}.md`, content: dailyNote(day, set) });
    const stats = tradeStats(trades as never);
    notes.push({
      path: "JARVIS/Trading/Last 14 Days.md",
      content: [
        "# Trading · last 14 days",
        "",
        `${stats.trades} trades over ${stats.sessions} sessions · win rate ${pct(stats.winRate)} · net ${money(stats.netPnl)}`,
        `Average ${stats.avgR ?? "—"}R · best excursion ${stats.avgMfeR ?? "—"}R · worst ${stats.avgMaeR ?? "—"}R · gave back from +1R: ${pct(stats.gaveBackRate)}`,
        `Prep before entry ${stats.avgPrepSeconds ?? "—"}s · time in trade ${stats.avgHoldMinutes ?? "—"} min`,
        "",
        "| Hour (NY) | Trades | Win rate | Avg R |",
        "|---|---|---|---|",
        ...stats.byHour.map((h) => `| ${h.hour}:00 | ${h.trades} | ${pct(h.winRate)} | ${h.avgR ?? "—"} |`),
      ].join("\n"),
    });
  }

  const latest = runs[0];
  notes.push({
    path: "JARVIS/Trading/Learning Status.md",
    content: [
      "# DEVIANT learning status",
      "",
      "## Market data",
      ...(coverage?.length ? coverage.map((c) => `- ${c.family}: ${c.bars.toLocaleString()} one-minute bars (${c.from?.slice(0, 10)} → ${c.to?.slice(0, 10)})`) : ["- No bars yet. Add the TradingView bar feed alert or import CSV history."]),
      "",
      "## Latest run",
      latest ? `${latest.createdAt.slice(0, 16)} · ${latest.family} · ${latest.report.status} · ${latest.report.message}` : "No learning run yet.",
      ...(latest?.report.metrics.test ? [
        "",
        "| Unseen days | Caught your entries | Arrows that matched | Arrows/day | Avg R |",
        "|---|---|---|---|---|",
        `| Candidate | ${pct(latest.report.metrics.test.combined.recall)} | ${pct(latest.report.metrics.test.combined.precision)} | ${latest.report.metrics.test.combined.signalsPerDay.toFixed(2)} | ${latest.report.metrics.test.combined.avgR?.toFixed(2) ?? "—"} |`,
        latest.report.metrics.baselineTest ? `| DEVIANT v1 | ${pct(latest.report.metrics.baselineTest.combined.recall)} | ${pct(latest.report.metrics.baselineTest.combined.precision)} | ${latest.report.metrics.baselineTest.combined.signalsPerDay.toFixed(2)} | ${latest.report.metrics.baselineTest.combined.avgR?.toFixed(2) ?? "—"} |` : "",
      ] : []),
      ...(latest ? ["", ...latest.report.verdict.map((v) => `- ${v}`)] : []),
    ].join("\n"),
  });

  const tasks = workforce.tasks ?? [];
  notes.push({
    path: "JARVIS/Agents/Workforce Report.md",
    content: [
      "# Himie Johnson Ventures · workforce",
      "",
      `Last cycle: ${workforce.lastCycleAt ?? "never"} · status ${workforce.status}`,
      "",
      "## Waiting on Dwight",
      ...(tasks.filter((t) => t.status === "WAITING_APPROVAL").map((t) => `- [ ] ${t.assignedTo}: ${t.title} — ${t.blockedReason ?? ""}`) || []),
      "",
      "## Recent outcomes",
      ...tasks.filter((t) => ["DONE", "FAILED"].includes(t.status) && t.source !== "workforce.cycle").slice(0, 12).map((t) => `- ${t.status === "DONE" ? "✅" : "❌"} ${t.assignedTo}: ${t.title}${t.verification ? ` (${t.verification.state})` : ""}\n  ${(t.result ?? "").replace(/\n/g, " ").slice(0, 400)}`),
      "",
      "## Agents",
      ...workforce.agents.map((a) => `- ${a.id} · ${a.status} · ${a.lastResult.replace(/\n/g, " ").slice(0, 200)}`),
    ].join("\n"),
  });

  const decisions = workforce.operatingSystem?.decisionMemory ?? [];
  notes.push({
    path: "JARVIS/Decisions/Decision Log.md",
    content: ["# Decision log", "", ...decisions.slice(0, 30).map((d) => `## ${d.at.slice(0, 10)} · ${d.decision}\n${d.reason}\nExpected: ${d.expectedOutcome}\n`)].join("\n"),
  });

  if (pulse) {
    notes.push({
      path: "JARVIS/Research/SentryOps Pulse.md",
      content: [`# SentryOps research pulse · ${pulse.ranAt.slice(0, 10)}`, "", pulse.summary, "", ...pulse.opportunities.map((o) => `## [${o.priority}] ${o.title}\n${o.whyItMatters}\n\nEvidence: ${o.evidence}\n`), `Next move: ${pulse.nextMove.title} — ${pulse.nextMove.reason}`].join("\n"),
    });
  }

  if (memory.length) {
    notes.push({
      path: "JARVIS/Memory/What Jarvis Remembers.md",
      content: ["# What Jarvis remembers", "", "Retire a fact from Jarvis (not here): it re-generates this list.", "", ...memory.map((m) => `- [${m.domain}] ${m.fact}`)].join("\n"),
    });
  }
  return notes;
}
