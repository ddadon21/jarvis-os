import type { Domain } from "@/core/types";
import type { AuditDraft, AuditEntry } from "@/core/audit/types";
import type { AuditRepository } from "@/core/audit/ports";
import type { PermissionDecision } from "@/core/permissions/types";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";

export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  async record(userId: string, draft: AuditDraft): Promise<AuditEntry> {
    const entry: AuditEntry = {
      ...draft,
      id: newId(),
      userId,
      occurredAt: draft.occurredAt ?? nowIso(),
    };
    return this.repository.append(entry);
  }

  /**
   * Records the outcome of a permission check.
   *
   * Called on both branches on purpose. A log that only contains successful
   * actions cannot tell you that something tried to move money forty times.
   */
  async recordPermissionCheck(
    userId: string,
    actorId: string,
    domain: Domain,
    decision: PermissionDecision,
    correlationId?: string,
  ): Promise<AuditEntry> {
    return this.record(userId, {
      actorType: "agent",
      actorId,
      action: decision.allowed ? "permission.allowed" : "permission.denied",
      domain,
      capability: decision.capability,
      outcome: decision.allowed ? "allowed" : "denied",
      reason: decision.reason,
      metadata: {
        requestedLevel: decision.requestedLevel,
        effectiveLevel: decision.effectiveLevel,
      },
      ...(correlationId ? { correlationId } : {}),
    });
  }

  async list(
    userId: string,
    filter?: { domain?: Domain; actorId?: string; correlationId?: string; limit?: number },
  ): Promise<AuditEntry[]> {
    return this.repository.list(userId, filter);
  }
}
