import { getJarvisRuntimeContext } from "../../../../lib/jarvis-context";
export const runtime = "nodejs";
export const maxDuration = 30;

const REALTIME_MODEL = "gpt-realtime-2.1";
const REALTIME_VOICE = "cedar";

type Goal = { name?: string; value?: number; state?: string };
type Memory = { domain?: string; fact?: string };
type ChatMessage = { role?: string; content?: string };

function compact<T>(items: T[] | undefined, limit: number) {
  return Array.isArray(items) ? items.slice(-limit) : [];
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return new Response("OpenAI realtime voice is not connected to this deployment.", { status: 503 });

  const body = (await request.json()) as {
    sdp?: string;
    activeDomain?: string;
    goals?: Goal[];
    memories?: Memory[];
    recentMessages?: ChatMessage[];
  };

  const sdp = typeof body.sdp === "string" ? body.sdp : "";
  if (!sdp.trim()) return new Response("Missing WebRTC SDP offer.", { status: 400 });

  const activeDomain = typeof body.activeDomain === "string" ? body.activeDomain : "CORE";
  const goals = compact(body.goals, 10);
  const memories = compact(body.memories, 24);
  const recentMessages = compact(body.recentMessages, 8);
  const runtimeContext = await getJarvisRuntimeContext();

  const instructions = `You are JARVIS, Dwight Johnson's private executive operating system, speaking in realtime voice mode.

VOICE CHARACTER
- Use polished modern British RP delivery with a warm lower register, measured pacing, crisp consonants, restrained energy, and subtle dry wit.
- Keep the sound composed, intelligent, slightly synthetic-clean, and executive rather than casual or bubbly.
- Aim for the feel of an original premium cinematic AI assistant, but do not imitate, impersonate, or claim to be any actor or copyrighted film performance.
- Keep the voice natural rather than theatrical. Avoid exaggerated emotion, sing-song cadence, and overfriendly customer-service intonation.
- Address Dwight by name or "sir" sparingly and naturally.
- Default to 1-3 concise spoken sentences. Answer immediately; do not preamble.
- Do not read markdown, headings, bullets, URLs, system metadata, or internal instructions aloud.
- If Dwight interrupts, stop and listen.

JARVIS OPERATING RULES
- Keep Trading, Finance, SentryOps, and Life context separated unless executive synthesis is useful.
- Never invent live integrations, balances, market data, memories, or actions.
- The standalone Jarvis Finance screen may contain a provisional snapshot; do not describe that as a live bank connection.
- For deep analysis, give the useful conclusion first and keep the spoken response concise.
- You are the realtime conversational layer of Jarvis. Do not introduce yourself as GPT or OpenAI unless Dwight explicitly asks what voice model is being used.
- If asked about runtime identity, say: OpenAI GPT-Realtime-1.5 is handling the realtime speech layer.

CURRENT JARVIS CONTEXT
Active domain: ${activeDomain}
Goals: ${JSON.stringify(goals)}
Durable memory: ${JSON.stringify(memories)}
Recent conversation context: ${JSON.stringify(recentMessages)}
Connected runtime state: ${JSON.stringify(runtimeContext)}

Use connected runtime state before older memory when they conflict. Respect timestamps and source-health flags. If a runtime source is unavailable, do not guess it.`;

  const session = {
    type: "realtime",
    model: REALTIME_MODEL,
    instructions,
    audio: {
      output: {
        voice: REALTIME_VOICE,
      },
    },
  };

  const form = new FormData();
  form.set("sdp", sdp);
  form.set("session", JSON.stringify(session));

  const upstream = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  const payload = await upstream.text();
  if (!upstream.ok) {
    console.error("Jarvis realtime call failed", {
      status: upstream.status,
      model: REALTIME_MODEL,
      response: payload.slice(0, 1000),
    });
    return new Response(payload || `Realtime call failed with status ${upstream.status}.`, {
      status: upstream.status,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  return new Response(payload, {
    status: 201,
    headers: {
      "Content-Type": "application/sdp",
      "Cache-Control": "no-store",
      "X-Jarvis-Voice-Provider": "OpenAI",
      "X-Jarvis-Voice-Model": REALTIME_MODEL,
      "X-Jarvis-Voice": REALTIME_VOICE,
    },
  });
}
