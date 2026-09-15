import type { Domain, Importance } from "@/core/types";

/**
 * The event catalog.
 *
 * Every meaningful thing that happens in Jarvis becomes an event, and every
 * event type is declared here first. A registry rather than free-form strings,
 * because the Event Engine is what eventually makes Jarvis proactive: if a type
 * can be invented at a call site, nothing downstream can reliably subscribe
 * to it, and the audit trail becomes untyped soup.
 *
 * Adding an event type:
 *   1. Add it here with its domain and default importance.
 *   2. Document its payload shape in docs/EVENTS.md.
 *   3. Publish it from the domain that owns the fact — never from another domain.
 */

export interface EventTypeDefinition {
  readonly domain: Domain;
  readonly defaultImportance: Importance;
  readonly description: string;
}

export const eventCatalog = {
  // --- Trading ---------------------------------------------------------------
  "trade.executed": {
    domain: "trading",
    defaultImportance: "high",
    description: "A position was opened on a live or paper account.",
  },
  "trade.closed": {
    domain: "trading",
    defaultImportance: "high",
    description: "A position was fully closed. Carries realised P&L and R multiple.",
  },
  "trade.journaled": {
    domain: "trading",
    defaultImportance: "normal",
    description: "A trade record was enriched with context, reasoning or screenshots.",
  },
  "signal.detected": {
    domain: "trading",
    defaultImportance: "normal",
    description: "The user's indicator produced a signal, whether or not it was traded.",
  },
  "signal.skipped": {
    domain: "trading",
    defaultImportance: "normal",
    description:
      "A signal fired and the user did not take it. Skipped setups are evidence, not absence of evidence.",
  },
  "liquidity.swept": {
    domain: "trading",
    defaultImportance: "low",
    description: "A tracked liquidity level was taken out.",
  },
  "market.session_opened": {
    domain: "trading",
    defaultImportance: "low",
    description: "A tracked session (Asia/London/NY) began.",
  },
  "strategy.hypothesis_formed": {
    domain: "trading",
    defaultImportance: "normal",
    description: "The Strategy Scientist proposed a testable claim about the user's edge.",
  },

  // --- Finance ---------------------------------------------------------------
  "transaction.posted": {
    domain: "finance",
    defaultImportance: "low",
    description: "A transaction settled on a tracked account.",
  },
  "income.received": {
    domain: "finance",
    defaultImportance: "high",
    description: "Income landed. Triggers an allocation recommendation.",
  },
  "debt.payment_due": {
    domain: "finance",
    defaultImportance: "high",
    description: "A scheduled debt payment is approaching or due.",
  },
  "credit.utilization_changed": {
    domain: "finance",
    defaultImportance: "normal",
    description: "Reported utilisation moved across a threshold that affects credit goals.",
  },
  "account.balance_changed": {
    domain: "finance",
    defaultImportance: "trivial",
    description: "A tracked balance changed materially.",
  },
  "allocation.recommended": {
    domain: "finance",
    defaultImportance: "normal",
    description: "Jarvis proposed a split for incoming capital.",
  },

  // --- SentryOps -------------------------------------------------------------
  "contract.discovered": {
    domain: "sentryops",
    defaultImportance: "high",
    description: "A public agency contract relevant to the market was found.",
  },
  "rfp.discovered": {
    domain: "sentryops",
    defaultImportance: "critical",
    description: "An open solicitation was found. These are time-boxed and expire.",
  },
  "competitor.updated": {
    domain: "sentryops",
    defaultImportance: "normal",
    description: "A competitor's product, pricing or customer list changed.",
  },
  "agency.observed": {
    domain: "sentryops",
    defaultImportance: "normal",
    description: "The user recorded a firsthand field observation about an agency.",
  },
  "hypothesis.validated": {
    domain: "sentryops",
    defaultImportance: "high",
    description: "A product hypothesis cleared a validation stage.",
  },
  "hypothesis.invalidated": {
    domain: "sentryops",
    defaultImportance: "high",
    description:
      "Evidence killed a hypothesis. Recorded as loudly as a win — this is how direction changes.",
  },
  "lead.received": {
    domain: "sentryops",
    defaultImportance: "high",
    description: "An inbound contact from an agency or partner.",
  },

  // --- Life ------------------------------------------------------------------
  "meeting.upcoming": {
    domain: "life",
    defaultImportance: "normal",
    description: "A calendar commitment is approaching.",
  },
  "commitment.made": {
    domain: "life",
    defaultImportance: "normal",
    description: "The user committed to something with a date or a cost attached.",
  },

  // --- Core ------------------------------------------------------------------
  "goal.progress_updated": {
    domain: "core",
    defaultImportance: "normal",
    description: "A goal criterion moved, possibly changing overall readiness.",
  },
  "goal.readiness_changed": {
    domain: "core",
    defaultImportance: "high",
    description: "A goal crossed RED/YELLOW/GREEN. The headline version of progress.",
  },
  "task.created": {
    domain: "core",
    defaultImportance: "low",
    description: "A task entered the system.",
  },
  "task.completed": {
    domain: "core",
    defaultImportance: "normal",
    description: "A task was finished. Feeds outcome measurement.",
  },
  "agent.task_completed": {
    domain: "core",
    defaultImportance: "normal",
    description: "A specialist agent finished a delegated unit of work.",
  },
  "approval.requested": {
    domain: "core",
    defaultImportance: "high",
    description: "Jarvis prepared an action and is waiting on the user.",
  },
  "approval.resolved": {
    domain: "core",
    defaultImportance: "high",
    description: "An approval request was granted, denied or expired.",
  },
  "world_state.snapshot_taken": {
    domain: "core",
    defaultImportance: "trivial",
    description: "A point-in-time snapshot of world state was persisted.",
  },
  "system.error": {
    domain: "core",
    defaultImportance: "high",
    description: "Something in Jarvis itself failed.",
  },
} as const satisfies Record<string, EventTypeDefinition>;

export type EventType = keyof typeof eventCatalog;

export const eventTypes = Object.keys(eventCatalog) as EventType[];

export function eventDefinition(type: EventType): EventTypeDefinition {
  return eventCatalog[type];
}

export function isKnownEventType(value: string): value is EventType {
  return Object.hasOwn(eventCatalog, value);
}
