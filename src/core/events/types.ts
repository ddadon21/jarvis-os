import { z } from "zod";
import { domains, importanceLevels, type Domain, type Importance } from "@/core/types";
import { eventTypes, type EventType } from "@/core/events/catalog";

/**
 * Event processing lifecycle.
 *
 * `pending` events are the queue that the Next Move Engine and future
 * proactive loops consume. `ignored` is deliberate and meaningful — it records
 * that Jarvis saw something and chose not to act, which is itself data.
 */
export const processingStatuses = ["pending", "processing", "processed", "failed", "ignored"] as const;
export type ProcessingStatus = (typeof processingStatuses)[number];

/**
 * The event envelope.
 *
 * Events are an append-only ledger. They are never edited after the fact;
 * only `processingStatus` and `processedAt` change. If a fact turns out to be
 * wrong, a correcting event is appended.
 */
export interface JarvisEvent {
  readonly id: string;
  readonly userId: string;
  readonly eventType: EventType;
  readonly domain: Domain;
  /** Where the fact came from: `manual`, `tradovate`, `plaid`, `jarvis.core`, … */
  readonly source: string;
  readonly importance: Importance;
  /** Type-specific body. Shape per type is documented in docs/EVENTS.md. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly processingStatus: ProcessingStatus;
  /** Ties together every record produced by one causal chain. */
  readonly correlationId?: string;
  /** The event this one was caused by, when there is a direct parent. */
  readonly causedByEventId?: string;
  /** When the thing happened — not when the row was written. */
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly processedAt?: string;
}

/** What a caller supplies. The service fills in the rest. */
export interface EventDraft {
  readonly eventType: EventType;
  readonly source: string;
  readonly payload?: Readonly<Record<string, unknown>>;
  /** Defaults to the catalog's importance for this event type. */
  readonly importance?: Importance;
  /** Defaults to now. Set explicitly when backfilling historical data. */
  readonly occurredAt?: string;
  readonly correlationId?: string;
  readonly causedByEventId?: string;
}

/**
 * Validation at the trust boundary. Anything arriving from an HTTP request,
 * a webhook or a file import is parsed with this before it becomes an event.
 */
export const eventDraftSchema = z.object({
  eventType: z.enum(eventTypes as [EventType, ...EventType[]]),
  source: z.string().min(1).max(64),
  payload: z.record(z.string(), z.unknown()).optional(),
  importance: z.enum(importanceLevels).optional(),
  occurredAt: z.iso.datetime().optional(),
  correlationId: z.uuid().optional(),
  causedByEventId: z.uuid().optional(),
});

export const eventQuerySchema = z.object({
  domain: z.enum(domains).optional(),
  eventType: z.enum(eventTypes as [EventType, ...EventType[]]).optional(),
  processingStatus: z.enum(processingStatuses).optional(),
  minImportance: z.enum(importanceLevels).optional(),
  since: z.iso.datetime().optional(),
  limit: z.number().int().min(1).max(500).default(50),
});

export type EventQuery = z.infer<typeof eventQuerySchema>;
