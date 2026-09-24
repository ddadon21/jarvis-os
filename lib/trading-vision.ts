import type { FrameRead } from "./trading-frame";
import type { TradingObserverState } from "./trading-runtime";

export type VisionResult = { capturedAt: string; frame: FrameRead | null; failed: boolean };
type Cache = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, options: { ttl: number }): Promise<unknown>;
};
type Lease = { id: string; until: number };
const running = new Set<string>();

// Only the upload handler writes trading state. Background jobs publish a
// timestamped result for the next upload, so they cannot roll back a newer read.
export async function queueVision(options: {
  key: string;
  capturedAt: string;
  cache: Cache;
  schedule: (task: () => Promise<void>) => void;
  inspect: () => Promise<FrameRead>;
}): Promise<VisionResult | null> {
  const { key, capturedAt, cache, schedule, inspect } = options;
  const resultKey = `jarvis:observer:vision:v2:${key}:result`;
  const leaseKey = `jarvis:observer:vision:v2:${key}:lease`;
  const [result, lease] = await Promise.all([
    cache.get(resultKey).catch(() => null) as Promise<VisionResult | null>,
    cache.get(leaseKey).catch(() => null) as Promise<Lease | null>,
  ]);
  if (running.has(key) || (lease && lease.until > Date.now())) return result;

  running.add(key);
  const id = crypto.randomUUID();
  try {
    // Uploads from the desktop are serialized. Reserve before acknowledging this
    // upload so its next request will not start a duplicate provider cascade.
    await cache.set(leaseKey, { id, until: Date.now() + 50_000 }, { ttl: 60 });
    schedule(async () => {
      try {
        let next: VisionResult;
        try {
          next = { capturedAt, frame: await inspect(), failed: false };
        } catch {
          console.warn("Observer background vision unavailable");
          next = { capturedAt, frame: null, failed: true };
        }
        const latest = await cache.get(resultKey) as VisionResult | null;
        if (!latest || Date.parse(latest.capturedAt) <= Date.parse(capturedAt)) {
          await cache.set(resultKey, next, { ttl: 60 });
        }
      } catch {
        console.warn("Observer vision result could not be cached");
      } finally {
        try {
          const active = await cache.get(leaseKey) as Lease | null;
          if (active?.id === id) await cache.set(leaseKey, { id, until: Date.now() + 1_000 }, { ttl: 2 });
        } catch { /* The lease expires even if cleanup fails. */ }
        running.delete(key);
      }
    });
  } catch {
    // If coordination is unavailable, keep local readings responsive without
    // starting an unbounded cloud request for every screenshot.
    running.delete(key);
  }
  return result;
}

export function usableVision(result: VisionResult | null, capturedAt: string, previous?: TradingObserverState): FrameRead | null {
  if (!result?.frame || result.failed) return null;
  const age = Date.parse(capturedAt) - Date.parse(result.capturedAt);
  if (!Number.isFinite(age) || age < 0 || age > 45_000) return null;
  // A newer local confirmation (including explicit FLAT) always wins.
  if (Date.parse(result.capturedAt) <= Date.parse(previous?.observedAt ?? "")) return null;
  const frame = result.frame;
  return frame.confidence >= .55 && (frame.brokerPanelVisible || frame.intentState === "PREPARING") ? frame : null;
}

export function enrichLocalFromVision(local: FrameRead, result: VisionResult | null, capturedAt: string): FrameRead {
  if (!result?.frame || result.failed || result.frame.confidence < .55) return local;
  const visual = result.frame;
  const age = Date.parse(capturedAt) - Date.parse(result.capturedAt);
  if (!Number.isFinite(age) || age < 0 || age > 5_000) return local;
  if (!local.symbol || !local.side || local.symbol !== visual.symbol || local.side !== visual.side
    || local.intentState !== visual.intentState || local.positionStatus !== visual.positionStatus) return local;
  // A different size/entry can be a new order on the same chart.
  if (["quantity", "entryPrice", "orderType"].some((field) => {
    const key = field as "quantity" | "entryPrice" | "orderType";
    return local[key] != null && visual[key] != null && local[key] !== visual[key];
  })) return local;
  return {
    ...local,
    orderType: local.orderType ?? visual.orderType,
    quantity: local.quantity ?? visual.quantity,
    entryPrice: local.entryPrice ?? visual.entryPrice,
    stopPrice: local.stopPrice ?? visual.stopPrice,
    targetPrice: local.targetPrice ?? visual.targetPrice,
    detailsObservedAt: result.capturedAt,
    // Never carry forward a cloud price/P&L or override a newly read value.
  };
}
