export const runtime = "nodejs";
export const maxDuration = 30;

const DEFAULT_MODEL = "eleven_flash_v2_5";

function configured() {
  return Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID);
}

export async function GET() {
  return Response.json({
    ok: true,
    configured: configured(),
    provider: "ElevenLabs",
    voiceIdConfigured: Boolean(process.env.ELEVENLABS_VOICE_ID),
    model: process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) {
    return Response.json({
      ok: false,
      error: "ElevenLabs voice is not configured on this deployment.",
      missing: [!apiKey ? "ELEVENLABS_API_KEY" : null, !voiceId ? "ELEVENLABS_VOICE_ID" : null].filter(Boolean),
    }, { status: 503 });
  }

  const body = await request.json().catch(() => null) as { text?: string } | null;
  const text = typeof body?.text === "string"
    ? body.text.replace(/s+/g, " ").trim().slice(0, 1800)
    : "";
  if (!text) return Response.json({ ok: false, error: "Missing speech text." }, { status: 400 });

  const modelId = process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL;
  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_22050_32`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability: 0.48,
          similarity_boost: 0.82,
          style: 0.08,
          use_speaker_boost: true,
          speed: 0.98,
        },
      }),
    },
  );

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    console.error("ElevenLabs speech failed", {
      status: upstream.status,
      modelId,
      response: detail.slice(0, 800),
    });
    return Response.json({
      ok: false,
      error: "ElevenLabs speech generation failed.",
      status: upstream.status,
    }, { status: 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "audio/mpeg",
      "Cache-Control": "no-store",
      "X-Jarvis-Voice-Provider": "ElevenLabs",
      "X-Jarvis-Voice-Model": modelId,
    },
  });
}
