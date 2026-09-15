import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * The standard container. Every data group on every screen sits in one of
 * these, so the grid stays legible as panels are added.
 */
export function Panel({
  label,
  title,
  action,
  children,
  className,
  dense = false,
}: {
  /** Uppercase mono micro-label above the title. */
  label?: string;
  title?: ReactNode;
  /** Right-aligned slot: a status badge, a count, a link. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  dense?: boolean;
}) {
  return (
    <section
      className={cn(
        "jarvis-panel relative border border-line bg-surface/80 backdrop-blur-sm",
        dense ? "p-3" : "p-4 sm:p-5",
        className,
      )}
    >
      {(label || title || action) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {label && <p className="jarvis-label">{label}</p>}
            {/* Clamped rather than truncated: a domain headline is a sentence, and
                one line of it is often not enough to be useful. */}
            {title && <h2 className="mt-1 line-clamp-2 text-sm font-medium text-ink">{title}</h2>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
