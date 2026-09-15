import { z } from "zod";
import type { Domain } from "@/core/types";
import { capabilities, type Capability, type RiskClass } from "@/core/permissions/capabilities";

/**
 * Approval requests are how PREPARE becomes EXECUTE.
 *
 * Jarvis assembles a fully-specified action — not a vague suggestion — and
 * parks it here. The user sees exactly what would happen, approves or denies,
 * and only then does anything run. This is the mechanism that makes it safe
 * for Jarvis to get more capable over time without getting more dangerous.
 */

export const approvalStatuses = [
  "pending",
  "approved",
  "denied",
  "expired",
  /** Approved and carried out successfully. */
  "executed",
  /** Approved, attempted, and the execution failed. */
  "failed",
] as const;
export type ApprovalStatus = (typeof approvalStatuses)[number];

export interface ApprovalRequest {
  readonly id: string;
  readonly userId: string;
  readonly domain: Domain;
  readonly capability: Capability;
  readonly riskClass: RiskClass;
  /** Agent or service that prepared the action. */
  readonly requestedBy: string;
  readonly title: string;
  /** Plain-language description of exactly what will happen if approved. */
  readonly summary: string;
  /**
   * The concrete, machine-executable action. Shape is defined by the capability
   * handler and validated again at execution time — an approval that sat for
   * six hours is not proof that the payload is still valid.
   */
  readonly proposedAction: Readonly<Record<string, unknown>>;
  /** What Jarvis expects to happen, for later outcome measurement. */
  readonly expectedOutcome?: string;
  readonly status: ApprovalStatus;
  /** Approvals go stale. A pending request past this point is not actionable. */
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly resolvedAt?: string;
  readonly resolvedBy?: string;
  readonly decisionNote?: string;
  readonly correlationId?: string;
}

export interface ApprovalDraft {
  readonly domain: Domain;
  readonly capability: Capability;
  readonly requestedBy: string;
  readonly title: string;
  readonly summary: string;
  readonly proposedAction: Readonly<Record<string, unknown>>;
  readonly expectedOutcome?: string;
  /** Defaults to 24 hours. */
  readonly expiresInHours?: number;
  readonly correlationId?: string;
}

export const approvalDecisionSchema = z.object({
  approvalId: z.uuid(),
  decision: z.enum(["approve", "deny"]),
  note: z.string().max(1000).optional(),
});

export const approvalDraftSchema = z.object({
  capability: z.enum(capabilities as [Capability, ...Capability[]]),
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(2000),
  proposedAction: z.record(z.string(), z.unknown()),
  expectedOutcome: z.string().max(1000).optional(),
  expiresInHours: z.number().int().min(1).max(168).optional(),
});
