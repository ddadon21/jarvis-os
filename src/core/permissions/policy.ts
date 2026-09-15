import { actionLevelRank, type ActionLevel } from "@/core/types";
import {
  capabilityDefinition,
  requiresExplicitApproval,
  type Capability,
} from "@/core/permissions/capabilities";
import type { PermissionDecision, PermissionPolicy } from "@/core/permissions/types";

/**
 * Permission evaluation.
 *
 * The order matters and is deliberately paranoid:
 *   1. Start from the capability's default level.
 *   2. Apply the user's grant, if one exists and has not expired.
 *   3. Clamp to the capability's hard ceiling — always, grant or not.
 *   4. Compare against the level being requested.
 *
 * Step 3 runs last so that no amount of configuration, corrupted row or
 * compromised write path can raise a critical capability past its code-declared
 * limit.
 */

export function effectiveLevel(
  policy: PermissionPolicy | null,
  capability: Capability,
  now: Date = new Date(),
): ActionLevel {
  const definition = capabilityDefinition(capability);

  const grant = policy?.grants.find((g) => g.capability === capability);
  const expired = grant?.expiresAt !== undefined && Date.parse(grant.expiresAt) <= now.getTime();

  const configured = grant && !expired ? grant.level : definition.defaultLevel;

  return minLevel(configured, definition.hardCeiling);
}

export function evaluate(
  policy: PermissionPolicy | null,
  capability: Capability,
  requestedLevel: ActionLevel,
  now: Date = new Date(),
): PermissionDecision {
  const definition = capabilityDefinition(capability);
  const effective = effectiveLevel(policy, capability, now);
  const allowed = actionLevelRank[effective] >= actionLevelRank[requestedLevel];

  const requiresApproval =
    requestedLevel === "execute" && requiresExplicitApproval(capability);

  return {
    allowed,
    capability,
    effectiveLevel: effective,
    requestedLevel,
    requiresApproval,
    reason: allowed
      ? `Granted at ${effective} (ceiling ${definition.hardCeiling}).`
      : denialReason(capability, requestedLevel, effective),
  };
}

function denialReason(capability: Capability, requested: ActionLevel, effective: ActionLevel): string {
  const definition = capabilityDefinition(capability);

  if (actionLevelRank[requested] > actionLevelRank[definition.hardCeiling]) {
    return `${capability} is capped at ${definition.hardCeiling} in code (risk class: ${definition.riskClass}). ${requested} is not grantable at runtime.`;
  }
  return `${capability} is currently granted ${effective}; ${requested} was requested.`;
}

/** Can Jarvis perform this action itself right now, without asking? */
export function canActAutonomously(
  policy: PermissionPolicy | null,
  capability: Capability,
  now: Date = new Date(),
): boolean {
  const decision = evaluate(policy, capability, "execute", now);
  return decision.allowed && !decision.requiresApproval;
}

/** The highest level currently in force across a domain's capabilities. */
export function minLevel(a: ActionLevel, b: ActionLevel): ActionLevel {
  return actionLevelRank[a] <= actionLevelRank[b] ? a : b;
}

export function maxLevel(a: ActionLevel, b: ActionLevel): ActionLevel {
  return actionLevelRank[a] >= actionLevelRank[b] ? a : b;
}
