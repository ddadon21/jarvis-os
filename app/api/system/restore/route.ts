import { createClient } from "@supabase/supabase-js";
import {
  appendRuntimeEvent,
  FinanceRuntimeState,
  getFinanceState,
  getLatestPulse,
  getWorkforceState,
  JarvisPulse,
  RuntimeEvent,
  setFinanceState,
  setLatestPulse,
  setWorkforceState,
  WorkforceState,
} from "../../../../lib/jarvis-runtime";
import {
  getTradingState,
  restoreTradingState,
  TradingRuntimeState,
} from "../../../../lib/trading-runtime";

export const runtime = "nodejs";

const fallbackUrl = "https://cubkgxdhkehmzczbvczy.supabase.co";
const fallbackPublishableKey = "sb_publishable_90f_kCgqpgfC8NvoviAyXg_anParHd2";

type RestoreBody = {
  finance?: FinanceRuntimeState | null;
  workforce?: WorkforceState | null;
  trading?: TradingRuntimeState | null;
  pulse?: JarvisPulse | null;
  events?: RuntimeEvent[];
};

function timestamp(value: string | null | undefined) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

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

  const { data: membership, error: membershipError } = await supabase
    .from("jarvis_workspace_members")
    .select("workspace_id,role")
    .eq("user_id", userData.user.id)
    .limit(1)
    .maybeSingle();

  if (membershipError || !membership?.workspace_id) {
    return Response.json({ ok: false, error: "Workspace access required" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as RestoreBody;
  const restored = {
    finance: false,
    workforce: false,
    trading: false,
    pulse: false,
    events: 0,
  };

  if (body.finance?.version === 1) {
    const current = await getFinanceState();
    if (!current || timestamp(body.finance.asOf) >= timestamp(current.asOf)) {
      await setFinanceState(body.finance);
      restored.finance = true;
    }
  }

  if (body.workforce?.version === 1) {
    const current = await getWorkforceState();
    const candidateTime = timestamp(body.workforce.lastCycleAt);
    const currentTime = timestamp(current?.lastCycleAt);
    const shouldRestore =
      !current ||
      candidateTime > currentTime ||
      (candidateTime === currentTime && current.status === "STARTING" && body.workforce.status !== "STARTING");
    if (shouldRestore) {
      await setWorkforceState(body.workforce);
      restored.workforce = true;
    }
  }

  if (body.trading?.version === 1 && body.trading.account) {
    const current = await getTradingState();
    const candidateTime = timestamp(body.trading.account.lastObservedAt);
    const currentTime = timestamp(current.account.lastObservedAt);
    const shouldRestore =
      candidateTime > currentTime ||
      (!current.account.lastObservedAt && Boolean(body.trading.account.lastObservedAt)) ||
      (current.account.connection === "DISCONNECTED" && body.trading.account.connection !== "DISCONNECTED");
    if (shouldRestore) {
      await restoreTradingState(body.trading);
      restored.trading = true;
    }
  }

  if (body.pulse?.id && body.pulse.ranAt) {
    const current = await getLatestPulse();
    if (!current || timestamp(body.pulse.ranAt) >= timestamp(current.ranAt)) {
      await setLatestPulse(body.pulse);
      restored.pulse = true;
    }
  }

  if (Array.isArray(body.events)) {
    for (const event of body.events.slice(0, 100).reverse()) {
      if (!event?.id || !event?.type || !event?.summary || !event?.occurredAt) continue;
      await appendRuntimeEvent(event);
      restored.events += 1;
    }
  }

  return Response.json({ ok: true, restored });
}
