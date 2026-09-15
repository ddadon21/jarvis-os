import type { AuditEntry } from "@/core/audit/types";
import type { Domain } from "@/core/types";

export interface AuditRepository {
  /** Append only. There is deliberately no update or delete. */
  append(entry: AuditEntry): Promise<AuditEntry>;
  list(
    userId: string,
    filter?: { domain?: Domain; actorId?: string; correlationId?: string; limit?: number },
  ): Promise<AuditEntry[]>;
}
