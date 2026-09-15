import type { Confidence, MinorUnits } from "@/core/types";
import type { HypothesisStage } from "@/domains/sentryops/types";

export interface SentryOpsSnapshot {
  readonly agenciesTracked: number;
  readonly observationsRecorded: number;
  /** Observations that have been tested against comparable agencies. */
  readonly observationsValidated: number;
  readonly contractsTracked: number;
  readonly competitorsTracked: number;
  readonly openRfps: readonly {
    readonly title: string;
    readonly dueAt: string;
    readonly estimatedValue?: MinorUnits;
  }[];
  readonly activeHypotheses: readonly {
    readonly id: string;
    readonly statement: string;
    readonly stage: HypothesisStage;
    readonly confidence: Confidence;
    /** Stage-appropriate evidence is present. Blocks advancement when false. */
    readonly evidenceSufficient: boolean;
  }[];
  /** 0..1 — how much of the direction rests on verified rather than local evidence. */
  readonly marketValidation: number;
  readonly productReadiness: number;
  readonly pilotReadiness: number;
  readonly observedAt: string;
}

export interface SentryOpsSource {
  getSnapshot(userId: string): Promise<SentryOpsSnapshot>;
}
