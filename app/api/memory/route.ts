import { archiveMemory, listMemory, saveMemoryFacts } from "../../../lib/jarvis-memory";

export const runtime = "nodejs";

/** Owner-only: Jarvis long-term memory (list, add, retire). */
export async function GET() {
  return Response.json({ ok: true, facts: await listMemory(200) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { facts?: Array<{ domain: string; fact: string }> } | null;
  const saved = await saveMemoryFacts(Array.isArray(body?.facts) ? body!.facts.slice(0, 200) : [], "owner");
  return Response.json({ ok: true, saved });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ ok: false, error: "id is required" }, { status: 400 });
  return Response.json({ ok: await archiveMemory(id) });
}
