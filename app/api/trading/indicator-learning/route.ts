import { createClient } from "@supabase/supabase-js";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { appendRuntimeEvent, createRuntimeEvent } from "../../../../lib/jarvis-runtime";
import { getTradingState } from "../../../../lib/trading-runtime";

export const runtime = "nodejs";
export const maxDuration = 60;

const FALLBACK_URL = "https://cubkgxdhkehmzczbvczy.supabase.co";
const FALLBACK_PUBLISHABLE_KEY = "sb_publishable_90f_kCgqpgfC8NvoviAyXg_anParHd2";
const GATEWAY_PRIMARY_MODEL = "google/gemini-3.6-flash";
const GATEWAY_FALLBACK_MODELS = ["openai/gpt-5.6-sol", "anthropic/claude-opus-5"] as const;

type LearningResult = {
  summary: string;
  visualFindings: string[];
  alignmentWithRules: string[];
  indicatorHypotheses: string[];
  codeAction: "NO_CHANGE" | "COLLECT_MORE" | "TEST_CANDIDATE";
  confidence: number;
  whyNoCodeChange: string;
};

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as { tradingDayId?: string } | null;
  const tradingDayId = body?.tradingDayId?.trim() ?? "";
  if (!tradingDayId) return Response.json({ ok: false, error: "tradingDayId is required" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    FALLBACK_PUBLISHABLE_KEY;

  const supabase = createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: day, error: dayError } = await supabase
    .from("trading_days")
    .select("id,workspace_id,trade_date,realized_pnl,notes,feeling,trade_management,errors,session_rating,screenshot_count,metadata,updated_at")
    .eq("id", tradingDayId)
    .maybeSingle();

  if (dayError || !day) return Response.json({ ok: false, error: "Trading day not found" }, { status: 404 });

  const { data: membership, error: membershipError } = await supabase
    .from("jarvis_workspace_members")
    .select("workspace_id")
    .eq("workspace_id", day.workspace_id)
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (membershipError || !membership) {
    return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { data: attachments, error: attachmentError } = await supabase
    .from("jarvis_attachments")
    .select("id,object_path,file_name,mime_type,created_at")
    .eq("workspace_id", day.workspace_id)
    .eq("domain", "TRADING")
    .eq("entity_type", "trading_day")
    .eq("entity_id", tradingDayId)
    .order("created_at", { ascending: true })
    .limit(4);

  if (attachmentError) {
    return Response.json({ ok: false, error: "Could not load trade images" }, { status: 502 });
  }

  const tradeDate = String(day.trade_date ?? "");
  const nextDate = tradeDate && Number.isFinite(Date.parse(tradeDate + "T00:00:00.000Z"))
    ? new Date(Date.parse(tradeDate + "T00:00:00.000Z") + 86_400_000).toISOString()
    : null;
  const dayStart = tradeDate ? tradeDate + "T00:00:00.000Z" : null;
  let observerSnapshots: Array<Record<string, unknown>> = [];
  if (dayStart && nextDate) {
    const { data: snapshots } = await supabase
      .from("trading_observer_snapshots")
      .select("observed_at,connection,status,intent_state,symbol,side,quantity,order_type,entry_price,current_price,stop_price,target_price,open_pnl,confidence,evidence")
      .eq("workspace_id", day.workspace_id)
      .gte("observed_at", dayStart)
      .lt("observed_at", nextDate)
      .order("observed_at", { ascending: true })
      .limit(24);
    observerSnapshots = (snapshots ?? []) as Array<Record<string, unknown>>;
  }

  const notes = [
    String(day.notes ?? "").trim(),
    String(day.feeling ?? "").trim(),
    String(day.trade_management ?? "").trim(),
    String(day.errors ?? "").trim(),
  ].filter(Boolean);

  const imageRows = attachments ?? [];
  if (!imageRows.length && !notes.length) {
    return Response.json({ ok: true, skipped: true, reason: "No trading screenshots or notes to analyze yet." });
  }

  const fingerprint = [
    String(day.trade_date ?? ""),
    String(day.realized_pnl ?? ""),
    String(day.notes ?? ""),
    String(day.feeling ?? ""),
    String(day.trade_management ?? ""),
    String(day.errors ?? ""),
    String(day.session_rating ?? ""),
    String(day.screenshot_count ?? ""),
    ...imageRows.map((item) => String(item.id)),
  ].join("|");

  const metadata = day.metadata && typeof day.metadata === "object"
    ? { ...(day.metadata as Record<string, unknown>) }
    : {};
  const priorLearning = metadata.indicatorLearning && typeof metadata.indicatorLearning === "object"
    ? metadata.indicatorLearning as Record<string, unknown>
    : null;

  if (priorLearning?.fingerprint === fingerprint) {
    return Response.json({ ok: true, skipped: true, reason: "Evidence already analyzed.", learning: priorLearning });
  }

  const imageParts: Array<{ type: "image"; image: string; mediaType: string }> = [];
  for (const item of imageRows) {
    const { data: blob, error } = await supabase.storage
      .from("jarvis-attachments")
      .download(String(item.object_path));
    if (error || !blob) continue;
    if (blob.size > 5_000_000) continue;
    const bytes = Buffer.from(await blob.arrayBuffer());
    const mediaType = String(item.mime_type || blob.type || "image/jpeg");
    imageParts.push({
      type: "image",
      image: `data:${mediaType};base64,${bytes.toString("base64")}`,
      mediaType,
    });
  }

  const observer = await getTradingState();
  const observerContext = observer.observer
    ? {
        status: observer.observer.status,
        symbol: observer.observer.symbol,
        side: observer.observer.side,
        entryPrice: observer.observer.entryPrice,
        stopPrice: observer.observer.stopPrice,
        targetPrice: observer.observer.targetPrice,
        currentPrice: observer.observer.currentPrice,
        intentState: observer.observer.intentState,
        observedAt: observer.observer.observedAt,
      }
    : null;

  const prompt = `You are JARVIS Trading Research for Himie Johnson Ventures.

Analyze this trading-day evidence retrospectively to improve the user's TradingView indicator over time. This is research and software-evidence work, not a live trade recommendation.

CURRENT MANUAL FRAMEWORK:
1. 4H & 1D zones
2. Identify trend
3. Price hits HTF zone
4. Someone loses / liquidity is taken
5. Confirmation back
6. Look for entry

CURRENT DEVIANT BASELINE:
- Pine v6 baseline file: trading/indicators/deviant-refined-baseline-v1.pine
- CCI length 14, smoothing 10, threshold 30
- HMA period 34, speed 1.5, extreme lookback 10
- EMA 21
- ATR 14 with 0.8 multiplier
- minimum candle body 10 points
- maximum 3 arrows/day
- NY session 08:00-15:00
- bank levels every 250 points with 80-point wick-zone radius
- baseline file must NEVER be overwritten in place; future revisions must be new versioned files

TRADING DAY:
date=${day.trade_date}
realizedPnl=${day.realized_pnl ?? "unknown"}
rating=${day.session_rating ?? "unknown"}
notes=${String(day.notes ?? "")}
feeling=${String(day.feeling ?? "")}
tradeManagement=${String(day.trade_management ?? "")}
errors=${String(day.errors ?? "")}
screenshots=${imageRows.length}

OBSERVER EVIDENCE FROM THIS TRADING DAY:
${JSON.stringify(observerSnapshots)}

LATEST LIVE OBSERVER CONTEXT (use only if it plausibly matches the trading day):
${JSON.stringify(observerContext)}

RULES:
- Treat screenshots as evidence, not proof of a general rule.
- Describe only price-action details that are actually visible.
- Correlate pictures, journal notes, outcome, and Observer context when timestamps/symbols plausibly match.
- Look specifically for why an indicator arrow would have been useful, early, late, missing, or false.
- Prefer repeated structural ideas: HTF-zone interaction, liquidity sweep / someone loses, confirmation back, displacement, gap/imbalance, trend alignment, session timing, volatility, stop/target context.
- Do not propose code changes from one weak example.
- If evidence is thin, say COLLECT_MORE.
- Any eventual code change must be testable against the immutable baseline.

Return ONLY JSON:
{
  "summary": "short evidence-grounded synthesis",
  "visualFindings": ["..."],
  "alignmentWithRules": ["..."],
  "indicatorHypotheses": ["specific testable hypothesis, not a guaranteed edge"],
  "codeAction": "NO_CHANGE|COLLECT_MORE|TEST_CANDIDATE",
  "confidence": 0.0,
  "whyNoCodeChange": "why the baseline should or should not change yet"
}`;

  const contentParts: Array<
    { type: "text"; text: string } |
    { type: "image"; image: string; mediaType: string }
  > = [{ type: "text", text: prompt }, ...imageParts];

  let raw = "";
  if (process.env.OPENAI_API_KEY) {
    const result = await generateText({
      model: openai(process.env.JARVIS_INDICATOR_RESEARCH_MODEL || "gpt-5.6-sol"),
      abortSignal: AbortSignal.timeout(30_000),
      maxOutputTokens: 1600,
      maxRetries: 0,
      messages: [{ role: "user", content: contentParts }],
    });
    raw = result.text;
  } else {
    const result = await generateText({
      model: GATEWAY_PRIMARY_MODEL,
      abortSignal: AbortSignal.timeout(30_000),
      maxOutputTokens: 1400,
      maxRetries: 0,
      providerOptions: {
        gateway: { models: [...GATEWAY_FALLBACK_MODELS] },
      },
      messages: [{ role: "user", content: contentParts }],
    });
    raw = result.text;
  }

  const learning = normalizeLearning(parseJson(raw));
  const storedLearning = {
    ...learning,
    fingerprint,
    analyzedAt: new Date().toISOString(),
    screenshotCount: imageRows.length,
    observerObservedAt: observerContext?.observedAt ?? null,
    observerSnapshotCount: observerSnapshots.length,
    baseline: "deviant-refined-baseline-v1.pine",
  };

  const { error: updateError } = await supabase
    .from("trading_days")
    .update({
      metadata: {
        ...metadata,
        indicatorLearning: storedLearning,
      },
    })
    .eq("id", tradingDayId)
    .eq("workspace_id", day.workspace_id);

  if (updateError) {
    return Response.json({ ok: false, error: "Indicator research completed but could not be saved." }, { status: 502 });
  }

  const firstHypothesis = learning.indicatorHypotheses[0] ?? learning.whyNoCodeChange;
  await appendRuntimeEvent(createRuntimeEvent({
    type: "trading.indicator_evidence",
    domain: "TRADING",
    source: "jarvis.trading.indicator-learning",
    importance: learning.codeAction === "TEST_CANDIDATE" ? "IMPORTANT" : "NORMAL",
    summary: `${day.trade_date} · ${learning.codeAction} · ${learning.summary} · ${firstHypothesis}`,
  }));

  return Response.json({ ok: true, learning: storedLearning });
}

function parseJson(value: string) {
  const cleaned = value.trim().replace(/^\`\`\`json\s*/i, "").replace(/\`\`\`$/i, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function strings(value: unknown, max = 8) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim().slice(0, 500))
    .slice(0, max);
}

function normalizeLearning(value: Record<string, unknown>): LearningResult {
  const action =
    value.codeAction === "TEST_CANDIDATE" || value.codeAction === "NO_CHANGE"
      ? value.codeAction
      : "COLLECT_MORE";
  const confidenceRaw = typeof value.confidence === "number" ? value.confidence : 0;
  return {
    summary: typeof value.summary === "string" && value.summary.trim()
      ? value.summary.trim().slice(0, 900)
      : "Trading evidence was reviewed, but it did not support a strong structured conclusion.",
    visualFindings: strings(value.visualFindings),
    alignmentWithRules: strings(value.alignmentWithRules),
    indicatorHypotheses: strings(value.indicatorHypotheses, 6),
    codeAction: action,
    confidence: Math.max(0, Math.min(1, confidenceRaw)),
    whyNoCodeChange: typeof value.whyNoCodeChange === "string"
      ? value.whyNoCodeChange.trim().slice(0, 700)
      : "Keep collecting evidence before changing the indicator baseline.",
  };
}
