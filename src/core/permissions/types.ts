import { z } from "zod";
import { actionLevels, type ActionLevel } from "@/core/types";
import { capabilities, type Capability } from "@/core/permissions/capabilities";

/** A user's configured autonomy grant for one capability. */
export interface PermissionGrant {
  readonly capability: Capability;
  readonly level: ActionLevel;
  readonly grantedAt: string;
  /** Optional expiry — useful for "let Jarvis run this for one week". */
  readonly expiresAt?: string;
  readonly note?: string;
}

export interface PermissionPolicy {
  readonly userId: string;
  readonly grants: readonly PermissionGrant[];
}

export interface PermissionDecision {
  readonly allowed: boolean;
  readonly capability: Capability;
  /** The level actually in force after ceilings and expiry are applied. */
  readonly effectiveLevel: ActionLevel;
  readonly requestedLevel: ActionLevel;
  /** Whether acting at this level must first create an approval request. */
  readonly requiresApproval: boolean;
  /** Human-readable reason. Written to the audit log on every denial. */
  readonly reason: string;
}

export const permissionGrantSchema = z.object({
  capability: z.enum(capabilities as [Capability, ...Capability[]]),
  level: z.enum(actionLevels),
  expiresAt: z.iso.datetime().optional(),
  note: z.string().max(500).optional(),
});
