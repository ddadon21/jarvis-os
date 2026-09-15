import { importanceRank, type Importance } from "@/core/types";
import { eventDefinition } from "@/core/events/catalog";
import type { EventDraft, EventQuery, JarvisEvent, ProcessingStatus } from "@/core/events/types";
import type { EventRepository } from "@/core/events/ports";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";

/**
 * The Event Engine.
 *
 * Everything meaningful that happens flows through `record()`. Domains publish;
 * core consumes. This is the substrate the proactive loop will be built on:
 * once facts are events rather than rows quietly mutated in place, Jarvis can
 * notice *changes*, not just read current state.
 *
 * Deliberately small for v0.1 — append, query, mark processed. No in-process
 * bus, no retries, no fan-out. Those belong in a durable queue later
 * (see docs/EVENTS.md, "Deferred").
 */
export class EventService {
  constructor(private readonly repository: EventRepository) {}

  async record(userId: string, draft: EventDraft): Promise<JarvisEvent> {
    const definition = eventDefinition(draft.eventType);
    const timestamp = nowIso();

    // The domain is taken from the catalog, never from the caller. A domain
    // must not be able to publish an event attributed to another domain.
    const event: JarvisEvent = {
      id: newId(),
      userId,
      eventType: draft.eventType,
      domain: definition.domain,
      source: draft.source,
      importance: draft.importance ?? definition.defaultImportance,
      payload: draft.payload ?? {},
      processingStatus: "pending",
      occurredAt: draft.occurredAt ?? timestamp,
      recordedAt: timestamp,
      ...(draft.correlationId ? { correlationId: draft.correlationId } : {}),
      ...(draft.causedByEventId ? { causedByEventId: draft.causedByEventId } : {}),
    };

    return this.repository.append(event);
  }

  async list(userId: string, query: Partial<EventQuery> = {}): Promise<JarvisEvent[]> {
    return this.repository.list(userId, query);
  }

  /** The pending work queue, most important first. */
  async pending(userId: string, minImportance: Importance = "normal", limit = 50): Promise<JarvisEvent[]> {
    const events = await this.repository.list(userId, {
      processingStatus: "pending",
      minImportance,
      limit,
    });
    return sortByImportanceThenRecency(events);
  }

  async markProcessed(userId: string, eventId: string): Promise<void> {
    await this.repository.updateStatus(userId, eventId, "processed", nowIso());
  }

  async markStatus(userId: string, eventId: string, status: ProcessingStatus): Promise<void> {
    const processedAt = status === "processed" || status === "ignored" ? nowIso() : undefined;
    await this.repository.updateStatus(userId, eventId, status, processedAt);
  }
}

/**
 * Triage order: importance first, then recency. A critical RFP found this
 * morning outranks a trivial balance change from a minute ago.
 */
export function sortByImportanceThenRecency(events: readonly JarvisEvent[]): JarvisEvent[] {
  return [...events].sort((a, b) => {
    const byImportance = importanceRank[b.importance] - importanceRank[a.importance];
    if (byImportance !== 0) return byImportance;
    return Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
  });
}

export function meetsImportance(event: JarvisEvent, minimum: Importance): boolean {
  return importanceRank[event.importance] >= importanceRank[minimum];
}
