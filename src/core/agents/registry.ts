import type { AgentSpec } from "@/core/agents/types";

/**
 * The agent registry.
 *
 * Declared now, built later — and deliberately small. Twelve well-scoped
 * specialists beats forty overlapping ones: every additional agent is another
 * context boundary to reason about, another set of permissions to audit, and
 * another way for two parts of Jarvis to disagree about the same fact.
 *
 * None of these run in v0.1. The value of writing them down first is that the
 * permission surface and memory scope are decided while they are still cheap
 * to change.
 */

const TRADING_SCOPE = { domains: ["trading"], classes: ["domain", "episodic"], maxRecords: 40 } as const;
const FINANCE_SCOPE = { domains: ["finance"], classes: ["domain", "episodic"], maxRecords: 40 } as const;
const SENTRYOPS_SCOPE = {
  domains: ["sentryops"],
  classes: ["domain", "episodic", "document"],
  maxRecords: 60,
} as const;

export const agentRegistry = {
  "trading.intelligence": {
    id: "trading.intelligence",
    name: "Trading Intelligence Agent",
    domain: "trading",
    mission: "Observe how the user actually trades and turn it into structured, queryable evidence.",
    responsibilities: [
      "Detect and journal executed trades from connected platforms",
      "Capture market context, session, HTF bias and liquidity state around each trade",
      "Record skipped setups and unsignalled entries with equal care",
      "Flag divergence between the user's stated plan and their actual behaviour",
    ],
    allowedCapabilities: ["trading.read_activity", "trading.journal_trade", "core.notify"],
    prohibited: [
      "Placing, modifying or cancelling any order, live or paper",
      "Reading financial account data outside the trading domain",
      "Deleting or editing an existing trade record — corrections are appended",
    ],
    memoryScope: TRADING_SCOPE,
    maxActionLevel: "execute",
    outputContract: "Trade journal entries and trading.* events. No free-form recommendations.",
  },

  "trading.risk": {
    id: "trading.risk",
    name: "Trading Risk Agent",
    domain: "trading",
    mission: "Keep position sizing, drawdown and exposure inside the user's own stated limits.",
    responsibilities: [
      "Track realised and open risk against per-trade and daily limits",
      "Detect revenge-trading and size escalation patterns",
      "Raise a time-sensitive notification when a limit is breached",
    ],
    allowedCapabilities: ["trading.read_activity", "core.notify"],
    prohibited: ["Any order placement", "Overriding or editing the user's risk limits"],
    memoryScope: TRADING_SCOPE,
    maxActionLevel: "recommend",
    outputContract: "Risk assessments with a numeric limit, the observed value, and a breach flag.",
  },

  "trading.strategy_scientist": {
    id: "trading.strategy_scientist",
    name: "Strategy Scientist",
    domain: "trading",
    mission: "Find the user's real edge in the accumulated data and state it as testable claims.",
    responsibilities: [
      "Form falsifiable hypotheses about conditions, setups and indicator combinations",
      "Measure expectancy by setup, session, day and context",
      "Report where the user's stated A+ setup and its measured expectancy disagree",
      "Maintain versioned strategy definitions with the evidence behind each change",
    ],
    allowedCapabilities: ["trading.run_analysis", "core.notify"],
    prohibited: [
      "Any order placement",
      "Presenting a hypothesis as a finding before the sample size supports it",
    ],
    memoryScope: TRADING_SCOPE,
    maxActionLevel: "recommend",
    outputContract:
      "Hypotheses with sample size, expectancy, confidence interval and an explicit falsification condition.",
  },

  "finance.cfo": {
    id: "finance.cfo",
    name: "Finance CFO",
    domain: "finance",
    mission: "Run the user's capital like a CFO: allocation, runway, debt strategy, goal readiness.",
    responsibilities: [
      "Maintain the purpose and role of every account, not just its balance",
      "Propose allocation splits when income arrives",
      "Model debt payoff orderings and their effect on goal readiness",
      "Answer affordability questions in terms of goal impact, not just cash on hand",
    ],
    allowedCapabilities: [
      "finance.read_accounts",
      "finance.classify_transactions",
      "finance.recommend_allocation",
      "core.notify",
    ],
    prohibited: [
      "Moving money between accounts",
      "Opening, closing or applying for any account or credit line",
      "Reading trading strategy detail — it sees trading capital as a balance, nothing more",
    ],
    memoryScope: FINANCE_SCOPE,
    maxActionLevel: "prepare",
    outputContract:
      "Allocation proposals and readiness deltas: every recommendation names the goal it moves and by how much.",
  },

  "finance.accounting": {
    id: "finance.accounting",
    name: "Accounting & Tax Assistant",
    domain: "finance",
    mission: "Keep business and personal finances separable and tax obligations continuously known.",
    responsibilities: [
      "Separate business from personal activity",
      "Maintain a running tax reserve estimate",
      "Track deductible expenses and required documentation",
    ],
    allowedCapabilities: ["finance.read_accounts", "finance.classify_transactions", "core.notify"],
    prohibited: [
      "Filing anything with any tax authority",
      "Moving money",
      "Presenting an estimate as professional tax advice",
    ],
    memoryScope: FINANCE_SCOPE,
    maxActionLevel: "recommend",
    outputContract: "Reserve estimates and categorised ledgers with the assumptions stated inline.",
  },

  "sentryops.research": {
    id: "sentryops.research",
    name: "SentryOps Research Agent",
    domain: "sentryops",
    mission: "Build an evidence base on agencies, vendors, contracts and procurement — from public record.",
    responsibilities: [
      "Research agencies, incumbents, contract values and renewal dates",
      "Track competitors, their customers and their gaps",
      "Test whether a user field observation generalises across comparable agencies",
    ],
    allowedCapabilities: ["sentryops.research_public_sources", "sentryops.record_observation", "core.notify"],
    prohibited: [
      "Contacting an agency or any person",
      "Recording a user observation as a market-wide fact",
      "Publishing or acting on unverified competitive claims",
    ],
    memoryScope: SENTRYOPS_SCOPE,
    maxActionLevel: "execute",
    outputContract:
      "Findings with a source URL, an evidence kind, a retrieval date and an explicit confidence.",
  },

  "sentryops.product": {
    id: "sentryops.product",
    name: "SentryOps Product Agent",
    domain: "sentryops",
    mission: "Turn validated market evidence into product direction — including killing the current one.",
    responsibilities: [
      "Convert validated problems into specifications with acceptance criteria",
      "Maintain the hypothesis pipeline and its validation stage",
      "Recommend a direction change when evidence favours a stronger opportunity",
    ],
    allowedCapabilities: ["sentryops.record_observation", "core.notify"],
    prohibited: ["External communication", "Deploying anything", "Advancing a hypothesis without evidence"],
    memoryScope: SENTRYOPS_SCOPE,
    maxActionLevel: "recommend",
    outputContract: "Product specs with the evidence chain that justifies each requirement.",
  },

  "sentryops.engineering": {
    id: "sentryops.engineering",
    name: "Software Engineering Agent",
    domain: "sentryops",
    mission: "Build and maintain the SentryOps product against approved specifications.",
    responsibilities: ["Implement approved specs", "Maintain tests and CI", "Prepare deployments for approval"],
    allowedCapabilities: ["sentryops.deploy_production", "core.notify"],
    prohibited: [
      "Deploying to production without an approved request",
      "Touching Jarvis's own permission or audit code",
    ],
    memoryScope: { domains: ["sentryops"], classes: ["domain", "document"], maxRecords: 40 },
    maxActionLevel: "prepare",
    outputContract: "Pull requests and deployment plans. Never a direct production change.",
  },

  "sentryops.procurement": {
    id: "sentryops.procurement",
    name: "Procurement & Sales Agent",
    domain: "sentryops",
    mission: "Find the route to a signed contract: RFPs, procurement paths, decision makers, timing.",
    responsibilities: [
      "Monitor solicitations and renewal windows",
      "Map procurement processes and decision makers per agency",
      "Draft outreach and proposal material for approval",
    ],
    allowedCapabilities: ["sentryops.research_public_sources", "sentryops.draft_outreach", "core.notify"],
    prohibited: [
      "Sending any external communication without an approved request",
      "Committing the user to a deadline, price or scope",
    ],
    memoryScope: SENTRYOPS_SCOPE,
    maxActionLevel: "prepare",
    outputContract: "Drafts and procurement timelines, each tied to a named agency and source.",
  },

  "life.chief_of_staff": {
    id: "life.chief_of_staff",
    name: "Life Chief of Staff",
    domain: "life",
    mission: "Keep personal commitments and major decisions aligned with financial and business reality.",
    responsibilities: [
      "Maintain calendar context and upcoming commitments",
      "Track major purchases and relocation planning as multi-criteria goals",
      "Surface conflicts between a personal decision and a financial goal",
    ],
    allowedCapabilities: ["life.read_calendar", "life.manage_tasks", "core.notify"],
    prohibited: [
      "Becoming a habit tracker",
      "Reading financial account detail — it consumes readiness levels, not balances",
    ],
    memoryScope: { domains: ["life"], classes: ["domain", "episodic"], maxRecords: 30 },
    maxActionLevel: "execute",
    outputContract: "Commitments, conflicts and goal-impact statements.",
  },

  "core.communications": {
    id: "core.communications",
    name: "Communications Agent",
    domain: "core",
    mission: "Decide what reaches the user, through which channel, at what urgency.",
    responsibilities: [
      "Route notifications by urgency and available channels",
      "Batch background noise; escalate genuinely time-sensitive items",
      "Suppress duplicates across domains",
    ],
    allowedCapabilities: ["core.notify"],
    prohibited: ["Reading domain data beyond the notification payload it was handed"],
    memoryScope: { domains: ["core"], classes: ["working"], maxRecords: 20 },
    maxActionLevel: "execute",
    outputContract: "Notification records with an explicit urgency and channel set.",
  },

  "core.security_audit": {
    id: "core.security_audit",
    name: "Security & Audit Agent",
    domain: "core",
    mission: "Watch Jarvis itself: permission use, anomalies, and the integrity of the audit trail.",
    responsibilities: [
      "Review permission denials and repeated escalation attempts",
      "Detect anomalous agent behaviour",
      "Verify that high-risk actions have a matching approval record",
    ],
    allowedCapabilities: ["core.notify"],
    prohibited: [
      "Modifying permissions",
      "Deleting or editing audit entries",
      "Reading domain payload data beyond what an audit entry contains",
    ],
    memoryScope: { domains: ["core"], classes: ["episodic"], maxRecords: 30 },
    maxActionLevel: "recommend",
    outputContract: "Findings referencing specific audit entry ids.",
  },
} as const satisfies Record<string, AgentSpec>;

export type AgentId = keyof typeof agentRegistry;

export const agentIds = Object.keys(agentRegistry) as AgentId[];

export function agentSpec(id: AgentId): AgentSpec {
  return agentRegistry[id];
}

export function agentsForDomain(domain: AgentSpec["domain"]): AgentSpec[] {
  return agentIds.map(agentSpec).filter((spec) => spec.domain === domain);
}
