import { generateText } from "ai";

export const runtime = "nodejs";
export const maxDuration = 30;

const SCREEN_MODEL = "openai/gpt-6-luna";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    image?: string;
    question?: string;
  } | null;

  const image = typeof body?.image === "string" ? body.image : "";
  if (!image.startsWith("data:image/jpeg;base64,") || image.length > 1_500_000) {
    return Response.json({ ok: false, error: "Invalid or oversized desktop image." }, { status: 400 });
  }

  const question = typeof body?.question === "string" && body.question.trim()
    ? body.question.trim().slice(0, 600)
    : "Describe what is currently visible on Dwight's screen and what application or task appears active.";

  try {
    const result = await generateText({
      model: SCREEN_MODEL,
      system: [
        "You are JARVIS screen perception for Dwight Johnson's own Windows PC.",
        "Describe only what is actually visible in the supplied screenshot.",
        "Be concise and operational: identify the active application, relevant visible content, dialogs, warnings, and obvious next actions.",
        "Do not infer passwords, hidden content, private data that is not visible, or actions that did not occur.",
        "Do not claim you clicked, typed, opened, changed, submitted, or executed anything.",
        "If text is too small or unclear, say what cannot be read instead of guessing.",
      ].join("\n"),
      messages: [{
        role: "user",
        content: [
          { type: "text", text: question },
          { type: "image", image },
        ],
      }],
      maxOutputTokens: 220,
    });

    return Response.json({
      ok: true,
      analysis: result.text.trim(),
      model: SCREEN_MODEL,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false, error: "Jarvis screen vision is unavailable." }, { status: 503 });
  }
}
