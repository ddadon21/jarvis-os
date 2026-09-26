"use client";

export type ObsidianAction = "LIST" | "READ" | "WRITE" | "SEARCH";

export type ObsidianCommandResult = {
  id: string;
  action: ObsidianAction;
  ok: boolean;
  path: string | null;
  data: string | null;
  error: string | null;
  completedAt: string;
};

function controllerToken() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem("jarvis-observer-controller-v1") ?? "";
}

async function waitForResult(token: string, id: string, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(resolve => window.setTimeout(resolve, 550));
    const response = await fetch(`/api/obsidian/command?id=${encodeURIComponent(id)}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("Local Agent command status unavailable.");
    const payload = await response.json() as { pending?: boolean; result?: ObsidianCommandResult | null };
    if (payload.result?.id === id) return payload.result;
  }
  throw new Error("Local Agent did not answer in time.");
}

let commandQueue: Promise<void> = Promise.resolve();

async function executeObsidianCommand(input: {
  action: ObsidianAction;
  path?: string | null;
  content?: string | null;
  query?: string | null;
  timeoutMs?: number;
}) {
  const token = controllerToken();
  if (!token) throw new Error("JARVIS Local Agent is not paired.");

  const response = await fetch("/api/obsidian/command", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: input.action,
      path: input.path ?? null,
      content: input.content ?? null,
      query: input.query ?? null,
    }),
  });

  if (!response.ok) throw new Error("Could not send Obsidian command to Local Agent.");
  const payload = await response.json() as { command?: { id?: string } };
  const id = payload.command?.id;
  if (!id) throw new Error("Local Agent command was not created.");

  const result = await waitForResult(token, id, input.timeoutMs ?? 12_000);
  if (!result.ok) throw new Error(result.error || "Obsidian command failed.");
  return result;
}

export function runObsidianCommand(input: {
  action: ObsidianAction;
  path?: string | null;
  content?: string | null;
  query?: string | null;
  timeoutMs?: number;
}) {
  const task = commandQueue.then(() => executeObsidianCommand(input));
  commandQueue = task.then(() => undefined, () => undefined);
  return task;
}

export async function writeObsidianNote(path: string, content: string) {
  return runObsidianCommand({ action: "WRITE", path, content });
}

export async function readObsidianNote(path: string) {
  return runObsidianCommand({ action: "READ", path });
}

export async function searchObsidian(query: string) {
  return runObsidianCommand({ action: "SEARCH", query });
}
