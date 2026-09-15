import { describe, expect, it } from "vitest";
import { canActAutonomously, effectiveLevel, evaluate } from "@/core/permissions/policy";
import { capabilities, capabilityDefinition } from "@/core/permissions/capabilities";
import type { PermissionPolicy } from "@/core/permissions/types";

const NOW = new Date("2026-03-02T14:00:00.000Z");

function policy(grants: PermissionPolicy["grants"]): PermissionPolicy {
  return { userId: "user-1", grants };
}

describe("permission ceilings", () => {
  it("refuses to grant a critical capability past its code ceiling", () => {
    const configured = policy([
      { capability: "trading.live_order", level: "execute", grantedAt: NOW.toISOString() },
    ]);

    const decision = evaluate(configured, "trading.live_order", "execute", NOW);

    expect(decision.allowed).toBe(false);
    expect(decision.effectiveLevel).toBe("prepare");
    expect(decision.reason).toContain("capped at prepare in code");
  });

  it("never lets Jarvis widen its own permissions", () => {
    const configured = policy([
      { capability: "core.modify_permissions", level: "execute", grantedAt: NOW.toISOString() },
    ]);
    expect(effectiveLevel(configured, "core.modify_permissions", NOW)).toBe("recommend");
  });

  it("holds every critical capability below EXECUTE, registry-wide", () => {
    const escapees = capabilities.filter((capability) => {
      const definition = capabilityDefinition(capability);
      return definition.riskClass === "critical" && definition.hardCeiling === "execute";
    });
    expect(escapees).toEqual([]);
  });
});

describe("grants", () => {
  it("applies a valid grant", () => {
    const configured = policy([
      { capability: "trading.paper_order", level: "execute", grantedAt: NOW.toISOString() },
    ]);
    expect(evaluate(configured, "trading.paper_order", "execute", NOW).allowed).toBe(true);
  });

  it("falls back to the default level once a grant expires", () => {
    const configured = policy([
      {
        capability: "trading.paper_order",
        level: "execute",
        grantedAt: "2026-03-01T00:00:00.000Z",
        expiresAt: "2026-03-02T00:00:00.000Z",
      },
    ]);
    expect(effectiveLevel(configured, "trading.paper_order", NOW)).toBe("prepare");
  });

  it("uses defaults when no policy exists at all", () => {
    expect(effectiveLevel(null, "trading.journal_trade", NOW)).toBe("execute");
    expect(effectiveLevel(null, "finance.move_money", NOW)).toBe("recommend");
  });
});

describe("approval requirements", () => {
  it("requires approval before executing anything high or critical risk", () => {
    const decision = evaluate(null, "sentryops.send_outreach", "execute", NOW);
    expect(decision.requiresApproval).toBe(true);
  });

  it("allows autonomous execution only for low-risk granted capabilities", () => {
    expect(canActAutonomously(null, "trading.journal_trade", NOW)).toBe(true);
    expect(canActAutonomously(null, "finance.move_money", NOW)).toBe(false);
  });
});
