import { generateText, gateway } from "ai";
import {
  JarvisPulse,
  ResearchOpportunity,
  RuntimeDomain,
  appendRuntimeEvent,
  createRuntimeEvent,
  getLatestPulse,
  setLatestPulse,
} from "./jarvis-runtime";

const MAX_OPPORTUNITIES = 5;

export async function runJarvisPulse(): Promise<JarvisPulse> {
  const previous = await getLatestPulse();
  const previousContext = previous
    ? `Previous pulse (${previous.ranAt}): ${previous.summary}\nPrevious opportunities: ${previous.opportunities
        .map((item) => item.title)
        .join(" | ")}`
    : "No previous pulse exists. Establish the baseline without pretending this is exhaustive market coverage.";

  try {
    const result = await generateText({
      model: "openai/gpt-5.6-sol",
      temperature: 0.2,
      prompt: `You are the background research lane inside JARVIS.

Your task is to proactively research SentryOps opportunities without waiting for the user to ask.

SentryOps currently explores operational software opportunities for sheriff offices, corrections, county public-safety agencies, and adjacent government operations. The goal is NOT to force the current product idea to survive. The goal is to discover painful, recurring, budget-backed operational problems where a new software product could win.

Continuously look for evidence around:
- Gwinnett County Sheriff's Office and Gwinnett County procurement where relevant
- Georgia sheriff/corrections/public-safety procurement and modernization
- contracts, awards, RFPs, renewals, procurement notices, budgets, and vendor relationships
- vendors used by sheriff offices and county agencies
- workflow fragmentation, manual processes, duplicated entry, reporting gaps, staffing/shift coordination, jail/corrections operations, transport, court operations, warrants, records, property/evidence, fleet, compliance, executive visibility, and other operational gaps
- competitor product launches, acquisitions, customer wins, complaints, implementation issues, and whitespace
- repeatable problems across agencies rather than one-off curiosities

IMPORTANT:
- Use web search. Prefer primary government/procurement sources and credible industry sources.
- Do not treat the user's private firsthand internship observations as public facts; those will be added later as a separate evidence class.
- Do not invent contracts, amounts, vendors, agency relationships, or RFPs.
- Distinguish a verified opportunity from a hypothesis that needs more research.
- Focus on what is NEW or materially useful compared with the previous pulse.
- If nothing meaningful changed, say so instead of manufacturing novelty.

${previousContext}

Return ONLY JSON with this shape:
{
  "summary": "2-5 sentence synthesis of the most important findings/change",
  "opportunities": [
    {
      "title": "short opportunity/hypothesis",
      "whyItMatters": "why this could matter commercially",
      "evidence": "what evidence was found and how strong it is",
      "priority": "LOW|MEDIUM|HIGH"
    }
  ],
  "nextMove": {
    "title": "single highest-leverage next research/product action",
    "reason": "why this action is next",
    "domain": "SENTRYOPS"
  }
}`,
      tools: {
        web_search: gateway.tools.exaSearch({
          type: "auto",
          numResults: 12,
          userLocation: "US",
          contents: {
            text: { maxCharacters: 3500 },
            highlights: { maxCharacters: 1800 },
            maxAgeHours: 24,
          },
        }),
      },
    });

    const parsed = parsePulse(result.text);
    const pulse: JarvisPulse = {
      id: crypto.randomUUID(),
      ranAt: new Date().toISOString(),
      status: "OK",
      lane: "SENTRYOPS_RESEARCH",
      summary: parsed.summary,
      opportunities: parsed.opportunities,
      nextMove: parsed.nextMove,
      sourceCount: estimateSourceCount(result),
    };

    await setLatestPulse(pulse);
    await appendRuntimeEvent(
      createRuntimeEvent({
        type: "research.pulse_completed",
        domain: "SENTRYOPS",
        source: "jarvis.background",
        importance: pulse.opportunities.some((item) => item.priority === "HIGH") ? "IMPORTANT" : "BACKGROUND",
        summary: pulse.summary,
      }),
    );

    return pulse;
  } catch (error) {
    console.error("Jarvis pulse failed", error);

    const pulse: JarvisPulse = {
      id: crypto.randomUUID(),
      ranAt: new Date().toISOString(),
      status: "ERROR",
      lane: "CORE_HEARTBEAT",
      summary: "Background research could not complete this cycle. Jarvis remains online and will retry on the next scheduled pulse.",
      opportunities: previous?.opportunities ?? [],
      nextMove: previous?.nextMove ?? {
        title: "Restore background research",
        reason: "The last research cycle failed, so new public-market intelligence is not yet available.",
        domain: "CORE",
      },
      sourceCount: 0,
    };

    await setLatestPulse(pulse);
    await appendRuntimeEvent(
      createRuntimeEvent({
        type: "research.pulse_failed",
        domain: "CORE",
        source: "jarvis.background",
        importance: "IMPORTANT",
        summary: pulse.summary,
      }),
    );

    return pulse;
  }
}

type ParsedPulse = {
  summary: string;
  opportunities: ResearchOpportunity[];
  nextMove: {
    title: string;
    reason: string;
    domain: RuntimeDomain;
  };
};

function parsePulse(text: string): ParsedPulse {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();

  try {
    const value = JSON.parse(cleaned) as {
      summary?: unknown;
      opportunities?: unknown;
      nextMove?: { title?: unknown; reason?: unknown; domain?: unknown };
    };

    const summary = typeof value.summary === "string" && value.summary.trim()
      ? value.summary.trim().slice(0, 1800)
      : "Research completed, but the structured summary was incomplete.";

    const opportunities = Array.isArray(value.opportunities)
      ? value.opportunities
          .map(normalizeOpportunity)
          .filter((item): item is ResearchOpportunity => item !== null)
          .slice(0, MAX_OPPORTUNITIES)
      : [];

    const nextMove = {
      title:
        typeof value.nextMove?.title === "string" && value.nextMove.title.trim()
          ? value.nextMove.title.trim().slice(0, 140)
          : "Review the latest SentryOps evidence",
      reason:
        typeof value.nextMove?.reason === "string"
          ? value.nextMove.reason.trim().slice(0, 420)
          : "Use the newest research before changing product direction.",
      domain: normalizeDomain(value.nextMove?.domain),
    };

    return { summary, opportunities, nextMove };
  } catch {
    return {
      summary: cleaned.slice(0, 1800) || "Research completed without a structured summary.",
      opportunities: [],
      nextMove: {
        title: "Review background research",
        reason: "The research returned usable text but not the expected structured result.",
        domain: "SENTRYOPS",
      },
    };
  }
}

function normalizeOpportunity(value: unknown): ResearchOpportunity | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.title !== "string" || !item.title.trim()) return null;

  return {
    title: item.title.trim().slice(0, 180),
    whyItMatters: typeof item.whyItMatters === "string" ? item.whyItMatters.trim().slice(0, 500) : "",
    evidence: typeof item.evidence === "string" ? item.evidence.trim().slice(0, 700) : "",
    priority: item.priority === "HIGH" || item.priority === "MEDIUM" ? item.priority : "LOW",
  };
}

function normalizeDomain(value: unknown): RuntimeDomain {
  const domain = typeof value === "string" ? value.toUpperCase() : "SENTRYOPS";
  if (domain === "TRADING" || domain === "FINANCE" || domain === "SENTRYOPS" || domain === "LIFE" || domain === "CORE") {
    return domain;
  }
  return "SENTRYOPS";
}

function estimateSourceCount(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const possible = result as { sources?: unknown[]; steps?: Array<{ sources?: unknown[] }> };
  if (Array.isArray(possible.sources)) return possible.sources.length;
  if (Array.isArray(possible.steps)) {
    return possible.steps.reduce((total, step) => total + (Array.isArray(step.sources) ? step.sources.length : 0), 0);
  }
  return 0;
}
