/**
 * Primitives shared by every part of Jarvis Core.
 *
 * Anything in here is vocabulary the whole system agrees on. Adding to this
 * file is a deliberate act — a new domain or a new action level changes the
 * meaning of every table and every policy check downstream.
 */

/**
 * The operating domains. These are architectural boundaries, not tags:
 * each has its own data, memory, agents and rules. `core` is Jarvis itself —
 * the executive layer that reads summaries from the others.
 */
export const domains = ["trading", "finance", "sentryops", "life", "core"] as const;
export type Domain = (typeof domains)[number];

export const domainLabels: Record<Domain, string> = {
  trading: "Trading",
  finance: "Finance",
  sentryops: "SentryOps",
  life: "Life",
  core: "Jarvis Core",
};

/** How much a fact or event matters. Drives triage, not delivery. */
export const importanceLevels = ["trivial", "low", "normal", "high", "critical"] as const;
export type Importance = (typeof importanceLevels)[number];

export const importanceRank: Record<Importance, number> = {
  trivial: 0,
  low: 1,
  normal: 2,
  high: 3,
  critical: 4,
};

/**
 * Readiness is a three-state signal, never a bare percentage.
 * A goal at "87%" tells you nothing about whether the missing 13% is a
 * rounding error or a hard blocker. RED/YELLOW/GREEN forces that judgement.
 */
export const readinessLevels = ["red", "yellow", "green"] as const;
export type ReadinessLevel = (typeof readinessLevels)[number];

export const readinessRank: Record<ReadinessLevel, number> = { red: 0, yellow: 1, green: 2 };

/** When something should happen. Distinct from priority — this is placement in time. */
export const horizons = ["now", "next", "today", "this_week", "longer_term"] as const;
export type Horizon = (typeof horizons)[number];

export const horizonLabels: Record<Horizon, string> = {
  now: "NOW",
  next: "NEXT",
  today: "TODAY",
  this_week: "THIS WEEK",
  longer_term: "LONGER TERM",
};

/**
 * How far Jarvis may go on its own for a given capability.
 * The ladder is strictly ordered: EXECUTE implies PREPARE implies RECOMMEND
 * implies OBSERVE. See docs/PERMISSIONS.md.
 */
export const actionLevels = ["observe", "recommend", "prepare", "execute"] as const;
export type ActionLevel = (typeof actionLevels)[number];

export const actionLevelRank: Record<ActionLevel, number> = {
  observe: 0,
  recommend: 1,
  prepare: 2,
  execute: 3,
};

/**
 * Where a claim came from. This exists mainly for SentryOps, where conflating
 * "I saw this during my internship" with "this is true of the market" would
 * produce confident nonsense — but it applies anywhere Jarvis reasons from
 * mixed-quality evidence.
 */
export const evidenceKinds = [
  /** Independently checkable: public record, published contract, vendor site. */
  "public_verified",
  /** Firsthand account from the user. True locally; market frequency unknown. */
  "user_observation",
  /** Derived by Jarvis from other evidence. Never promoted to fact on its own. */
  "inferred",
  /** Claimed by a third party without verification. */
  "unverified_report",
] as const;
export type EvidenceKind = (typeof evidenceKinds)[number];

/** A 0..1 confidence. Kept as a plain number, but always documented as a fraction. */
export type Confidence = number;

/** Money in minor units (cents). Never store dollars as a float. */
export type MinorUnits = number;

export interface Identified {
  readonly id: string;
}

export interface Owned {
  /** Supabase auth user id. Every row in Jarvis is owned by exactly one user. */
  readonly userId: string;
}

export interface Timestamped {
  readonly createdAt: string;
  readonly updatedAt?: string;
}
