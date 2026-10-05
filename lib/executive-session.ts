import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { JARVIS_MODELS } from "./jarvis-models";
import {
  HJV_CONSTITUTION_SYSTEM,
  HJV_CONSTITUTION_VERSION,
  HJV_EXECUTIVE_AGREEMENT_VERSION,
  HJV_EXECUTIVE_SESSION,
  HJV_EXECUTIVE_SOP_VERSION,
} from "./hjv-constitution";

export type ExecutiveBrain = "GPT" | "CLAUDE";
export type ExecutiveLeadPreference = ExecutiveBrain | "AUTO";
export type ExecutiveDecision = typeof HJV_EXECUTIVE_SESSION.decisions[number];

export type ExecutiveSessionInput = {
  objective: string;
  context?: string;
  preferredLead?: ExecutiveLeadPreference;
};

export type ExecutiveSessionResult = {
  id: string;
  constitutionVersion: string;
  agreementVersion: string;
  sopVersion: string;
  mode: "RECOMMENDATION_ONLY";
  status: "COMPLETE" | "DEGRADED" | "FAILED";
  lead: ExecutiveBrain;
  reviewer: ExecutiveBrain;
  providerState: {
    openAIConfigured: boolean;
    anthropicConfigured: boolean;
  };
  proposal: string | null;
  critique: string | null;
  reconciliation: string | null;
  decision: ExecutiveDecision;
  degradationReason: string | null;
  exchangesUsed: number;
  createdAt: string;
};

const TECHNICAL = /\b(code|coding|repo|repository|architecture|technical|implementation|implement|debug|bug|refactor|database|supabase|api|deploy|deployment|typescript|javascript|python|c#|observer|backend|frontend|infrastructure|security|integration)\b/i;

function autoLead(objective: string): ExecutiveBrain {
  return TECHNICAL.test(objective) ? "CLAUDE" : "GPT";
}

function other(brain: ExecutiveBrain): ExecutiveBrain {
  return brain === "GPT" ? "CLAUDE" : "GPT";
}

function configured(brain: ExecutiveBrain) {
  return brain === "GPT" ? Boolean(process.env.OPENAI_API_KEY) : Boolean(process.env.ANTHROPIC_API_KEY);
}

function modelFor(brain: ExecutiveBrain) {
  return brain === "GPT" ? openai(JARVIS_MODELS.gptExecutive) : anthropic(JARVIS_MODELS.claudeDeep);
}

async function ask(brain: ExecutiveBrain, system: string, prompt: string) {
  if (!configured(brain)) throw new Error(brain + " provider is not configured.");
  const result = await generateText({
    model: modelFor(brain),
    system,
    prompt,
    maxOutputTokens: 1800,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(75_000),
  });
  const text = result.text.trim();
  if (!text) throw new Error(brain + " returned no written result.");
  return text.slice(0, 12_000);
}

function parseDecision(text: string): ExecutiveDecision {
  const match = text.match(/DECISION\s*:\s*(APPROVE_WITH_CONDITIONS|APPROVE|TEST_FIRST|REJECT|ESCALATE_DWIGHT)/i);
  const value = match?.[1]?.toUpperCase() as ExecutiveDecision | undefined;
  return HJV_EXECUTIVE_SESSION.decisions.includes(value as never) ? value! : "ESCALATE_DWIGHT";
}

function baseSystem(brain: ExecutiveBrain, role: "LEAD" | "REVIEWER" | "RECONCILER") {
  return [
    HJV_CONSTITUTION_SYSTEM,
    "",
    "EXECUTIVE OPERATING AGREEMENT:",
    "You are " + brain + " acting as " + role + " inside a bounded HJV Executive Session.",
    "GPT and Claude are peer executive partners. Challenge weak reasoning; do not flatter or agree automatically.",
    "Use only the supplied context as company evidence. State assumptions instead of inventing company facts.",
    "This v1 session is RECOMMENDATION ONLY. You cannot execute production actions, move money, place trades, contact outsiders, change permissions, or expand your own authority.",
    "Be concise and decision-oriented.",
  ].join("\n");
}

export function executiveProviderStatus() {
  return {
    constitutionVersion: HJV_CONSTITUTION_VERSION,
    agreementVersion: HJV_EXECUTIVE_AGREEMENT_VERSION,
    sopVersion: HJV_EXECUTIVE_SOP_VERSION,
    openAIConfigured: Boolean(process.env.OPENAI_API_KEY),
    anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    maxModelExchanges: HJV_EXECUTIVE_SESSION.maxModelExchanges,
    mode: HJV_EXECUTIVE_SESSION.defaultMode,
  };
}

export async function runExecutiveSession(input: ExecutiveSessionInput): Promise<ExecutiveSessionResult> {
  const objective = input.objective.replace(/\s+/g, " ").trim().slice(0, 2000);
  const context = (input.context ?? "").trim().slice(0, 16_000);
  if (objective.length < 8) throw new Error("Executive objective must be at least 8 characters.");

  const preferred = input.preferredLead ?? "AUTO";
  let lead: ExecutiveBrain = preferred === "AUTO" ? autoLead(objective) : preferred;
  let reviewer = other(lead);

  const result: ExecutiveSessionResult = {
    id: "exec_" + crypto.randomUUID(),
    constitutionVersion: HJV_CONSTITUTION_VERSION,
    agreementVersion: HJV_EXECUTIVE_AGREEMENT_VERSION,
    sopVersion: HJV_EXECUTIVE_SOP_VERSION,
    mode: "RECOMMENDATION_ONLY",
    status: "FAILED",
    lead,
    reviewer,
    providerState: {
      openAIConfigured: Boolean(process.env.OPENAI_API_KEY),
      anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    },
    proposal: null,
    critique: null,
    reconciliation: null,
    decision: "ESCALATE_DWIGHT",
    degradationReason: null,
    exchangesUsed: 0,
    createdAt: new Date().toISOString(),
  };

  // If the preferred lead is not configured, allow the healthy partner to make
  // a single-model recommendation, but never call it dual review.
  if (!configured(lead) && configured(reviewer)) {
    const previousLead = lead;
    lead = reviewer;
    reviewer = previousLead;
    result.lead = lead;
    result.reviewer = reviewer;
    result.status = "DEGRADED";
    result.degradationReason = previousLead + " is not configured; " + lead + " is operating alone.";
  }

  if (!configured(lead)) {
    result.degradationReason = "Neither required lead provider is configured.";
    return result;
  }

  const evidence = context || "No additional company context was supplied. Do not invent missing facts.";
  const proposalPrompt = [
    "OBJECTIVE: " + objective,
    "",
    "CONTEXT / EVIDENCE:",
    evidence,
    "",
    "Produce the strongest company recommendation.",
    "Include: recommendation, evidence used, strongest risk, scope impact, smallest reversible next step, definition of done, what requires Dwight, and what would falsify your recommendation.",
  ].join("\n");

  try {
    result.proposal = await ask(lead, baseSystem(lead, "LEAD"), proposalPrompt);
    result.exchangesUsed = 1;
  } catch (error) {
    // If the selected lead is unhealthy at runtime, try the peer once. This is
    // provider failover, not dual review.
    if (configured(reviewer)) {
      const failedLead = lead;
      const fallback = reviewer;
      try {
        result.proposal = await ask(fallback, baseSystem(fallback, "LEAD"), proposalPrompt);
        result.lead = fallback;
        result.reviewer = failedLead;
        result.status = "DEGRADED";
        result.degradationReason = failedLead + " lead call failed; " + fallback + " produced a single-model fallback recommendation. " + errorMessage(error);
        result.exchangesUsed = 1;
        return result;
      } catch (fallbackError) {
        result.degradationReason = "Both provider calls failed. Lead: " + errorMessage(error) + " Fallback: " + errorMessage(fallbackError);
        return result;
      }
    }
    result.degradationReason = errorMessage(error);
    return result;
  }

  if (!configured(reviewer)) {
    result.status = "DEGRADED";
    result.degradationReason = reviewer + " is not configured; independent peer review could not run.";
    return result;
  }

  const critiquePrompt = [
    "OBJECTIVE: " + objective,
    "",
    "CONTEXT / EVIDENCE:",
    evidence,
    "",
    "LEAD PROPOSAL:",
    result.proposal,
    "",
    "Act as the independent executive reviewer. Do not rewrite the whole proposal.",
    "Identify the most important errors, unsupported assumptions, scope creep, risk, missing dependency, smaller reversible test, and any Founder-reserved decision.",
    "End with REVIEW: PASS, PASS_WITH_CONDITIONS, TEST_FIRST, REJECT, or ESCALATE_DWIGHT.",
  ].join("\n");

  try {
    result.critique = await ask(reviewer, baseSystem(reviewer, "REVIEWER"), critiquePrompt);
    result.exchangesUsed = 2;
  } catch (error) {
    result.status = "DEGRADED";
    result.degradationReason = reviewer + " review failed; do not represent this as dual-reviewed. " + errorMessage(error);
    return result;
  }

  const reconcilePrompt = [
    "OBJECTIVE: " + objective,
    "",
    "CONTEXT / EVIDENCE:",
    evidence,
    "",
    "YOUR ORIGINAL PROPOSAL:",
    result.proposal,
    "",
    "PEER REVIEW:",
    result.critique,
    "",
    "Reconcile only the material objections. Do not defend weak points.",
    "Return a final company recommendation, conditions/tests, unresolved assumptions, Founder-required decisions, and definition of done.",
    "End with exactly one line:",
    "DECISION: APPROVE | APPROVE_WITH_CONDITIONS | TEST_FIRST | REJECT | ESCALATE_DWIGHT",
  ].join("\n");

  try {
    result.reconciliation = await ask(lead, baseSystem(lead, "RECONCILER"), reconcilePrompt);
    result.exchangesUsed = 3;
    result.decision = parseDecision(result.reconciliation);
    result.status = "COMPLETE";
    return result;
  } catch (error) {
    result.status = "DEGRADED";
    result.degradationReason = lead + " reconciliation failed after successful peer review. " + errorMessage(error);
    result.decision = "ESCALATE_DWIGHT";
    return result;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 800) : "Unknown provider error.";
}
