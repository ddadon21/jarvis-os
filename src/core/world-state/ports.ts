import type { WorldStateSnapshot } from "@/core/world-state/types";

export interface WorldStateRepository {
  saveSnapshot(snapshot: WorldStateSnapshot): Promise<WorldStateSnapshot>;
  latest(userId: string): Promise<WorldStateSnapshot | null>;
  list(userId: string, limit?: number): Promise<WorldStateSnapshot[]>;
}
