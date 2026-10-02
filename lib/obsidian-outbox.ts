"use client";

import { getSupabaseBrowserClient } from "./supabase-browser";

// A durable handoff, not a claim that a disconnected local vault was written.
const LOCAL_KEY = "jarvis-obsidian-outbox-v1";
const CLOUD_KEY = "obsidian.outbox.v1";

export type PendingObsidianNote = {
  path: string;
  content: string;
  queuedAt: string;
};

function parseNotes(input: unknown): PendingObsidianNote[] {
  if (!Array.isArray(input)) return [];
  return input.filter((value): value is PendingObsidianNote =>
    Boolean(value && typeof value === "object" &&
      typeof (value as PendingObsidianNote).path === "string" &&
      typeof (value as PendingObsidianNote).content === "string" &&
      typeof (value as PendingObsidianNote).queuedAt === "string")
  ).filter(item => item.path.length <= 230 && item.content.length <= 200_000).slice(-200);
}

function localNotes(): PendingObsidianNote[] {
  try {
    return parseNotes(JSON.parse(window.localStorage.getItem(LOCAL_KEY) || "[]"));
  } catch {
    return [];
  }
}

function mergeNotes(a: PendingObsidianNote[], b: PendingObsidianNote[]) {
  const merged = new Map<string, PendingObsidianNote>();
  for (const note of [...a, ...b]) {
    const previous = merged.get(note.path);
    if (!previous || Date.parse(note.queuedAt) >= Date.parse(previous.queuedAt)) {
      merged.set(note.path, note);
    }
  }
  return [...merged.values()].sort((x, y) => x.path.localeCompare(y.path)).slice(-200);
}

function saveLocal(notes: PendingObsidianNote[]) {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(notes));
    return true;
  } catch {
    return false;
  }
}

async function workspace() {
  const client = getSupabaseBrowserClient();
  const { data: userData, error: authError } = await client.auth.getUser();
  if (authError || !userData.user) return null;
  const { data, error } = await client.from("jarvis_workspaces")
    .select("id").eq("slug", "primary").maybeSingle();
  return error || !data?.id ? null : { client, id: String(data.id) };
}

export async function loadObsidianOutbox() {
  const local = localNotes();
  try {
    const source = await workspace();
    if (!source) return { notes: local, cloudAvailable: false };
    const { data, error } = await source.client.from("jarvis_state_snapshots")
      .select("payload")
      .eq("workspace_id", source.id)
      .eq("state_key", CLOUD_KEY)
      .maybeSingle();
    if (error) return { notes: local, cloudAvailable: false };
    const payload = data?.payload as { format?: string; notes?: unknown } | null | undefined;
    const remote = payload?.format === "obsidian-outbox-v1" ? parseNotes(payload.notes) : [];
    const notes = mergeNotes(remote, local);
    saveLocal(notes);
    return { notes, cloudAvailable: true };
  } catch {
    return { notes: local, cloudAvailable: false };
  }
}

export async function persistObsidianOutbox(notes: PendingObsidianNote[]) {
  const normalized = mergeNotes([], notes);
  const localSaved = saveLocal(normalized);
  if (!localSaved) return { localSaved: false, cloudSaved: false };
  try {
    const source = await workspace();
    if (!source) return { localSaved: true, cloudSaved: false };
    const { error } = await source.client.from("jarvis_state_snapshots")
      .upsert({
        workspace_id: source.id,
        state_key: CLOUD_KEY,
        version: 1,
        payload: { format: "obsidian-outbox-v1", notes: normalized },
        source: "JARVIS OBSIDIAN QUEUE",
        client_updated_at: new Date().toISOString(),
      }, { onConflict: "workspace_id,state_key" });
    return { localSaved: true, cloudSaved: !error };
  } catch {
    return { localSaved: true, cloudSaved: false };
  }
}
