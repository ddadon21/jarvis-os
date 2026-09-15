import type { JarvisEvent, EventQuery, ProcessingStatus } from "@/core/events/types";

/**
 * Port for event persistence.
 *
 * Core declares the interface; `src/server/repositories` provides the Supabase
 * adapter and the in-memory dev adapter. Core never knows which it is talking
 * to, which is what keeps the engines unit-testable without a database.
 */
export interface EventRepository {
  append(event: JarvisEvent): Promise<JarvisEvent>;
  list(userId: string, query: Partial<EventQuery>): Promise<JarvisEvent[]>;
  findById(userId: string, eventId: string): Promise<JarvisEvent | null>;
  updateStatus(
    userId: string,
    eventId: string,
    status: ProcessingStatus,
    processedAt?: string,
  ): Promise<void>;
}
