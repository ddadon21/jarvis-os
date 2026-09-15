import type { Notification, NotificationDraft, NotificationStatus } from "@/core/notifications/types";
import { routeChannels } from "@/core/notifications/types";
import type { NotificationRepository } from "@/core/notifications/ports";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";

export class NotificationService {
  constructor(private readonly repository: NotificationRepository) {}

  /** Creates one notification per routed channel. */
  async notify(userId: string, draft: NotificationDraft): Promise<Notification[]> {
    const channels = routeChannels(draft.urgency);
    const createdAt = nowIso();

    return Promise.all(
      channels.map((channel) =>
        this.repository.create({
          id: newId(),
          userId,
          domain: draft.domain,
          urgency: draft.urgency,
          channel,
          title: draft.title,
          body: draft.body,
          status: "pending",
          createdAt,
          ...(draft.deepLink ? { deepLink: draft.deepLink } : {}),
          ...(draft.correlationId ? { correlationId: draft.correlationId } : {}),
        }),
      ),
    );
  }

  async list(userId: string, limit = 20): Promise<Notification[]> {
    return this.repository.list(userId, { limit });
  }

  async markStatus(userId: string, id: string, status: NotificationStatus): Promise<void> {
    await this.repository.updateStatus(userId, id, status);
  }
}
