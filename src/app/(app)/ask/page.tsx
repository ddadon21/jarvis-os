import { Panel } from "@/components/ui/panel";
import { agentIds, agentSpec } from "@/core/agents/registry";
import { capabilities, capabilityDefinition } from "@/core/permissions/capabilities";

export const metadata = { title: "Ask Jarvis" };

/**
 * ASK JARVIS — not wired to a model yet.
 *
 * Rather than shipping a chat box that answers from nothing, this screen shows
 * what the conversational surface will be able to reach when it exists: the
 * declared agents and the autonomy ceiling on every capability. That is the
 * part worth reviewing now; the chat box is the easy part.
 */
export default function AskPage() {
  const agents = agentIds.map(agentSpec);

  return (
    <div className="space-y-4">
      <Panel label="Ask Jarvis" title="Conversational surface — not implemented">
        <p className="text-sm leading-relaxed text-ink-muted">
          No model is connected in v0.1. A chat box answering from invented data would be worse than
          no chat box at all. What follows is the surface it will operate over once it exists: the
          declared specialists, and the hard limits on what any of them may do.
        </p>
      </Panel>

      <Panel label="Specialists" title={`${agents.length} declared, none running`}>
        <ul className="divide-y divide-line/50">
          {agents.map((agent) => (
            <li key={agent.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm text-ink">{agent.name}</h3>
                <span className="jarvis-label">
                  {agent.domain} · max {agent.maxActionLevel}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">{agent.mission}</p>
              <p className="mt-1.5 text-[11px] text-ink-faint">
                <span className="font-mono uppercase tracking-wider">Never:</span>{" "}
                {agent.prohibited.join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel label="Autonomy" title="Capability ceilings, enforced in code">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead>
              <tr className="jarvis-label border-b border-line">
                <th className="py-2 pr-3 font-normal">Capability</th>
                <th className="py-2 pr-3 font-normal">Risk</th>
                <th className="py-2 pr-3 font-normal">Default</th>
                <th className="py-2 font-normal">Hard ceiling</th>
              </tr>
            </thead>
            <tbody>
              {capabilities.map((capability) => {
                const definition = capabilityDefinition(capability);
                const critical = definition.riskClass === "critical";
                return (
                  <tr key={capability} className="border-b border-line/40">
                    <td className="py-1.5 pr-3 font-mono text-[11px] text-ink-muted">{capability}</td>
                    <td className={`py-1.5 pr-3 ${critical ? "text-status-red" : "text-ink-faint"}`}>
                      {definition.riskClass}
                    </td>
                    <td className="py-1.5 pr-3 text-ink-faint">{definition.defaultLevel}</td>
                    <td className="py-1.5 text-ink">{definition.hardCeiling}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
