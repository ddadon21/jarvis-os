import type { GoalWithReadiness } from "@/core/goals/service";
import type { ScoredMove } from "@/core/next-move/types";
import type { WorldStateSlice } from "@/core/world-state/types";
import { domainLabels, horizonLabels, type Domain } from "@/core/types";
import { Panel } from "@/components/ui/panel";
import { MetricTile } from "@/components/ui/metric";
import { DataQualityBadge } from "@/components/ui/data-quality";
import { GoalCard } from "@/components/dashboard/goal-card";

/**
 * One layout for all four domain screens.
 *
 * The domains differ enormously in what they *mean* and not at all in what
 * they need to render: a headline, their metrics, their goals, their proposed
 * moves, and a statement of what is not built yet. Four hand-maintained copies
 * of this would drift within a month.
 */
export function DomainScreen({
  domain,
  slice,
  goals,
  moves,
  mission,
  notImplemented,
}: {
  domain: Domain;
  slice?: WorldStateSlice;
  goals: readonly GoalWithReadiness[];
  moves: readonly ScoredMove[];
  mission: string;
  /** What this domain does not do yet. Stated plainly rather than implied. */
  notImplemented: readonly string[];
}) {
  return (
    <div className="space-y-4">
      <Panel
        label={domainLabels[domain]}
        title={slice?.headline ?? "No data reported."}
        action={slice && <DataQualityBadge quality={slice.dataQuality} />}
      >
        <p className="text-sm leading-relaxed text-ink-muted">{mission}</p>

        {slice && slice.metrics.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {slice.metrics.map((metric) => (
              <MetricTile key={metric.key} metric={metric} />
            ))}
          </div>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel label="Goals" title={`${goals.length} tracked`}>
          {goals.length === 0 ? (
            <p className="text-sm text-ink-muted">No goals defined in this domain.</p>
          ) : (
            <div className="space-y-3">
              {goals.map((entry) => (
                <GoalCard key={entry.goal.id} entry={entry} expanded />
              ))}
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel label="Proposed moves" title={`${moves.length} candidates`}>
            {moves.length === 0 ? (
              <p className="text-sm text-ink-muted">Nothing proposed in this domain right now.</p>
            ) : (
              <ul className="space-y-3">
                {moves.map((move) => (
                  <li key={move.candidate.id} className="border-b border-line/40 pb-3 last:border-b-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 text-sm text-ink">{move.candidate.title}</span>
                      <span className="jarvis-label shrink-0">{horizonLabels[move.horizon]}</span>
                    </div>
                    <p className="mt-1 text-xs text-ink-faint">{move.rationale}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel label="Not implemented" title="Deliberately absent in v0.1">
            <ul className="space-y-1.5">
              {notImplemented.map((item) => (
                <li key={item} className="flex gap-2 text-xs text-ink-muted">
                  <span className="text-ink-faint" aria-hidden>
                    —
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
