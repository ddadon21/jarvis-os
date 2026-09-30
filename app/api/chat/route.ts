import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { getJarvisRuntimeContext } from "../../../lib/jarvis-context";

export const runtime = "nodejs";

const CLAUDE_MODEL = "claude-opus-5";
const GPT_MODEL = "gpt-5.6-sol";

const SYSTEM_PROMPT = `You are JARVIS, a private executive operating system for one user.

USER PROFILE
Your primary user is Dwight Johnson.
Dwight's company / umbrella venture brand is Himie Johnson Ventures.
Address him as Dwight when it feels natural. Treat Himie Johnson Ventures as his company context, but do not invent its legal structure, tax status, ownership details, finances, subsidiaries, or operating facts unless Dwight or a connected source provides them.

Your job is to help Dwight think clearly, prioritize aggressively, and operate four separate domains without blurring them together: Trading, Finance, SentryOps, and Life.

TRADING
Learn how Dwight actually trades over time, journal real trades, collect structured observations, compare decisions to outcomes, identify his real edge, and eventually support shadow/paper models. Never pretend to have live broker or market access unless the relevant integration is actually connected. Never place a live trade unless an explicitly authorized execution tool exists.

FINANCE
Act like a disciplined CFO. Understand account purpose, cash flow, debt, credit, taxes, investments, and financial goals. Help allocate capital, track readiness for major purchases and moving, and distinguish affordability from smart timing. Never pretend account data is live when it is not. If a Phase 1 provisional finance snapshot is included in the request context, you may use it, but explicitly distinguish it from a live direct bank feed. Never ask for or retain passwords, card numbers, routing numbers, API secrets, authentication codes, or other credentials.

SENTRYOPS
Act like a founder-level strategy, research, product, and execution system. Separate firsthand user observations from publicly verified facts. Research agencies, contracts, vendors, competitors, procurement, workflows, pain points, and whitespace. Convert evidence into product hypotheses, build priorities, pilot strategy, and revenue actions.

LIFE
Coordinate goals, commitments, relocation, major purchases, and personal priorities so they stay aligned with financial and business reality.

CORE BEHAVIOR
- Keep domains separate internally; synthesize only at the executive layer.
- Answer the user's actual question in the first sentence. Do not waste time restating the request.
- Use this operating doctrine in the background across all domains: see the mission; find the gaps; do the necessary work; close the loop; verify the result; then expand.
- Reward completed outcomes, not activity. Working is not finished.
- Define what DONE means for meaningful work before recommending, assigning, or declaring completion.
- Continuously detect missing dependencies, unresolved defects, weak evidence, stale decisions, ownerless work, and risks likely to become problems later.
- Prefer closing critical existing gaps before expanding scope. Preserve new ideas in vision mode without letting them widen current execution automatically.
- Keep vision expansive but execution narrow: quarter → month → week → today → next action.
- Treat testing, cleanup, documentation, recovery, backups, security reviews, follow-up, and data quality as first-class work when they close an operational loop.
- Challenge poor prioritization with evidence while preserving Dwight's authority as the final decision-maker.
- Escalate only when authority, money, strategy, unusual risk, or user judgment is required; otherwise resolve downward through specialists and QA.
- Repeated failures require a post-mortem and a preventive system change, not merely a reminder to be more careful.
- Quietly evaluate "what are we avoiding?" when repeated redesign or expansion appears to bypass a foundational unresolved problem.
- This doctrine is an internal operating background; do not constantly recite it unless it is useful to the answer.
- Use balanced autonomy, not paralysis: low-risk, reversible internal work inside an approved mission should proceed without unnecessary escalation.
- Ask Dwight before major scope expansion, architecture redesign, consequential external actions, spending, production-risk changes, contracts, permissions, or hard-to-reverse decisions.
- Dwight can explicitly authorize expansion, but that does not bypass hard safety, secret-protection, money-movement, trading-execution, or permission boundaries.
- If a runtime workforce governance charter is present, treat it as durable policy and do not silently deviate from it.
- Always identify the highest-leverage next move when enough context exists.
- Distinguish evidence from assumptions.
- Avoid fake certainty.
- Protect Dwight from distraction and low-value motion.
- Prefer controlled speed over reckless activity.
- Use connected runtime state before older memory when they conflict. Respect timestamps and freshness markers.
- Quietly check whether your conclusion conflicts with Trading, Finance, Life, SentryOps, recent events, or workforce state before answering.
- When data is missing, say exactly what connection or information would make the answer stronger.
- Do not invent live account, broker, market, email, calendar, or business data.
- Do not present mock dashboard numbers as real.
- Never guess which foundation model is running. Use the runtime model identity injected into each request.
- If a provisional finance snapshot is present, do not claim Jarvis has no financial context at all. Say the snapshot is available but not live-linked.
- Keep routine answers compact. Expand only when the task genuinely benefits from deeper reasoning, comparison, planning, or implementation detail.

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
type BrainPreference = "auto" | "claude" | "gpt" | "dual";
type ActiveBrain = "CLAUDE" | "GPT";
type ResponseBrain = ActiveBrain | "DUAL";

type FinanceSnapshot = {
  personalNetWorth?: number;
  providerNetWorth?: number;
  liquidity?: number;
  personalDebt?: number;
  authorizedUserBalance?: number;
  compounding?: number;
  targetNetWorth?: number;
  status?: string;
};

type JarvisResponse = {
  reply: string;
  memoryUpdates: Array<{ domain: string; fact: string }>;
  nextMove: { title: string; reason: string; domain: string };
};

type BrainResult = {
  brain: ActiveBrain;
  provider: "Anthropic" | "OpenAI";
  model: string;
  text: string;
};

type DualReview = {
  verdict: "PASS" | "REVISE";
  note: string;
  correctedResponse?: JarvisResponse;
};

export async function POST(request: Request) {
  let activeBrain: ResponseBrain | undefined;
  let activeModel: string | undefined;

  try {
    const body = (await request.json()) as {
      messages?: ChatMessage[];
      activeDomain?: string;
      goals?: Goal[];
      memories?: Memory[];
      financeSnapshot?: FinanceSnapshot;
      brain?: BrainPreference;
    };

    const messages = Array.isArray(body.messages) ? body.messages.slice(-24) : [];
    const activeDomain = typeof body.activeDomain === "string" ? body.activeDomain : "CORE";
    const goals = Array.isArray(body.goals) ? body.goals.slice(0, 20) : [];
    const memories = Array.isArray(body.memories) ? body.memories.slice(-60) : [];
    const financeSnapshot = body.financeSnapshot && typeof body.financeSnapshot === "object" ? body.financeSnapshot : null;
    const brainPreference: BrainPreference =
      body.brain === "claude" || body.brain === "gpt" || body.brain === "dual" ? body.brain : "auto";

    const directClaudeAvailable = Boolean(process.env.ANTHROPIC_API_KEY);
    const directOpenAIAvailable = Boolean(process.env.OPENAI_API_KEY);

    if (brainPreference === "claude" && !directClaudeAvailable) {
      return missingProviderResponse("CLAUDE", CLAUDE_MODEL, "Anthropic");
    }

    if (brainPreference === "gpt" && !directOpenAIAvailable) {
      return missingProviderResponse("GPT", GPT_MODEL, "OpenAI");
    }

    if (brainPreference === "dual" && (!directClaudeAvailable || !directOpenAIAvailable)) {
      return Response.json(
        {
          reply: "DUAL mode needs both direct providers online. Make sure ANTHROPIC_API_KEY and OPENAI_API_KEY are available to this deployment, then redeploy.",
          memoryUpdates: [],
          nextMove: {
            title: "Finish dual-brain connection",
            reason: "Jarvis needs both Claude and GPT available before it can run independent review mode.",
            domain: "CORE",
          },
          brain: "DUAL",
          model: `${CLAUDE_MODEL} + ${GPT_MODEL}`,
          provider: "Anthropic + OpenAI",
        },
        { status: 503 },
      );
    }

    if (!directClaudeAvailable && !directOpenAIAvailable) {
      return Response.json(
        {
          reply: "Jarvis is online, but neither direct model provider is connected. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to the deployment environment and redeploy.",
          memoryUpdates: [],
          nextMove: {
            title: "Connect a reasoning provider",
            reason: "Jarvis needs at least one direct model credential to answer reliably without the locked gateway.",
            domain: "CORE",
          },
          brain: "AUTO",
          model: null,
          provider: null,
        },
        { status: 503 },
      );
    }

    const context = await buildContext(activeDomain, goals, memories, financeSnapshot);

    if (brainPreference === "dual") {
      activeBrain = "DUAL";
      activeModel = `${CLAUDE_MODEL} + ${GPT_MODEL}`;

      const primary = await runBrain("CLAUDE", messages, context);
      const primaryParsed = parseResponse(primary.text, activeDomain);
      const review = await runDualReview(primaryParsed, messages, context, activeDomain);
      const finalResponse = review.verdict === "REVISE" && review.correctedResponse
        ? normalizeJarvisResponse(review.correctedResponse, activeDomain)
        : primaryParsed;

      return Response.json({
        ...finalResponse,
        brain: "DUAL",
        provider: "Anthropic + OpenAI",
        model: `${CLAUDE_MODEL} + ${GPT_MODEL}`,
        primary: { brain: "CLAUDE", provider: "Anthropic", model: CLAUDE_MODEL },
        reviewer: { brain: "GPT", provider: "OpenAI", model: GPT_MODEL },
        dualReview: { verdict: review.verdict, note: review.note },
      });
    }

    const primaryBrain: ActiveBrain =
      brainPreference === "gpt"
        ? "GPT"
        : brainPreference === "claude"
          ? "CLAUDE"
          : directClaudeAvailable
            ? "CLAUDE"
            : "GPT";

    let result: BrainResult;
    try {
      result = await runBrain(primaryBrain, messages, context);
    } catch (primaryError) {
      const canFallback =
        brainPreference === "auto" &&
        ((primaryBrain === "CLAUDE" && directOpenAIAvailable) ||
          (primaryBrain === "GPT" && directClaudeAvailable));

      if (!canFallback) throw primaryError;

      const fallbackBrain: ActiveBrain = primaryBrain === "CLAUDE" ? "GPT" : "CLAUDE";
      console.warn("Jarvis primary brain failed; using fallback", {
        primaryBrain,
        fallbackBrain,
        error: primaryError instanceof Error ? primaryError.message : String(primaryError),
      });
      result = await runBrain(fallbackBrain, messages, context);
    }

    activeBrain = result.brain;
    activeModel = result.model;

    const parsed = parseResponse(result.text, activeDomain);
    return Response.json({
      ...parsed,
      brain: result.brain,
      model: result.model,
      provider: result.provider,
    });
  } catch (error) {
    console.error("Jarvis chat error", {
      brain: activeBrain,
      model: activeModel,
      error,
    });

    const errorText = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const anthropicAuthIssue = /anthropic|api key|authentication|unauthorized/i.test(errorText);
    const openAIAuthIssue = /openai|api key|authentication|unauthorized/i.test(errorText);
    const rateLimited = /rate limit|too many requests|429/i.test(errorText);

    return Response.json(
      {
        reply: rateLimited
          ? "The active reasoning provider is temporarily rate-limited. Jarvis is online; retry in a moment."
          : anthropicAuthIssue
            ? "Claude is wired into Jarvis, but its server-side Anthropic credential is missing, invalid, or unavailable to this deployment."
            : openAIAuthIssue
              ? "GPT is wired into Jarvis, but its server-side OpenAI credential is missing, invalid, or unavailable to this deployment."
              : "Core link unavailable. The interface is online, but the reasoning provider could not complete this request.",
        memoryUpdates: [],
        nextMove: {
          title: "Restore reasoning link",
          reason: "Jarvis needs at least one healthy direct model provider to answer through the command interface.",
          domain: "CORE",
        },
        brain: activeBrain,
        model: activeModel,
      },
      { status: 503 },
    );
  }
}

async function buildContext(activeDomain: string, goals: Goal[], memories: Memory[], financeSnapshot: FinanceSnapshot | null) {
  const runtimeContext = await getJarvisRuntimeContext();
  const financeContext = financeSnapshot
    ? `\nCLIENT FINANCE SNAPSHOT (PROVISIONAL): ${JSON.stringify(financeSnapshot)}\nUse the server runtime finance state when it is newer or more complete. Never describe a synchronized snapshot as a real-time bank feed.`
    : "";

  return [
    "CURRENT JARVIS CONTEXT",
    `Active domain: ${activeDomain}`,
    `Known goals: ${JSON.stringify(goals)}`,
    `Durable memory: ${JSON.stringify(memories)}`,
    `CONNECTED RUNTIME STATE: ${JSON.stringify(runtimeContext)}`,
    "Runtime state is the freshest connected operating context available to this request. If a sourceHealth flag is false, treat that source as unavailable rather than guessing.",
    financeContext,
  ].filter(Boolean).join("\n");
}

async function runBrain(brain: ActiveBrain, messages: ChatMessage[], context: string): Promise<BrainResult> {
  const isClaude = brain === "CLAUDE";
  const modelId = isClaude ? CLAUDE_MODEL : GPT_MODEL;
  const provider = isClaude ? "Anthropic" : "OpenAI";
  const modelIdentity = isClaude
    ? `RUNTIME MODEL IDENTITY\nProvider: Anthropic\nModel: Claude Opus 5\nAPI model id: ${CLAUDE_MODEL}\nIf Dwight asks which model or brain is answering, state exactly this runtime identity. Do not claim to be GPT-4o, GPT-4, or another model.`
    : `RUNTIME MODEL IDENTITY\nProvider: OpenAI\nModel: GPT-5.6 Sol\nAPI model id: ${GPT_MODEL}\nIf Dwight asks which model or brain is answering, state exactly this runtime identity. Do not claim to be GPT-4o, GPT-4, or another model.`;

  console.info("Jarvis brain request", { brain, provider, model: modelId });

  const { text } = await generateText({
    model: isClaude ? anthropic(CLAUDE_MODEL) : openai(GPT_MODEL),
    system: `${SYSTEM_PROMPT}\n\n${modelIdentity}\n\n${context}`,
    messages,
  });

  return { brain, provider, model: modelId, text };
}

async function runDualReview(
  primaryResponse: JarvisResponse,
  messages: ChatMessage[],
  context: string,
  activeDomain: string,
): Promise<DualReview> {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const reviewPrompt = `You are the independent second-brain reviewer inside JARVIS.
The primary answer was produced by Claude Opus 5. Your job is to check it for factual errors, unsupported certainty, missed constraints, domain leakage, finance/trading safety issues, or a clearly better next move.

Do not rewrite merely for style. Only choose REVISE when there is a meaningful substantive issue.

Current active domain: ${activeDomain}
Latest user request: ${latestUserMessage}
${context}

PRIMARY STRUCTURED RESPONSE:
${JSON.stringify(primaryResponse)}

Return ONLY JSON with this shape:
{
  "verdict": "PASS" | "REVISE",
  "note": "short private review summary",
  "correctedResponse": {
    "reply": "corrected final answer",
    "memoryUpdates": [{"domain":"TRADING|FINANCE|SENTRYOPS|LIFE|CORE","fact":"durable fact"}],
    "nextMove": {"title":"short action","reason":"concise reason","domain":"TRADING|FINANCE|SENTRYOPS|LIFE|CORE"}
  }
}
If verdict is PASS, omit correctedResponse.`;

  console.info("Jarvis dual reviewer request", { brain: "GPT", provider: "OpenAI", model: GPT_MODEL });

  const { text } = await generateText({
    model: openai(GPT_MODEL),
    system: "You are a precise independent reviewer. Return only valid JSON.",
    prompt: reviewPrompt,
  });

  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    const value = JSON.parse(cleaned) as Partial<DualReview>;
    const verdict = value.verdict === "REVISE" ? "REVISE" : "PASS";
    const note = typeof value.note === "string" ? value.note.trim().slice(0, 300) : "Independent review completed.";
    const correctedResponse = value.correctedResponse
      ? normalizeJarvisResponse(value.correctedResponse, activeDomain)
      : undefined;
    return { verdict, note, correctedResponse };
  } catch {
    return { verdict: "PASS", note: "Reviewer response was not structured; primary answer retained." };
  }
}

function missingProviderResponse(brain: ActiveBrain, model: string, provider: "Anthropic" | "OpenAI") {
  const keyName = brain === "CLAUDE" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  return Response.json(
    {
      reply: `${provider} ${model} is wired into Jarvis, but this deployment does not have ${keyName} available yet. Add it as a server-side environment variable and redeploy; do not paste the secret into Jarvis chat.`,
      memoryUpdates: [],
      nextMove: {
        title: `Connect ${provider} securely`,
        reason: `Jarvis already has the ${provider} model path; it only needs the server-side credential.`,
        domain: "CORE",
      },
      brain,
      model,
      provider,
    },
    { status: 503 },
  );
}

function parseResponse(text: string, activeDomain: string): JarvisResponse {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();

  try {
    const value = JSON.parse(cleaned) as Partial<JarvisResponse>;
    return normalizeJarvisResponse(value, activeDomain, cleaned);
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

function normalizeJarvisResponse(value: Partial<JarvisResponse>, activeDomain: string, fallbackReply = ""): JarvisResponse {
  const reply = typeof value.reply === "string" && value.reply.trim() ? value.reply.trim() : fallbackReply || "Jarvis returned an empty response.";
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
