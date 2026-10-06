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
import {
  adjudicateExecutiveDecision,
  parseFinalDecision,
  parseFinalReview,
  type ExecutiveDecision,
  type ExecutiveReview,
} from "./executive-decision";
import { appendRuntimeEvent, createRuntimeEvent } from "./jarvis-runtime";

export type ExecutiveBrain = "GPT" | "CLAUDE";
export type ExecutiveLeadPreference = ExecutiveBrain | "AUTO";

export type ExecutiveSessionInput = {
  objective: string;
  context?: string;
  preferredLead?: ExecutiveLeadPreference;
  signal?: AbortSignal;
};

export type ExecutiveModelCall = {
  role: "LEAD" | "REVIEWER" | "RECONCILER";
  brain: ExecutiveBrain;
  model: string;
  finishReason: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type ExecutiveSessionResult = {
  id: string;
  constitutionVersion: string;
  agreementVersion: string;
  sopVersion: string;
  mode: "RECOMMENDATION_ONLY";
  status: "COMPLETE" | "DEGRADED" | "FAILED";
  lead: ExecutiveBrain;
  reviewer: ExecutiveBrain | null;
  independentReview: boolean;
  providerState: {
    openAIConfigured: boolean;
    anthropicConfigured: boolean;
  };
  proposal: string | null;
  critique: string | null;
  reconciliation: string | null;
  reviewerVerdict: ExecutiveReview | null;
  leadDecision: ExecutiveDecision | null;
  decision: ExecutiveDecision;
  degradationReason: string | null;
  exchangesUsed: number;
  modelCalls: ExecutiveModelCall[];
  contextFingerprint: string | null;
  createdAt: string;
};

type ModelRunSuccess = {
  ok: true;
  text: string;
  call: ExecutiveModelCall;
};

type ModelRunFailure = {
  ok: false;
  error: string;
  call: ExecutiveModelCall;
};

type ModelRunResult = ModelRunSuccess | ModelRunFailure;

export type ExecutiveSessionDependencies = {
  runModel?: (input: {
    brain: ExecutiveBrain;
    role: ExecutiveModelCall["role"];
    system: string;
    prompt: string;
    signal?: AbortSignal;
  }) => Promise<ModelRunResult>;
  isConfigured?: (brain: ExecutiveBrain) => boolean;
  persistAudit?: (result: ExecutiveSessionResult) => Promise<void>;
};

const TECHNICAL = /\b(code|coding|repo|repository|architecture|technical|implementation|implement|debug|bug|refactor|database|supabase|api|deploy|deployment|typescript|javascript|python|c#|observer|backend|frontend|infrastructure|security|integration)\b/i;

function autoLead(objective: string): ExecutiveBrain {
  return TECHNICAL.test(objective) ? "CLAUDE" : "GPT";
}

function other(brain: ExecutiveBrain): ExecutiveBrain {
  return brain === "GPT" ? "CLAUDE" : "GPT";
}

function defaultConfigured(brain: ExecutiveBrain) {
  return brain === "GPT" ? Boolean(process.env.OPENAI_API_KEY) : Boolean(process.env.ANTHROPIC_API_KEY);
}

function requestedModel(brain: ExecutiveBrain) {
  return brain === "GPT" ? JARVIS_MODELS.gptExecutive : JARVIS_MODELS.claudeDeep;
}

function modelFor(brain: ExecutiveBrain) {
  return brain === "GPT" ? openai(JARVIS_MODELS.gptExecutive) : anthropic(JARVIS_MODELS.claudeDeep);
}

async function defaultRunModel(input: {
  brain: ExecutiveBrain;
  role: ExecutiveModelCall["role"];
  system: string;
  prompt: string;
  signal?: AbortSignal;
}): Promise<ModelRunResult> {
  const model = requestedModel(input.brain);
  const signal = input.signal
    ? AbortSignal.any([input.signal, AbortSignal.timeout(75_000)])
    : AbortSignal.timeout(75_000);

  try {
    const result = await generateText({
      model: modelFor(input.brain),
      system: input.system,
      prompt: input.prompt,
      maxOutputTokens: 8192,
      maxRetries: 1,
      abortSignal: signal,
    });

    const call: ExecutiveModelCall = {
      role: input.role,
      brain: input.brain,
      model: result.response?.modelId || model,
      finishReason: result.finishReason,
      inputTokens: result.usage.inputTokens ?? null,
      outputTokens: result.usage.outputTokens ?? null,
      totalTokens: result.usage.totalTokens ?? null,
    };

    if (result.finishReason !== "stop") {
      return {
        ok: false,
        error: input.brain + " did not finish normally (finishReason=" + result.finishReason + ").",
        call,
      };
    }

    const text = result.text.trim();
    if (!text) return { ok: false, error: input.brain + " returned no written result.", call };
    return { ok: true, text: text.slice(0, 48_000), call };
  } catch (error) {
    return {
      ok: false,
      error: errorMessage(error),
      call: {
        role: input.role,
        brain: input.brain,
        model,
        finishReason: "error",
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      },
    };
  }
}

function baseSystem(brain: ExecutiveBrain, role: ExecutiveModelCall["role"]) {
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

export async function runExecutiveSession(
  input: ExecutiveSessionInput,
  dependencies: ExecutiveSessionDependencies = {},
): Promise<ExecutiveSessionResult> {
  const runModel = dependencies.runModel ?? defaultRunModel;
  const isConfigured = dependencies.isConfigured ?? defaultConfigured;
  const objective = input.objective.replace(/\s+/g, " ").trim().slice(0, 2000);
  const context = (input.context ?? "").trim().slice(0, 16_000);
  if (objective.length < 8) throw new Error("Executive objective must be at least 8 characters.");

  const preferred = input.preferredLead ?? "AUTO";
  let lead: ExecutiveBrain = preferred === "AUTO" ? autoLead(objective) : preferred;
  const intendedReviewer = other(lead);

  const result: ExecutiveSessionResult = {
    id: "exec_" + crypto.randomUUID(),
    constitutionVersion: HJV_CONSTITUTION_VERSION,
    agreementVersion: HJV_EXECUTIVE_AGREEMENT_VERSION,
    sopVersion: HJV_EXECUTIVE_SOP_VERSION,
    mode: "RECOMMENDATION_ONLY",
    status: "FAILED",
    lead,
    reviewer: null,
    independentReview: false,
    providerState: {
      openAIConfigured: isConfigured("GPT"),
      anthropicConfigured: isConfigured("CLAUDE"),
    },
    proposal: null,
    critique: null,
    reconciliation: null,
    reviewerVerdict: null,
    leadDecision: null,
    decision: "ESCALATE_DWIGHT",
    degradationReason: null,
    exchangesUsed: 0,
    modelCalls: [],
    contextFingerprint: await fingerprint(objective + "\n" + context),
    createdAt: new Date().toISOString(),
  };

  const finish = () => finalizeSession(result, dependencies.persistAudit);

  if (!isConfigured(lead) && !isConfigured(intendedReviewer)) {
    result.degradationReason = "Neither executive model provider is configured.";
    return finish();
  }

  // Missing intended lead: healthy peer may provide a single-model fallback,
  // but the session remains degraded and has no independent reviewer.
  if (!isConfigured(lead) && isConfigured(intendedReviewer)) {
    lead = intendedReviewer;
    result.lead = lead;
    const fallback = await runModel({
      brain: lead,
      role: "LEAD",
      system: baseSystem(lead, "LEAD"),
      prompt: proposalPrompt(objective, context),
      signal: input.signal,
    });
    result.modelCalls.push(fallback.call);
    if (!fallback.ok) {
      result.status = "FAILED";
      result.degradationReason = "Configured fallback lead failed: " + fallback.error;
      return finish();
    }
    result.proposal = fallback.text;
    result.exchangesUsed = 1;
    result.status = "DEGRADED";
    result.degradationReason = other(lead) + " is not configured; " + lead + " produced a single-model recommendation.";
    return finish();
  }

  const leadRun = await runModel({
    brain: lead,
    role: "LEAD",
    system: baseSystem(lead, "LEAD"),
    prompt: proposalPrompt(objective, context),
    signal: input.signal,
  });
  result.modelCalls.push(leadRun.call);

  if (!leadRun.ok) {
    const fallbackBrain = other(lead);
    if (!isConfigured(fallbackBrain)) {
      result.status = "FAILED";
      result.degradationReason = lead + " lead call failed and no fallback provider is configured. " + leadRun.error;
      return finish();
    }

    const fallback = await runModel({
      brain: fallbackBrain,
      role: "LEAD",
      system: baseSystem(fallbackBrain, "LEAD"),
      prompt: proposalPrompt(objective, context),
      signal: input.signal,
    });
    result.modelCalls.push(fallback.call);
    if (!fallback.ok) {
      result.status = "FAILED";
      result.degradationReason = "Both lead attempts failed. " + lead + ": " + leadRun.error + " " + fallbackBrain + ": " + fallback.error;
      return finish();
    }

    result.lead = fallbackBrain;
    result.proposal = fallback.text;
    result.exchangesUsed = 1;
    result.status = "DEGRADED";
    result.degradationReason = lead + " lead call failed; " + fallbackBrain + " produced a single-model fallback recommendation. " + leadRun.error;
    return finish();
  }

  result.proposal = leadRun.text;
  result.exchangesUsed = 1;

  const reviewerBrain = other(lead);
  if (!isConfigured(reviewerBrain)) {
    result.status = "DEGRADED";
    result.degradationReason = reviewerBrain + " is not configured; independent peer review could not run.";
    return finish();
  }

  const reviewRun = await runModel({
    brain: reviewerBrain,
    role: "REVIEWER",
    system: baseSystem(reviewerBrain, "REVIEWER"),
    prompt: critiquePrompt(objective, context, result.proposal),
    signal: input.signal,
  });
  result.modelCalls.push(reviewRun.call);
  result.exchangesUsed = 2;

  if (!reviewRun.ok) {
    result.status = "DEGRADED";
    result.degradationReason = reviewerBrain + " review failed; do not represent this as dual-reviewed. " + reviewRun.error;
    return finish();
  }

  result.critique = reviewRun.text;
  result.reviewer = reviewerBrain;
  result.independentReview = true;
  result.reviewerVerdict = parseFinalReview(reviewRun.text);

  if (!result.reviewerVerdict) {
    result.status = "DEGRADED";
    result.degradationReason = reviewerBrain + " review did not end with a valid protocol REVIEW line.";
    return finish();
  }

  const reconcileRun = await runModel({
    brain: lead,
    role: "RECONCILER",
    system: baseSystem(lead, "RECONCILER"),
    prompt: reconciliationPrompt(objective, context, result.proposal, result.critique),
    signal: input.signal,
  });
  result.modelCalls.push(reconcileRun.call);
  result.exchangesUsed = 3;

  if (!reconcileRun.ok) {
    result.status = "DEGRADED";
    result.degradationReason = lead + " reconciliation failed after independent peer review. " + reconcileRun.error;
    return finish();
  }

  result.reconciliation = reconcileRun.text;
  result.leadDecision = parseFinalDecision(reconcileRun.text);
  if (!result.leadDecision) {
    result.status = "DEGRADED";
    result.degradationReason = lead + " reconciliation did not end with a valid protocol DECISION line.";
    return finish();
  }

  result.decision = adjudicateExecutiveDecision(result.reviewerVerdict, result.leadDecision);
  result.status = "COMPLETE";
  return finish();
}

function proposalPrompt(objective: string, context: string) {
  return [
    "OBJECTIVE: " + objective,
    "",
    "CONTEXT / EVIDENCE:",
    context || "No additional company context was supplied. Do not invent missing facts.",
    "",
    "Produce the strongest company recommendation.",
    "Include: recommendation, evidence used, strongest risk, scope impact, smallest reversible next step, definition of done, what requires Dwight, and what would falsify your recommendation.",
  ].join("\n");
}

function critiquePrompt(objective: string, context: string, proposal: string) {
  return [
    "OBJECTIVE: " + objective,
    "",
    "CONTEXT / EVIDENCE:",
    context || "No additional company context was supplied. Do not invent missing facts.",
    "",
    "LEAD PROPOSAL:",
    proposal,
    "",
    "Act as the independent executive reviewer. Do not rewrite the whole proposal.",
    "Identify the most important errors, unsupported assumptions, scope creep, risk, missing dependency, smaller reversible test, and any Founder-reserved decision.",
    "End with exactly one machine line using underscores:",
    "REVIEW: PASS | PASS_WITH_CONDITIONS | TEST_FIRST | REJECT | ESCALATE_DWIGHT",
  ].join("\n");
}

function reconciliationPrompt(objective: string, context: string, proposal: string, critique: string) {
  return [
    "OBJECTIVE: " + objective,
    "",
    "CONTEXT / EVIDENCE:",
    context || "No additional company context was supplied. Do not invent missing facts.",
    "",
    "YOUR ORIGINAL PROPOSAL:",
    proposal,
    "",
    "PEER REVIEW:",
    critique,
    "",
    "Reconcile only the material objections. Do not defend weak points.",
    "Return a final company recommendation, conditions/tests, unresolved assumptions, Founder-required decisions, and definition of done.",
    "End with exactly one machine line using underscores:",
    "DECISION: APPROVE | APPROVE_WITH_CONDITIONS | TEST_FIRST | REJECT | ESCALATE_DWIGHT",
  ].join("\n");
}

async function finalizeSession(
  result: ExecutiveSessionResult,
  persistAudit: ExecutiveSessionDependencies["persistAudit"] = defaultPersistAudit,
) {
  try {
    await persistAudit!(result);
  } catch (error) {
    result.status = result.proposal ? "DEGRADED" : "FAILED";
    result.decision = "ESCALATE_DWIGHT";
    result.degradationReason = joinReason(result.degradationReason, "Audit persistence failed: " + errorMessage(error));
  }
  return result;
}

async function defaultPersistAudit(result: ExecutiveSessionResult) {
  const inputTokens = result.modelCalls.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0);
  const outputTokens = result.modelCalls.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0);
  const totalTokens = result.modelCalls.reduce((sum, call) => sum + (call.totalTokens ?? 0), 0);
  const models = result.modelCalls.map(call =>
    call.role[0] + ":" + call.brain[0] + ":" + call.model + ":" + call.finishReason
  ).join("|");

  const summary = [
    "cv=" + result.constitutionVersion,
    "av=" + result.agreementVersion,
    "sv=" + result.sopVersion,
    "status=" + result.status,
    "decision=" + result.decision,
    "independentReview=" + String(result.independentReview),
    "models=" + models,
    "tokens=" + inputTokens + "/" + outputTokens + "/" + totalTokens,
    "context=" + (result.contextFingerprint ?? "none"),
    "degradation=" + (result.degradationReason?.slice(0, 80) ?? "none"),
  ].join(" | ");

  const event = createRuntimeEvent({
    type: "executive.session",
    domain: "CORE",
    source: "jarvis.executive-session",
    importance: result.decision === "ESCALATE_DWIGHT" ? "IMPORTANT" : "NORMAL",
    occurredAt: result.createdAt,
    summary,
  });
  event.id = result.id;
  const durable = await appendRuntimeEvent(event);
  if (!durable) throw new Error("Supabase did not acknowledge the executive audit event.");
}

async function fingerprint(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function joinReason(current: string | null, next: string) {
  return current ? current + " " + next : next;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 800) : "Unknown provider error.";
}
