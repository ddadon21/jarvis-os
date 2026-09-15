import type { Domain } from "@/core/types";
import type { Capability } from "@/core/permissions/capabilities";

/**
 * The audit log is append-only and never edited or deleted.
 *
 * It answers one question that becomes critical the moment Jarvis acts on its
 * own: "why did that happen, who decided it, and what were they allowed to do
 * at the time?". Denials are logged as carefully as successes — a denied
 * attempt is often the more interesting record.
 */

export const actorTypes = ["user", "agent", "system", "integration"] as const;
export type ActorType = (typeof actorTypes)[number];

export const auditOutcomes = ["allowed", "denied", "succeeded", "failed"] as const;
export type AuditOutcome = (typeof auditOutcomes)[number];

export interface AuditEntry {
  readonly id: string;
  readonly userId: string;
  readonly actorType: ActorType;
  /** User id, agent id, integration name, or `jarvis.core`. */
  readonly actorId: string;
  /** Verb phrase: `approval.granted`, `permission.denied`, `trade.journaled`. */
  readonly action: string;
  readonly domain: Domain;
  readonly capability?: Capability;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly outcome: AuditOutcome;
  readonly reason?: string;
  /** Never contains credentials, tokens or full account numbers. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly correlationId?: string;
  readonly occurredAt: string;
}

export type AuditDraft = Omit<AuditEntry, "id" | "occurredAt" | "userId"> & {
  readonly occurredAt?: string;
};
