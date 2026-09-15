import type { GoalWithReadiness } from "@/core/goals/service";
import type { CriterionReadiness } from "@/core/goals/types";
import { formatCount, formatCurrency, formatPercent } from "@/lib/format";
import { ReadinessBadge, ReadinessBar, readinessTextClass } from "@/components/ui/readiness";
import { cn } from "@/components/ui/cn";

/**
 * A goal as a readiness meter with its criteria exposed.
 *
 * The expanded form is the useful one: "RED" is a verdict, and the criteria
 * underneath are the instructions. Showing the gap in the criterion's own unit
 * ("$7,000 short") is what turns a status into a next action.
 */
export function GoalCard({ entry, expanded = false }: { entry: GoalWithReadiness; expanded?: boolean }) {
  const { goal, readiness } = entry;

  return (
    <article className="border border-line bg-surface-raised/40 p-3.5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-ink">{goal.title}</h3>
          <p className="jarvis-label mt-0.5">{goal.domain}</p>
        </div>
        <ReadinessBadge level={readiness.level} />
      </header>

      <div className="mt-3 flex items-center gap-3">
        <ReadinessBar level={readiness.level} progress={readiness.score} className="flex-1" />
        <span className={cn("jarvis-figure w-9 text-right text-xs", readinessTextClass(readiness.level))}>
          {Math.round(readiness.score * 100)}%
        </span>
      </div>

      <p className="mt-2 text-xs text-ink-faint">{readiness.rationale}</p>

      {expanded && (
        <ul className="mt-4 space-y-2.5 border-t border-line/60 pt-3">
          {readiness.criteria.map((criterion) => (
            <CriterionRow key={criterion.criterionId} criterion={criterion} />
          ))}
        </ul>
      )}
    </article>
  );
}

function CriterionRow({ criterion }: { criterion: CriterionReadiness }) {
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-ink-muted">
          {criterion.blocking && (
            <span
              title="Blocking criterion — the goal cannot go green while this is red."
              className="font-mono text-[9px] text-ink-faint"
            >
              [REQ]
            </span>
          )}
          {criterion.label}
        </span>
        <span className={cn("jarvis-figure shrink-0 text-xs", readinessTextClass(criterion.level))}>
          {formatCriterionValue(criterion, criterion.currentValue)}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <ReadinessBar level={criterion.level} progress={criterion.progress} className="flex-1" />
        <span className="jarvis-label w-24 shrink-0 text-right normal-case tracking-normal">
          {criterion.gapToGreen > 0
            ? `${formatCriterionValue(criterion, criterion.gapToGreen)} to go`
            : "met"}
        </span>
      </div>
    </li>
  );
}

function formatCriterionValue(criterion: CriterionReadiness, value: number): string {
  switch (criterion.unit) {
    case "currency":
      return formatCurrency(value, { compact: true });
    case "percent":
      return formatPercent(value, 1);
    case "months":
      return `${value.toFixed(1)} mo`;
    case "boolean":
      return value >= 1 ? "yes" : "no";
    case "ratio":
      return value.toFixed(2);
    case "count":
      return formatCount(value);
    default:
      return String(value);
  }
}
