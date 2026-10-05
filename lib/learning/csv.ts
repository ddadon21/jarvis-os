import type { Bar } from "./types.ts";

/**
 * Parses TradingView "Export chart data" CSV (time,open,high,low,close,Volume,...).
 * `time` may be UNIX seconds, UNIX milliseconds, or an ISO date-time.
 */
export function parseTradingViewCsv(text: string): { bars: Bar[]; skipped: number; timeframeMinutes: number | null } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { bars: [], skipped: 0, timeframeMinutes: null };
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const it = col("time"), io = col("open"), ih = col("high"), il = col("low"), ic = col("close"), iv = col("volume");
  if (it < 0 || io < 0 || ih < 0 || il < 0 || ic < 0) throw new Error("CSV needs time, open, high, low, close columns (TradingView: Export chart data).");
  const bars: Bar[] = [];
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const rawTime = cells[it]?.trim() ?? "";
    let t: number;
    if (/^\d+(\.\d+)?$/.test(rawTime)) {
      const n = Number(rawTime);
      t = n < 1e12 ? n * 1000 : n;
    } else {
      t = Date.parse(rawTime);
    }
    const o = Number(cells[io]), h = Number(cells[ih]), l = Number(cells[il]), c = Number(cells[ic]);
    const v = iv >= 0 ? Number(cells[iv]) : 0;
    if (![t, o, h, l, c].every(Number.isFinite) || h < l) { skipped += 1; continue; }
    bars.push({ t, o, h, l, c, v: Number.isFinite(v) ? v : 0 });
  }
  bars.sort((a, b) => a.t - b.t);
  const deltas = bars.slice(1, 200).map((bar, i) => bar.t - bars[i].t).filter((d) => d > 0).sort((a, b) => a - b);
  const timeframeMinutes = deltas.length ? Math.round(deltas[Math.floor(deltas.length / 2)] / 60_000) : null;
  return { bars, skipped, timeframeMinutes };
}

export type WebhookBar = { kind: "bar"; symbol: string; timeframe: string; bar: Bar };
export type WebhookSignal = { kind: "signal"; model: string; symbol: string; side: "LONG" | "SHORT"; t: number; price: number | null };

/** Validates a TradingView alert payload (bar feed or shadow signal). Secret checked by the caller. */
export function parseMarketWebhook(payload: unknown): WebhookBar | WebhookSignal | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);
  const symbol = typeof p.symbol === "string" ? p.symbol.trim().slice(0, 40) : "";
  if (!symbol) return null;
  if (p.kind === "bar") {
    const t = num(p.time), o = num(p.open), h = num(p.high), l = num(p.low), c = num(p.close), v = num(p.volume);
    if (![t, o, h, l, c].every(Number.isFinite) || h < l) return null;
    const timeframe = typeof p.timeframe === "string" ? p.timeframe.trim().slice(0, 8) : "1";
    return { kind: "bar", symbol, timeframe, bar: { t, o, h, l, c, v: Number.isFinite(v) ? v : 0 } };
  }
  if (p.kind === "signal") {
    const t = num(p.time);
    const side = p.side === "LONG" || p.side === "SHORT" ? p.side : null;
    const model = typeof p.model === "string" ? p.model.trim().slice(0, 80) : "";
    if (!Number.isFinite(t) || !side || !model) return null;
    const price = num(p.price);
    return { kind: "signal", model, symbol, side, t, price: Number.isFinite(price) ? price : null };
  }
  return null;
}
