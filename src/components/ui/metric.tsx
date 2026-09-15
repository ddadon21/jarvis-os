import type { Metric } from "@/core/world-state/types";
import { formatCount, formatCurrency, formatPercent, formatR } from "@/lib/format";
import { cn } from "@/components/ui/cn";

/**
 * Renders a World State metric.
 *
 * Formatting lives here rather than in the domain modules on purpose: a metric
 * travels as a number plus a declared format, so the same value can be shown
 * compactly on a phone and in full on a desktop without the domain knowing or
 * caring.
 */
export function MetricValue({ metric, compact = true }: { metric: Metric; compact?: boolean }) {
  return <span className="jarvis-figure">{formatMetric(metric, compact)}</span>;
}

export function formatMetric(metric: Metric, compact = true): string {
  if (typeof metric.value === "string") return metric.value;

  switch (metric.format) {
    case "currency":
      return formatCurrency(metric.value, { compact });
    case "percent":
      return formatPercent(metric.value);
    case "r_multiple":
      return formatR(metric.value);
    case "duration":
      return `${metric.value.toFixed(1)} mo`;
    case "number":
      return formatCount(metric.value);
    case "text":
      return String(metric.value);
    default:
      return String(metric.value);
  }
}

export function MetricTile({ metric, className }: { metric: Metric; className?: string }) {
  return (
    <div className={cn("border border-line/60 bg-surface-raised/60 p-3", className)}>
      <p className="jarvis-label truncate">{metric.label}</p>
      <p className="mt-1.5 text-lg font-medium text-ink sm:text-xl">
        <MetricValue metric={metric} />
      </p>
      {metric.caption && <p className="mt-0.5 text-[11px] text-ink-faint">{metric.caption}</p>}
    </div>
  );
}

export function MetricRow({ metric }: { metric: Metric }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/50 py-2 last:border-b-0">
      <span className="truncate text-xs text-ink-muted">{metric.label}</span>
      <span className="text-sm text-ink">
        <MetricValue metric={metric} />
      </span>
    </div>
  );
}
