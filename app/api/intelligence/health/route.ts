import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { JARVIS_MODELS } from "../../../../lib/jarvis-models";

export const runtime = "nodejs";
export const maxDuration = 30;

async function probe(name: "OpenAI" | "Anthropic") {
  const configured = name === "OpenAI"
    ? Boolean(process.env.OPENAI_API_KEY)
    : Boolean(process.env.ANTHROPIC_API_KEY);
  const model = name === "OpenAI" ? JARVIS_MODELS.gptStandard : JARVIS_MODELS.claudeDeep;
  if (!configured) return { provider: name, configured: false, ok: false, model, latencyMs: null, error: "credential_missing" };

  const started = Date.now();
  try {
    const result = await generateText({
      model: name === "OpenAI" ? openai(model) : anthropic(model),
      prompt: "Reply with exactly: OK",
      maxOutputTokens: 16,
    });
    return {
      provider: name,
      configured: true,
      ok: result.text.trim().toUpperCase().includes("OK"),
      model,
      latencyMs: Date.now() - started,
      error: null,
    };
  } catch (error) {
    return {
      provider: name,
      configured: true,
      ok: false,
      model,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    };
  }
}

export async function GET() {
  const [openaiState, anthropicState] = await Promise.all([probe("OpenAI"), probe("Anthropic")]);
  return Response.json({
    ok: openaiState.ok || anthropicState.ok,
    providers: [openaiState, anthropicState],
  }, { headers: { "Cache-Control": "no-store" } });
}
