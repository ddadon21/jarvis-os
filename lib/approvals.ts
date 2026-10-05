import { randomUUID } from "node:crypto";
import { durableRead, durableWrite } from "./jarvis-db";

export type ApprovalSubject = "WORKFORCE_TASK" | "DESKTOP_ACTION";
export type ApprovalDecision = "APPROVED" | "DENIED";

export type ApprovalRecord = {
  id: string;
  subjectType: ApprovalSubject;
  subjectId: string;
  decision: ApprovalDecision;
  decidedBy: string;
  reason: string | null;
  decidedAt: string;
};

/** Records an owner decision server-side (audit trail, never self-asserted by a client). */
export async function recordApproval(input: {
  subjectType: ApprovalSubject;
  subjectId: string;
  decision: ApprovalDecision;
  decidedBy?: string;
  reason?: string | null;
}): Promise<ApprovalRecord> {
  const record: ApprovalRecord = {
    id: "apr_" + randomUUID(),
    subjectType: input.subjectType,
    subjectId: input.subjectId.slice(0, 200),
    decision: input.decision,
    decidedBy: (input.decidedBy ?? "owner-session").slice(0, 80),
    reason: input.reason ? input.reason.slice(0, 500) : null,
    decidedAt: new Date().toISOString(),
  };
  await durableWrite("jarvis_approvals", ({ db, workspaceId }) =>
    db.from("jarvis_approvals").insert({
      id: record.id,
      workspace_id: workspaceId,
      subject_type: record.subjectType,
      subject_id: record.subjectId,
      decision: record.decision,
      decided_by: record.decidedBy,
      reason: record.reason,
      decided_at: record.decidedAt,
    }),
  );
  return record;
}

export async function listApprovals(limit = 50): Promise<ApprovalRecord[]> {
  const rows = await durableRead<Array<{ id: string; subject_type: ApprovalSubject; subject_id: string; decision: ApprovalDecision; decided_by: string; reason: string | null; decided_at: string }>>(
    "jarvis_approvals",
    ({ db, workspaceId }) => db.from("jarvis_approvals").select("id,subject_type,subject_id,decision,decided_by,reason,decided_at").eq("workspace_id", workspaceId).order("decided_at", { ascending: false }).limit(limit),
  );
  return (rows ?? []).map((row) => ({
    id: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    decision: row.decision,
    decidedBy: row.decided_by,
    reason: row.reason,
    decidedAt: row.decided_at,
  }));
}
