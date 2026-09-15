import Link from "next/link";
import type { Route } from "next";
import type { ReadinessLevel } from "@/core/types";
import type { WorldStateSlice } from "@/core/world-state/types";
import { domainLabels } from "@/core/types";
import { Panel } from "@/components/ui/panel";
import { MetricRow } from "@/components/ui/metric";
import { DataQualityBadge } from "@/components/ui/data-quality";
import { ReadinessBadge } from "@/components/ui/readiness";

/**
 * A domain's summary panel on the command centre.
 *
 * Deliberately thin: it shows the domain's own headline and its top metrics,
 * and links through. Jarvis Core does not reinterpret a domain's numbers —
 * that is the architectural boundary showing up in the UI.
 */
export function DomainPanel({
  slice,
  readiness,
  href,
  maxMetrics = 4,
}: {
  slice: WorldStateSlice;
  readiness?: ReadinessLevel;
  href: Route;
  maxMetrics?: number;
}) {
  return (
    <Panel
      label={domainLabels[slice.domain]}
      title={<Link href={href} className="hover:text-accent">{slice.headline}</Link>}
      action={
        <div className="flex items-center gap-2">
          <DataQualityBadge quality={slice.dataQuality} />
          {readiness && <ReadinessBadge level={readiness} />}
        </div>
      }
    >
      {slice.metrics.length === 0 ? (
        <p className="text-sm text-ink-muted">No metrics reported.</p>
      ) : (
        <div>
          {slice.metrics.slice(0, maxMetrics).map((metric) => (
            <MetricRow key={metric.key} metric={metric} />
          ))}
        </div>
      )}

      {slice.flags && slice.flags.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {slice.flags.map((flag) => (
            <li
              key={flag}
              className="border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint"
            >
              {flag.replace(/_/g, " ")}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
