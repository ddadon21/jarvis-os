import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/**
 * One place for model choices. Override any of them with environment variables
 * instead of editing code in several routes.
 */
export const JARVIS_MODELS = {
  claudeDeep: process.env.JARVIS_CLAUDE_MODEL || "claude-opus-5",
  gptStandard: process.env.JARVIS_GPT_MODEL || "gpt-5.6-sol",
  gptFast: process.env.JARVIS_GPT_FAST_MODEL || "gpt-5.6-luna",
  agent: process.env.JARVIS_AGENT_MODEL || "",
  /** Vercel AI Gateway model for screen/chart vision, with gateway fallbacks below. */
  gatewayVision: process.env.JARVIS_GATEWAY_VISION_MODEL || "google/gemini-3.6-flash",
} as const;

export type AgentModelChoice = { model: LanguageModel; provider: "Anthropic" | "OpenAI"; id: string };

/** Model for workforce agents: explicit override, else Claude when available, else GPT. */
export function agentModel(): AgentModelChoice | null {
  const explicit = JARVIS_MODELS.agent;
  if (explicit) {
    if (explicit.startsWith("claude") && process.env.ANTHROPIC_API_KEY) return { model: anthropic(explicit), provider: "Anthropic", id: explicit };
    if (process.env.OPENAI_API_KEY) return { model: openai(explicit), provider: "OpenAI", id: explicit };
  }
  if (process.env.ANTHROPIC_API_KEY) return { model: anthropic(JARVIS_MODELS.claudeDeep), provider: "Anthropic", id: JARVIS_MODELS.claudeDeep };
  if (process.env.OPENAI_API_KEY) return { model: openai(JARVIS_MODELS.gptStandard), provider: "OpenAI", id: JARVIS_MODELS.gptStandard };
  return null;
}
