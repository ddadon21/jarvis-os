import type { Domain } from "@/core/types";
import { importanceRank } from "@/core/types";
import type { EventRepository } from "@/core/events/ports";
import type { EventQuery, JarvisEvent, ProcessingStatus } from "@/core/events/types";
import type { GoalRepository } from "@/core/goals/ports";
import type { Goal, GoalCriterionReading } from "@/core/goals/types";
import type { ApprovalRepository } from "@/core/approvals/ports";
import type { ApprovalRequest, ApprovalStatus } from "@/core/approvals/types";
import type { AuditRepository } from "@/core/audit/ports";
import type { AuditEntry } from "@/core/audit/types";
import type { NotificationRepository } from "@/core/notifications/ports";
import type { Notification, NotificationStatus } from "@/core/notifications/types";
import type { MemoryRepository } from "@/core/memory/ports";
import type { MemoryQuery, MemoryRecord } from "@/core/memory/types";
import type { WorldStateRepository } from "@/core/world-state/ports";
import type { WorldStateSnapshot } from "@/core/world-state/types";
import { devGoals } from "@/dev/goals";
import { notFound } from "@/lib/result";

/**
 * In-memory repository adapters.
 *
 * Used when `JARVIS_DATA_SOURCE=dev`. They exist so the whole system —
 * services, engines, UI — can be built and tested before the database is
 * wired, and so unit tests never need a network.
 *
 * Known and accepted limitation: state lives in the process. On Vercel that
 * means each serverless invocation starts fresh, and writes do not survive.
 * That is correct for a development stand-in and completely wrong for anything
 * else, which is why `JARVIS_DATA_SOURCE=supabase` exists.
 */

export class InMemoryEventRepository implements EventRepository {
  private readonly events: JarvisEvent[] = [];

  async append(event: JarvisEvent): Promise<JarvisEvent> {
    this.events.push(event);
    return event;
  }

  async list(userId: string, query: Partial<EventQuery>): Promise<JarvisEvent[]> {
    const limit = query.limit ?? 50;

    return this.events
      .filter((event) => event.userId === userId)
      .filter((event) => (query.domain ? event.domain === query.domain : true))
      .filter((event) => (query.eventType ? event.eventType === query.eventType : true))
      .filter((event) => (query.processingStatus ? event.processingStatus === query.processingStatus : true))
      .filter((event) =>
        query.minImportance ? importanceRank[event.importance] >= importanceRank[query.minImportance] : true,
      )
      .filter((event) => (query.since ? Date.parse(event.occurredAt) >= Date.parse(query.since) : true))
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
      .slice(0, limit);
  }

  async findById(userId: string, eventId: string): Promise<JarvisEvent | null> {
    return this.events.find((event) => event.userId === userId && event.id === eventId) ?? null;
  }

  async updateStatus(
    userId: string,
    eventId: string,
    status: ProcessingStatus,
    processedAt?: string,
  ): Promise<void> {
    const index = this.events.findIndex((event) => event.userId === userId && event.id === eventId);
    const existing = this.events[index];
    if (!existing) return;

    this.events[index] = {
      ...existing,
      processingStatus: status,
      ...(processedAt ? { processedAt } : {}),
    };
  }
}

export class InMemoryGoalRepository implements GoalRepository {
  private readonly readingsLog: GoalCriterionReading[] = [];

  constructor(private readonly goals: readonly Goal[] = devGoals) {}

  async list(userId: string, filter?: { domain?: Domain; status?: Goal["status"] }): Promise<Goal[]> {
    return this.goals
      .filter((goal) => goal.userId === userId)
      .filter((goal) => (filter?.domain ? goal.domain === filter.domain : true))
      .filter((goal) => (filter?.status ? goal.status === filter.status : true));
  }

  async findBySlug(userId: string, slug: string): Promise<Goal | null> {
    return this.goals.find((goal) => goal.userId === userId && goal.slug === slug) ?? null;
  }

  async recordReading(reading: GoalCriterionReading): Promise<GoalCriterionReading> {
    this.readingsLog.push(reading);
    return reading;
  }

  async readings(userId: string, criterionId: string, limit = 50): Promise<GoalCriterionReading[]> {
    return this.readingsLog
      .filter((reading) => reading.userId === userId && reading.criterionId === criterionId)
      .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt))
      .slice(0, limit);
  }
}

export class InMemoryApprovalRepository implements ApprovalRepository {
  private readonly requests: ApprovalRequest[] = [];

  async create(request: ApprovalRequest): Promise<ApprovalRequest> {
    this.requests.push(request);
    return request;
  }

  async findById(userId: string, id: string): Promise<ApprovalRequest | null> {
    return this.requests.find((request) => request.userId === userId && request.id === id) ?? null;
  }

  async list(userId: string, filter?: { status?: ApprovalStatus; limit?: number }): Promise<ApprovalRequest[]> {
    return this.requests
      .filter((request) => request.userId === userId)
      .filter((request) => (filter?.status ? request.status === filter.status : true))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, filter?.limit ?? 25);
  }

  async updateStatus(
    userId: string,
    id: string,
    patch: Pick<ApprovalRequest, "status"> &
      Partial<Pick<ApprovalRequest, "resolvedAt" | "resolvedBy" | "decisionNote">>,
  ): Promise<ApprovalRequest> {
    const index = this.requests.findIndex((request) => request.userId === userId && request.id === id);
    const existing = this.requests[index];
    if (!existing) throw new Error(notFound("Approval request", id).message);

    const updated: ApprovalRequest = { ...existing, ...patch };
    this.requests[index] = updated;
    return updated;
  }
}

export class InMemoryAuditRepository implements AuditRepository {
  private readonly entries: AuditEntry[] = [];

  async append(entry: AuditEntry): Promise<AuditEntry> {
    this.entries.push(entry);
    return entry;
  }

  async list(
    userId: string,
    filter?: { domain?: Domain; actorId?: string; correlationId?: string; limit?: number },
  ): Promise<AuditEntry[]> {
    return this.entries
      .filter((entry) => entry.userId === userId)
      .filter((entry) => (filter?.domain ? entry.domain === filter.domain : true))
      .filter((entry) => (filter?.actorId ? entry.actorId === filter.actorId : true))
      .filter((entry) => (filter?.correlationId ? entry.correlationId === filter.correlationId : true))
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
      .slice(0, filter?.limit ?? 100);
  }
}

export class InMemoryNotificationRepository implements NotificationRepository {
  private readonly notifications: Notification[] = [];

  async create(notification: Notification): Promise<Notification> {
    this.notifications.push(notification);
    return notification;
  }

  async list(userId: string, filter?: { status?: NotificationStatus; limit?: number }): Promise<Notification[]> {
    return this.notifications
      .filter((notification) => notification.userId === userId)
      .filter((notification) => (filter?.status ? notification.status === filter.status : true))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, filter?.limit ?? 20);
  }

  async updateStatus(userId: string, id: string, status: NotificationStatus): Promise<void> {
    const index = this.notifications.findIndex((n) => n.userId === userId && n.id === id);
    const existing = this.notifications[index];
    if (!existing) return;
    this.notifications[index] = { ...existing, status };
  }
}

export class InMemoryMemoryRepository implements MemoryRepository {
  private readonly records: MemoryRecord[] = [];

  async write(record: MemoryRecord): Promise<MemoryRecord> {
    this.records.push(record);
    return record;
  }

  async search(userId: string, query: MemoryQuery): Promise<MemoryRecord[]> {
    const asOf = query.asOf ? Date.parse(query.asOf) : Date.now();
    const text = query.text?.toLowerCase();

    return this.records
      .filter((record) => record.userId === userId)
      // Scope is enforced here, not by the caller: an out-of-scope record must
      // be unreachable, not merely un-requested.
      .filter((record) => query.scope.domains.includes(record.domain))
      .filter((record) => query.scope.classes.includes(record.memoryClass))
      .filter((record) => record.supersededById === undefined)
      .filter((record) => (record.validUntil ? Date.parse(record.validUntil) > asOf : true))
      .filter((record) =>
        query.minImportance ? importanceRank[record.importance] >= importanceRank[query.minImportance] : true,
      )
      .filter((record) => (query.tags ? query.tags.some((tag) => record.tags.includes(tag)) : true))
      // Substring matching stands in for embeddings until semantic recall lands.
      .filter((record) =>
        text ? `${record.title} ${record.content}`.toLowerCase().includes(text) : true,
      )
      .sort((a, b) => Date.parse(b.validFrom) - Date.parse(a.validFrom))
      .slice(0, Math.min(query.limit ?? query.scope.maxRecords, query.scope.maxRecords));
  }

  async findById(userId: string, id: string): Promise<MemoryRecord | null> {
    return this.records.find((record) => record.userId === userId && record.id === id) ?? null;
  }

  async supersede(userId: string, id: string, supersededById: string, at: string): Promise<void> {
    const index = this.records.findIndex((record) => record.userId === userId && record.id === id);
    const existing = this.records[index];
    if (!existing) return;
    this.records[index] = { ...existing, supersededById, validUntil: at };
  }
}

export class InMemoryWorldStateRepository implements WorldStateRepository {
  private readonly snapshots: WorldStateSnapshot[] = [];

  async saveSnapshot(snapshot: WorldStateSnapshot): Promise<WorldStateSnapshot> {
    this.snapshots.push(snapshot);
    return snapshot;
  }

  async latest(userId: string): Promise<WorldStateSnapshot | null> {
    return (
      [...this.snapshots]
        .filter((snapshot) => snapshot.userId === userId)
        .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0] ?? null
    );
  }

  async list(userId: string, limit = 20): Promise<WorldStateSnapshot[]> {
    return [...this.snapshots]
      .filter((snapshot) => snapshot.userId === userId)
      .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))
      .slice(0, limit);
  }
}
