import type { MemoryDraft, MemoryQuery, MemoryRecord, MemoryScope } from "@/core/memory/types";
import type { MemoryRepository } from "@/core/memory/ports";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";

export class MemoryService {
  constructor(private readonly repository: MemoryRepository) {}

  async remember(userId: string, draft: MemoryDraft): Promise<MemoryRecord> {
    const record: MemoryRecord = {
      id: newId(),
      userId,
      memoryClass: draft.memoryClass,
      domain: draft.domain,
      title: draft.title,
      content: draft.content,
      importance: draft.importance ?? "normal",
      tags: draft.tags ?? [],
      evidenceKind: draft.evidenceKind ?? "user_observation",
      confidence: draft.confidence ?? 0.8,
      source: draft.source,
      validFrom: draft.validFrom ?? nowIso(),
      createdAt: nowIso(),
      accessCount: 0,
      ...(draft.summary ? { summary: draft.summary } : {}),
      ...(draft.sourceRef ? { sourceRef: draft.sourceRef } : {}),
    };
    return this.repository.write(record);
  }

  /**
   * Replaces a belief without destroying the old one.
   *
   * "We thought agencies bought on price; we now believe they buy on
   * integration effort" is a more valuable record than either belief alone.
   */
  async replace(userId: string, previousId: string, draft: MemoryDraft): Promise<MemoryRecord> {
    const replacement = await this.remember(userId, draft);
    await this.repository.supersede(userId, previousId, replacement.id, replacement.validFrom);
    return replacement;
  }

  async recall(userId: string, query: MemoryQuery): Promise<MemoryRecord[]> {
    const limit = Math.min(query.limit ?? query.scope.maxRecords, query.scope.maxRecords);
    return this.repository.search(userId, { ...query, limit });
  }

  /** Convenience for agents: recall within a fixed scope. */
  async recallForScope(userId: string, scope: MemoryScope, text?: string): Promise<MemoryRecord[]> {
    return this.recall(userId, { scope, ...(text ? { text } : {}) });
  }
}
