import type { ScoredMove } from "@/core/next-move/types";
import { domainLabels, horizonLabels, horizons, type Horizon } from "@/core/types";
import { Panel } from "@/components/ui/panel";

/**
 * CURRENT PRIORITIES, grouped by horizon rather than by domain.
 *
 * Grouping by time is the point: the user does not experience their day as
 * "trading things" and "finance things", they experience it as what has to
 * happen before lunch.
 */
export function PrioritiesPanel({
  movesByHorizon,
}: {
  movesByHorizon: Readonly<Record<Horizon, ScoredMove[]>>;
}) {
  const populated = horizons.filter((horizon) => movesByHorizon[horizon].length > 0);

  return (
    <Panel label="Current priorities" title="Ranked across every domain">
      {populated.length === 0 ? (
        <p className="text-sm text-ink-muted">No candidate actions.</p>
      ) : (
        <div className="space-y-4">
          {populated.map((horizon) => (
            <div key={horizon}>
              <p className="jarvis-label mb-1.5">{horizonLabels[horizon]}</p>
              <ul className="space-y-1">
                {movesByHorizon[horizon].map((move) => (
                  <li
                    key={move.candidate.id}
                    className="flex items-center gap-3 border-b border-line/40 py-1.5 last:border-b-0"
                  >
                    <span className="jarvis-figure w-8 shrink-0 font-mono text-xs text-accent">
                      {Math.round(move.score * 100)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{move.candidate.title}</span>
                    <span className="jarvis-label shrink-0">{domainLabels[move.candidate.domain]}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
