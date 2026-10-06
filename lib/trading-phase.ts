/**
 * The five external Observer phases (issue #3). Jarvis shows exactly these:
 * WAITING → PREPARING_ORDER → PENDING_ORDER → ORDER_FILLED (short) → TRADE_IN_PROGRESS.
 *
 * Derived deterministically from the fused local reads (OCR + accessibility);
 * no model call is involved. Pure, so the UI and tests share one definition.
 */

export type ObserverPhase = "WAITING" | "PREPARING_ORDER" | "PENDING_ORDER" | "ORDER_FILLED" | "TRADE_IN_PROGRESS";

export const OBSERVER_PHASES: readonly ObserverPhase[] = ["WAITING", "PREPARING_ORDER", "PENDING_ORDER", "ORDER_FILLED", "TRADE_IN_PROGRESS"];

/** How long a fresh fill is shown as ORDER_FILLED before TRADE_IN_PROGRESS. */
export const ORDER_FILLED_HOLD_MS = 4_000;

export type PhaseInput = {
  status?: "FLAT" | "PENDING" | "OPEN" | "UNKNOWN" | null;
  intentState?: "NONE" | "PREPARING" | "ORDER_WORKING" | "POSITION_OPEN" | "UNKNOWN" | null;
  filledAt?: string | null;
};

export function observerPhase(observer: PhaseInput | null | undefined, now: number = Date.now()): ObserverPhase {
  if (!observer) return "WAITING";
  if (observer.status === "OPEN" || observer.intentState === "POSITION_OPEN") {
    const filled = observer.filledAt ? Date.parse(observer.filledAt) : Number.NaN;
    return Number.isFinite(filled) && now - filled >= 0 && now - filled < ORDER_FILLED_HOLD_MS ? "ORDER_FILLED" : "TRADE_IN_PROGRESS";
  }
  if (observer.status === "PENDING" || observer.intentState === "ORDER_WORKING") return "PENDING_ORDER";
  if (observer.intentState === "PREPARING") return "PREPARING_ORDER";
  return "WAITING";
}

/**
 * When the position became visible: kept while it stays open, set on the
 * transition into OPEN, cleared once flat.
 */
export function nextFilledAt(
  previous: { status?: string | null; filledAt?: string | null } | undefined,
  nextStatus: string | null | undefined,
  observedAt: string | null,
): string | null {
  if (nextStatus !== "OPEN") return null;
  if (previous?.status === "OPEN" && previous.filledAt) return previous.filledAt;
  return observedAt;
}

export function phaseLabel(phase: ObserverPhase): string {
  return phase.replace(/_/g, " ");
}
