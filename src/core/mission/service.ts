import { domainLabels, readinessRank, type Domain, type ReadinessLevel } from "@/core/types";
import type { MissionDirective, MissionStatus } from "@/core/mission/types";
import { rollupReadiness } from "@/core/goals/readiness";
import { nowIso } from "@/lib/time";

/**
 * Standing directives.
 *
 * Held in code for v0.1 because they are closer to configuration-as-intent
 * than to user data, and because an editable mission that drifts silently is
 * worse than a fixed one that has to be changed on purpose. They move to the
 * database when the user needs to revise them without a deploy.
 */
export const defaultDirectives: readonly MissionDirective[] = [
  {
    id: "trading.evidence_first",
    domain: "trading",
    statement:
      "Accumulate an honest record of how the user actually trades. No strategy claim outruns its sample size.",
    rank: 1,
  },
  {
    id: "finance.debt_to_independence",
    domain: "finance",
    statement:
      "Move capital from debt toward independence. Every dollar has an assigned purpose before it is spent.",
    rank: 0,
  },
  {
    id: "sentryops.evidence_over_attachment",
    domain: "sentryops",
    statement:
      "Find the strongest opportunity the evidence supports — including one that replaces the current product concept.",
    rank: 2,
  },
  {
    id: "life.alignment",
    domain: "life",
    statement: "Keep personal decisions consistent with what the financial picture actually supports.",
    rank: 3,
  },
];

export class MissionService {
  constructor(private readonly directives: readonly MissionDirective[] = defaultDirectives) {}

  /**
   * Synthesises one headline from per-domain readiness.
   *
   * The headline names the weakest domain rather than averaging: an average
   * across four domains hides the one that is actually on fire, which is the
   * only one worth putting at the top of a command centre.
   */
  status(domainReadiness: Readonly<Partial<Record<Domain, ReadinessLevel>>>): MissionStatus {
    const entries = Object.entries(domainReadiness) as [Domain, ReadinessLevel][];
    const overall = rollupReadiness(entries.map(([, level]) => level));

    const weakest = entries
      .slice()
      .sort((a, b) => readinessRank[a[1]] - readinessRank[b[1]])[0];

    const headline =
      entries.length === 0
        ? "No domain reporting."
        : overall === "green"
          ? "All domains green. Hold the line and compound."
          : `Weakest link: ${domainLabels[weakest![0]]} at ${weakest![1].toUpperCase()}.`;

    return {
      headline,
      overall,
      domainReadiness,
      directives: [...this.directives].sort((a, b) => a.rank - b.rank),
      generatedAt: nowIso(),
    };
  }
}
