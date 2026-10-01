"server-only";

import { getCache } from "@vercel/functions";

const KEY = "jarvis:voice:elevenlabs:runtime:v1";
const TTL = 60 * 60 * 24 * 7;

export type ElevenLabsRuntimeStatus = "UNKNOWN" | "CONNECTED" | "PLAN_REQUIRED" | "AUTH_ERROR" | "DEGRADED";

export type ElevenLabsRuntimeState = {
  status: ElevenLabsRuntimeStatus;
  updatedAt: string;
  detail: string;
  model: string;
};

export async function getElevenLabsRuntimeState(): Promise<ElevenLabsRuntimeState> {
  const cached = await getCache().get(KEY) as ElevenLabsRuntimeState | null;
  if (cached?.status) return cached;
  return {
    status: "UNKNOWN",
    updatedAt: new Date(0).toISOString(),
    detail: "No ElevenLabs TTS result has been recorded yet.",
    model: process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5",
  };
}

export async function setElevenLabsRuntimeState(
  status: ElevenLabsRuntimeStatus,
  detail: string,
  model = process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5",
) {
  const state: ElevenLabsRuntimeState = {
    status,
    updatedAt: new Date().toISOString(),
    detail: detail.slice(0, 500),
    model,
  };
  await getCache().set(KEY, state, { ttl: TTL, tags: ["jarvis-elevenlabs-voice"] });
  return state;
}
