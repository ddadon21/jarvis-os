import type { Domain } from "@/core/types";
import type { DomainContext, DomainModule } from "@/core/domain-module";
import type { WorldState, WorldStateSlice, WorldStateSnapshot } from "@/core/world-state/types";
import type { WorldStateRepository } from "@/core/world-state/ports";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";

/**
 * Assembles World State by polling every registered domain.
 *
 * A failing domain degrades to an `unavailable` slice rather than taking down
 * the whole view. A dashboard that renders three of four domains plus an
 * honest "SentryOps is unavailable" is far more useful than an error page —
 * and silently omitting the slice would be worse than either, because a
 * missing panel reads as "nothing is happening".
 */
export class WorldStateService {
  constructor(
    private readonly modules: readonly DomainModule[],
    private readonly repository?: WorldStateRepository,
  ) {}

  async capture(context: DomainContext): Promise<WorldState> {
    const results = await Promise.allSettled(
      this.modules.map(async (domainModule) => ({
        domain: domainModule.domain,
        slice: await domainModule.getStateSlice(context),
      })),
    );

    const slices: Partial<Record<Domain, WorldStateSlice>> = {};
    results.forEach((result, index) => {
      const domainModule = this.modules[index];
      if (!domainModule) return;

      slices[domainModule.domain] =
        result.status === "fulfilled"
          ? result.value.slice
          : unavailableSlice(domainModule.domain, result.reason);
    });

    return { userId: context.userId, capturedAt: nowIso(), slices };
  }

  /** Persists a point-in-time copy so change over time stays answerable. */
  async snapshot(context: DomainContext, reason: string): Promise<WorldStateSnapshot> {
    const state = await this.capture(context);
    const snapshot: WorldStateSnapshot = {
      id: newId(),
      userId: context.userId,
      capturedAt: state.capturedAt,
      reason,
      state,
    };

    if (!this.repository) return snapshot;
    return this.repository.saveSnapshot(snapshot);
  }
}

function unavailableSlice(domain: Domain, reason: unknown): WorldStateSlice {
  const detail = reason instanceof Error ? reason.message : "unknown error";
  return {
    domain,
    headline: `Unavailable — ${detail}`,
    metrics: [],
    dataQuality: "unavailable",
    observedAt: nowIso(),
  };
}
