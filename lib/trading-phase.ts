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

/** How far apart two OPEN reads may be and still confirm each other. */
export const OPEN_CONFIRM_WINDOW_MS = 60_000;

export type OpenCandidate = { symbol: string | null; side: "LONG" | "SHORT" | null; at: string };

export type OpenGateInput = {
  status: "FLAT" | "PENDING" | "OPEN" | "UNKNOWN";
  intentState: "NONE" | "PREPARING" | "ORDER_WORKING" | "POSITION_OPEN" | "UNKNOWN";
  symbol: string | null;
  side: "LONG" | "SHORT" | null;
};

export type OpenGatePrevious = {
  status?: string | null;
  intentState?: string | null;
  openCandidate?: OpenCandidate | null;
} | undefined;

/**
 * Server-side confirmed-fill boundary, matching the local journal's two-read
 * confirmation. Every web observation (local OCR, accessibility, cloud vision,
 * /ingest) passes through here, so one OPEN read can never show ORDER_FILLED or
 * TRADE_IN_PROGRESS. A second coherent OPEN read (same symbol and side where
 * known, later timestamp, within the window, no non-OPEN read between) promotes.
 * Non-OPEN reads pass straight through, so PREPARING and PENDING stay immediate.
 */
export function gateOpenRead(
  incoming: OpenGateInput,
  previous: OpenGatePrevious,
  observedAt: string | null,
): { status: OpenGateInput["status"]; intentState: OpenGateInput["intentState"]; openCandidate: OpenCandidate | null } {
  const readsOpen = incoming.status === "OPEN" || incoming.intentState === "POSITION_OPEN";
  if (!readsOpen) {
    // A newer non-OPEN read clears the candidate; a carry-over of the held state (not newer) keeps it.
    const held = previous?.openCandidate ?? null;
    const at = observedAt ? Date.parse(observedAt) : Number.NaN;
    const keep = held != null && !(Number.isFinite(at) && at > Date.parse(held.at));
    return { status: incoming.status, intentState: incoming.intentState, openCandidate: keep ? held : null };
  }

  const previouslyOpen = previous?.status === "OPEN" || previous?.intentState === "POSITION_OPEN";
  if (previouslyOpen) return { status: incoming.status, intentState: incoming.intentState, openCandidate: null };

  const candidate = previous?.openCandidate ?? null;
  const at = observedAt ? Date.parse(observedAt) : Number.NaN;
  const candidateAt = candidate ? Date.parse(candidate.at) : Number.NaN;
  const agrees = (a: string | null, b: string | null) => a == null || b == null || a === b;
  const confirms = candidate != null &&
    Number.isFinite(at) && Number.isFinite(candidateAt) &&
    at > candidateAt && at - candidateAt <= OPEN_CONFIRM_WINDOW_MS &&
    agrees(candidate.symbol, incoming.symbol) && agrees(candidate.side, incoming.side);
  if (confirms) return { status: incoming.status, intentState: incoming.intentState, openCandidate: null };

  // Unconfirmed: hold the previous non-open phase and remember this read as the candidate.
  const holdStatus = previous?.status === "FLAT" || previous?.status === "PENDING" ? previous.status : "UNKNOWN";
  const holdIntent = previous?.intentState === "NONE" || previous?.intentState === "PREPARING" || previous?.intentState === "ORDER_WORKING"
    ? previous.intentState
    : "UNKNOWN";
  return {
    status: holdStatus,
    intentState: holdIntent,
    openCandidate: observedAt ? { symbol: incoming.symbol, side: incoming.side, at: observedAt } : null,
  };
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
