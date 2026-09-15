import { MissionPanel } from "@/components/dashboard/mission-panel";
import { NextMovePanel } from "@/components/dashboard/next-move-panel";
import { PrioritiesPanel } from "@/components/dashboard/priorities-panel";
import { DomainPanel } from "@/components/dashboard/domain-panel";
import { GoalCard } from "@/components/dashboard/goal-card";
import { Panel } from "@/components/ui/panel";
import { DEV_DATA_NOTICE } from "@/dev/notice";
import { loadOverview } from "@/server/services/overview";

export const metadata = { title: "Mission" };

/**
 * The command centre.
 *
 * Order is the message: mission, then the single next move, then priorities,
 * then goals, then the domains reporting upward. Anything that cannot justify
 * a place in that hierarchy does not belong on this screen.
 */
export default async function MissionPage() {
  const overview = await loadOverview();
  const { slices } = overview.worldState;

  return (
    <div className="space-y-4">
      {overview.dataSource === "dev" && (
        <p className="border border-status-yellow/30 bg-status-yellow/5 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-status-yellow">
          {DEV_DATA_NOTICE}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <MissionPanel mission={overview.mission} />
        </div>
        <NextMovePanel move={overview.nextMove} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <PrioritiesPanel movesByHorizon={overview.movesByHorizon} />

        <Panel label="Goals" title="Readiness" className="lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            {overview.goals.slice(0, 6).map((entry) => (
              <GoalCard key={entry.goal.id} entry={entry} />
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {slices.trading && (
          <DomainPanel
            slice={slices.trading}
            readiness={overview.domainReadiness.trading}
            href="/trading"
          />
        )}
        {slices.finance && (
          <DomainPanel
            slice={slices.finance}
            readiness={overview.domainReadiness.finance}
            href="/finance"
          />
        )}
        {slices.sentryops && (
          <DomainPanel
            slice={slices.sentryops}
            readiness={overview.domainReadiness.sentryops}
            href="/sentryops"
          />
        )}
        {slices.life && (
          <DomainPanel slice={slices.life} readiness={overview.domainReadiness.life} href="/life" />
        )}
      </div>
    </div>
  );
}
