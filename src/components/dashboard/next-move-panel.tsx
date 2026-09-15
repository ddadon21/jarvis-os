import type { ScoredMove } from "@/core/next-move/types";
import { domainLabels, horizonLabels } from "@/core/types";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/components/ui/cn";

/**
 * NEXT MOVE — the answer to "what should I do right now?".
 *
 * Shows the reasoning alongside the recommendation. A ranked action the user
 * cannot interrogate is one they will either follow blindly or ignore
 * entirely, and both are failure modes.
 */
export function NextMovePanel({ move }: { move: ScoredMove | null }) {
  if (!move) {
    return (
      <Panel label="Next move" title="Nothing proposed">
        <p className="text-sm text-ink-muted">
          No domain is proposing an action. That is either a very good day or a sign a domain is not
          reporting.
        </p>
      </Panel>
    );
  }

  const top = move.contributions.filter((c) => c.contribution > 0).slice(0, 3);

  return (
    <Panel
      label="Next move"
      title={move.candidate.title}
      action={
        <span className="inline-flex items-center gap-2 border border-accent-dim/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
          {horizonLabels[move.horizon]}
        </span>
      }
      className="border-accent-dim/40"
    >
      {move.candidate.summary && <p className="text-sm text-ink-muted">{move.candidate.summary}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line/60 pt-3">
        <Stat label="Score" value={`${Math.round(move.score * 100)}`} />
        <Stat label="Domain" value={domainLabels[move.candidate.domain]} />
        <Stat label="Autonomy" value={move.candidate.requiredActionLevel} />
        <Stat label="Est." value={`${move.candidate.factors.estimatedMinutes}m`} />
      </div>

      <p className="mt-3 text-xs text-ink-faint">{move.rationale}</p>

      {top.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {top.map((contribution) => (
            <li key={contribution.factor} className="flex items-center gap-2">
              <span className="w-32 shrink-0 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                {contribution.factor.replace(/([A-Z])/g, " $1").toLowerCase()}
              </span>
              <span className="h-1 flex-1 bg-line">
                <span
                  className="block h-full bg-accent/70"
                  style={{ width: `${Math.min(contribution.contribution * 400, 100)}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("leading-tight", className)}>
      <p className="jarvis-label">{label}</p>
      <p className="jarvis-figure mt-0.5 text-sm text-ink">{value}</p>
    </div>
  );
}
