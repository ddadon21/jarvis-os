import { cache } from "react";
import type { Domain, Horizon, ReadinessLevel } from "@/core/types";
import type { GoalWithReadiness } from "@/core/goals/service";
import type { MissionStatus } from "@/core/mission/types";
import type { ScoredMove } from "@/core/next-move/types";
import type { WorldState } from "@/core/world-state/types";
import { MissionService } from "@/core/mission/service";
import { rollupReadiness } from "@/core/goals/readiness";
import { getContainer } from "@/server/container";
import { buildDomainContext } from "@/server/session";

/**
 * Assembles everything the command centre renders.
 *
 * This is the only place the four engines are composed, and it is server-side
 * by construction. Pages receive finished data; no React component fetches,
 * ranks or rolls anything up — that keeps domain logic out of the view layer
 * and makes every number on screen traceable to one function.
 */

export interface Overview {
  readonly worldState: WorldState;
  readonly mission: MissionStatus;
  readonly goals: readonly GoalWithReadiness[];
  readonly nextMove: ScoredMove | null;
  readonly moves: readonly ScoredMove[];
  readonly movesByHorizon: Readonly<Record<Horizon, ScoredMove[]>>;
  readonly domainReadiness: Readonly<Partial<Record<Domain, ReadinessLevel>>>;
  readonly dataSource: string;
}

const missionService = new MissionService();

/**
 * Wrapped in React's request cache: the shell and the page both need the
 * overview, and they should not each poll every domain for it.
 */
export const loadOverview = cache(async function loadOverview(): Promise<Overview> {
  const container = getContainer();
  const context = await buildDomainContext();

  // Independent reads — run them together rather than serialising three
  // round-trips the user has to wait through.
  const [worldState, goals, moves] = await Promise.all([
    container.worldState.capture(context),
    container.goals.list(context.userId),
    container.nextMove.rank(context),
  ]);

  const domainReadiness = rollupDomainReadiness(goals);
  const mission = missionService.status(domainReadiness);

  const movesByHorizon: Record<Horizon, ScoredMove[]> = {
    now: [],
    next: [],
    today: [],
    this_week: [],
    longer_term: [],
  };
  for (const move of moves) movesByHorizon[move.horizon].push(move);

  return {
    worldState,
    mission,
    goals,
    moves,
    movesByHorizon,
    nextMove: moves[0] ?? null,
    domainReadiness,
    dataSource: container.dataSource,
  };
});

export async function loadDomainOverview(domain: Domain): Promise<{
  readonly overview: Overview;
  readonly goals: readonly GoalWithReadiness[];
  readonly moves: readonly ScoredMove[];
}> {
  const overview = await loadOverview();

  return {
    overview,
    goals: overview.goals.filter((entry) => entry.goal.domain === domain),
    moves: overview.moves.filter((move) => move.candidate.domain === domain),
  };
}

/** Worst-goal rollup per domain. A domain with no goals reports nothing. */
function rollupDomainReadiness(
  goals: readonly GoalWithReadiness[],
): Partial<Record<Domain, ReadinessLevel>> {
  const byDomain = new Map<Domain, ReadinessLevel[]>();

  for (const entry of goals) {
    const levels = byDomain.get(entry.goal.domain) ?? [];
    levels.push(entry.readiness.level);
    byDomain.set(entry.goal.domain, levels);
  }

  const result: Partial<Record<Domain, ReadinessLevel>> = {};
  for (const [domain, levels] of byDomain) result[domain] = rollupReadiness(levels);
  return result;
}
