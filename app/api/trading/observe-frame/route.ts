import { isRichExecutionRead, mergeVisualWithSemantic, inspectLocalOcrExecution, inspectSemanticExecution, fuseExecutionReads, mergeSemanticWithPrevious, normalizeFrameRead, normalizeDate, type FrameRead } from "../../../../lib/trading-frame";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
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
    intentState: { type: "string", enum: ["NONE", "PREPARING", "ORDER_WORKING", "POSITION_OPEN", "UNKNOWN"] },
    orderTicketVisible: { type: "boolean" },
  },
  required: [
    "brokerPanelVisible", "positionStatus", "symbol", "orderType", "side", "quantity",
    "entryPrice", "currentPrice", "stopPrice", "targetPrice", "openPnl",
    "tradeRealizedPnl", "balance", "equity", "confidence", "evidence", "note",
    "intentState", "orderTicketVisible",
  ],
  additionalProperties: false,
} as const;

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

  const semanticText = typeof body.semanticText === "string" ? body.semanticText.slice(0, 60000) : null;
  if (semanticText) {
    const executionLines = semanticText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /\b(buy|sell|limit|stop|market|working|order|orders|position|positions|filled|cancel|qty|quantity)\b/i.test(line))
      .slice(0, 24);
    if (executionLines.length > 0) {
      console.info("Observer semantic execution sample", { lines: executionLines });
    }
  }

  const explicitlyNoPositions = /\b(no (?:open )?positions|positions\s*\(0\))\b/i.test(semanticText ?? "");
  const localRead = semanticText ? inspectLocalOcrExecution(semanticText) : null;
  // Old clients emit FLAT merely because their parser missed a position row.
  // Absence of a recognized order is not proof that the account is flat.
  const ocrExecution = localRead?.frame.positionStatus === "FLAT" && !explicitlyNoPositions ? null : localRead;
  const accessibilityExecution = semanticText ? inspectSemanticExecution(semanticText, ocrExecution?.frame.symbol) : null;
  const semanticExecution = fuseExecutionReads(ocrExecution, accessibilityExecution);

  // A valid, authenticated screenshot reached Jarvis. Record that transport-level
  // success independently from whether the vision model can interpret the frame.
  if (deviceId && bearer && deviceAuthorized) {
    await markObserverFrame(deviceId, bearer, body.observerVersion ?? null);
  }

  const previous = await getTradingState();
  const observerVersion = typeof body.observerVersion === "string" ? body.observerVersion : "";

  if (
    ocrExecution?.frame.positionStatus === "FLAT" &&
    (previous.observer?.status !== "OPEN" || explicitlyNoPositions) &&
    !accessibilityExecution
  ) {
    const flatFrame = ocrExecution.frame;
    const state = await ingestTradingObservation(mapFrameToObservation(flatFrame, capturedAt, previous.openTrades));
    console.info("Observer local OCR execution cleared", {
      status: "FLAT",
      priorStatus: previous.observer?.status,
      observerVersion,
    });
    return Response.json({
      ok: true,
      accepted: true,
      source: "local-ocr",
      frame: flatFrame,
      state: {
        connection: state.account.connection,
        observer: state.observer,
        guardrails: state.guardrails,
        openTrades: state.openTrades,
        today: state.today,
      },
    });
  }

  const preserveConfirmedExecution =
    !semanticExecution &&
    (previous.observer?.status === "PENDING" || previous.observer?.status === "OPEN");

  if (
    semanticExecution &&
    isRichExecutionRead(semanticExecution.frame) &&
    (
      semanticExecution.frame.positionStatus === "PENDING" ||
      semanticExecution.frame.positionStatus === "OPEN" ||
      semanticExecution.frame.intentState === "PREPARING"
    )
  ) {
    const frame = mergeSemanticWithPrevious(semanticExecution.frame, previous.observer, capturedAt);
    const observation = mapFrameToObservation(frame, capturedAt, previous.openTrades);
    const state = await ingestTradingObservation(observation);
    console.info(
      ocrExecution?.frame.positionStatus === "PENDING" || ocrExecution?.frame.positionStatus === "OPEN"
        ? "Observer local OCR execution accepted"
        : "Observer semantic execution accepted",
      {
      status: frame.positionStatus,
      intentState: frame.intentState,
      symbol: frame.symbol,
      side: frame.side,
      quantity: frame.quantity,
      orderType: frame.orderType,
      entryPrice: frame.entryPrice,
      stopPrice: frame.stopPrice,
      targetPrice: frame.targetPrice,
      evidence: frame.evidence,
    });
    return Response.json({
      ok: true,
      accepted: true,
      source: "screen-fused",
      frame,
      state: {
        connection: state.account.connection,
        activeGoal: state.activeGoal,
        observer: state.observer,
        guardrails: state.guardrails,
        openTrades: state.openTrades,
        today: state.today,
      },
    });
  }

  // Publish readable draft facts immediately; completing the screenshot through
  // vision must not delay the preparation state for an entire model round-trip.
  if (semanticExecution && (semanticExecution.frame.intentState === "PREPARING" || semanticExecution.frame.positionStatus === "PENDING" || semanticExecution.frame.positionStatus === "OPEN")) {
    await ingestTradingObservation(mapFrameToObservation(
      mergeSemanticWithPrevious(semanticExecution.frame, previous.observer, capturedAt), capturedAt, previous.openTrades,
    ));
  }

  let frame: FrameRead;
  try {
    frame = await inspectFrame(
      body.imageBase64,
      anthropicKey,
      previous,
      semanticText,
    );
    frame = mergeSemanticWithPrevious(mergeVisualWithSemantic(frame, semanticExecution?.frame ?? null), previous.observer, capturedAt);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown observer vision error.";
    console.error("Observer frame parse degraded:", message);
    frame = semanticExecution?.frame
      ? mergeSemanticWithPrevious(semanticExecution.frame, previous.observer, capturedAt)
      : (preserveConfirmedExecution && previous.observer ? {
      brokerPanelVisible: true,
      positionStatus: previous.observer.status,
      symbol: previous.observer.symbol,
      orderType: previous.observer.orderType,
      side: previous.observer.side,
      quantity: previous.observer.quantity,
      entryPrice: previous.observer.entryPrice,
      currentPrice: previous.observer.currentPrice,
      stopPrice: previous.observer.stopPrice,
      targetPrice: previous.observer.targetPrice,
      openPnl: previous.observer.openPnl,
      tradeRealizedPnl: null,
      balance: null,
      equity: null,
      confidence: Math.max(0.62, previous.observer.confidence * 0.98),
      evidence: [
        ...previous.observer.evidence.slice(0, 5),
        "Jarvis retained the last positively confirmed execution state because the current frame was inconclusive.",
      ].slice(0, 8),
      note: "Confirmed execution state retained until contrary evidence is observed.",
      intentState: previous.observer.status === "OPEN" ? "POSITION_OPEN" : "ORDER_WORKING",
      orderTicketVisible: previous.observer.orderTicketVisible ?? true,
    } : {
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
      intentState: "UNKNOWN",
      orderTicketVisible: false,
    });

    const state = await ingestTradingObservation({
      connection: "DEGRADED",
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
        observedAt: preserveConfirmedExecution && !semanticExecution
          ? previous.observer?.observedAt ?? capturedAt
          : capturedAt,
        evidence: frame.evidence,
        intentState: frame.intentState,
        orderTicketVisible: frame.orderTicketVisible,
        readingIssue: "Vision unavailable. Showing only confirmed screen readings.",
        detailsObservedAt: frame.detailsObservedAt ?? capturedAt,
      },
      observedAt: capturedAt,
    });

    return Response.json({
      ok: true,
      accepted: Boolean(semanticExecution),
      reason: semanticExecution
        ? "Visual parsing was unavailable; Jarvis preserved TradingView semantic execution state."
        : preserveConfirmedExecution
          ? "Visual parsing was inconclusive; Jarvis retained the last positively confirmed execution state."
          : "Frame received, but visual parsing was inconclusive.",
      frame,
      state: {
        connection: state.account.connection,
        observer: state.observer,
      },
    });
  }

  if ((!frame.brokerPanelVisible && frame.intentState !== "PREPARING") || frame.confidence < 0.55) {
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
        intentState: frame.intentState,
        orderTicketVisible: frame.orderTicketVisible,
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
Inspect ONLY what is visibly shown in this TradingView Desktop screenshot, including an unsubmitted on-chart order preview, hover widget, order ticket, or live position. A separate broker application is not required.

Do not infer hidden values. Do not guess a trade from chart direction alone. If a value is not clearly readable, return null. Account numbers must never be returned. Ignore unrelated windows if any appear.

Previous Jarvis trading state, provided only to help distinguish an existing position from a new one:
${JSON.stringify({ account: previous.account, observer: previous.observer, openTrades: previous.openTrades })}

Windows accessibility text from the SAME TradingView window may be included below. Treat it as supporting evidence only and prefer exact values when it clearly labels broker/order/position state. Never treat unrelated watchlist quotes as a position.
${semanticText ?? "(no accessibility text available)"}

Return the structured frame state requested by the schema.
${JSON.stringify(FRAME_READ_SCHEMA)}

Rules:
- confidence is 0 to 1.
- Set positionStatus OPEN only when the broker UI visibly shows a non-zero live position.
- Set PENDING only when a submitted working entry order is confirmed. Buy/Sell + quantity + Limit/Stop also appears on an UNPLACED preview; that text alone does not prove submission.
- Set FLAT only when the broker UI visibly indicates no position and no working entry order.
- intentState PREPARING means an order ticket is visibly configured or being edited, but no working order is confirmed yet.
- A hovering/on-chart draft with editable quantity/type is PREPARING even before submission and even when the broker panel is collapsed. Populate symbol, side, quantity, orderType, entryPrice, currentPrice, stopPrice, targetPrice from that draft now.
- In split charts, use ONLY the pane containing the active order/ticket. Never mix another pane, watchlist, browser tab, old position or previous-state values into this draft.
- Read each entry/stop/target from its own colored price-axis label aligned with its order line; ignore nearby indicator levels, crosshair prices and profit dollar amounts. Support both long and short setups.
- currentPrice means the visible last-traded/current chart price for the same symbol, NOT the average of the Buy/Sell quotes. If no current price is readable, return null.
- intentState ORDER_WORKING means a pending entry order is visibly working.
- intentState POSITION_OPEN means a live position is visibly open.
- intentState NONE means no order preparation, pending order, or live position is visible.
- orderTicketVisible is true only when the ticket/order-entry controls are visibly open.
- tradeRealizedPnl must be the result of the just-closed trade only if the UI makes that explicit; otherwise null.
- Stop/target must correspond to the live position or its working exit orders, not random chart labels.
- A position row with remaining quantity and live USD P&L establishes an OPEN position. “1 Sell Stop” and “1 Sell Limit” beside it are exits for a LONG, not a new short. BUY exits indicate SHORT. A live stop can be above a long entry or below a short entry after being moved to protect profit.
- Do not infer the filled entry's orderType from its protective exit labels; use null if it is no longer visible.
- Never fabricate strategy reasoning, setup quality, HTF bias, liquidity, confidence level, or rule adherence.`;

  let gatewayFailure: string | null = null;

  // Jarvis already uses a direct OpenAI credential for its chat/voice paths.
  // Give screen vision the same independent route instead of requiring Gateway
  // and Anthropic billing to both be healthy.
  if (process.env.OPENAI_API_KEY) {
    try {
      const result = await generateText({
        model: openai(process.env.JARVIS_OBSERVER_OPENAI_MODEL || "gpt-5.6-sol"),
        abortSignal: AbortSignal.timeout(12_000),
        maxOutputTokens: 1600,
        maxRetries: 0,
        messages: [{ role: "user", content: [
          { type: "text", text: prompt + "\nReturn ONLY the JSON object, with no markdown." },
          { type: "image", image: `data:image/jpeg;base64,${imageBase64}`, mediaType: "image/jpeg" },
        ] }],
      });
      const parsed = normalizeFrameRead(parseJson(result.text));
      console.info("Observer vision parsed", { provider: "openai-direct", status: parsed.positionStatus, intentState: parsed.intentState });
      return parsed;
    } catch (error) {
      console.error("Observer direct OpenAI vision degraded:", error instanceof Error ? error.message : "Unknown error");
    }
  }

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
    signal: AbortSignal.timeout(12_000),
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
  );
  const closingTrade = matchingOpen ?? (previousOpenTrades.length === 1 ? previousOpenTrades[0] : undefined);

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
  } else if (frame.positionStatus === "FLAT" && frame.intentState === "NONE" && closingTrade) {
    trades.push({
      ...closingTrade,
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
      intentState: frame.intentState,
      orderTicketVisible: frame.orderTicketVisible,
      readingIssue: null,
      detailsObservedAt: frame.detailsObservedAt ?? observedAt,
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
