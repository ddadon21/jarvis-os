import type { Domain, ReadinessLevel } from "@/core/types";

/**
 * The Mission Engine holds what Jarvis is *for*.
 *
 * Standing directives are the fixed points everything else is measured
 * against. They change rarely and deliberately; the Next Move Engine, by
 * contrast, changes minute to minute. Keeping them apart is what stops
 * long-term direction from being quietly rewritten by whatever was urgent
 * this week.
 */
export interface MissionDirective {
  readonly id: string;
  readonly domain: Domain;
  readonly statement: string;
  /** Lower sorts first. Ties are a signal the directives need sharpening. */
  readonly rank: number;
}

export interface MissionStatus {
  readonly headline: string;
  readonly overall: ReadinessLevel;
  readonly domainReadiness: Readonly<Partial<Record<Domain, ReadinessLevel>>>;
  readonly directives: readonly MissionDirective[];
  readonly generatedAt: string;
}
