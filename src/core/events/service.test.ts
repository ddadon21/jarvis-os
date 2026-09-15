import { describe, expect, it } from "vitest";
import { EventService, sortByImportanceThenRecency } from "@/core/events/service";
import { InMemoryEventRepository } from "@/server/repositories/in-memory";
import type { JarvisEvent } from "@/core/events/types";

const USER = "user-1";

function service() {
  return new EventService(new InMemoryEventRepository());
}

describe("EventService.record", () => {
  it("takes the domain from the catalog, not the caller", async () => {
    const event = await service().record(USER, { eventType: "trade.closed", source: "manual" });
    expect(event.domain).toBe("trading");
  });

  it("applies the catalog's default importance when none is given", async () => {
    const events = service();
    const rfp = await events.record(USER, { eventType: "rfp.discovered", source: "research" });
    const balance = await events.record(USER, { eventType: "account.balance_changed", source: "sync" });

    expect(rfp.importance).toBe("critical");
    expect(balance.importance).toBe("trivial");
  });

  it("lets a caller override importance for a specific occurrence", async () => {
    const event = await service().record(USER, {
      eventType: "account.balance_changed",
      source: "sync",
      importance: "high",
    });
    expect(event.importance).toBe("high");
  });

  it("separates when a thing happened from when it was recorded", async () => {
    const occurredAt = "2026-01-05T09:30:00.000Z";
    const event = await service().record(USER, {
      eventType: "trade.executed",
      source: "backfill",
      occurredAt,
    });

    expect(event.occurredAt).toBe(occurredAt);
    expect(Date.parse(event.recordedAt)).toBeGreaterThan(Date.parse(occurredAt));
  });

  it("starts every event pending so nothing is silently considered handled", async () => {
    const event = await service().record(USER, { eventType: "income.received", source: "manual" });
    expect(event.processingStatus).toBe("pending");
  });
});

describe("EventService queries", () => {
  it("scopes reads to the owning user", async () => {
    const events = service();
    await events.record(USER, { eventType: "trade.closed", source: "manual" });
    await events.record("user-2", { eventType: "trade.closed", source: "manual" });

    expect(await events.list(USER)).toHaveLength(1);
  });

  it("returns pending work by importance, then recency", async () => {
    const events = service();
    await events.record(USER, { eventType: "account.balance_changed", source: "s", importance: "normal" });
    await events.record(USER, { eventType: "rfp.discovered", source: "s" });
    await events.record(USER, { eventType: "debt.payment_due", source: "s" });

    const pending = await events.pending(USER);
    expect(pending.map((event) => event.eventType)).toEqual([
      "rfp.discovered",
      "debt.payment_due",
      "account.balance_changed",
    ]);
  });

  it("drops events below the importance floor", async () => {
    const events = service();
    await events.record(USER, { eventType: "account.balance_changed", source: "s" });
    expect(await events.pending(USER, "high")).toHaveLength(0);
  });

  it("removes an event from the pending queue once processed", async () => {
    const events = service();
    const event = await events.record(USER, { eventType: "income.received", source: "manual" });

    await events.markProcessed(USER, event.id);

    expect(await events.pending(USER)).toHaveLength(0);
    const stored = await events.list(USER, { processingStatus: "processed" });
    expect(stored[0]?.processedAt).toBeDefined();
  });

  it("keeps a correlation id so one causal chain stays reconstructable", async () => {
    const events = service();
    const correlationId = "11111111-1111-4111-8111-111111111111";

    const income = await events.record(USER, {
      eventType: "income.received",
      source: "manual",
      correlationId,
    });
    await events.record(USER, {
      eventType: "allocation.recommended",
      source: "finance.cfo",
      correlationId,
      causedByEventId: income.id,
    });

    const chain = (await events.list(USER)).filter((event) => event.correlationId === correlationId);
    expect(chain).toHaveLength(2);
  });
});

describe("sortByImportanceThenRecency", () => {
  it("prefers importance over recency", () => {
    const base = {
      id: "a",
      userId: USER,
      domain: "core",
      source: "s",
      payload: {},
      processingStatus: "pending",
      recordedAt: "2026-01-01T00:00:00.000Z",
    } as const;

    const sorted = sortByImportanceThenRecency([
      { ...base, id: "recent-trivial", eventType: "task.created", importance: "trivial", occurredAt: "2026-02-01T00:00:00.000Z" },
      { ...base, id: "old-critical", eventType: "system.error", importance: "critical", occurredAt: "2026-01-01T00:00:00.000Z" },
    ] as JarvisEvent[]);

    expect(sorted[0]?.id).toBe("old-critical");
  });
});
