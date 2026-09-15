import { generateText } from "ai";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are JARVIS, a private executive operating system for one user.

USER PROFILE
Your primary user is Dwight Johnson.
Dwight's company / umbrella venture brand is Himie Johnson Ventures.
Address him as Dwight when it feels natural. Treat Himie Johnson Ventures as his company context, but do not invent its legal structure, tax status, ownership details, finances, subsidiaries, or operating facts unless Dwight or a connected source provides them.

Your job is to help Dwight think clearly, prioritize aggressively, and operate four separate domains without blurring them together: Trading, Finance, SentryOps, and Life.

TRADING
Learn how Dwight actually trades over time, journal real trades, collect structured observations, compare decisions to outcomes, identify his real edge, and eventually support shadow/paper models. Never pretend to have live broker or market access unless the relevant integration is actually connected. Never place a live trade unless an explicitly authorized execution tool exists.

FINANCE
Act like a disciplined CFO. Understand account purpose, cash flow, debt, credit, taxes, investments, and financial goals. Help allocate capital, track readiness for major purchases and moving, and distinguish affordability from smart timing. Never pretend account data is connected when it is not. Never ask for or retain passwords, card numbers, routing numbers, API secrets, authentication codes, or other credentials.

SENTRYOPS
Act like a founder-level strategy, research, product, and execution system. Separate firsthand user observations from publicly verified facts. Research agencies, contracts, vendors, competitors, procurement, workflows, pain points, and whitespace. Convert evidence into product hypotheses, build priorities, pilot strategy, and revenue actions.

LIFE
Coordinate goals, commitments, relocation, major purchases, and personal priorities so they stay aligned with financial and business reality.

CORE BEHAVIOR
- Keep domains separate internally; synthesize only at the executive layer.
- Always identify the highest-leverage next move when enough context exists.
- Distinguish evidence from assumptions.
- Avoid fake certainty.
- Protect Dwight from distraction and low-value motion.
- Prefer controlled speed over reckless activity.
- When data is missing, say exactly what connection or information would make the answer stronger.
- Do not invent live account, broker, market, email, calendar, or business data.
- Do not present mock dashboard numbers as real.

PERSISTENT MEMORY RULES
You may suggest short memory updates only for durable, non-secret facts that will improve future reasoning, such as goals, strategy rules, project decisions, preferences, or durable business context.
Do NOT create memory updates for passwords, credentials, full account/card numbers, routing numbers, tax IDs, authentication codes, API keys, or other secrets.
Avoid saving fleeting conversation details.

OUTPUT CONTRACT
Return ONLY valid JSON with this exact top-level shape:
{
  "reply": "natural language answer to the user",
  "memoryUpdates": [
    { "domain": "TRADING|FINANCE|SENTRYOPS|LIFE|CORE", "fact": "short durable fact" }
  ],
  "nextMove": {
    "title": "short action title",
    "reason": "one concise reason",
    "domain": "TRADING|FINANCE|SENTRYOPS|LIFE|CORE"
  }
}

If there is no worthwhile memory update, return an empty array. If there is not enough context to change the next move, keep it conservative and useful.`;

type ChatMessage = { role: "user" | "assistant"; content: string };
type Goal = { name: string; value: number; state: string };
type Memory = { domain: string; fact: string };

type JarvisResponse = {
  reply: string;
  memoryUpdates: Array<{ domain: string; fact: string }>;
  nextMove: { title: string; reason: string; domain: string };
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      messages?: ChatMessage[];
      activeDomain?: string;
      goals?: Goal[];
      memories?: Memory[];
    };

    const messages = Array.isArray(body.messages) ? body.messages.slice(-24) : [];
    const activeDomain = typeof body.activeDomain === "string" ? body.activeDomain : "CORE";
    const goals = Array.isArray(body.goals) ? body.goals.slice(0, 20) : [];
    const memories = Array.isArray(body.memories) ? body.memories.slice(-60) : [];

    const context = `CURRENT JARVIS CONTEXT\nActive domain: ${activeDomain}\nKnown goals: ${JSON.stringify(goals)}\nDurable memory: ${JSON.stringify(memories)}`;

    const { text } = await generateText({
      model: "openai/gpt-5.6-sol",
      system: `${SYSTEM_PROMPT}\n\n${context}`,
      messages,
      temperature: 0.25,
    });

    const parsed = parseResponse(text, activeDomain);
    return Response.json(parsed);
  } catch (error) {
    console.error("Jarvis chat error", error);
    const errorText = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const gatewayNeedsBilling = /credit card|customer_verification_required/i.test(errorText);

    return Response.json(
      {
        reply: gatewayNeedsBilling
          ? "The interface and runtime are online, but the AI reasoning provider is locked until Vercel AI Gateway billing verification is enabled. Once that is activated, I can reason, research, and synthesize through this interface."
          : "Core link unavailable. The interface is online, but the reasoning gateway could not complete this request.",
        memoryUpdates: [],
        nextMove: {
          title: gatewayNeedsBilling ? "Activate AI reasoning provider" : "Restore reasoning link",
          reason: gatewayNeedsBilling
            ? "Background research and conversational reasoning require an active model provider connection."
            : "Jarvis cannot safely synthesize or act until the model connection is healthy.",
          domain: "CORE",
        },
      },
      { status: gatewayNeedsBilling ? 503 : 500 },
    );
  }
}

function parseResponse(text: string, activeDomain: string): JarvisResponse {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();

  try {
    const value = JSON.parse(cleaned) as Partial<JarvisResponse>;
    const reply = typeof value.reply === "string" && value.reply.trim() ? value.reply.trim() : cleaned;
    const memoryUpdates = Array.isArray(value.memoryUpdates)
      ? value.memoryUpdates
          .filter((item) => item && typeof item.fact === "string" && item.fact.trim())
          .map((item) => ({
            domain: normalizeDomain(item.domain, activeDomain),
            fact: item.fact.trim().slice(0, 280),
          }))
          .slice(0, 6)
      : [];

    const nextMove = value.nextMove && typeof value.nextMove.title === "string"
      ? {
          title: value.nextMove.title.trim().slice(0, 120),
          reason: typeof value.nextMove.reason === "string" ? value.nextMove.reason.trim().slice(0, 300) : "",
          domain: normalizeDomain(value.nextMove.domain, activeDomain),
        }
      : {
          title: "Continue current objective",
          reason: "No stronger next move was produced from the available context.",
          domain: normalizeDomain(activeDomain, "CORE"),
        };

    return { reply, memoryUpdates, nextMove };
  } catch {
    return {
      reply: cleaned || "Jarvis returned an empty response.",
      memoryUpdates: [],
      nextMove: {
        title: "Continue current objective",
        reason: "The response was usable as text but did not include structured next-move data.",
        domain: normalizeDomain(activeDomain, "CORE"),
      },
    };
  }
}

function normalizeDomain(value: unknown, fallback: string): string {
  const domain = typeof value === "string" ? value.toUpperCase() : "";
  if (domain === "TRADING" || domain === "FINANCE" || domain === "SENTRYOPS" || domain === "LIFE" || domain === "CORE") {
    return domain;
  }
  const safeFallback = fallback.toUpperCase();
  return safeFallback === "TRADING" || safeFallback === "FINANCE" || safeFallback === "SENTRYOPS" || safeFallback === "LIFE"
    ? safeFallback
    : "CORE";
}
