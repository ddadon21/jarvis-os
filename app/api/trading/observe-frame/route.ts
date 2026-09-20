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
  intentState: "NONE" | "PREPARING" | "ORDER_WORKING" | "POSITION_OPEN" | "UNKNOWN";
  orderTicketVisible: boolean;
};

type SemanticExecutionRead = {
  frame: FrameRead;
  source: "semantic";
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

  const semanticText = typeof body.semanticText === "string" ? body.semanticText.slice(0, 20000) : null;
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

  const ocrExecution = semanticText ? inspectLocalOcrExecution(semanticText) : null;
  const accessibilityExecution = semanticText ? inspectSemanticExecution(semanticText) : null;
  const semanticExecution =
    ocrExecution && (
      ocrExecution.frame.positionStatus === "PENDING" ||
      ocrExecution.frame.positionStatus === "OPEN" ||
      ocrExecution.frame.intentState === "PREPARING"
    )
      ? ocrExecution
      : accessibilityExecution;

  // A valid, authenticated screenshot reached Jarvis. Record that transport-level
  // success independently from whether the vision model can interpret the frame.
  if (deviceId && bearer && deviceAuthorized) {
    await markObserverFrame(deviceId, bearer, body.observerVersion ?? null);
  }

  const previous = await getTradingState();
  const observerVersion = typeof body.observerVersion === "string" ? body.observerVersion : "";

  const previousWasLocallyConfirmedOpen =
    previous.observer?.status === "OPEN" &&
    previous.observer.evidence.some((item) => item.includes("Local Windows OCR confirmed a live TradingView position"));

  if (
    ocrExecution?.frame.positionStatus === "FLAT" &&
    (previous.observer?.status === "PENDING" || previousWasLocallyConfirmedOpen) &&
    accessibilityExecution?.frame.positionStatus !== "PENDING"
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

  if (semanticExecution?.frame.positionStatus === "PENDING" || semanticExecution?.frame.positionStatus === "OPEN") {
    const frame = mergeSemanticWithPrevious(semanticExecution.frame, previous.observer);
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
      source: ocrExecution?.frame.positionStatus === "PENDING" || ocrExecution?.frame.positionStatus === "OPEN" ? "local-ocr" : "semantic",
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

  if (semanticExecution?.frame.intentState === "PREPARING") {
    const frame = semanticExecution.frame;
    const state = await ingestTradingObservation({
      connection: "OBSERVING",
      observer: {
        status: "UNKNOWN",
        symbol: frame.symbol,
        side: frame.side,
        quantity: frame.quantity,
        orderType: frame.orderType,
        entryPrice: frame.entryPrice,
        currentPrice: null,
        stopPrice: frame.stopPrice,
        targetPrice: frame.targetPrice,
        openPnl: null,
        confidence: frame.confidence,
        observedAt: capturedAt,
        evidence: frame.evidence,
        intentState: "PREPARING",
        orderTicketVisible: true,
      },
      observedAt: capturedAt,
    });

    return Response.json({
      ok: true,
      accepted: true,
      source: "semantic-preparing",
      frame,
      state: {
        connection: state.account.connection,
        observer: state.observer,
        guardrails: state.guardrails,
        openTrades: state.openTrades,
        today: state.today,
      },
    });
  }

  let frame: FrameRead;
  try {
    frame = await inspectFrame(
      body.imageBase64,
      anthropicKey,
      previous,
      semanticText,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown observer vision error.";
    console.error("Observer frame parse degraded:", message);
    frame = semanticExecution?.frame
      ? mergeSemanticWithPrevious(semanticExecution.frame, previous.observer)
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
        observedAt: preserveConfirmedExecution && !semanticExecution
          ? previous.observer?.observedAt ?? capturedAt
          : capturedAt,
        evidence: frame.evidence,
        intentState: frame.intentState,
        orderTicketVisible: frame.orderTicketVisible,
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

function inspectLocalOcrExecution(semanticText: string): SemanticExecutionRead | null {
  const line = semanticText
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.startsWith("JARVIS_OCR_EXECUTION|"));

  if (!line) return null;

  const fields = Object.fromEntries(
    line
      .split("|")
      .slice(1)
      .map((part) => {
        const index = part.indexOf("=");
        return index > 0 ? [part.slice(0, index), part.slice(index + 1)] : [part, ""];
      }),
  );

  if (fields.STATUS === "FLAT") {
    return {
      source: "semantic",
      frame: {
        brokerPanelVisible: true,
        positionStatus: "FLAT",
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
        confidence: 0.96,
        evidence: ["Local TradingView OCR confirmed the previously visible working order disappeared across consecutive scans."],
        note: "Local execution reader confirmed no working order remains.",
        intentState: "NONE",
        orderTicketVisible: false,
      },
    };
  }

  if (fields.STATUS !== "PENDING" && fields.STATUS !== "OPEN" && fields.STATUS !== "PREPARING") return null;

  const side = fields.SIDE === "LONG" || fields.SIDE === "SHORT" ? fields.SIDE : null;
  const orderType = fields.TYPE === "LIMIT" || fields.TYPE === "STOP" || fields.TYPE === "MARKET" ? fields.TYPE : null;
  const quantity = parseSemanticNumber(fields.QTY);
  const entryPrice = parseSemanticNumber(fields.ENTRY);
  const stopPrice = parseSemanticNumber(fields.STOP);
  const targetPrice = parseSemanticNumber(fields.TARGET);
  const symbol = normalizeTradingSymbol(fields.SYMBOL || null);

  const isOpen = fields.STATUS === "OPEN";
  const isPreparing = fields.STATUS === "PREPARING";
  const detailCount = [symbol, side, quantity, orderType, entryPrice, stopPrice, targetPrice].filter((value) => value != null).length;
  return {
    source: "semantic",
    frame: {
      brokerPanelVisible: true,
      positionStatus: isOpen ? "OPEN" : isPreparing ? "UNKNOWN" : "PENDING",
      symbol,
      orderType,
      side,
      quantity,
      entryPrice,
      currentPrice: null,
      stopPrice,
      targetPrice,
      openPnl: null,
      tradeRealizedPnl: null,
      balance: null,
      equity: null,
      confidence: detailCount >= 6 ? 0.995 : detailCount >= 4 ? 0.97 : 0.86,
      evidence: [
        isOpen
          ? "Local Windows OCR confirmed a live TradingView position."
          : isPreparing
            ? "Local Windows OCR read the draft TradingView order before submission."
            : "Local Windows OCR read the visible TradingView working order."
      ],
      note: isOpen
        ? "Live position detected locally from TradingView."
        : isPreparing
          ? "Preparing order details detected locally from TradingView."
          : "Pending order detected locally from TradingView.",
      intentState: isOpen ? "POSITION_OPEN" : isPreparing ? "PREPARING" : "ORDER_WORKING",
      orderTicketVisible: !isOpen,
    },
  };
}

function parseSemanticNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function inspectSemanticExecution(semanticText: string): SemanticExecutionRead | null {
  const text = semanticText.replace(/\r/g, "");
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const evidence = semanticOrderEvidence(lines);
  const hasQuantityEditor = lines.some((line) => /\bedit\s*\|\s*quantity\b/i.test(line) || /\bchange order quantity\b/i.test(line));
  const hasOrderTypeControl = lines.some((line) => /\bchange order type\b/i.test(line));
  const orderTicketVisible = hasQuantityEditor || hasOrderTypeControl;
  const details = extractSemanticOrderDetails(lines);

  if (evidence.cancelControl) {
    const facts: string[] = ["TradingView accessibility confirms a working order."];
    if (details.side && details.quantity && details.symbol && details.orderType && details.entryPrice != null) {
      facts.unshift(
        `TradingView reports ${details.side === "LONG" ? "Buy" : "Sell"} ${details.quantity} ${details.symbol} @ ${details.entryPrice} ${details.orderType.toLowerCase()}.`
      );
    }

    return {
      source: "semantic",
      frame: {
        brokerPanelVisible: true,
        positionStatus: "PENDING",
        symbol: details.symbol,
        orderType: details.orderType,
        side: details.side,
        quantity: details.quantity,
        entryPrice: details.entryPrice,
        currentPrice: null,
        stopPrice: details.stopPrice,
        targetPrice: details.targetPrice,
        openPnl: null,
        tradeRealizedPnl: null,
        balance: null,
        equity: null,
        confidence: details.entryPrice != null && details.quantity != null && details.symbol ? 0.98 : 0.92,
        evidence: facts,
        note: "Working order detected directly from TradingView accessibility order text.",
        intentState: "ORDER_WORKING",
        orderTicketVisible: true,
      },
    };
  }

  if (orderTicketVisible || evidence.explicitOrder) {
    return {
      source: "semantic",
      frame: {
        brokerPanelVisible: true,
        positionStatus: "UNKNOWN",
        symbol: details.symbol,
        orderType: details.orderType,
        side: details.side,
        quantity: details.quantity,
        entryPrice: details.entryPrice,
        currentPrice: null,
        stopPrice: details.stopPrice,
        targetPrice: details.targetPrice,
        openPnl: null,
        tradeRealizedPnl: null,
        balance: null,
        equity: null,
        confidence: 0.78,
        evidence: ["TradingView accessibility shows active order-entry controls; Jarvis classifies this as order preparation, not a submitted order."],
        note: "Order preparation detected from TradingView accessibility state.",
        intentState: "PREPARING",
        orderTicketVisible: true,
      },
    };
  }

  return null;
}

function executionDetailScore(frame: Pick<FrameRead, "symbol" | "orderType" | "side" | "quantity" | "entryPrice" | "stopPrice" | "targetPrice">) {
  return [
    frame.symbol,
    frame.orderType,
    frame.side,
    frame.quantity,
    frame.entryPrice,
    frame.stopPrice,
    frame.targetPrice,
  ].filter((value) => value != null).length;
}

function mergeSemanticWithPrevious(
  frame: FrameRead,
  previous: Awaited<ReturnType<typeof getTradingState>>["observer"] | undefined,
): FrameRead {
  if (!previous || (previous.status !== "PENDING" && previous.status !== "OPEN")) return frame;

  const currentScore = executionDetailScore(frame);
  const previousScore = executionDetailScore(previous);
  const preferPrevious = previousScore > currentScore;

  return {
    ...frame,
    symbol: preferPrevious ? previous.symbol ?? frame.symbol : frame.symbol ?? previous.symbol,
    orderType: preferPrevious ? previous.orderType ?? frame.orderType : frame.orderType ?? previous.orderType,
    side: preferPrevious ? previous.side ?? frame.side : frame.side ?? previous.side,
    quantity: preferPrevious ? previous.quantity ?? frame.quantity : frame.quantity ?? previous.quantity,
    entryPrice: preferPrevious ? previous.entryPrice ?? frame.entryPrice : frame.entryPrice ?? previous.entryPrice,
    currentPrice: frame.currentPrice ?? previous.currentPrice,
    stopPrice: preferPrevious ? previous.stopPrice ?? frame.stopPrice : frame.stopPrice ?? previous.stopPrice,
    targetPrice: preferPrevious ? previous.targetPrice ?? frame.targetPrice : frame.targetPrice ?? previous.targetPrice,
    openPnl: frame.openPnl ?? previous.openPnl,
    confidence: preferPrevious ? Math.max(frame.confidence, previous.confidence) : frame.confidence,
    evidence: [...frame.evidence, ...previous.evidence].filter((item, index, all) => all.indexOf(item) === index).slice(0, 8),
  };
}

function extractSemanticOrderDetails(lines: string[]): Pick<FrameRead, "symbol" | "orderType" | "side" | "quantity" | "entryPrice" | "stopPrice" | "targetPrice"> {
  const normalizedLines = lines
    .map((line) => line.split("|").map((part) => part.trim()))
    .flat()
    .filter(Boolean);

  const orderPattern = /^(Buy|Sell)\s+(\d+(?:\.\d+)?)\s+([A-Z]{1,8}[A-Z0-9!]{0,10})\s+@\s+([\d,]+(?:\.\d+)?)\s+(limit|stop|market)\b(?:\s+([\d,]+(?:\.\d+)?)\s+limit\b)?/i;
  const parsed = normalizedLines
    .map((text) => {
      const match = text.match(orderPattern);
      if (!match) return null;
      return {
        action: match[1].toUpperCase() as "BUY" | "SELL",
        quantity: Number(match[2]),
        contract: match[3].toUpperCase(),
        price: Number(match[4].replace(/,/g, "")),
        type: match[5].toUpperCase() as "LIMIT" | "STOP" | "MARKET",
        secondaryLimitPrice: match[6] ? Number(match[6].replace(/,/g, "")) : null,
        raw: text,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter((item, index, all) => all.findIndex((other) => other.raw === item.raw) === index);

  const protectiveStop = parsed.find((item) => item.type === "STOP") ?? null;
  const inferredEntryAction: "BUY" | "SELL" | null =
    protectiveStop?.action === "SELL" ? "BUY" :
    protectiveStop?.action === "BUY" ? "SELL" :
    null;

  const entry =
    (inferredEntryAction
      ? parsed.find((item) => item.action === inferredEntryAction && item.type === "LIMIT")
        ?? parsed.find((item) => item.action === inferredEntryAction && item.type === "STOP")
      : null) ??
    parsed.find((item) => item.type === "LIMIT") ??
    parsed.find((item) => item.type === "STOP") ??
    parsed.find((item) => item.type === "MARKET");

  if (!entry) {
    const ocrRows = parseLocalOcrRows(lines);
    const addOrder = normalizedLines
      .map((text) => text.match(/^Add order on\s+([A-Z0-9!\s]{1,20}?)\s+at\s+([\d,]+(?:\.\d+)?)/i))
      .find(Boolean);

    const orderTypeAnchor = ocrRows.find((row) => /\bchange order type\b/i.test(row.text)) ?? null;
    const quantityAnchor =
      ocrRows.find((row) => /\bchange order quantity\b/i.test(row.text))
      ?? ocrRows.find((row) => /^quantity$/i.test(row.text))
      ?? null;

    const lowerAction = ocrRows
      .filter((row) => row.y >= 450 && /^(buy|sell)$/i.test(row.text))
      .sort((a, b) => b.y - a.y)[0] ?? null;

    const side: "LONG" | "SHORT" | null =
      lowerAction?.text.toUpperCase() === "BUY" ? "LONG" :
      lowerAction?.text.toUpperCase() === "SELL" ? "SHORT" :
      null;

    const typeCandidates = orderTypeAnchor
      ? ocrRows
          .filter((row) => row.y >= orderTypeAnchor.y - 8 && row.y <= orderTypeAnchor.y + 130)
          .filter((row) => /^(limit|stop|market)$/i.test(row.text))
          .sort((a, b) => Math.abs(a.y - orderTypeAnchor.y) - Math.abs(b.y - orderTypeAnchor.y))
      : [];
    const orderType =
      typeCandidates.length === 1 || (typeCandidates.length > 1 && typeCandidates[0].y < typeCandidates[1].y - 12)
        ? typeCandidates[0].text.toUpperCase() as "LIMIT" | "STOP" | "MARKET"
        : null;

    const quantity = quantityAnchor ? nearestPlainNumber(ocrRows, quantityAnchor, 120, 70, 1, 1000) : null;
    const entryPrice = addOrder ? Number(addOrder[2].replace(/,/g, "")) : null;

    const stopAnchor = ocrRows.find((row) => /\bstop loss\b/i.test(row.text)) ?? null;
    const targetAnchor = ocrRows.find((row) => /\b(take profit|target)\b/i.test(row.text)) ?? null;
    const stopPrice = stopAnchor ? nearestPriceRow(ocrRows, stopAnchor, 180, 50) : null;
    const targetPrice = targetAnchor ? nearestPriceRow(ocrRows, targetAnchor, 180, 50) : null;

    const symbol =
      normalizeTradingSymbol(addOrder?.[1]?.replace(/\s+/g, "") ?? null)
      ?? inferSymbolFromOcrRows(ocrRows);

    return {
      symbol,
      orderType,
      side,
      quantity,
      entryPrice: Number.isFinite(entryPrice) ? entryPrice : null,
      stopPrice,
      targetPrice,
    };
  }

  const side: "LONG" | "SHORT" = entry.action === "BUY" ? "LONG" : "SHORT";
  const exitAction = side === "LONG" ? "SELL" : "BUY";

  const stopOrder = parsed.find((item) =>
    item.action === exitAction &&
    item.type === "STOP" &&
    item.contract === entry.contract &&
    item.quantity === entry.quantity
  ) ?? null;

  const targetOrder = parsed.find((item) =>
    item.action === exitAction &&
    item.type === "LIMIT" &&
    item.contract === entry.contract &&
    item.quantity === entry.quantity &&
    Math.abs(item.price - entry.price) > 0.000001
  ) ?? null;

  const ocrRows = parseLocalOcrRows(lines);
  const overlayStop = findRiskRewardPriceFromRows(ocrRows, true, entry.price);
  const overlayTarget = findRiskRewardPriceFromRows(ocrRows, false, entry.price);
  const fallbackStop =
    stopOrder && Number.isFinite(stopOrder.price) && Math.abs(stopOrder.price - entry.price) > 0.000001
      ? stopOrder.price
      : null;
  const fallbackTarget =
    targetOrder && Number.isFinite(targetOrder.price) && Math.abs(targetOrder.price - entry.price) > 0.000001
      ? targetOrder.price
      : null;

  return {
    symbol: normalizeTradingSymbol(entry.contract),
    orderType: entry.type,
    side,
    quantity: Number.isFinite(entry.quantity) ? entry.quantity : null,
    entryPrice: Number.isFinite(entry.price) ? entry.price : null,
    stopPrice: overlayStop ?? fallbackStop,
    targetPrice: overlayTarget ?? fallbackTarget,
  };
}

type LocalOcrRow = { x: number; y: number; w: number; h: number; text: string };

function parseLocalOcrRows(lines: string[]): LocalOcrRow[] {
  return lines
    .map((line) => {
      const match = line.match(/^JARVIS_OCR\|X=(-?\d+(?:\.\d+)?)\|Y=(-?\d+(?:\.\d+)?)\|W=(-?\d+(?:\.\d+)?)\|H=(-?\d+(?:\.\d+)?)\|TEXT=(.*)$/i);
      if (!match) return null;
      return {
        x: Number(match[1]),
        y: Number(match[2]),
        w: Number(match[3]),
        h: Number(match[4]),
        text: match[5].trim(),
      };
    })
    .filter((row): row is LocalOcrRow => Boolean(row));
}

function nearestPlainNumber(
  rows: LocalOcrRow[],
  anchor: LocalOcrRow,
  maxDx: number,
  maxDy: number,
  min: number,
  max: number,
): number | null {
  const candidate = rows
    .map((row) => ({
      row,
      value: /^\d+(?:\.\d+)?$/.test(row.text) ? Number(row.text) : null,
      dx: Math.abs((row.x + row.w / 2) - (anchor.x + anchor.w / 2)),
      dy: Math.abs((row.y + row.h / 2) - (anchor.y + anchor.h / 2)),
    }))
    .filter((item) => item.value != null && item.value >= min && item.value <= max)
    .filter((item) => item.dx <= maxDx && item.dy <= maxDy)
    .sort((a, b) => (a.dy * 4 + a.dx) - (b.dy * 4 + b.dx))[0];
  return candidate?.value ?? null;
}

function nearestPriceRow(
  rows: LocalOcrRow[],
  anchor: LocalOcrRow,
  maxDx: number,
  maxDy: number,
): number | null {
  const candidate = rows
    .map((row) => {
      const matches = row.text.match(/\b\d{1,3}(?:,\d{3})+(?:\.\d{1,4})?\b|\b\d{4,6}(?:\.\d{1,4})?\b/g) ?? [];
      const values = matches
        .map((raw) => Number(raw.replace(/,/g, "")))
        .filter((value) => Number.isFinite(value) && value >= 100 && value <= 1_000_000);
      return {
        row,
        value: values[0] ?? null,
        dx: Math.abs((row.x + row.w / 2) - (anchor.x + anchor.w / 2)),
        dy: Math.abs((row.y + row.h / 2) - (anchor.y + anchor.h / 2)),
      };
    })
    .filter((item) => item.value != null)
    .filter((item) => item.dx <= maxDx && item.dy <= maxDy)
    .sort((a, b) => (a.dy * 4 + a.dx) - (b.dy * 4 + b.dx))[0];
  return candidate?.value ?? null;
}

function inferSymbolFromOcrRows(rows: LocalOcrRow[]): string | null {
  const text = rows.slice(0, 160).map((row) => row.text).join(" ");
  if (/Micro.*Nasdaq.*100/i.test(text)) return "MNQ";
  if (/Nasdaq.*100/i.test(text)) return "NQ";
  if (/Micro.*S\s*&?\s*P/i.test(text)) return "MES";
  if (/E-?mini.*S\s*&?\s*P/i.test(text)) return "ES";
  if (/Micro.*Dow/i.test(text)) return "MYM";
  if (/E-?mini.*Dow/i.test(text)) return "YM";
  if (/Micro.*Russell/i.test(text)) return "M2K";
  if (/Russell.*2000/i.test(text)) return "RTY";
  if (/Micro.*Gold/i.test(text)) return "MGC";
  if (/Gold.*Futures/i.test(text)) return "GC";
  if (/Micro.*Crude/i.test(text)) return "MCL";
  if (/Crude.*Oil/i.test(text)) return "CL";

  for (const row of rows.slice(0, 160)) {
    const contract = row.text.toUpperCase().match(/\b([A-Z]{1,5}[FGHJKMNQUVXZ]\d{2,4})\b/);
    if (contract) {
      const normalized = normalizeTradingSymbol(contract[1]);
      if (normalized) return normalized;
    }

    const ticker = row.text.toUpperCase().match(/\b([A-Z0-9]{2,6}[1I]?!?)\b/);
    if (ticker) {
      const normalized = normalizeOcrTicker(ticker[1]);
      if (normalized) return normalized;
    }
  }

  return null;
}

function normalizeOcrTicker(raw: string | null): string | null {
  if (!raw) return null;
  const symbol = raw.toUpperCase().replace(/[^A-Z0-9!]/g, "");
  const known: Record<string, string> = {
    MNQ: "MNQ", MNQ1: "MNQ", MNQI: "MNQ", "MNQ1!": "MNQ", "MNQI!": "MNQ",
    NQ: "NQ", NQ1: "NQ", NQI: "NQ", "NQ1!": "NQ", "NQI!": "NQ",
    MES: "MES", MES1: "MES", MESI: "MES", "MES1!": "MES",
    ES: "ES", ES1: "ES", ESI: "ES", "ES1!": "ES",
    MYM: "MYM", MYM1: "MYM", MYMI: "MYM", "MYM1!": "MYM",
    YM: "YM", YM1: "YM", YMI: "YM", "YM1!": "YM",
    M2K: "M2K", RTY: "RTY", MGC: "MGC", GC: "GC",
    MCL: "MCL", CL: "CL", SIL: "SIL", SI: "SI",
    HG: "HG", ZB: "ZB", ZN: "ZN", ZF: "ZF", ZT: "ZT",
  };
  return known[symbol] ?? null;
}

function findRiskRewardPriceFromRows(
  rows: LocalOcrRow[],
  negative: boolean,
  entryPrice: number | null,
): number | null {
  const riskPattern = negative
    ? /(^|\s)-\s*\$?\d[\d,]*(?:\.\d+)?\s*(USD)?\b|\bstop loss\b/i
    : /(^|\s)\+\s*\$?\d[\d,]*(?:\.\d+)?\s*(USD)?\b|\b(take profit|target)\b/i;

  const anchors = rows.filter((row) => riskPattern.test(row.text));
  for (const anchor of anchors) {
    const value = nearestPriceRow(rows, anchor, 520, 55);
    if (value == null) continue;
    if (entryPrice == null) return value;
    if (negative && value < entryPrice) return value;
    if (!negative && value > entryPrice) return value;
  }
  return null;
}

function normalizeTradingSymbol(raw: string | null): string | null {
  if (!raw) return null;
  const symbol = raw.toUpperCase().replace(/[^A-Z0-9!]/g, "");
  const reserved = new Set(["CLASS", "BUTTON", "GROUP", "TEXT", "ORDER", "ORDERS", "POSITION", "POSITIONS", "BUY", "SELL"]);
  if (!symbol || reserved.has(symbol)) return null;

  const futuresContract = symbol.match(/^([A-Z]{1,5})[FGHJKMNQUVXZ]\d{2,4}$/);
  if (futuresContract) return futuresContract[1];

  const continuous = symbol.match(/^([A-Z]{1,5})\d?!$/);
  if (continuous) return continuous[1];

  if (/^[A-Z]{1,6}$/.test(symbol)) return symbol;
  return null;
}

function semanticOrderEvidence(lines: string[]) {
  const textParts = lines
    .map((line) => line.split("|").map((part) => part.trim()))
    .flat()
    .filter(Boolean);

  const explicitOrder = textParts.some((part) =>
    /^(Buy|Sell)\s+\d+(?:\.\d+)?\s+[A-Z]{1,8}[A-Z0-9!]{0,10}\s+@\s+[\d,]+(?:\.\d+)?\s+(limit|stop|market)\b/i.test(part)
  );
  const cancelControl = textParts.some((part) => /^Cancel project order$/i.test(part));
  return { explicitOrder, cancelControl };
}

function semanticShowsTradingSurface(semanticText: string) {
  return /\bOrders\b/i.test(semanticText) &&
    (/\bPositions\b/i.test(semanticText) || /\bBUY\b/i.test(semanticText) || /\bSELL\b/i.test(semanticText));
}

function isObserverVersionAtLeast(version: string, major: number, minor: number, patch: number) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])];
  const target = [major, minor, patch];
  for (let i = 0; i < 3; i++) {
    if (parts[i] > target[i]) return true;
    if (parts[i] < target[i]) return false;
  }
  return true;
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
- intentState PREPARING means an order ticket is visibly configured or being edited, but no working order is confirmed yet.
- intentState ORDER_WORKING means a pending entry order is visibly working.
- intentState POSITION_OPEN means a live position is visibly open.
- intentState NONE means no order preparation, pending order, or live position is visible.
- orderTicketVisible is true only when the ticket/order-entry controls are visibly open.
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
      intentState: frame.intentState,
      orderTicketVisible: frame.orderTicketVisible,
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
    symbol: normalizeTradingSymbol(cleanString(v.symbol, 24)),
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
    intentState:
      v.intentState === "NONE" || v.intentState === "PREPARING" || v.intentState === "ORDER_WORKING" || v.intentState === "POSITION_OPEN"
        ? v.intentState
        : "UNKNOWN",
    orderTicketVisible: v.orderTicketVisible === true,
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
