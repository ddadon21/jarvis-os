import type { MemoryQuery, MemoryRecord } from "@/core/memory/types";

export interface MemoryRepository {
  write(record: MemoryRecord): Promise<MemoryRecord>;
  /** Scope is applied inside the adapter — an out-of-scope record is never returned. */
  search(userId: string, query: MemoryQuery): Promise<MemoryRecord[]>;
  findById(userId: string, id: string): Promise<MemoryRecord | null>;
  /** Marks a memory replaced by a newer one, preserving both. */
  supersede(userId: string, id: string, supersededById: string, at: string): Promise<void>;
}
