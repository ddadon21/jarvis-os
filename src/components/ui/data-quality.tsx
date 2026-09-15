import type { DataQuality } from "@/core/world-state/types";
import { cn } from "@/components/ui/cn";

/**
 * Says out loud where a panel's numbers came from.
 *
 * This is not decoration. Until real integrations exist, every figure on this
 * dashboard is invented, and a user must never have to remember that — the
 * interface has to tell them, on every panel, every time.
 */
const labels: Record<DataQuality, { text: string; className: string; title: string }> = {
  live: {
    text: "live",
    className: "border-accent-dim/50 text-accent",
    title: "Synced from a connected source.",
  },
  stale: {
    text: "stale",
    className: "border-status-yellow/40 text-status-yellow",
    title: "Last sync is old — treat these figures with caution.",
  },
  mock: {
    text: "dev data",
    className: "border-line-bright text-ink-faint",
    title: "Invented development data. Not real balances, positions or market facts.",
  },
  unavailable: {
    text: "unavailable",
    className: "border-status-red/40 text-status-red",
    title: "This domain could not be reached.",
  },
};

export function DataQualityBadge({ quality, className }: { quality: DataQuality; className?: string }) {
  const style = labels[quality];
  return (
    <span
      title={style.title}
      className={cn(
        "inline-flex items-center border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]",
        style.className,
        className,
      )}
    >
      {style.text}
    </span>
  );
}
