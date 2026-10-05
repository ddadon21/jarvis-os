import { createHash } from "node:crypto";
import { durableRead, durableWrite } from "./jarvis-db";

/**
 * Server-side long-term memory. One store for every device (the browser copy
 * is only a cache). Facts are deduplicated by content and recalled by
 * Postgres full-text search plus recency.
 */

export type MemoryFact = { id: string; domain: string; fact: string; source: string; createdAt: string };

const SECRET_PATTERNS = [/\b\d{12,19}\b/, /\bpassword\b/i, /\b(api[_ -]?key|secret|token)\b\s*[:=]/i, /\brouting\b.*\d{9}/i];

function normalize(fact: string) {
  return fact.replace(/\s+/g, " ").trim();
}

export function memoryId(fact: string) {
  return "mem_" + createHash("sha256").update(normalize(fact).toLowerCase()).digest("hex").slice(0, 24);
}

export function isSafeMemory(fact: string) {
  const text = normalize(fact);
  return text.length >= 8 && text.length <= 400 && !SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

export async function saveMemoryFacts(facts: Array<{ domain: string; fact: string }>, source = "chat") {
  const rows = facts
    .filter((item) => item && typeof item.fact === "string" && isSafeMemory(item.fact))
    .map((item) => ({ id: memoryId(item.fact), domain: String(item.domain || "CORE").toUpperCase().slice(0, 20), fact: normalize(item.fact), source }));
  if (!rows.length) return 0;
  await durableWrite("jarvis_memory_facts", ({ db, workspaceId }) =>
    db.from("jarvis_memory_facts").upsert(rows.map((row) => ({ ...row, workspace_id: workspaceId })), { onConflict: "id", ignoreDuplicates: true }),
  );
  return rows.length;
}

type Row = { id: string; domain: string; fact: string; source: string; created_at: string };
const toFact = (row: Row): MemoryFact => ({ id: row.id, domain: row.domain, fact: row.fact, source: row.source, createdAt: row.created_at });

export async function listMemory(limit = 50): Promise<MemoryFact[]> {
  const rows = await durableRead<Row[]>("jarvis_memory_facts", ({ db, workspaceId }) =>
    db.from("jarvis_memory_facts").select("id,domain,fact,source,created_at").eq("workspace_id", workspaceId).eq("archived", false).order("created_at", { ascending: false }).limit(limit),
  );
  return (rows ?? []).map(toFact);
}

/** Relevant facts for a question: full-text matches first, then the most recent ones. */
export async function recallMemory(query: string, limit = 25): Promise<MemoryFact[]> {
  const words = query.toLowerCase().match(/[a-z0-9$]{3,}/g)?.slice(0, 12) ?? [];
  const matches = words.length
    ? await durableRead<Row[]>("jarvis_memory_facts", ({ db, workspaceId }) =>
        db.from("jarvis_memory_facts").select("id,domain,fact,source,created_at").eq("workspace_id", workspaceId).eq("archived", false)
          .textSearch("fact", words.join(" | "), { config: "english" }).limit(limit),
      )
    : [];
  const recent = await listMemory(15);
  const seen = new Set<string>();
  const out: MemoryFact[] = [];
  for (const fact of [...(matches ?? []).map(toFact), ...recent]) {
    if (seen.has(fact.id)) continue;
    seen.add(fact.id);
    out.push(fact);
    if (out.length >= limit) break;
  }
  return out;
}

export async function archiveMemory(id: string) {
  return durableWrite("jarvis_memory_facts", ({ db, workspaceId }) =>
    db.from("jarvis_memory_facts").update({ archived: true }).eq("id", id).eq("workspace_id", workspaceId),
  );
}

/** Obsidian vault notes indexed by the Local Agent (folders Dwight allows). */
export async function searchVault(query: string, limit = 6) {
  const words = query.toLowerCase().match(/[a-z0-9$]{3,}/g)?.slice(0, 12) ?? [];
  if (!words.length) return [];
  const rows = await durableRead<Array<{ path: string; title: string; content: string; modified_at: string | null }>>("jarvis_vault_notes", ({ db, workspaceId }) =>
    db.from("jarvis_vault_notes").select("path,title,content,modified_at").eq("workspace_id", workspaceId)
      .textSearch("content", words.join(" | "), { config: "english" }).limit(limit),
  );
  return (rows ?? []).map((row) => ({ path: row.path, title: row.title, modifiedAt: row.modified_at, excerpt: excerpt(row.content, words) }));
}

function excerpt(content: string, words: string[]) {
  const lower = content.toLowerCase();
  const hit = words.map((word) => lower.indexOf(word)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, hit - 200);
  return (start > 0 ? "…" : "") + content.slice(start, start + 700).replace(/\s+/g, " ").trim() + (start + 700 < content.length ? "…" : "");
}
