import { GoalCard } from "@/components/dashboard/goal-card";
import { Panel } from "@/components/ui/panel";
import { loadOverview } from "@/server/services/overview";
import { readinessLevels, type ReadinessLevel } from "@/core/types";

export const metadata = { title: "Goals" };

/**
 * Every goal, criteria expanded, worst first.
 *
 * Ordering by readiness rather than by domain answers the question the user
 * actually has when they open this screen: what is furthest from where it
 * needs to be?
 */
export default async function GoalsPage() {
  const overview = await loadOverview();

  const byLevel = new Map<ReadinessLevel, typeof overview.goals>();
  for (const level of readinessLevels) {
    byLevel.set(
      level,
      overview.goals.filter((entry) => entry.readiness.level === level),
    );
  }

  return (
    <div className="space-y-4">
      <Panel label="Goals" title="Readiness across every domain">
        <p className="text-sm leading-relaxed text-ink-muted">
          A goal is green only when every one of its criteria is green — never on a strong average. A
          criterion marked <span className="font-mono text-[11px] text-ink-faint">[REQ]</span> vetoes
          the goal outright while it is red.
        </p>
      </Panel>

      {readinessLevels.map((level) => {
        const entries = byLevel.get(level) ?? [];
        if (entries.length === 0) return null;

        return (
          <Panel key={level} label={level} title={`${entries.length} goals`}>
            <div className="grid gap-3 lg:grid-cols-2">
              {entries.map((entry) => (
                <GoalCard key={entry.goal.id} entry={entry} expanded />
              ))}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
