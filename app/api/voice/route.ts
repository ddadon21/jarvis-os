import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";

export const runtime = "nodejs";
export const maxDuration = 30;

const VOICE_MODEL = "claude-sonnet-4-6";

type ChatMessage = { role: "user" | "assistant"; content: string };
type Goal = { name: string; value: number; state: string };
type Memory = { domain: string; fact: string };

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response("Claude voice lane is not connected to this deployment.", { status: 503 });
  }

  const body = (await request.json()) as {
    messages?: ChatMessage[];
    activeDomain?: string;
    goals?: Goal[];
    memories?: Memory[];
  };

  const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  const activeDomain = typeof body.activeDomain === "string" ? body.activeDomain : "CORE";
  const goals = Array.isArray(body.goals) ? body.goals.slice(0, 12) : [];
  const memories = Array.isArray(body.memories) ? body.memories.slice(-30) : [];

  const system = `You are JARVIS in low-latency voice mode for Dwight Johnson.

VOICE BEHAVIOR
- Answer the question immediately in the first sentence.
- Sound like a calm, capable executive assistant speaking aloud, not a written report.
- Default to 1-3 short sentences and usually stay under 70 words unless Dwight explicitly asks for detail.
- Do not use markdown, headings, bullets, tables, code fences, or decorative formatting unless explicitly requested.
- Avoid filler, repeated context, and long disclaimers.
- Keep Trading, Finance, SentryOps, and Life context separate unless an executive synthesis is useful.
- Never invent live integrations or data.
- If the request needs deeper analysis, still give the useful concise answer first.

RUNTIME MODEL IDENTITY
Provider: Anthropic
Voice fast-lane model: Claude Sonnet 4.6
API model id: ${VOICE_MODEL}
If asked which model is speaking, report this voice-lane identity exactly.

CURRENT CONTEXT
Active domain: ${activeDomain}
Goals: ${JSON.stringify(goals)}
Durable memory: ${JSON.stringify(memories)}`;

  console.info("Jarvis voice request", { provider: "Anthropic", model: VOICE_MODEL });

  const result = streamText({
    model: anthropic(VOICE_MODEL),
    system,
    messages,
    maxOutputTokens: 220,
  });

  return result.toTextStreamResponse({
    headers: {
      "Cache-Control": "no-store",
      "X-Jarvis-Provider": "Anthropic",
      "X-Jarvis-Model": VOICE_MODEL,
    },
  });
}
