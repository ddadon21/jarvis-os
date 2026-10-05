import { randomUUID } from "node:crypto";
import { durableContext } from "../jarvis-db";
import { priceFamily } from "../trading-symbols";
import type { Bar, LabeledTrade, Rule } from "./types.ts";
import type { LearningReport } from "./pipeline.ts";
import type { SignalPolicy } from "./evaluate.ts";

export type ModelStatus = "CANDIDATE" | "SHADOW" | "PROMOTED" | "REJECTED";

export type StoredModel = {
  id: string;
  createdAt: string;
  status: ModelStatus;
  family: string;
  report: LearningReport;
};

const PAGE = 1000;

export async function upsertBars(family: string, timeframe: string, bars: Bar[], source: string) {
  const ctx = await durableContext();
  if (!ctx) throw new Error("Durable storage is not configured.");
  let written = 0;
  for (let i = 0; i < bars.length; i += 500) {
    const chunk = bars.slice(i, i + 500).map((bar) => ({
      workspace_id: ctx.workspaceId,
      symbol: family,
      timeframe,
      ts: new Date(bar.t).toISOString(),
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
      source,
    }));
    const { error } = await ctx.db.from("trading_bars").upsert(chunk, { onConflict: "workspace_id,symbol,timeframe,ts" });
    if (error) throw new Error("Bar upsert failed: " + error.message);
    written += chunk.length;
  }
  return written;
}

export async function loadBars(family: string, fromMs: number, toMs: number): Promise<Bar[]> {
  const ctx = await durableContext();
  if (!ctx) return [];
  const out: Bar[] = [];
  let cursor = new Date(fromMs).toISOString();
  const end = new Date(toMs).toISOString();
  for (let guard = 0; guard < 2000; guard += 1) {
    const { data, error } = await ctx.db.from("trading_bars")
      .select("ts,open,high,low,close,volume")
      .eq("workspace_id", ctx.workspaceId)
      .eq("symbol", family)
      .eq("timeframe", "1")
      .gt("ts", guard === 0 ? new Date(fromMs - 1).toISOString() : cursor)
      .lte("ts", end)
      .order("ts", { ascending: true })
      .limit(PAGE);
    if (error || !data?.length) break;
    for (const row of data as Array<{ ts: string; open: number; high: number; low: number; close: number; volume: number | null }>) {
      out.push({ t: Date.parse(row.ts), o: Number(row.open), h: Number(row.high), l: Number(row.low), c: Number(row.close), v: Number(row.volume ?? 0) });
    }
    cursor = (data[data.length - 1] as { ts: string }).ts;
    if (data.length < PAGE) break;
  }
  return out;
}

export async function barCoverage(families = ["NQ", "ES", "YM", "RTY", "GC", "CL"]) {
  const ctx = await durableContext();
  if (!ctx) return null;
  const rows = await Promise.all(families.map(async (family) => {
    const base = () => ctx.db.from("trading_bars").select("ts", { count: "exact" }).eq("workspace_id", ctx.workspaceId).eq("symbol", family).eq("timeframe", "1");
    const [first, last] = await Promise.all([
      base().order("ts", { ascending: true }).limit(1),
      base().order("ts", { ascending: false }).limit(1),
    ]);
    const count = first.count ?? 0;
    return {
      family,
      bars: count,
      from: (first.data?.[0] as { ts?: string } | undefined)?.ts ?? null,
      to: (last.data?.[0] as { ts?: string } | undefined)?.ts ?? null,
    };
  }));
  return rows.filter((row) => row.bars > 0);
}

export async function loadLabeledTrades(family?: string): Promise<LabeledTrade[]> {
  const ctx = await durableContext();
  if (!ctx) return [];
  const out: LabeledTrade[] = [];
  for (let page = 0; page < 50; page += 1) {
    const { data, error } = await ctx.db.from("trading_trades")
      .select("id,symbol,side,opened_at,prepared_at,closed_at,entry_price,exit_price,initial_stop,initial_target,realized_pnl")
      .eq("workspace_id", ctx.workspaceId)
      .order("opened_at", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error || !data?.length) break;
    for (const row of data as Array<Record<string, unknown>>) {
      const symbol = String(row.symbol);
      if (family && priceFamily(symbol) !== family) continue;
      const num = (v: unknown) => (v == null ? null : Number(v));
      out.push({
        id: String(row.id),
        symbol,
        side: row.side === "SHORT" ? "SHORT" : "LONG",
        openedAt: String(row.opened_at),
        preparedAt: row.prepared_at ? String(row.prepared_at) : null,
        closedAt: row.closed_at ? String(row.closed_at) : null,
        entryPrice: num(row.entry_price),
        exitPrice: num(row.exit_price),
        initialStop: num(row.initial_stop),
        initialTarget: num(row.initial_target),
        realizedPnl: num(row.realized_pnl),
      });
    }
    if (data.length < PAGE) break;
  }
  return out;
}

export async function saveModelRun(family: string, report: LearningReport): Promise<string | null> {
  const ctx = await durableContext();
  if (!ctx) return null;
  const id = `${family}-${report.version}-${randomUUID().slice(0, 6)}`;
  const { error } = await ctx.db.from("trading_model_versions").insert({
    id,
    workspace_id: ctx.workspaceId,
    status: report.status === "CANDIDATE" ? "CANDIDATE" : "REJECTED",
    base_version: "deviant-refined-baseline-v1",
    metrics: { ...report.metrics, data: report.data, verdict: report.verdict, status: report.status, message: report.message, family },
    rules: { rules: report.rules, policy: report.policy },
    pine: report.pine,
    notes: report.message,
  });
  if (error) throw new Error("Could not save model run: " + error.message);
  return id;
}

export async function listModelRuns(limit = 20): Promise<StoredModel[]> {
  const ctx = await durableContext();
  if (!ctx) return [];
  const { data } = await ctx.db.from("trading_model_versions")
    .select("id,created_at,status,metrics,rules,pine,notes")
    .eq("workspace_id", ctx.workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Array<{ id: string; created_at: string; status: ModelStatus; metrics: Record<string, unknown>; rules: { rules?: Rule[]; policy?: SignalPolicy }; pine: string | null; notes: string | null }>).map((row) => {
    const metrics = row.metrics ?? {};
    return {
      id: row.id,
      createdAt: row.created_at,
      status: row.status,
      family: String(metrics.family ?? "NQ"),
      report: {
        status: (metrics.status as LearningReport["status"]) ?? "NO_EDGE",
        version: row.id,
        generatedAt: row.created_at,
        message: row.notes ?? "",
        data: metrics.data as LearningReport["data"],
        rules: row.rules?.rules ?? [],
        policy: row.rules?.policy as SignalPolicy,
        metrics: {
          train: (metrics.train as LearningReport["metrics"]["train"]) ?? null,
          test: (metrics.test as LearningReport["metrics"]["test"]) ?? null,
          baselineTest: (metrics.baselineTest as LearningReport["metrics"]["baselineTest"]) ?? null,
          dwightTest: (metrics.dwightTest as LearningReport["metrics"]["dwightTest"]) ?? null,
        },
        verdict: (metrics.verdict as string[]) ?? [],
        pine: row.pine,
      },
    };
  });
}

export async function setModelStatus(id: string, status: ModelStatus) {
  const ctx = await durableContext();
  if (!ctx) throw new Error("Durable storage is not configured.");
  if (status === "PROMOTED" || status === "SHADOW") {
    // Only one model per role at a time.
    await ctx.db.from("trading_model_versions").update({ status: "CANDIDATE" }).eq("workspace_id", ctx.workspaceId).eq("status", status);
  }
  const { error } = await ctx.db.from("trading_model_versions").update({ status }).eq("id", id).eq("workspace_id", ctx.workspaceId);
  if (error) throw new Error(error.message);
}

export async function insertSignals(rows: Array<{ id: string; model: string; symbol: string; side: "LONG" | "SHORT"; ts: string; price: number | null; source: string; payload?: Record<string, unknown> }>) {
  const ctx = await durableContext();
  if (!ctx || !rows.length) return 0;
  const { error } = await ctx.db.from("trading_signals").upsert(rows.map((row) => ({
    id: row.id,
    workspace_id: ctx.workspaceId,
    model_version: row.model,
    symbol: row.symbol,
    side: row.side,
    ts: row.ts,
    price: row.price,
    source: row.source,
    payload: row.payload ?? {},
  })), { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new Error("Signal insert failed: " + error.message);
  return rows.length;
}
