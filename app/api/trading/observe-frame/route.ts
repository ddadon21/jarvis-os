import { generateText } from "ai";
import { getTradingState, ingestTradingObservation, type JournalTrade, type TradingObservationInput } from "../../../../lib/trading-runtime";
import { authenticateObserverDevice, markObserverFrame } from "../../../../lib/trading-device-link";

export const runtime = "nodejs";

const GATEWAY_PRIMARY_MODEL = "google/gemini-3.6-flash";
const GATEWAY_FALLBACK_MODELS = ["openai/gpt-5.6-sol", "anthropic/claude-opus-5"] as const;
const DIRECT_ANTHROPIC_MODEL = "claude-opus-5";
const MAX_BASE64_CHARS = 8_000_000;

const FRAME_READ_SCHEMA = {
  type: "object",
  properties: {
    brokerPanelVisible: { type: "boolean" },
    positionStatus: { type: "string", enum: ["FLAT", "PENDING", "OPEN", "UNKNOWN"] },
    symbol: { anyOf: [{ type: "string" }, { type: "null" }] },
    orderType: { anyOf: [{ type: "string", enum: ["LIMIT", "STOP", "MARKET"] }, { type: "null" }] },
    side: { anyOf: [{ type: "string", enum: ["LONG", "SHORT"] }, { type: "null" }] },
    quantity: { anyOf: [{ type: "number" }, { type: "null" }] },
    entryPrice: { anyOf: [{ type: "number" }, { type: "null" }] },
    currentPrice: { anyOf: [{ type: "number" }, { type: "null" }] },
    stopPrice: { anyOf: [{ type: "number" }, { type: "null" }] },
    targetPrice: { anyOf: [{ type: "number" }, { type: "null" }] },
    openPnl: { anyOf: [{ type: "number" }, { type: "null" }] },
    tradeRealizedPnl: { anyOf: [{ type: "number" }, { type: "null" }] },
    balance: { anyOf: [{ type: "number" }, { type: "null" }] },
    equity: { anyOf: [{ type: "number" }, { type: "null" }] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    evidence: { type: "array", items: { type: "string" }, maxItems: 8 },
    note: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: [
    "brokerPanelVisible", "positionStatus", "symbol", "orderType", "side", "quantity",
    "entryPrice", "currentPrice", "stopPrice", "targetPrice", "openPnl",
    "tradeRealizedPnl", "balance", "equity", "confidence", "evidence", "note",
  ],
  additionalProperties: false,
} as const;

type FrameRead = {
  brokerPanelVisible: boolean;
  positionStatus: "FLAT" | "PENDING" | "OPEN" | "UNKNOWN";
  symbol: string | null;
  orderType: "LIMIT" | "STOP" | "MARKET" | null;
  side: "LONG" | "SHORT" | null;
  quantity: number | null;
  entryPrice: number | null;
  currentPrice: number | null;
  stopPrice: number | null;
  targetPrice: number | null;
  openPnl: number | null;
  tradeRealizedPnl: number | null;
  balance: number | null;
  equity: number | null;
  confidence: number;
  evidence: string[];
  note: string | null;
};

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const deviceId = request.headers.get("x-jarvis-device-id");
  const legacySecret = process.env.JARVIS_TRADING_SECRET;
  const legacyAuthorized = Boolean(legacySecret && bearer === legacySecret);
  const deviceAuthorized = deviceId && bearer ? await authenticateObserverDevice(deviceId, bearer) : null;

  if (!legacyAuthorized && !deviceAuthorized) {
    return Response.json({ ok: false, error: "Observer device is not securely paired." }, { status: 401 });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? null;

  const body = await request.json().catch(() => null) as null | {
    capturedAt?: string;
    imageBase64?: string;
    visualDifference?: number;
    source?: string;
    observerVersion?: string;
    semanticText?: string | null;
  };

  if (!body || typeof body.imageBase64 !== "string" || body.imageBase64.length === 0 || body.imageBase64.length > MAX_BASE64_CHARS) {
    return Response.json({ ok: false, error: "Invalid observer frame." }, { status: 400 });
  }

  const capturedAt = normalizeDate(body.capturedAt) ?? new Date().toISOString();

  // A valid, authenticated screenshot reached Jarvis. Record that transport-level
  // success independently from whether the vision model can interpret the frame.
  if (deviceId && bearer && deviceAuthorized) {
    await markObserverFrame(deviceId, bearer, body.observerVersion ?? null);
  }

  const previous = await getTradingState();
  let frame: FrameRead;
  try {
    frame = await inspectFrame(
      body.imageBase64,
      anthropicKey,
      previous,
      typeof body.semanticText === "string" ? body.semanticText.slice(0, 12000) : null,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown observer vision error.";
    console.error("Observer frame parse degraded:", message);
    frame = {
      brokerPanelVisible: false,
      positionStatus: "UNKNOWN",
      symbol: null,
      orderType: null,
      side: null,
      quantity: null,
      entryPrice: null,
      currentPrice: null,
      stopPrice: null,
      targetPrice: null,
      openPnl: null,
      tradeRealizedPnl: null,
      balance: null,
      equity: null,
      confidence: 0,
      evidence: ["Frame reached Jarvis but visual parsing did not produce a reliable structured result."],
      note: message.slice(0, 300),
    };

    const state = await ingestTradingObservation({
      connection: "OBSERVING",
      observer: {
        status: "UNKNOWN",
        symbol: null,
        side: null,
        quantity: null,
        orderType: null,
        entryPrice: null,
        currentPrice: null,
        stopPrice: null,
        targetPrice: null,
        openPnl: null,
        confidence: 0,
        observedAt: capturedAt,
        evidence: frame.evidence,
      },
      observedAt: capturedAt,
    });

    return Response.json({
      ok: true,
      accepted: false,
      reason: "Frame received, but visual parsing was inconclusive.",
      frame,
      state: {
        connection: state.account.connection,
        observer: state.observer,
      },
    });
  }

  if (!frame.brokerPanelVisible || frame.confidence < 0.55) {
    const state = await ingestTradingObservation({
      connection: "OBSERVING",
      observer: {
        status: "UNKNOWN",
        symbol: null,
        side: null,
        quantity: null,
        orderType: null,
        entryPrice: null,
        currentPrice: null,
        stopPrice: null,
        targetPrice: null,
        openPnl: null,
        confidence: frame.confidence,
        observedAt: capturedAt,
        evidence: frame.evidence,
      },
      observedAt: capturedAt,
    });

    return Response.json({
      ok: true,
      accepted: false,
      reason: !frame.brokerPanelVisible ? "Tradovate/broker state was not clearly visible." : "Frame confidence was too low to update trading state.",
      frame,
      state: {
        connection: state.account.connection,
        observer: state.observer,
      },
    });
  }

  const observation = mapFrameToObservation(frame, capturedAt, previous.openTrades);
  const state = await ingestTradingObservation(observation);

  return Response.json({
    ok: true,
    accepted: true,
    frame,
    state: {
      connection: state.account.connection,
      activeGoal: state.activeGoal,
      observer: state.observer,
      openTrades: state.openTrades,
      today: state.today,
    },
  });
}

async function inspectFrame(
  imageBase64: string,
  anthropicKey: string | null,
  previous: Awaited<ReturnType<typeof getTradingState>>,
  semanticText: string | null,
): Promise<FrameRead> {
  const prompt = `You are the visual parser for Jarvis Trading Observer.
Inspect ONLY what is visibly shown in this TradingView Desktop screenshot, especially the Tradovate broker/order/position panel.

Do not infer hidden values. Do not guess a trade from chart direction alone. If a value is not clearly readable, return null. Account numbers must never be returned. Ignore unrelated windows if any appear.

Previous Jarvis trading state, provided only to help distinguish an existing position from a new one:
${JSON.stringify({ account: previous.account, observer: previous.observer, openTrades: previous.openTrades })}

Windows accessibility text from the SAME TradingView window may be included below. Treat it as supporting evidence only and prefer exact values when it clearly labels broker/order/position state. Never treat unrelated watchlist quotes as a position.
${semanticText ?? "(no accessibility text available)"}

Return the structured frame state requested by the schema.

Rules:
- confidence is 0 to 1.
- Set positionStatus OPEN only when the broker UI visibly shows a non-zero live position.
- Set PENDING when a working entry order is visibly resting but no live position is shown. A visible label such as Buy/Sell + quantity + Limit/Stop is strong pending-order evidence.
- Set FLAT only when the broker UI visibly indicates no position and no working entry order.
- tradeRealizedPnl must be the result of the just-closed trade only if the UI makes that explicit; otherwise null.
- Stop/target must correspond to the live position or its working exit orders, not random chart labels.
- Never fabricate strategy reasoning, setup quality, HTF bias, liquidity, confidence level, or rule adherence.`;

  let gatewayFailure: string | null = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const result = await generateText({
        model: GATEWAY_PRIMARY_MODEL,
        abortSignal: controller.signal,
        maxOutputTokens: 1000,
        maxRetries: 0,
        providerOptions: {
          gateway: {
            models: [...GATEWAY_FALLBACK_MODELS],
          },
        },
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text: prompt + "\nReturn ONLY valid JSON matching the requested frame schema. No markdown fences or commentary.",
            },
            {
              type: "image",
              image: `data:image/jpeg;base64,${imageBase64}`,
              mediaType: "image/jpeg",
            },
          ],
        }],
      });

      const parsed = normalizeFrameRead(parseJson(result.text));
      console.info("Observer vision parsed", {
        provider: "vercel-ai-gateway",
        requestedModel: GATEWAY_PRIMARY_MODEL,
        confidence: parsed.confidence,
        status: parsed.positionStatus,
      });
      return parsed;
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    gatewayFailure = error instanceof Error ? error.message : "Unknown AI Gateway error.";
    console.error("Observer gateway vision degraded:", gatewayFailure);
  }

  if (!anthropicKey) {
    throw new Error(gatewayFailure ?? "AI Gateway vision failed and no direct Anthropic fallback is configured.");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: DIRECT_ANTHROPIC_MODEL,
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: imageBase64 },
          },
          { type: "text", text: prompt + "\nReturn ONLY valid JSON matching the requested frame schema." },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    const prefix = gatewayFailure ? `Gateway also failed: ${gatewayFailure.slice(0, 240)}. ` : "";
    throw new Error(`${prefix}Direct Anthropic observer vision failed (${response.status}): ${text.slice(0, 500)}`);
  }

  const payload = await response.json() as { content?: Array<{ type?: string; text?: string }> };
  const text = payload.content?.find((item) => item.type === "text")?.text ?? "";
  const parsed = normalizeFrameRead(parseJson(text));
  console.info("Observer vision parsed", {
    provider: "anthropic-direct-fallback",
    model: DIRECT_ANTHROPIC_MODEL,
    confidence: parsed.confidence,
    status: parsed.positionStatus,
  });
  return parsed;
}

function mapFrameToObservation(frame: FrameRead, observedAt: string, previousOpenTrades: JournalTrade[]): TradingObservationInput {
  const matchingOpen = previousOpenTrades.find((trade) =>
    frame.symbol && trade.symbol.toUpperCase() === frame.symbol.toUpperCase() && (!frame.side || trade.side === frame.side),
  ) ?? previousOpenTrades[0];

  const trades: TradingObservationInput["trades"] = [];

  if (frame.positionStatus === "OPEN" && frame.symbol && frame.side && (frame.quantity ?? 0) > 0) {
    trades.push({
      id: matchingOpen?.id ?? `screen:${frame.symbol}:${frame.side}:${observedAt}`,
      externalId: null,
      symbol: frame.symbol,
      side: frame.side,
      quantity: frame.quantity ?? 0,
      status: "OPEN",
      entryPrice: frame.entryPrice,
      stopPrice: frame.stopPrice,
      targetPrice: frame.targetPrice,
      openedAt: matchingOpen?.openedAt ?? observedAt,
      source: "TradingView Desktop / Tradovate",
      notes: frame.note,
    });
  } else if (frame.positionStatus === "FLAT" && matchingOpen) {
    trades.push({
      ...matchingOpen,
      status: "CLOSED",
      quantity: 0,
      exitPrice: frame.currentPrice,
      closedAt: observedAt,
      realizedPnl: frame.tradeRealizedPnl,
      source: "TradingView Desktop / Tradovate",
      notes: frame.note,
    });
  }

  return {
    connection: "OBSERVING",
    observer: {
      status: frame.positionStatus,
      symbol: frame.symbol,
      side: frame.side,
      quantity: frame.quantity,
      orderType: frame.orderType,
      entryPrice: frame.entryPrice,
      currentPrice: frame.currentPrice,
      stopPrice: frame.stopPrice,
      targetPrice: frame.targetPrice,
      openPnl: frame.openPnl,
      confidence: frame.confidence,
      observedAt,
      evidence: frame.evidence,
    },
    provider: "Tradovate via TradingView Desktop",
    propFirm: "Lucid Trading",
    accountLabel: "CURRENT PROP ACCOUNT",
    stage: "PASS CURRENT ACCOUNT",
    balance: frame.balance,
    equity: frame.equity,
    openPnl: frame.openPnl ?? 0,
    trades,
    observedAt,
  };
}

function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("Claude observer returned no JSON object.");
  return JSON.parse(cleaned.slice(first, last + 1));
}

function normalizeFrameRead(value: unknown): FrameRead {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    brokerPanelVisible: v.brokerPanelVisible === true,
    positionStatus: v.positionStatus === "OPEN" || v.positionStatus === "PENDING" || v.positionStatus === "FLAT" ? v.positionStatus : "UNKNOWN",
    symbol: cleanString(v.symbol, 24),
    orderType: v.orderType === "LIMIT" || v.orderType === "STOP" || v.orderType === "MARKET" ? v.orderType : null,
    side: v.side === "LONG" || v.side === "SHORT" ? v.side : null,
    quantity: numberOrNull(v.quantity),
    entryPrice: numberOrNull(v.entryPrice),
    currentPrice: numberOrNull(v.currentPrice),
    stopPrice: numberOrNull(v.stopPrice),
    targetPrice: numberOrNull(v.targetPrice),
    openPnl: numberOrNull(v.openPnl),
    tradeRealizedPnl: numberOrNull(v.tradeRealizedPnl),
    balance: numberOrNull(v.balance),
    equity: numberOrNull(v.equity),
    confidence: Math.max(0, Math.min(1, typeof v.confidence === "number" && Number.isFinite(v.confidence) ? v.confidence : 0)),
    evidence: Array.isArray(v.evidence) ? v.evidence.filter((x): x is string => typeof x === "string").slice(0, 8).map((x) => x.slice(0, 160)) : [],
    note: cleanString(v.note, 300),
  };
}

function cleanString(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeDate(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}
