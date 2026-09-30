export const runtime = "nodejs";

export async function GET(request: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json({
      ok: false,
      error: "ELEVENLABS_API_KEY is not configured.",
    }, { status: 503 });
  }

  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const params = new URLSearchParams({
    page_size: "30",
    include_total_count: "true",
    gender: "male",
    language: "en",
  });
  if (search) params.set("search", search);

  const upstream = await fetch(`https://api.elevenlabs.io/v2/voices?${params.toString()}`, {
    headers: { "xi-api-key": apiKey },
    cache: "no-store",
  });

  const payload = await upstream.json().catch(() => null) as {
    voices?: Array<{
      voice_id?: string;
      name?: string;
      category?: string;
      description?: string | null;
      labels?: Record<string, string>;
      preview_url?: string | null;
    }>;
    total_count?: number;
  } | null;

  if (!upstream.ok) {
    return Response.json({
      ok: false,
      error: "Could not load ElevenLabs voices.",
      status: upstream.status,
    }, { status: 502 });
  }

  const voices = (payload?.voices ?? []).map((voice) => ({
    voiceId: voice.voice_id,
    name: voice.name,
    category: voice.category,
    description: voice.description,
    accent: voice.labels?.accent ?? null,
    age: voice.labels?.age ?? null,
    useCase: voice.labels?.use_case ?? null,
    previewUrl: voice.preview_url ?? null,
  }));

  return Response.json({
    ok: true,
    voices,
    totalCount: payload?.total_count ?? voices.length,
  }, { headers: { "Cache-Control": "no-store" } });
}
