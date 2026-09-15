import type { MissionStatus } from "@/core/mission/types";
import { domainLabels } from "@/core/types";
import { Panel } from "@/components/ui/panel";
import { ReadinessBadge } from "@/components/ui/readiness";

/**
 * MISSION STATUS — the standing directives and the current rollup.
 *
 * The directives are shown, not just the status, because the point of a
 * mission layer is that the user can see what Jarvis believes it is optimising
 * for and object when that is wrong.
 */
export function MissionPanel({ mission }: { mission: MissionStatus }) {
  const domains = Object.entries(mission.domainReadiness) as [keyof typeof domainLabels, MissionStatus["overall"]][];

  return (
    <Panel
      label="Mission status"
      title={mission.headline}
      action={<ReadinessBadge level={mission.overall} />}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {domains.map(([domain, level]) => (
          <div key={domain} className="border border-line/60 bg-surface-raised/50 p-2.5">
            <p className="jarvis-label truncate">{domainLabels[domain]}</p>
            <div className="mt-1.5">
              <ReadinessBadge level={level} />
            </div>
          </div>
        ))}
      </div>

      <ul className="mt-4 space-y-2 border-t border-line/60 pt-3">
        {mission.directives.map((directive) => (
          <li key={directive.id} className="flex gap-2.5">
            <span className="jarvis-label mt-0.5 w-16 shrink-0">{domainLabels[directive.domain]}</span>
            <span className="text-xs leading-relaxed text-ink-muted">{directive.statement}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
