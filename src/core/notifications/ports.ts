import type { Notification, NotificationStatus } from "@/core/notifications/types";

export interface NotificationRepository {
  create(notification: Notification): Promise<Notification>;
  list(userId: string, filter?: { status?: NotificationStatus; limit?: number }): Promise<Notification[]>;
  updateStatus(userId: string, id: string, status: NotificationStatus): Promise<void>;
}
