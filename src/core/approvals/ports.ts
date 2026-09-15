import type { ApprovalRequest, ApprovalStatus } from "@/core/approvals/types";

export interface ApprovalRepository {
  create(request: ApprovalRequest): Promise<ApprovalRequest>;
  findById(userId: string, id: string): Promise<ApprovalRequest | null>;
  list(userId: string, filter?: { status?: ApprovalStatus; limit?: number }): Promise<ApprovalRequest[]>;
  updateStatus(
    userId: string,
    id: string,
    patch: Pick<ApprovalRequest, "status"> &
      Partial<Pick<ApprovalRequest, "resolvedAt" | "resolvedBy" | "decisionNote">>,
  ): Promise<ApprovalRequest>;
}
