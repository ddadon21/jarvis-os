export type ExecutiveDecision = "APPROVE" | "APPROVE_WITH_CONDITIONS" | "TEST_FIRST" | "REJECT" | "ESCALATE_DWIGHT";
export type ExecutiveReview = "PASS" | "PASS_WITH_CONDITIONS" | "TEST_FIRST" | "REJECT" | "ESCALATE_DWIGHT";

const DECISIONS = new Set<ExecutiveDecision>([
  "APPROVE",
  "APPROVE_WITH_CONDITIONS",
  "TEST_FIRST",
  "REJECT",
  "ESCALATE_DWIGHT",
]);

const REVIEWS = new Set<ExecutiveReview>([
  "PASS",
  "PASS_WITH_CONDITIONS",
  "TEST_FIRST",
  "REJECT",
  "ESCALATE_DWIGHT",
]);

/**
 * Protocol parsing is deliberately strict:
 * - only the final non-empty line counts;
 * - exact uppercase machine token required;
 * - ambiguity is not "helpfully" normalized into approval.
 */
export function parseFinalDecision(text: string): ExecutiveDecision | null {
  const line = finalNonEmptyLine(text);
  const match = /^DECISION: (APPROVE|APPROVE_WITH_CONDITIONS|TEST_FIRST|REJECT|ESCALATE_DWIGHT)$/.exec(line);
  const value = match?.[1] as ExecutiveDecision | undefined;
  return value && DECISIONS.has(value) ? value : null;
}

export function parseFinalReview(text: string): ExecutiveReview | null {
  const line = finalNonEmptyLine(text);
  const match = /^REVIEW: (PASS|PASS_WITH_CONDITIONS|TEST_FIRST|REJECT|ESCALATE_DWIGHT)$/.exec(line);
  const value = match?.[1] as ExecutiveReview | undefined;
  return value && REVIEWS.has(value) ? value : null;
}

/**
 * JARVIS adjudicates. The lead cannot approve its own proposal over an
 * independent objection.
 */
export function adjudicateExecutiveDecision(
  review: ExecutiveReview | null,
  leadDecision: ExecutiveDecision | null,
): ExecutiveDecision {
  if (!review || !leadDecision) return "ESCALATE_DWIGHT";
  if (review === "ESCALATE_DWIGHT") return "ESCALATE_DWIGHT";

  if (review === "REJECT") {
    if (leadDecision === "REJECT") return "REJECT";
    if (leadDecision === "ESCALATE_DWIGHT") return "ESCALATE_DWIGHT";
    return "ESCALATE_DWIGHT";
  }

  if (review === "TEST_FIRST") {
    if (leadDecision === "REJECT" || leadDecision === "ESCALATE_DWIGHT") return leadDecision;
    return "TEST_FIRST";
  }

  if (review === "PASS_WITH_CONDITIONS") {
    if (leadDecision === "APPROVE") return "APPROVE_WITH_CONDITIONS";
    return leadDecision;
  }

  // REVIEW: PASS. The independent reviewer has not added a restriction, but the
  // lead may still choose a stricter outcome after reconciliation.
  return leadDecision;
}

function finalNonEmptyLine(text: string) {
  const lines = text.replace(/\r/g, "").split("\n").map(line => line.trim()).filter(Boolean);
  return lines.at(-1) ?? "";
}
