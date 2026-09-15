import { describe, expect, it } from "vitest";
import { ApprovalService } from "@/core/approvals/service";
import { AuditService } from "@/core/audit/service";
import { EventService } from "@/core/events/service";
import {
  InMemoryApprovalRepository,
  InMemoryAuditRepository,
  InMemoryEventRepository,
} from "@/server/repositories/in-memory";
import { isErr, isOk } from "@/lib/result";

const USER = "user-1";

function build() {
  const audit = new AuditService(new InMemoryAuditRepository());
  const events = new EventService(new InMemoryEventRepository());
  // The repository is held here as well as passed in, so tests can seed rows
  // that the service has no API to create — an already-expired request.
  const repository = new InMemoryApprovalRepository();
  const approvals = new ApprovalService(repository, audit, events);

  return { approvals, audit, events, repository };
}

const EXPIRED = "2020-01-01T00:00:00.000Z";

const draft = {
  domain: "finance",
  capability: "finance.move_money",
  requestedBy: "finance.cfo",
  title: "Pay $428.00 to Auto loan",
  summary: "Scheduled payment from personal checking.",
  proposedAction: { from: "acct_1", to: "loan_1", amountMinorUnits: 42_800 },
} as const;

describe("ApprovalService", () => {
  it("records an audit entry and an event for every request", async () => {
    const { approvals, audit, events } = build();

    const request = await approvals.request(USER, draft);

    expect(request.status).toBe("pending");
    expect(request.riskClass).toBe("critical");

    const entries = await audit.list(USER);
    expect(entries.map((entry) => entry.action)).toContain("approval.requested");

    const recorded = await events.list(USER);
    expect(recorded[0]?.eventType).toBe("approval.requested");
    // A critical capability escalates the event's importance.
    expect(recorded[0]?.importance).toBe("critical");
  });

  it("approving records consent and does not execute anything", async () => {
    const { approvals, audit } = build();
    const request = await approvals.request(USER, draft);

    const result = await approvals.resolve(USER, request.id, "approve", USER, "Confirmed");

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.status).toBe("approved");

    // "executed" is a separate transition reported by whoever carried it out.
    const entries = await audit.list(USER);
    expect(entries.some((entry) => entry.action === "approval.executed")).toBe(false);
  });

  it("refuses to resolve the same request twice", async () => {
    const { approvals } = build();
    const request = await approvals.request(USER, draft);

    await approvals.resolve(USER, request.id, "approve", USER);
    const second = await approvals.resolve(USER, request.id, "deny", USER);

    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.error.kind).toBe("conflict");
  });

  it("expires rather than approves a stale request", async () => {
    const { approvals, repository } = build();
    const request = await approvals.request(USER, draft);
    await repository.create({ ...request, id: "stale-1", expiresAt: EXPIRED });

    const result = await approvals.resolve(USER, "stale-1", "approve", USER);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.message).toContain("expired");

    const stored = await repository.findById(USER, "stale-1");
    expect(stored?.status).toBe("expired");
  });

  it("omits expired requests from the pending list", async () => {
    const { approvals, repository } = build();
    const live = await approvals.request(USER, draft);
    await repository.create({ ...live, id: "expired-1", expiresAt: EXPIRED });

    const pending = await approvals.pending(USER);

    expect(pending.map((request) => request.id)).toEqual([live.id]);
  });

  it("reports a not_found rather than throwing for an unknown id", async () => {
    const { approvals } = build();
    const result = await approvals.resolve(USER, "missing", "approve", USER);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("not_found");
  });
});
