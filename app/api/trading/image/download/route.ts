import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const fallbackUrl = "https://cubkgxdhkehmzczbvczy.supabase.co";
const fallbackPublishableKey = "sb_publishable_90f_kCgqpgfC8NvoviAyXg_anParHd2";

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "trade-image.jpg";
}

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const attachmentId = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!attachmentId) return Response.json({ ok: false, error: "Missing attachment id" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || fallbackUrl;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    fallbackPublishableKey;

  const supabase = createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: attachment, error: attachmentError } = await supabase
    .from("jarvis_attachments")
    .select("workspace_id,bucket,object_path,file_name,mime_type")
    .eq("id", attachmentId)
    .eq("domain", "TRADING")
    .eq("entity_type", "trading_day")
    .maybeSingle();

  if (attachmentError || !attachment) {
    return Response.json({ ok: false, error: "Trade image not found" }, { status: 404 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("jarvis_workspace_members")
    .select("workspace_id")
    .eq("workspace_id", attachment.workspace_id)
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (membershipError || !membership) {
    return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { data: blob, error: downloadError } = await supabase.storage
    .from(String(attachment.bucket || "jarvis-attachments"))
    .download(String(attachment.object_path));

  if (downloadError || !blob) {
    return Response.json({ ok: false, error: "Could not load trade image" }, { status: 502 });
  }

  const bytes = await blob.arrayBuffer();
  const fileName = safeFileName(String(attachment.file_name || "trade-image.jpg"));

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": String(attachment.mime_type || blob.type || "image/jpeg"),
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
