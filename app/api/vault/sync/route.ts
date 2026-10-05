import { authenticateObserverDevice } from "../../../../lib/trading-device-link";
import { durableContext } from "../../../../lib/jarvis-db";

export const runtime = "nodejs";

/** Local Agent uploads changed notes from the vault folders Dwight allows, for Jarvis search. */
export async function POST(request: Request) {
  const deviceId = request.headers.get("x-jarvis-device-id");
  const auth = request.headers.get("authorization") ?? "";
  const device = await authenticateObserverDevice(deviceId, auth.startsWith("Bearer ") ? auth.slice(7).trim() : "");
  if (!device) return Response.json({ ok: false, error: "Observer device is not paired." }, { status: 401 });
  const ctx = await durableContext();
  if (!ctx) return Response.json({ ok: false, error: "Durable storage is not configured on the server." }, { status: 503 });

  const body = await request.json().catch(() => null) as { notes?: Array<{ path?: string; title?: string; content?: string; modifiedAt?: string }> } | null;
  const notes = (Array.isArray(body?.notes) ? body!.notes : []).slice(0, 200).flatMap((note) => {
    const path = typeof note.path === "string" ? note.path.replace(/\\/g, "/").replace(/^\/+/, "").slice(0, 400) : "";
    if (!path.toLowerCase().endsWith(".md") || path.split("/").some((part) => part === ".." || part.startsWith("."))) return [];
    return [{
      workspace_id: ctx.workspaceId,
      path,
      title: String(note.title ?? path.split("/").pop()?.replace(/\.md$/i, "") ?? path).slice(0, 200),
      content: String(note.content ?? "").slice(0, 100_000),
      modified_at: note.modifiedAt && Number.isFinite(Date.parse(note.modifiedAt)) ? new Date(note.modifiedAt).toISOString() : null,
      indexed_at: new Date().toISOString(),
    }];
  });
  if (!notes.length) return Response.json({ ok: true, indexed: 0 });
  const { error } = await ctx.db.from("jarvis_vault_notes").upsert(notes, { onConflict: "workspace_id,path" });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 502 });
  return Response.json({ ok: true, indexed: notes.length });
}
