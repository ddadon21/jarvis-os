import type { ActionLevel, Domain } from "@/core/types";

/**
 * The capability registry.
 *
 * Autonomy is granted per capability, never globally. Every capability declares
 * a `hardCeiling`: the highest autonomy it can EVER be granted, regardless of
 * what a settings row says. Placing a live order or moving money cannot be
 * raised to EXECUTE by flipping a boolean in a database — it requires editing
 * this file, which is code review, a commit and a deploy.
 *
 * That asymmetry is the whole design. Configuration is easy to change by
 * accident, or by anything that can write to the database. Code is not.
 */

export const riskClasses = ["low", "medium", "high", "critical"] as const;
export type RiskClass = (typeof riskClasses)[number];

export interface CapabilityDefinition {
  readonly domain: Domain;
  readonly description: string;
  readonly riskClass: RiskClass;
  /** Maximum level this capability may ever hold. Not overridable at runtime. */
  readonly hardCeiling: ActionLevel;
  /** Level applied when the user has not configured anything. */
  readonly defaultLevel: ActionLevel;
}

export const capabilityRegistry = {
  // --- Trading ---------------------------------------------------------------
  "trading.read_activity": {
    domain: "trading",
    description: "Read account activity, fills and positions from a connected broker.",
    riskClass: "low",
    hardCeiling: "execute",
    defaultLevel: "observe",
  },
  "trading.journal_trade": {
    domain: "trading",
    description: "Create and enrich journal entries for trades that already happened.",
    riskClass: "low",
    hardCeiling: "execute",
    defaultLevel: "execute",
  },
  "trading.run_analysis": {
    domain: "trading",
    description: "Run statistical analysis over the trade dataset.",
    riskClass: "low",
    hardCeiling: "execute",
    defaultLevel: "execute",
  },
  "trading.paper_order": {
    domain: "trading",
    description: "Place a simulated order on a paper account.",
    riskClass: "medium",
    hardCeiling: "execute",
    defaultLevel: "prepare",
  },
  "trading.live_order": {
    domain: "trading",
    description: "Place, modify or cancel an order with real capital at risk.",
    riskClass: "critical",
    // Deliberately capped below EXECUTE. Autonomous live trading is out of
    // scope until there is a measured edge and a controlled rollout plan.
    hardCeiling: "prepare",
    defaultLevel: "recommend",
  },

  // --- Finance ---------------------------------------------------------------
  "finance.read_accounts": {
    domain: "finance",
    description: "Read balances and transactions from connected financial accounts.",
    riskClass: "low",
    hardCeiling: "execute",
    defaultLevel: "observe",
  },
  "finance.classify_transactions": {
    domain: "finance",
    description: "Assign categories and purposes to transactions.",
    riskClass: "low",
    hardCeiling: "execute",
    defaultLevel: "execute",
  },
  "finance.recommend_allocation": {
    domain: "finance",
    description: "Propose how incoming capital should be split.",
    riskClass: "medium",
    hardCeiling: "prepare",
    defaultLevel: "recommend",
  },
  "finance.move_money": {
    domain: "finance",
    description: "Transfer funds between accounts or pay a bill.",
    riskClass: "critical",
    hardCeiling: "prepare",
    defaultLevel: "recommend",
  },
  "finance.file_taxes": {
    domain: "finance",
    description: "Submit a tax filing to an authority.",
    riskClass: "critical",
    hardCeiling: "prepare",
    defaultLevel: "recommend",
  },

  // --- SentryOps -------------------------------------------------------------
  "sentryops.research_public_sources": {
    domain: "sentryops",
    description: "Read public records, contracts, budgets and vendor sites.",
    riskClass: "low",
    hardCeiling: "execute",
    defaultLevel: "observe",
  },
  "sentryops.record_observation": {
    domain: "sentryops",
    description: "Store a user field observation, tagged as such.",
    riskClass: "low",
    hardCeiling: "execute",
    defaultLevel: "execute",
  },
  "sentryops.draft_outreach": {
    domain: "sentryops",
    description: "Draft an email or proposal to an agency contact.",
    riskClass: "medium",
    hardCeiling: "prepare",
    defaultLevel: "prepare",
  },
  "sentryops.send_outreach": {
    domain: "sentryops",
    description: "Send external communication on the user's behalf.",
    riskClass: "high",
    hardCeiling: "prepare",
    defaultLevel: "recommend",
  },
  "sentryops.deploy_production": {
    domain: "sentryops",
    description: "Deploy the SentryOps product to production.",
    riskClass: "critical",
    hardCeiling: "prepare",
    defaultLevel: "recommend",
  },

  // --- Life ------------------------------------------------------------------
  "life.read_calendar": {
    domain: "life",
    description: "Read calendar commitments.",
    riskClass: "low",
    hardCeiling: "execute",
    defaultLevel: "observe",
  },
  "life.manage_tasks": {
    domain: "life",
    description: "Create, update and close tasks.",
    riskClass: "low",
    hardCeiling: "execute",
    defaultLevel: "execute",
  },

  // --- Core ------------------------------------------------------------------
  "core.notify": {
    domain: "core",
    description: "Send an in-app or push notification to the user.",
    riskClass: "low",
    hardCeiling: "execute",
    defaultLevel: "execute",
  },
  "core.delete_records": {
    domain: "core",
    description: "Permanently delete user records.",
    riskClass: "critical",
    hardCeiling: "prepare",
    defaultLevel: "recommend",
  },
  "core.modify_permissions": {
    domain: "core",
    description: "Change autonomy grants.",
    riskClass: "critical",
    // Jarvis may never widen its own permissions, in any mode. This is the one
    // capability where even PREPARE would be a mistake: a prepared change plus
    // a distracted approval is how a system quietly grants itself execution.
    hardCeiling: "recommend",
    defaultLevel: "recommend",
  },
} as const satisfies Record<string, CapabilityDefinition>;

export type Capability = keyof typeof capabilityRegistry;

export const capabilities = Object.keys(capabilityRegistry) as Capability[];

export function capabilityDefinition(capability: Capability): CapabilityDefinition {
  return capabilityRegistry[capability];
}

export function isKnownCapability(value: string): value is Capability {
  return Object.hasOwn(capabilityRegistry, value);
}

/** Capabilities that must always produce an approval request before acting. */
export function requiresExplicitApproval(capability: Capability): boolean {
  const risk = capabilityRegistry[capability].riskClass;
  return risk === "high" || risk === "critical";
}
