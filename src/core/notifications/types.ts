import type { Domain } from "@/core/types";

/**
 * Notifications.
 *
 * v0.1 delivers in-app only. SMS, voice and email are declared here and marked
 * unavailable so the model does not have to be reshaped when they are added —
 * the urgency ladder and the routing decision are the parts that are hard to
 * retrofit, and they exist now.
 */

export const notificationUrgencies = [
  /** Accumulates silently. Read when the user looks. */
  "background",
  /** Appears in the feed. No interruption. */
  "normal",
  /** Surfaces to the top of the feed; push once channels exist. */
  "important",
  /** Loses value quickly — an RFP deadline, a setup forming. */
  "time_sensitive",
  /** Interrupt regardless of context. Money or safety is at stake. */
  "critical",
] as const;
export type NotificationUrgency = (typeof notificationUrgencies)[number];

export const notificationChannels = ["in_app", "push", "email", "sms", "voice"] as const;
export type NotificationChannel = (typeof notificationChannels)[number];

/** Which channels actually work today. Routing consults this, not intuition. */
export const channelAvailability: Record<NotificationChannel, boolean> = {
  in_app: true,
  push: false,
  email: false,
  sms: false,
  voice: false,
};

export const notificationStatuses = ["pending", "sent", "read", "dismissed", "failed"] as const;
export type NotificationStatus = (typeof notificationStatuses)[number];

export interface Notification {
  readonly id: string;
  readonly userId: string;
  readonly domain: Domain;
  readonly urgency: NotificationUrgency;
  readonly channel: NotificationChannel;
  readonly title: string;
  readonly body: string;
  /** In-app route this notification points at, e.g. `/finance`. */
  readonly deepLink?: string;
  readonly status: NotificationStatus;
  readonly createdAt: string;
  readonly sentAt?: string;
  readonly readAt?: string;
  readonly correlationId?: string;
}

export interface NotificationDraft {
  readonly domain: Domain;
  readonly urgency: NotificationUrgency;
  readonly title: string;
  readonly body: string;
  readonly deepLink?: string;
  readonly correlationId?: string;
}

/**
 * Channel routing.
 *
 * Returns every channel a notification of this urgency *should* reach, filtered
 * down to what is actually wired up. Keeping the intent and the capability
 * separate means the escalation policy can be reviewed now and simply starts
 * working as channels come online.
 */
export function routeChannels(urgency: NotificationUrgency): NotificationChannel[] {
  const intended: Record<NotificationUrgency, NotificationChannel[]> = {
    background: ["in_app"],
    normal: ["in_app"],
    important: ["in_app", "push"],
    time_sensitive: ["in_app", "push", "sms"],
    critical: ["in_app", "push", "sms", "voice"],
  };

  const available = intended[urgency].filter((channel) => channelAvailability[channel]);
  // in_app is always available and is the floor: a notification that reaches
  // nothing is a silent failure, which is the worst outcome for a critical one.
  return available.length > 0 ? available : ["in_app"];
}
