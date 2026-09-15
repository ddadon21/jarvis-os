import type { DomainModule } from "@/core/domain-module";
import { EventService } from "@/core/events/service";
import { GoalService } from "@/core/goals/service";
import { NextMoveService } from "@/core/next-move/service";
import { WorldStateService } from "@/core/world-state/service";
import { MemoryService } from "@/core/memory/service";
import { AuditService } from "@/core/audit/service";
import { ApprovalService } from "@/core/approvals/service";
import { NotificationService } from "@/core/notifications/service";
import { TradingModule } from "@/domains/trading/module";
import { FinanceModule } from "@/domains/finance/module";
import { SentryOpsModule } from "@/domains/sentryops/module";
import { LifeModule } from "@/domains/life/module";
import {
  InMemoryApprovalRepository,
  InMemoryAuditRepository,
  InMemoryEventRepository,
  InMemoryGoalRepository,
  InMemoryMemoryRepository,
  InMemoryNotificationRepository,
  InMemoryWorldStateRepository,
} from "@/server/repositories/in-memory";
import { devFinanceSource, devLifeSource, devSentryOpsSource, devTradingSource } from "@/dev/sources";
import { serverEnv } from "@/lib/env";
import { notImplemented } from "@/lib/result";

/**
 * Composition root.
 *
 * The only place that knows which adapters are in play. Services and engines
 * receive their dependencies; nothing constructs its own. That is what makes
 * the Supabase swap a change to this file rather than a change to fifty.
 *
 * Kept as a module-level singleton because the wiring is stateless and
 * rebuilding it per request would be pure overhead. The in-memory repositories
 * behind it are NOT stateless, which is one more reason they are development
 * only (see src/server/repositories/in-memory.ts).
 */

export interface JarvisContainer {
  readonly modules: readonly DomainModule[];
  readonly events: EventService;
  readonly goals: GoalService;
  readonly nextMove: NextMoveService;
  readonly worldState: WorldStateService;
  readonly memory: MemoryService;
  readonly audit: AuditService;
  readonly approvals: ApprovalService;
  readonly notifications: NotificationService;
  readonly dataSource: "dev" | "supabase";
}

let container: JarvisContainer | undefined;

export function getContainer(): JarvisContainer {
  if (container) return container;

  const dataSource = serverEnv().JARVIS_DATA_SOURCE;

  if (dataSource === "supabase") {
    // Deliberately unimplemented rather than silently falling back to mock
    // data. A finance dashboard that quietly shows invented numbers because a
    // connection failed is the single worst outcome this codebase can produce.
    throw new Error(
      `${notImplemented("Supabase repository adapters").message}. ` +
        "Run the core migration and implement src/server/repositories/supabase.ts, or set JARVIS_DATA_SOURCE=dev.",
    );
  }

  const eventRepository = new InMemoryEventRepository();
  const auditRepository = new InMemoryAuditRepository();
  const approvalRepository = new InMemoryApprovalRepository();

  const events = new EventService(eventRepository);
  const audit = new AuditService(auditRepository);

  const modules: DomainModule[] = [
    new TradingModule(devTradingSource),
    new FinanceModule(devFinanceSource),
    new SentryOpsModule(devSentryOpsSource),
    new LifeModule(devLifeSource),
  ];

  container = {
    modules,
    events,
    audit,
    goals: new GoalService(new InMemoryGoalRepository()),
    nextMove: new NextMoveService(modules),
    worldState: new WorldStateService(modules, new InMemoryWorldStateRepository()),
    memory: new MemoryService(new InMemoryMemoryRepository()),
    approvals: new ApprovalService(approvalRepository, audit, events),
    notifications: new NotificationService(new InMemoryNotificationRepository()),
    dataSource,
  };

  return container;
}
