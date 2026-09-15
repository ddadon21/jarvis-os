import type { ReadinessLevel } from "@/core/types";
import { cn } from "@/components/ui/cn";

/**
 * Readiness colour is reserved.
 *
 * Red, amber and green appear nowhere else in the interface. The moment they
 * are used for anything decorative, a glance at the dashboard stops carrying
 * information.
 */
const levelStyles: Record<ReadinessLevel, { dot: string; text: string; bar: string; border: string }> = {
  red: {
    dot: "bg-status-red",
    text: "text-status-red",
    bar: "bg-status-red",
    border: "border-status-red/40",
  },
  yellow: {
    dot: "bg-status-yellow",
    text: "text-status-yellow",
    bar: "bg-status-yellow",
    border: "border-status-yellow/40",
  },
  green: {
    dot: "bg-status-green",
    text: "text-status-green",
    bar: "bg-status-green",
    border: "border-status-green/40",
  },
};

export function ReadinessBadge({ level, className }: { level: ReadinessLevel; className?: string }) {
  const styles = levelStyles[level];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em]",
        styles.border,
        styles.text,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", styles.dot)} aria-hidden />
      {level}
    </span>
  );
}

export function ReadinessBar({
  level,
  progress,
  className,
}: {
  level: ReadinessLevel;
  /** 0..1. */
  progress: number;
  className?: string;
}) {
  const pct = Math.round(Math.min(Math.max(progress, 0), 1) * 100);

  return (
    <div
      className={cn("h-1 w-full bg-line", className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Progress: ${pct}%, status ${level}`}
    >
      <div className={cn("h-full transition-[width]", levelStyles[level].bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function readinessTextClass(level: ReadinessLevel): string {
  return levelStyles[level].text;
}
