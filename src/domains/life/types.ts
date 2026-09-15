import type { MinorUnits } from "@/core/types";

/**
 * Life domain types.
 *
 * Scope discipline matters here more than anywhere else: this domain exists to
 * keep personal decisions honest against financial and business reality, not
 * to track habits. Every entity below either carries a date the user is
 * committed to, or a cost that shows up in Finance.
 */

export const commitmentKinds = ["meeting", "deadline", "obligation", "travel", "personal"] as const;
export type CommitmentKind = (typeof commitmentKinds)[number];

export interface Commitment {
  readonly id: string;
  readonly userId: string;
  readonly title: string;
  readonly kind: CommitmentKind;
  readonly startsAt: string;
  readonly endsAt?: string;
  readonly location?: string;
  /** Cost this commitment implies, so Finance can see it coming. */
  readonly financialImpact?: MinorUnits;
  readonly notes?: string;
  readonly externalCalendarId?: string;
}

export const majorDecisionKinds = ["relocation", "vehicle", "education", "career", "large_purchase"] as const;
export type MajorDecisionKind = (typeof majorDecisionKinds)[number];

/**
 * A big personal decision under consideration.
 *
 * Linked to a goal slug rather than owning its own readiness logic: "can I
 * afford to move out?" is a goal with criteria, and this record is the
 * decision that goal exists to serve.
 */
export interface MajorDecision {
  readonly id: string;
  readonly userId: string;
  readonly title: string;
  readonly kind: MajorDecisionKind;
  readonly goalSlug?: string;
  readonly estimatedCost?: MinorUnits;
  readonly estimatedMonthlyCost?: MinorUnits;
  readonly targetDate?: string;
  readonly notes?: string;
}
