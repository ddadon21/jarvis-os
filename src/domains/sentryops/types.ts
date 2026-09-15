import type { Confidence, EvidenceKind, MinorUnits } from "@/core/types";

/**
 * SentryOps domain types.
 *
 * The defining constraint of this domain: a user field observation and a
 * publicly verified fact are different kinds of thing, and the difference must
 * survive every transformation. "Staff were handling process Y by hand during
 * my internship" is strong evidence about one agency and no evidence at all
 * about the market. `evidenceKind` is therefore required on every claim, and
 * promotion from observation to market fact only happens through an explicit
 * validation step with its own record.
 */

export const agencyTypes = [
  "sheriff_office",
  "police_department",
  "corrections",
  "dispatch_911",
  "fire_ems",
  "county_admin",
  "state_agency",
  "federal_agency",
  "other",
] as const;
export type AgencyType = (typeof agencyTypes)[number];

export interface Agency {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly type: AgencyType;
  readonly state: string;
  readonly county?: string;
  readonly population?: number;
  readonly swornOfficers?: number;
  readonly annualBudget?: MinorUnits;
  /** Known systems in use. Each entry should trace to a source. */
  readonly knownSystems: readonly string[];
  readonly websiteUrl?: string;
  readonly notes?: string;
}

/**
 * A firsthand observation from inside an agency.
 * Always `user_observation`; never promoted in place.
 */
export interface AgencyObservation {
  readonly id: string;
  readonly userId: string;
  readonly agencyId?: string;
  readonly observedAt: string;
  readonly title: string;
  readonly detail: string;
  /** The workflow or process this touches, e.g. `evidence_intake`. */
  readonly processArea: string;
  /** How much pain the user judged it to cause, 0..1. Subjective by definition. */
  readonly perceivedPain: Confidence;
  readonly evidenceKind: Extract<EvidenceKind, "user_observation">;
  /** Validation records that tested whether this generalises. */
  readonly validationIds: readonly string[];
}

export interface Vendor {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly websiteUrl?: string;
  readonly productAreas: readonly string[];
  readonly knownCustomers: readonly string[];
  readonly notes?: string;
}

export interface Competitor {
  readonly id: string;
  readonly userId: string;
  readonly vendorId?: string;
  readonly name: string;
  readonly positioning: string;
  readonly strengths: readonly string[];
  readonly weaknesses: readonly string[];
  readonly pricingNotes?: string;
  readonly lastReviewedAt: string;
}

export interface Contract {
  readonly id: string;
  readonly userId: string;
  readonly agencyId: string;
  readonly vendorId?: string;
  readonly title: string;
  readonly value?: MinorUnits;
  readonly startDate?: string;
  readonly endDate?: string;
  /** The date that makes a contract actionable rather than merely interesting. */
  readonly renewalDate?: string;
  readonly procurementRoute?: string;
  readonly sourceId: string;
}

export const rfpStatuses = ["open", "closed", "awarded", "cancelled"] as const;
export type RfpStatus = (typeof rfpStatuses)[number];

export interface Rfp {
  readonly id: string;
  readonly userId: string;
  readonly agencyId?: string;
  readonly title: string;
  readonly status: RfpStatus;
  readonly postedAt?: string;
  readonly dueAt?: string;
  readonly estimatedValue?: MinorUnits;
  readonly requirements: readonly string[];
  readonly sourceId: string;
}

/** Where a claim came from. Every non-observation fact must cite one. */
export interface ResearchSource {
  readonly id: string;
  readonly userId: string;
  readonly url?: string;
  readonly title: string;
  readonly publisher?: string;
  readonly retrievedAt: string;
  readonly evidenceKind: EvidenceKind;
  readonly excerpt?: string;
}

/**
 * The SentryOps reasoning loop, as a state machine.
 * A hypothesis advances only when the current stage's evidence bar is met.
 */
export const hypothesisStages = [
  "observation",
  "research",
  "validation",
  "market_frequency",
  "pain",
  "buyer",
  "existing_solutions",
  "competitive_gap",
  "product_opportunity",
  "product_spec",
  "build",
  "demo",
  "pilot",
  "contract",
  "feedback",
  "iterate",
] as const;
export type HypothesisStage = (typeof hypothesisStages)[number];

export const hypothesisStatuses = ["active", "validated", "invalidated", "parked"] as const;
export type HypothesisStatus = (typeof hypothesisStatuses)[number];

export interface ProductHypothesis {
  readonly id: string;
  readonly userId: string;
  readonly statement: string;
  readonly stage: HypothesisStage;
  readonly status: HypothesisStatus;
  /** What would prove this wrong. Required — a hypothesis without one is a belief. */
  readonly falsificationCondition: string;
  readonly confidence: Confidence;
  /** Observations and sources supporting it, with their evidence kinds intact. */
  readonly supportingObservationIds: readonly string[];
  readonly supportingSourceIds: readonly string[];
  readonly contradictingSourceIds: readonly string[];
  /** How many comparable agencies show the same problem, once tested. */
  readonly marketFrequency?: { readonly sampled: number; readonly matched: number };
  readonly estimatedBuyer?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Opportunity {
  readonly id: string;
  readonly userId: string;
  readonly hypothesisId: string;
  readonly title: string;
  readonly targetSegment: string;
  readonly estimatedContractValue?: MinorUnits;
  readonly competitiveGap: string;
  readonly confidence: Confidence;
}
