import type { MinorUnits } from "@/core/types";

export interface LifeSnapshot {
  readonly upcomingCommitments: readonly {
    readonly title: string;
    readonly startsAt: string;
    readonly financialImpact?: MinorUnits;
  }[];
  readonly openDecisions: readonly {
    readonly title: string;
    readonly goalSlug?: string;
    readonly estimatedCost?: MinorUnits;
  }[];
  /** Commitments carrying a cost that Finance has not been told about. */
  readonly unaccountedCommitmentCost: MinorUnits;
  readonly observedAt: string;
}

export interface LifeSource {
  getSnapshot(userId: string): Promise<LifeSnapshot>;
}
