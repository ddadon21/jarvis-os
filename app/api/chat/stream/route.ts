import { generateText, streamText } from "ai";
import { getJarvisRuntimeContext } from "../../../../lib/jarvis-context";
import { getAssistantRuntimeState } from "../../../../lib/jarvis-assistant-runtime";
import { lookupLiveWorldFallback, lookupWorldKnowledgeFallback, needsLiveWorldSearch, resolveDirectAnswer } from "../../../../lib/jarvis-assistant-tools";
import { addWorkforceTask, getOrSeedWorkforceState, runWorkforceCycle } from "../../../../lib/jarvis-workforce";
import type { AgentId, AgentPermission, RuntimeDomain } from "../../../../lib/jarvis-runtime";

export const runtime = "nodejs";
export const maxDuration = 300;

const FAST_MODEL = "openai/gpt-6-luna";
const STANDARD_MODEL = "openai/gpt-5.6-sol";
const DEEP_MODEL = "anthropic/claude-opus-5.5";

type ChatMessage = { role: "user" | "assistant"; content: string };
type Goal = { name: string; value: number; state: string };
type Memory = { domain: string; fact: string };
type Route = "FAST" | "STANDARD" | "DEEP";
type Choice = { provider: "Vercel AI Gateway"; brain: "GATEWAY"; model: string };
type Metadata = {
  memoryUpdates: Array<{ domain: string; fact: string }>;
  nextMove: { title: string; reason: string; domain: string };
};

const SYSTEM = [
  "You are JARVIS, Dwight Johnson's private executive operating intelligence.",
  "Answer the actual question immediately. Be fast, precise, context-aware, reliable, and useful.",
  "Use connected runtime state before older memory when they conflict. Respect timestamps and source-health flags.",
  "Never invent live balances, market data, broker state, integrations, actions, memories, or research.",
  "Keep Trading, Finance, SentryOps, and Life evidence separate unless executive synthesis is useful.",
  "Distinguish observed facts, saved context, inference, and recommendation.",
  "Keep routine answers compact. Expand when complexity genuinely requires it.",
  "For difficult tasks, reason across constraints before answering.",
  "If a connected source is unavailable, say so specifically instead of guessing.",
  "Trading remains observation and analysis only unless an explicitly authorized execution tool exists.",
  "Do not mention routing, provider fallback, latency, or internal orchestration unless Dwight asks.",
  "Treat domains as views, not limits. Automatically use whatever connected context is relevant to the question.",
  "If the assistant context says Calendar, Email, Meeting Presence, Contacts, or Web Search are not connected, never pretend you can see them.",
  "Style: natural, composed, direct, compact. No filler or fake cinematic roleplay."
].join("\n");

function routeFor(text: string, domain: string): Route {
  const value = text.trim();
  const lower = value.toLowerCase();
  const deep = ["deep", "in depth", "analyze", "analysis", "audit", "architecture", "strategy", "compare", "debug", "implement", "build", "design", "research", "optimize", "best way", "from start to finish"];
  const fast = ["status", "is it online", "are we connected", "open ", "go to ", "yes", "no", "okay", "bet", "continue", "what's next", "what is next"];
  if (value.length > 900 || deep.some(x => lower.includes(x))) return "DEEP";
  if ((domain === "FINANCE" || domain === "TRADING") && value.length > 140) return "STANDARD";
  if (value.length <= 180 && fast.some(x => lower.includes(x))) return "FAST";
  if (value.length <= 110) return "FAST";
  return "STANDARD";
}

function choices(route: Route): Choice[] {
  return [{
    provider: "Vercel AI Gateway",
    brain: "GATEWAY",
    model: route === "FAST" ? FAST_MODEL : route === "DEEP" ? DEEP_MODEL : STANDARD_MODEL,
  }];
}

function modelFor(choice: Choice) {
  return choice.model;
}

function domainFor(value: unknown, fallback = "CORE") {
  const domain = typeof value === "string" ? value.toUpperCase() : "";
  if (["TRADING", "FINANCE", "SENTRYOPS", "LIFE", "CORE"].includes(domain)) return domain;
  return ["TRADING", "FINANCE", "SENTRYOPS", "LIFE"].includes(fallback.toUpperCase()) ? fallback.toUpperCase() : "CORE";
}

function normalizeMetadata(value: Partial<Metadata>, activeDomain: string): Metadata {
  const memoryUpdates = Array.isArray(value.memoryUpdates)
    ? value.memoryUpdates.filter(item => item && typeof item.fact === "string" && item.fact.trim()).map(item => ({
        domain: domainFor(item.domain, activeDomain),
        fact: item.fact.trim().slice(0, 280),
      })).slice(0, 5)
    : [];
  const nextMove = value.nextMove && typeof value.nextMove.title === "string"
    ? {
        title: value.nextMove.title.trim().slice(0, 120),
        reason: typeof value.nextMove.reason === "string" ? value.nextMove.reason.trim().slice(0, 300) : "",
        domain: domainFor(value.nextMove.domain, activeDomain),
      }
    : {
        title: "Continue current objective",
        reason: "No stronger next move was required by this exchange.",
        domain: domainFor(activeDomain),
      };
  return { memoryUpdates, nextMove };
}

function sendEvent(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder, event: string, data: unknown) {
  controller.enqueue(encoder.encode("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n"));
}

type WorkforceCommand =
  | { type: "RUN" }
  | { type: "STATUS" }
  | { type: "ASSIGN"; assignedTo: AgentId; domain: RuntimeDomain; permissionRequired: AgentPermission; title: string };

function workforceAgent(value: string): { id: AgentId; domain: RuntimeDomain; permission: AgentPermission } | null {
  const text = value.toLowerCase();
  if (/\b(builder|engineer|developer agent)\b/.test(text)) return { id: "BUILDER", domain: "CORE", permission: "WRITE_INTERNAL" };
  if (/\b(cfo|finance agent|finance cfo)\b/.test(text)) return { id: "FINANCE_CFO", domain: "FINANCE", permission: "ANALYZE" };
  if (/\b(sentryops research|research agent|researcher)\b/.test(text)) return { id: "SENTRYOPS_RESEARCH", domain: "SENTRYOPS", permission: "ANALYZE" };
  if (/\b(trading observer|observer agent)\b/.test(text)) return { id: "TRADING_OBSERVER", domain: "TRADING", permission: "READ" };
  if (/\b(qa watchdog|qa agent|qa)\b/.test(text)) return { id: "JARVIS_QA", domain: "CORE", permission: "ANALYZE" };
  if (/\b(executive agent|executive)\b/.test(text)) return { id: "EXECUTIVE", domain: "CORE", permission: "WRITE_INTERNAL" };
  return null;
}

function parseWorkforceCommand(input: string): WorkforceCommand | null {
  const text = input.trim();
  const lower = text.toLowerCase();

  if (/\b(run|start)\b.*\b(workforce|agent cycle|agents)\b/.test(lower) || /\bhave (the )?agents work\b/.test(lower)) {
    return { type: "RUN" };
  }

  if (/\b(workforce|agents?)\b/.test(lower) && /\b(status|doing|working|queue|employees|roster)\b/.test(lower)) {
    return { type: "STATUS" };
  }

  const direct = text.match(/^(?:jarvis[,\s]*)?(?:have|tell|ask|give)\s+(?:the\s+)?(.+?)\s+(?:to\s+)(.+)$/i);
  if (direct) {
    const agent = workforceAgent(direct[1]);
    const title = direct[2]?.trim();
    if (agent && title) return { type: "ASSIGN", assignedTo: agent.id, domain: agent.domain, permissionRequired: agent.permission, title };
  }

  const assign = text.match(/^(?:jarvis[,\s]*)?assign\s+(.+?)\s+to\s+(?:the\s+)?(.+)$/i);
  if (assign) {
    const agent = workforceAgent(assign[2]);
    const title = assign[1]?.trim();
    if (agent && title) return { type: "ASSIGN", assignedTo: agent.id, domain: agent.domain, permissionRequired: agent.permission, title };
  }

  return null;
}

function directSseResponse(input: {
  answer: string;
  activeDomain: string;
  startedAt: number;
  provider: string;
  model: string;
}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const elapsed = Date.now() - input.startedAt;
      sendEvent(controller, encoder, "meta", {
        route: "FAST",
        provider: input.provider,
        brain: "TOOLS",
        model: input.model,
        fallback: false,
      });
      sendEvent(controller, encoder, "delta", { text: input.answer });
      sendEvent(controller, encoder, "final", {
        memoryUpdates: [],
        nextMove: {
          title: "Continue current objective",
          reason: "JARVIS handled the request through the workforce control layer.",
          domain: input.activeDomain,
        },
        route: "FAST",
        provider: input.provider,
        brain: "TOOLS",
        model: input.model,
        firstTokenMs: elapsed,
        totalMs: Date.now() - input.startedAt,
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Jarvis-Route": "FAST",
    },
  });
}

async function extractMetadata(choice: Choice, user: string, reply: string, activeDomain: string, memories: Memory[]) {
  try {
    const result = await generateText({
      model: modelFor(choice),
      system: "You are JARVIS state extraction. Return only valid JSON. Save only durable non-secret facts. Do not save credentials, account numbers, temporary statuses, or fleeting chat details.",
      prompt: [
        "Active domain: " + activeDomain,
        "Existing memory: " + JSON.stringify(memories.slice(-40)),
        "User: " + user,
        "JARVIS answer: " + reply,
        'Return exactly: {"memoryUpdates":[{"domain":"TRADING|FINANCE|SENTRYOPS|LIFE|CORE","fact":"durable fact"}],"nextMove":{"title":"short action","reason":"concise reason","domain":"TRADING|FINANCE|SENTRYOPS|LIFE|CORE"}}'
      ].join("\n"),
      maxOutputTokens: 420,
    });
    const start = result.text.indexOf("{");
    const end = result.text.lastIndexOf("}");
    const cleaned = start >= 0 && end >= start ? result.text.slice(start, end + 1) : result.text.trim();
    return normalizeMetadata(JSON.parse(cleaned) as Partial<Metadata>, activeDomain);
  } catch {
    return normalizeMetadata({}, activeDomain);
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const body = (await request.json().catch(() => ({}))) as {
    messages?: ChatMessage[];
    activeDomain?: string;
    goals?: Goal[];
    memories?: Memory[];
  };

  const messages = Array.isArray(body.messages) ? body.messages.slice(-24) : [];
  const latestUser = [...messages].reverse().find(message => message.role === "user")?.content?.trim() || "";
  if (!latestUser) return new Response("Missing user message.", { status: 400 });

  const activeDomain = domainFor(body.activeDomain);
  const goals = Array.isArray(body.goals) ? body.goals.slice(0, 20) : [];
  const memories = Array.isArray(body.memories) ? body.memories.slice(-60) : [];
  const workforceCommand = parseWorkforceCommand(latestUser);
  if (workforceCommand?.type === "RUN") {
    const workforce = await runWorkforceCycle();
    const done = workforce.agents.filter((agent) => agent.status === "DONE").length;
    const blocked = workforce.agents.filter((agent) => agent.status === "BLOCKED").length;
    const errors = workforce.agents.filter((agent) => agent.status === "ERROR").length;
    return directSseResponse({
      answer: `Workforce cycle complete. ${done} agents completed work, ${blocked} are blocked, and ${errors} reported errors. Executive summary: ${workforce.executiveSummary}`,
      activeDomain,
      startedAt,
      provider: "JARVIS Workforce",
      model: "EXECUTIVE",
    });
  }

  if (workforceCommand?.type === "STATUS") {
    const workforce = await getOrSeedWorkforceState();
    const open = (workforce.tasks ?? []).filter((task) => ["QUEUED", "RUNNING", "BLOCKED", "FAILED", "WAITING_APPROVAL"].includes(task.status));
    const roster = workforce.agents.map((agent) => `${agent.id}: ${agent.status}`).join(" · ");
    return directSseResponse({
      answer: `AI workforce is ${workforce.status.toLowerCase()}. ${workforce.agents.length} employees are on the roster. ${open.length} tasks are open. ${roster}. Current executive focus: ${workforce.agents.find((agent) => agent.id === "EXECUTIVE")?.currentWork ?? workforce.executiveSummary}`,
      activeDomain,
      startedAt,
      provider: "JARVIS Workforce",
      model: "ROSTER",
    });
  }

  if (workforceCommand?.type === "ASSIGN") {
    const task = await addWorkforceTask({
      title: workforceCommand.title,
      domain: workforceCommand.domain,
      assignedTo: workforceCommand.assignedTo,
      priority: "HIGH",
      permissionRequired: workforceCommand.permissionRequired,
      source: "jarvis.chat",
    });
    return directSseResponse({
      answer: `Assigned to ${task.assignedTo}: ${task.title}. Status: ${task.status}.${task.status === "WAITING_APPROVAL" ? " I will not bypass the approval boundary." : " It is now in the workforce queue."}`,
      activeDomain,
      startedAt,
      provider: "JARVIS Workforce",
      model: task.assignedTo,
    });
  }

  const route = routeFor(latestUser, activeDomain);
  const candidates = choices(route);
  if (!candidates.length) return new Response("No reasoning provider is connected.", { status: 503 });

  const runtimeContext = await getJarvisRuntimeContext();
  const assistantContext = await getAssistantRuntimeState();
  const directAnswer = resolveDirectAnswer(latestUser, runtimeContext, assistantContext);
  const liveWorldAnswer = needsLiveWorldSearch(latestUser)
    ? await lookupLiveWorldFallback(latestUser)
    : null;

  if (liveWorldAnswer) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        sendEvent(controller, encoder, "meta", {
          route: "FAST",
          provider: "JARVIS Web",
          brain: "WEB",
          model: liveWorldAnswer.source,
          source: liveWorldAnswer.source,
          fallback: false,
        });
        sendEvent(controller, encoder, "delta", { text: liveWorldAnswer.answer });
        sendEvent(controller, encoder, "final", {
          memoryUpdates: [],
          nextMove: {
            title: "Continue current objective",
            reason: "The request was answered from live public information.",
            domain: activeDomain,
          },
          route: "FAST",
          provider: "JARVIS Web",
          brain: "WEB",
          model: liveWorldAnswer.source,
          firstTokenMs: Date.now() - startedAt,
          totalMs: Date.now() - startedAt,
        });
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "X-Jarvis-Route": "FAST",
      },
    });
  }

  if (directAnswer) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        sendEvent(controller, encoder, "meta", {
          route: "FAST",
          provider: "JARVIS Tools",
          brain: "TOOLS",
          model: directAnswer.capability,
          source: directAnswer.source,
          fallback: false,
        });
        sendEvent(controller, encoder, "delta", { text: directAnswer.answer });
        sendEvent(controller, encoder, "final", {
          memoryUpdates: [],
          nextMove: {
            title: "Continue current objective",
            reason: "The request was answered directly from connected JARVIS data.",
            domain: activeDomain,
          },
          route: "FAST",
          provider: "JARVIS Tools",
          brain: "TOOLS",
          model: directAnswer.capability,
          firstTokenMs: Date.now() - startedAt,
          totalMs: Date.now() - startedAt,
        });
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "X-Jarvis-Route": "FAST",
      },
    });
  }

  const context = [
    "ROUTE DEPTH: " + route,
    "ACTIVE DOMAIN: " + activeDomain,
    "KNOWN GOALS: " + JSON.stringify(goals),
    "DURABLE MEMORY: " + JSON.stringify(memories),
    "CONNECTED RUNTIME STATE: " + JSON.stringify(runtimeContext),
    "Runtime state is the freshest connected context. If a sourceHealth flag is false, that source is unavailable."
  ].join("\n");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let reply = "";
      let firstTokenAt: number | null = null;
      let activeChoice = candidates[0];
      let streamed = false;

      try {
        let completed = false;
        for (let index = 0; index < candidates.length && !completed; index += 1) {
          const choice = candidates[index];
          activeChoice = choice;
          sendEvent(controller, encoder, "meta", { route, provider: choice.provider, brain: choice.brain, model: choice.model, fallback: index > 0 });

          try {
            const result = streamText({
              model: modelFor(choice),
              system: SYSTEM + "\n\nRUNTIME MODEL\nProvider: " + choice.provider + "\nModel: " + choice.model + "\n\n" + context,
              messages,
              maxOutputTokens: route === "FAST" ? 500 : route === "STANDARD" ? 1200 : 2200,
            });

            for await (const delta of result.textStream) {
              if (!delta) continue;
              if (firstTokenAt === null) firstTokenAt = Date.now();
              streamed = true;
              reply += delta;
              sendEvent(controller, encoder, "delta", { text: delta });
            }
            completed = true;
          } catch (error) {
            if (streamed || index === candidates.length - 1) throw error;
          }
        }

        const metadataChoice = candidates[0] || activeChoice;
        const metadata = await extractMetadata(metadataChoice, latestUser, reply, activeDomain, memories);
        sendEvent(controller, encoder, "final", {
          ...metadata,
          route,
          provider: activeChoice.provider,
          brain: activeChoice.brain,
          model: activeChoice.model,
          firstTokenMs: firstTokenAt ? firstTokenAt - startedAt : null,
          totalMs: Date.now() - startedAt,
        });
      } catch (error) {
        if (!reply) {
          const worldFallback = (await lookupLiveWorldFallback(latestUser)) ?? (await lookupWorldKnowledgeFallback(latestUser));
          if (worldFallback) {
            reply = worldFallback.answer;
            if (firstTokenAt === null) firstTokenAt = Date.now();
            sendEvent(controller, encoder, "meta", {
              route: "FAST",
              provider: "JARVIS Knowledge",
              brain: "KNOWLEDGE",
              model: worldFallback.source,
              fallback: true,
            });
            sendEvent(controller, encoder, "delta", { text: worldFallback.answer });
            sendEvent(controller, encoder, "final", {
              memoryUpdates: [],
              nextMove: {
                title: "Continue current objective",
                reason: "General knowledge was answered from JARVIS's encyclopedic fallback.",
                domain: activeDomain,
              },
              route: "FAST",
              provider: "JARVIS Knowledge",
              brain: "KNOWLEDGE",
              model: worldFallback.source,
              firstTokenMs: firstTokenAt - startedAt,
              totalMs: Date.now() - startedAt,
            });
          } else {
            sendEvent(controller, encoder, "error", {
              message: "JARVIS can hear you, but the general intelligence provider is unavailable for this request.",
              detail: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
            });
          }
        } else {
          sendEvent(controller, encoder, "error", {
            message: "The reasoning stream ended early. JARVIS kept the partial response.",
            detail: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
          });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Jarvis-Route": route,
    },
  });
}
