import type { TradingObserverState } from "./trading-runtime";

export type FrameRead = {
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
  detailsObservedAt?: string;
};

export type SemanticExecutionRead = {
  frame: FrameRead;
  source: "semantic";
};


function executionReadCompleteness(frame: FrameRead): number {
  return [
    frame.symbol,
    frame.side,
    frame.quantity,
    frame.orderType,
    frame.entryPrice,
    frame.currentPrice,
    frame.stopPrice,
    frame.targetPrice,
  ].filter((value) => value != null).length;
}

export function isRichExecutionRead(frame: FrameRead): boolean {
  return (frame.intentState === "PREPARING" || frame.positionStatus === "PENDING" || frame.positionStatus === "OPEN")
    && executionReadCompleteness(frame) === 8 && (frame.quantity ?? 0) > 0;
}

function compatibleExecution(a: Pick<FrameRead, "symbol" | "side">, b: Pick<FrameRead, "symbol" | "side">) {
  return Boolean(a.symbol && b.symbol && a.symbol === b.symbol && (!a.side || !b.side || a.side === b.side));
}

export function mergeVisualWithSemantic(visual: FrameRead, semantic: FrameRead | null): FrameRead {
  if (!semantic) return visual;
  // A coherent visual read may explicitly clear a draft. Never refill it with
  // a stale OCR order, or combine facts from different split-screen instruments.
  if (visual.positionStatus === "FLAT" && visual.intentState === "NONE" && visual.confidence >= 0.55) return visual;
  if (!compatibleExecution(visual, semantic)) {
    return visual.confidence >= 0.55 && visual.symbol ? visual : semantic;
  }
  const visualScore = executionReadCompleteness(visual);
  const semanticScore = executionReadCompleteness(semantic);
  const preferVisual = visualScore >= semanticScore;

  return {
    ...visual,
    positionStatus: visual.positionStatus !== "UNKNOWN" ? visual.positionStatus : semantic.positionStatus,
    symbol: preferVisual ? visual.symbol ?? semantic.symbol : semantic.symbol ?? visual.symbol,
    orderType: preferVisual ? visual.orderType ?? semantic.orderType : semantic.orderType ?? visual.orderType,
    side: preferVisual ? visual.side ?? semantic.side : semantic.side ?? visual.side,
    quantity: preferVisual ? visual.quantity ?? semantic.quantity : semantic.quantity ?? visual.quantity,
    entryPrice: preferVisual ? visual.entryPrice ?? semantic.entryPrice : semantic.entryPrice ?? visual.entryPrice,
    currentPrice: visual.currentPrice ?? semantic.currentPrice,
    stopPrice: preferVisual ? visual.stopPrice ?? semantic.stopPrice : semantic.stopPrice ?? visual.stopPrice,
    targetPrice: preferVisual ? visual.targetPrice ?? semantic.targetPrice : semantic.targetPrice ?? visual.targetPrice,
    openPnl: visual.openPnl ?? semantic.openPnl,
    confidence: Math.max(visual.confidence, semantic.confidence),
    evidence: [...visual.evidence, ...semantic.evidence].filter((item, index, all) => all.indexOf(item) === index).slice(0, 8),
    note: visual.note ?? semantic.note,
    intentState:
      visual.intentState !== "UNKNOWN" ? visual.intentState :
      semantic.intentState,
    orderTicketVisible: visual.orderTicketVisible || semantic.orderTicketVisible,
  };
}

export function inspectLocalOcrExecution(semanticText: string): SemanticExecutionRead | null {
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
  const currentPrice = parseSemanticNumber(fields.CURRENT);
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
      currentPrice,
      stopPrice,
      targetPrice,
      openPnl: isOpen ? parseSemanticNumber(fields.PNL) : null,
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

export function inspectSemanticExecution(semanticText: string, activeSymbol: string | null = null): SemanticExecutionRead | null {
  const text = semanticText.replace(/\r/g, "");
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean).filter(line => {
    const order = line.match(/\b(?:Buy|Sell)\s+\d+(?:\.\d+)?\s+(\S+)\s+@/i);
    return !activeSymbol || !order || normalizeTradingSymbol(order[1]) === activeSymbol;
  });
  const evidence = semanticOrderEvidence(lines);
  const hasQuantityEditor = lines.some((line) => /\bedit\s*\|\s*quantity\b/i.test(line) || /\bchange order quantity\b/i.test(line));
  const hasOrderTypeControl = lines.some((line) => /\bchange order type\b/i.test(line));
  const orderTicketVisible = hasQuantityEditor || hasOrderTypeControl;
  const details = extractSemanticOrderDetails(lines);

  if (evidence.cancelControl && !orderTicketVisible) {
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

export function fuseExecutionReads(
  ocr: SemanticExecutionRead | null,
  accessibility: SemanticExecutionRead | null,
): SemanticExecutionRead | null {
  if (!ocr) return accessibility;
  if (!accessibility) return ocr;

  const a = accessibility.frame;
  const o = ocr.frame;

  // Accessibility often lists the protective SELL/BUY exits as working
  // orders. An OCR position row with remaining size and live P&L takes
  // precedence; those exits must not become a new opposite-side entry.
  if (o.positionStatus === "OPEN" && a.positionStatus !== "OPEN") return ocr;

  if (a.symbol && o.symbol && !compatibleExecution(a, o)) {
    // Prefer the explicit draft being edited; do not fill its blanks from
    // another pane's pending order.
    return a.intentState === "PREPARING" ? accessibility : o.intentState === "PREPARING" ? ocr : accessibility;
  }

  const aScore = executionDetailScore(a);
  const oScore = executionDetailScore(o);

  // Exact TradingView/accessibility order text is semantically cleaner for
  // side, contract quantity, order type and entry. Local OCR is best used to
  // supplement chart-only prices such as stop/target/current.
  const identityPrimary = aScore >= 3 ? a : (oScore > aScore ? o : a);
  const identitySecondary = compatibleExecution(a, o) ? (identityPrimary === a ? o : a) : identityPrimary;

  const symbol = identityPrimary.symbol ?? identitySecondary.symbol;
  const side = identityPrimary.side ?? identitySecondary.side;
  const quantity = identityPrimary.quantity ?? identitySecondary.quantity;
  const orderType = identityPrimary.orderType ?? identitySecondary.orderType;
  const entryPrice = identityPrimary.entryPrice ?? identitySecondary.entryPrice;
  const currentPrice = identityPrimary.currentPrice ?? identitySecondary.currentPrice;

  const validStop = (value: number | null) => {
    if (value == null) return false;
    if (a.positionStatus === "OPEN" || o.positionStatus === "OPEN") return value > 0;
    if (entryPrice == null || side == null) return true;
    return side === "LONG" ? value < entryPrice : value > entryPrice;
  };
  const validTarget = (value: number | null) => {
    if (value == null) return false;
    if (entryPrice == null || side == null) return true;
    return side === "LONG" ? value > entryPrice : value < entryPrice;
  };

  const stopPrice =
    [identityPrimary.stopPrice, identitySecondary.stopPrice].find((value): value is number => validStop(value)) ?? null;
  const targetPrice =
    [identityPrimary.targetPrice, identitySecondary.targetPrice].find((value): value is number => validTarget(value)) ?? null;

  const positionStatus: FrameRead["positionStatus"] =
    a.positionStatus === "OPEN" || o.positionStatus === "OPEN" ? "OPEN" :
    o.intentState === "PREPARING" ? "UNKNOWN" :
    a.positionStatus === "PENDING" ? "PENDING" :
    a.intentState === "PREPARING" ? "UNKNOWN" :
    o.positionStatus === "PENDING" ? "PENDING" :
    o.positionStatus;

  const intentState: FrameRead["intentState"] =
    positionStatus === "OPEN" ? "POSITION_OPEN" :
    positionStatus === "PENDING" ? "ORDER_WORKING" :
    a.intentState === "PREPARING" || o.intentState === "PREPARING" ? "PREPARING" :
    a.intentState !== "UNKNOWN" ? a.intentState : o.intentState;

  return {
    source: "semantic",
    frame: {
      ...o,
      ...a,
      brokerPanelVisible: a.brokerPanelVisible || o.brokerPanelVisible,
      positionStatus,
      symbol,
      side,
      quantity,
      orderType,
      entryPrice,
      currentPrice,
      stopPrice,
      targetPrice,
      openPnl: a.openPnl ?? o.openPnl,
      tradeRealizedPnl: a.tradeRealizedPnl ?? o.tradeRealizedPnl,
      balance: a.balance ?? o.balance,
      equity: a.equity ?? o.equity,
      confidence: Math.max(a.confidence, o.confidence),
      evidence: [...a.evidence, ...o.evidence]
        .filter((item, index, all) => all.indexOf(item) === index)
        .slice(0, 8),
      note: a.note ?? o.note,
      intentState,
      orderTicketVisible: a.orderTicketVisible || o.orderTicketVisible,
    },
  };
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

export function mergeSemanticWithPrevious(
  frame: FrameRead,
  previous: TradingObserverState | undefined,
  capturedAt: string = new Date().toISOString(),
): FrameRead {
  if (!previous || !compatibleExecution(frame, previous)) return frame;
  const detailTime = previous.detailsObservedAt ?? previous.observedAt ?? "";
  const age = Date.parse(capturedAt) - Date.parse(detailTime);
  if (!Number.isFinite(age) || age < 0 || age > 5_000) return frame;
  const samePhase = frame.intentState === previous.intentState;
  const justFilled = previous.status === "PENDING" && frame.positionStatus === "OPEN";
  if (!samePhase && !justFilled) return frame;
  // Changed non-null facts are authoritative (including partial size and moved
  // stops). Richness is not a reason to overwrite a new quantity with an old one.

  return {
    ...frame,
    detailsObservedAt: detailTime,
    symbol: frame.symbol,
    orderType: frame.orderType ?? previous.orderType,
    side: frame.side ?? previous.side,
    quantity: frame.quantity ?? previous.quantity,
    entryPrice: frame.entryPrice ?? previous.entryPrice,
    // Current price and P&L are live measurements, never carried forward.
    stopPrice: frame.stopPrice ?? previous.stopPrice,
    targetPrice: frame.targetPrice ?? previous.targetPrice,
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

    const accessibilityQuantity = lines
      .map((line) => line.match(/\bQuantity\b[^\n]*\bvalue=\s*(\d+(?:\.\d+)?)/i))
      .find(Boolean);
    const quantity =
      accessibilityQuantity ? Number(accessibilityQuantity[1]) :
      quantityAnchor ? nearestPlainNumber(ocrRows, quantityAnchor, 160, 90, 1, 1000) :
      null;
    const entryPrice = addOrder ? Number(addOrder[2].replace(/,/g, "")) : null;

    const stopAnchor = ocrRows.find((row) => /\bstop loss\b/i.test(row.text)) ?? null;
    const targetAnchor = ocrRows.find((row) => /\b(take profit|target)\b/i.test(row.text)) ?? null;
    const stopPrice = stopAnchor ? nearestPriceRow(ocrRows, stopAnchor, 180, 50) : null;
    const targetPrice = targetAnchor ? nearestPriceRow(ocrRows, targetAnchor, 180, 50) : null;

    const symbol =
      normalizeOcrTicker(addOrder?.[1]?.replace(/\s+/g, "") ?? null)
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
  const overlayStop = findRiskRewardPriceFromRows(ocrRows, true, entry.price, side);
  const overlayTarget = findRiskRewardPriceFromRows(ocrRows, false, entry.price, side);
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
    stopPrice: fallbackStop ?? overlayStop,
    targetPrice: fallbackTarget ?? overlayTarget,
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
  for (const row of rows.slice(0, 180)) {
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

  const text = rows.slice(0, 180).map((row) => row.text).join(" ");
  if (/Micro.*Nasdaq.*100/i.test(text)) return "MNQ";
  if (/Micro.*S\s*&?\s*P/i.test(text)) return "MES";
  if (/Micro.*Dow/i.test(text)) return "MYM";
  if (/Micro.*Russell/i.test(text)) return "M2K";
  if (/Micro.*Gold/i.test(text)) return "MGC";
  if (/Micro.*Crude/i.test(text)) return "MCL";

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
  return known[symbol] ?? known[symbol.replace(/(?:[12I]!?|!)$/, "")] ?? null;
}

function findRiskRewardPriceFromRows(
  rows: LocalOcrRow[],
  negative: boolean,
  entryPrice: number | null,
  side: "LONG" | "SHORT",
): number | null {
  const riskPattern = negative
    ? /(^|\s)-\s*\$?\d[\d,]*(?:\.\d+)?\s*(USD)?\b|\bstop loss\b/i
    : /(^|\s)\+\s*\$?\d[\d,]*(?:\.\d+)?\s*(USD)?\b|\b(take profit|target)\b/i;

  const anchors = rows.filter((row) => riskPattern.test(row.text));
  for (const anchor of anchors) {
    const value = nearestPriceRow(rows, anchor, 520, 55);
    if (value == null) continue;
    if (entryPrice == null) return value;
    if (negative && (side === "LONG" ? value < entryPrice : value > entryPrice)) return value;
    if (!negative && (side === "LONG" ? value > entryPrice : value < entryPrice)) return value;
  }
  return null;
}

function normalizeTradingSymbol(raw: string | null): string | null {
  if (!raw) return null;
  const symbol = raw.toUpperCase().replace(/[^A-Z0-9!]/g, "");
  const reserved = new Set(["CLASS", "BUTTON", "GROUP", "TEXT", "ORDER", "ORDERS", "POSITION", "POSITIONS", "BUY", "SELL"]);
  if (!symbol || reserved.has(symbol)) return null;

  const futuresContract = symbol.match(/^([A-Z]{1,5})[FGHJKMNQUVXZ]\d{2,4}$/);
  if (futuresContract) return normalizeOcrTicker(futuresContract[1]);

  const continuous = symbol.match(/^([A-Z]{1,5})\d?!$/);
  if (continuous) return normalizeOcrTicker(continuous[1]);

  return normalizeOcrTicker(symbol);
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
  const livePosition = textParts.some((part) => /^Close position(?:\s+on\s+\S+)?$/i.test(part));
  return { explicitOrder, cancelControl, livePosition };
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

export function normalizeFrameRead(value: unknown): FrameRead {
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

export function normalizeDate(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}
