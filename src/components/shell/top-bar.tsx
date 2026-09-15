import type { ReadinessLevel } from "@/core/types";
import { ReadinessBadge } from "@/components/ui/readiness";

/**
 * The persistent header: identity, system status, and the one-line mission
 * headline. Present on every screen so the top-level state is never more than
 * a glance away.
 */
export function TopBar({
  status,
  headline,
  dataSource,
}: {
  status: ReadinessLevel;
  headline: string;
  dataSource: string;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-void/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="relative flex h-7 w-7 items-center justify-center">
            <span className="absolute inset-0 rounded-full border border-accent-dim" aria-hidden />
            <span className="h-2 w-2 rounded-full bg-accent" aria-hidden />
          </span>
          <div className="leading-tight">
            <p className="font-mono text-sm tracking-[0.3em] text-ink">JARVIS</p>
            <p className="jarvis-label hidden sm:block">Personal operating system</p>
          </div>
        </div>

        <p className="ml-auto hidden max-w-md truncate text-xs text-ink-muted md:block">{headline}</p>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <span className="jarvis-label hidden sm:inline">{dataSource}</span>
          <ReadinessBadge level={status} />
        </div>
      </div>
    </header>
  );
}
