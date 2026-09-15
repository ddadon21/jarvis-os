import { capabilityDefinition } from "@/core/permissions/capabilities";
import type { ApprovalDraft, ApprovalRequest, ApprovalStatus } from "@/core/approvals/types";
import type { ApprovalRepository } from "@/core/approvals/ports";
import type { AuditService } from "@/core/audit/service";
import type { EventService } from "@/core/events/service";
import { err, ok, jarvisError, type Result } from "@/lib/result";
import { newId } from "@/lib/ids";
import { isoHoursFromNow, nowIso } from "@/lib/time";

const DEFAULT_EXPIRY_HOURS = 24;

/**
 * The Approval Engine.
 *
 * Note what `approve()` does not do: execute anything. It records consent and
 * returns. The caller that owns the capability performs the action and reports
 * back with `markExecuted` or `markFailed`. Keeping consent and execution in
 * separate steps means a bug in an executor can never be mistaken for a bug in
 * the approval path, and every attempt is separately auditable.
 */
export class ApprovalService {
  constructor(
    private readonly repository: ApprovalRepository,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {}

  async request(userId: string, draft: ApprovalDraft): Promise<ApprovalRequest> {
    const definition = capabilityDefinition(draft.capability);

    const request: ApprovalRequest = {
      id: newId(),
      userId,
      domain: draft.domain,
      capability: draft.capability,
      riskClass: definition.riskClass,
      requestedBy: draft.requestedBy,
      title: draft.title,
      summary: draft.summary,
      proposedAction: draft.proposedAction,
      status: "pending",
      expiresAt: isoHoursFromNow(draft.expiresInHours ?? DEFAULT_EXPIRY_HOURS),
      createdAt: nowIso(),
      ...(draft.expectedOutcome ? { expectedOutcome: draft.expectedOutcome } : {}),
      ...(draft.correlationId ? { correlationId: draft.correlationId } : {}),
    };

    const created = await this.repository.create(request);

    await this.audit.record(userId, {
      actorType: "agent",
      actorId: draft.requestedBy,
      action: "approval.requested",
      domain: draft.domain,
      capability: draft.capability,
      targetType: "approval_request",
      targetId: created.id,
      outcome: "succeeded",
      reason: draft.title,
      ...(draft.correlationId ? { correlationId: draft.correlationId } : {}),
    });

    await this.events.record(userId, {
      eventType: "approval.requested",
      source: draft.requestedBy,
      importance: definition.riskClass === "critical" ? "critical" : "high",
      payload: { approvalId: created.id, capability: draft.capability, title: draft.title },
      ...(draft.correlationId ? { correlationId: draft.correlationId } : {}),
    });

    return created;
  }

  async resolve(
    userId: string,
    approvalId: string,
    decision: "approve" | "deny",
    resolvedBy: string,
    note?: string,
  ): Promise<Result<ApprovalRequest>> {
    const existing = await this.repository.findById(userId, approvalId);
    if (!existing) return err(jarvisError("not_found", "Approval request not found", { approvalId }));

    if (existing.status !== "pending") {
      return err(
        jarvisError("conflict", `Approval is already ${existing.status}`, {
          approvalId,
          status: existing.status,
        }),
      );
    }

    // An expired request is never silently approved. Staleness is the whole
    // reason the field exists: conditions move, and a six-hour-old proposal to
    // move money may no longer be the right action.
    if (Date.parse(existing.expiresAt) <= Date.now()) {
      await this.transition(userId, approvalId, "expired", resolvedBy, "Expired before resolution");
      return err(jarvisError("conflict", "Approval request has expired", { approvalId }));
    }

    const status: ApprovalStatus = decision === "approve" ? "approved" : "denied";
    const updated = await this.transition(userId, approvalId, status, resolvedBy, note);
    return ok(updated);
  }

  /** Called by the capability handler after a successful execution. */
  async markExecuted(userId: string, approvalId: string, actorId: string): Promise<ApprovalRequest> {
    return this.transition(userId, approvalId, "executed", actorId, "Action carried out");
  }

  /** Called by the capability handler when execution fails after approval. */
  async markFailed(userId: string, approvalId: string, actorId: string, reason: string): Promise<ApprovalRequest> {
    return this.transition(userId, approvalId, "failed", actorId, reason);
  }

  async pending(userId: string, limit = 25): Promise<ApprovalRequest[]> {
    const requests = await this.repository.list(userId, { status: "pending", limit });
    const now = Date.now();
    return requests.filter((request) => Date.parse(request.expiresAt) > now);
  }

  private async transition(
    userId: string,
    approvalId: string,
    status: ApprovalStatus,
    actorId: string,
    note?: string,
  ): Promise<ApprovalRequest> {
    const updated = await this.repository.updateStatus(userId, approvalId, {
      status,
      resolvedAt: nowIso(),
      resolvedBy: actorId,
      ...(note ? { decisionNote: note } : {}),
    });

    await this.audit.record(userId, {
      actorType: actorId === userId ? "user" : "agent",
      actorId,
      action: `approval.${status}`,
      domain: updated.domain,
      capability: updated.capability,
      targetType: "approval_request",
      targetId: approvalId,
      outcome: status === "denied" || status === "failed" ? "denied" : "succeeded",
      ...(note ? { reason: note } : {}),
      ...(updated.correlationId ? { correlationId: updated.correlationId } : {}),
    });

    await this.events.record(userId, {
      eventType: "approval.resolved",
      source: "jarvis.core",
      payload: { approvalId, status, capability: updated.capability },
      ...(updated.correlationId ? { correlationId: updated.correlationId } : {}),
    });

    return updated;
  }
}
