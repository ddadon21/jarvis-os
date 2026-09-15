import type { DomainContext, DomainModule } from "@/core/domain-module";
import type { MoveCandidate } from "@/core/next-move/types";
import type { WorldStateSlice } from "@/core/world-state/types";
import { factors } from "@/core/next-move/scoring";
import type { SentryOpsSnapshot, SentryOpsSource } from "@/domains/sentryops/ports";

/**
 * SentryOps Jarvis.
 *
 * Thinks like a founder, and is specifically built to be willing to kill the
 * current product concept. The bias it exists to counteract is attachment:
 * once a direction is chosen, every new fact starts looking like support for
 * it. Hence the hard rule encoded below — an observation that has not been
 * tested against comparable agencies cannot advance a hypothesis, no matter
 * how compelling it felt in the field.
 */
export class SentryOpsModule implements DomainModule {
  readonly domain = "sentryops" as const;
  readonly mission =
    "Find the strongest evidence-backed market opportunity for SentryOps, and change direction when the evidence says to.";

  constructor(private readonly source: SentryOpsSource) {}

  async getStateSlice(context: DomainContext): Promise<WorldStateSlice> {
    const snapshot = await this.source.getSnapshot(context.userId);
    const unvalidated = snapshot.observationsRecorded - snapshot.observationsValidated;

    return {
      domain: this.domain,
      headline: headline(snapshot),
      metrics: [
        {
          key: "market_validation",
          label: "Market validation",
          value: snapshot.marketValidation,
          format: "percent",
          polarity: "higher_is_better",
          caption: "verified vs. local evidence",
        },
        { key: "product_readiness", label: "Product readiness", value: snapshot.productReadiness, format: "percent", polarity: "higher_is_better" },
        { key: "pilot_readiness", label: "Pilot readiness", value: snapshot.pilotReadiness, format: "percent", polarity: "higher_is_better" },
        { key: "agencies", label: "Agencies tracked", value: snapshot.agenciesTracked, format: "number", polarity: "higher_is_better" },
        {
          key: "observations_unvalidated",
          label: "Unvalidated observations",
          value: unvalidated,
          format: "number",
          polarity: "lower_is_better",
          caption: "field notes not yet tested against the market",
        },
        { key: "open_rfps", label: "Open RFPs", value: snapshot.openRfps.length, format: "number", polarity: "neutral" },
      ],
      flags: buildFlags(snapshot),
      dataQuality: "mock",
      observedAt: snapshot.observedAt,
    };
  }

  async proposeMoves(context: DomainContext): Promise<MoveCandidate[]> {
    const snapshot = await this.source.getSnapshot(context.userId);
    const moves: MoveCandidate[] = [];

    // RFPs are the only hard deadlines in this domain. Everything else can slip.
    for (const rfp of snapshot.openRfps) {
      moves.push({
        id: `sentryops.rfp.${slug(rfp.title)}`,
        userId: context.userId,
        domain: this.domain,
        title: `Assess RFP: ${rfp.title}`,
        summary: "Solicitations close on a fixed date. An expired RFP is worth nothing regardless of fit.",
        dueAt: rfp.dueAt,
        requiredActionLevel: "recommend",
        sourceKind: "agent",
        sourceId: "sentryops.procurement",
        factors: factors({
          urgency: 0.85,
          ...(rfp.estimatedValue !== undefined ? { expectedValue: rfp.estimatedValue } : {}),
          goalAlignment: 0.7,
          strategicImportance: 0.8,
          contextFit: 0.6,
          // Most solicitations will not be a fit, and that is fine — the cost of
          // assessing one is small against the cost of missing the right one.
          probabilityOfSuccess: 0.35,
          estimatedMinutes: 60,
        }),
      });
    }

    const unvalidated = snapshot.observationsRecorded - snapshot.observationsValidated;
    if (unvalidated > 0) {
      moves.push({
        id: "sentryops.validate_observations",
        userId: context.userId,
        domain: this.domain,
        title: `Test ${unvalidated} field observations against comparable agencies`,
        summary:
          "A firsthand observation is strong evidence about one agency and none about the market. Validation is what converts it.",
        requiredActionLevel: "recommend",
        sourceKind: "agent",
        sourceId: "sentryops.research",
        factors: factors({
          urgency: 0.3,
          goalAlignment: 0.8,
          strategicImportance: 0.95,
          contextFit: 0.5,
          probabilityOfSuccess: 0.8,
          estimatedMinutes: 90,
        }),
      });
    }

    const stalled = snapshot.activeHypotheses.filter((h) => !h.evidenceSufficient);
    for (const hypothesis of stalled) {
      moves.push({
        id: `sentryops.hypothesis.${hypothesis.id}`,
        userId: context.userId,
        domain: this.domain,
        title: `Gather evidence for: ${hypothesis.statement}`,
        summary: `Stalled at the ${hypothesis.stage.replace(/_/g, " ")} stage — the current stage's evidence bar is not met.`,
        blocked: true,
        dependsOn: [`evidence:${hypothesis.id}`],
        requiredActionLevel: "recommend",
        sourceKind: "agent",
        sourceId: "sentryops.product",
        factors: factors({
          urgency: 0.2,
          goalAlignment: 0.7,
          strategicImportance: 0.85,
          contextFit: 0.4,
          probabilityOfSuccess: 0.6,
          estimatedMinutes: 120,
        }),
      });
    }

    return moves;
  }
}

function headline(snapshot: SentryOpsSnapshot): string {
  if (snapshot.openRfps.length > 0) {
    return `${snapshot.openRfps.length} open ${snapshot.openRfps.length === 1 ? "solicitation" : "solicitations"} and ${snapshot.activeHypotheses.length} active hypotheses.`;
  }
  if (snapshot.marketValidation < 0.5) {
    return "Research stage — direction still rests mostly on local evidence.";
  }
  return `Validated direction at ${Math.round(snapshot.marketValidation * 100)}% market confidence.`;
}

function buildFlags(snapshot: SentryOpsSnapshot): string[] {
  const flags = [snapshot.marketValidation < 0.5 ? "research" : "build"];
  if (snapshot.openRfps.length > 0) flags.push("rfp_open");
  if (snapshot.observationsValidated < snapshot.observationsRecorded) flags.push("evidence_gap");
  return flags;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
}
