"server-only";

import type { JarvisRuntimeContext } from "./jarvis-context";
import { getAssistantRuntimeState, type JarvisAssistantRuntime } from "./jarvis-assistant-runtime";

export type JarvisCapability = {
  id: string;
  label: string;
  category: "WORLD" | "PERSONAL" | "OPERATIONAL" | "ACTION";
  state: "CONNECTED" | "AVAILABLE" | "DEGRADED" | "NEEDS_CONNECTION";
  source: string;
  canRead: boolean;
  canWrite: boolean;
  approvalRequiredForWrite: boolean;
  note: string;
};

export type DirectAnswer = {
  answer: string;
  source: string;
  capability: string;
};

function amount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : null;
}

function minutesSince(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
}

function minutesUntil(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return Math.ceil((Date.parse(value) - Date.now()) / 60_000);
}

function queryTerms(value: string) {
  const stop = new Set([
    "did", "does", "do", "has", "have", "had", "the", "a", "an", "my", "me", "they", "them",
    "he", "she", "him", "her", "client", "person", "guest", "meeting", "email", "emailed", "message",
    "from", "about", "yet", "already", "today", "recent", "recently", "is", "are", "was", "were",
  ]);
  return value.toLowerCase().match(/[a-z0-9@._-]+/g)?.filter(term => term.length > 2 && !stop.has(term)) ?? [];
}

function communicationScore(question: string, signal: JarvisAssistantRuntime["communications"]["recent"][number]) {
  const terms = queryTerms(question);
  if (!terms.length) return 0;
  const haystack = [signal.from, signal.subject, signal.summary].filter(Boolean).join(" ").toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function upcomingMeeting(assistant: JarvisAssistantRuntime) {
  const now = Date.now();
  return [...assistant.calendar.events]
    .filter(event => event.status !== "CANCELLED" && Number.isFinite(Date.parse(event.startAt)) && Date.parse(event.startAt) >= now - 15 * 60_000)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))[0] ?? null;
}

export async function getJarvisCapabilities(runtime?: JarvisRuntimeContext): Promise<JarvisCapability[]> {
  const assistant = await getAssistantRuntimeState();
  const sourceHealth: Partial<JarvisRuntimeContext["sourceHealth"]> = runtime?.sourceHealth ?? {};

  return [
    {
      id: "world.general",
      label: "General knowledge",
      category: "WORLD",
      state: "AVAILABLE",
      source: "foundation model",
      canRead: true,
      canWrite: false,
      approvalRequiredForWrite: false,
      note: "Broad knowledge and reasoning when an intelligence provider is available.",
    },
    {
      id: "world.web",
      label: "Live web search",
      category: "WORLD",
      state: assistant.sources.webSearch === "CONNECTED" ? "CONNECTED" : "NEEDS_CONNECTION",
      source: assistant.sources.webSearch === "CONNECTED" ? "configured web search provider" : "not connected",
      canRead: assistant.sources.webSearch === "CONNECTED",
      canWrite: false,
      approvalRequiredForWrite: false,
      note: "Required for current news, changing facts, and fresh public information.",
    },
    {
      id: "personal.calendar",
      label: "Calendar",
      category: "PERSONAL",
      state: assistant.sources.calendar,
      source: assistant.sources.calendar === "CONNECTED" ? "assistant calendar feed" : "not connected",
      canRead: assistant.sources.calendar === "CONNECTED",
      canWrite: false,
      approvalRequiredForWrite: true,
      note: "Upcoming meetings, conflicts, time-to-event, and schedule awareness.",
    },
    {
      id: "personal.email",
      label: "Email",
      category: "PERSONAL",
      state: assistant.sources.email,
      source: assistant.sources.email === "CONNECTED" ? "assistant email feed" : "not connected",
      canRead: assistant.sources.email === "CONNECTED",
      canWrite: false,
      approvalRequiredForWrite: true,
      note: "Recent communication and meeting-related messages.",
    },
    {
      id: "operational.meetings",
      label: "Meeting presence",
      category: "OPERATIONAL",
      state: assistant.sources.meetings,
      source: assistant.sources.meetings === "CONNECTED" ? "meeting presence feed" : "not connected",
      canRead: assistant.sources.meetings === "CONNECTED",
      canWrite: false,
      approvalRequiredForWrite: false,
      note: "Can report who joined, who is waiting, and how long they have waited when the meeting platform exposes it.",
    },
    {
      id: "personal.finance",
      label: "Finance",
      category: "PERSONAL",
      state: sourceHealth.finance === false ? "DEGRADED" : "CONNECTED",
      source: "JARVIS Finance",
      canRead: sourceHealth.finance !== false,
      canWrite: false,
      approvalRequiredForWrite: true,
      note: "Balances, debt, liquidity, goals, and synchronized finance state.",
    },
    {
      id: "operational.trading",
      label: "Trading observer",
      category: "OPERATIONAL",
      state: sourceHealth.trading === false ? "DEGRADED" : "CONNECTED",
      source: "JARVIS Trading + Local Agent",
      canRead: sourceHealth.trading !== false,
      canWrite: false,
      approvalRequiredForWrite: true,
      note: "Trading observation, journal state, account progress, and historical payouts. No trade execution.",
    },
    {
      id: "personal.knowledge",
      label: "Long-term knowledge",
      category: "PERSONAL",
      state: "CONNECTED",
      source: "Supabase + Obsidian",
      canRead: true,
      canWrite: true,
      approvalRequiredForWrite: false,
      note: "Structured memory and readable long-term knowledge.",
    },
  ];
}

export function resolveDirectAnswer(
  question: string,
  runtime: JarvisRuntimeContext,
  assistant: JarvisAssistantRuntime,
): DirectAnswer | null {
  const lower = question.trim().toLowerCase();

  if (/\b(payout|pay out|payouts)\b/.test(lower)) {
    const payouts = runtime.tradingPayouts as any;
    if (!payouts || payouts.unavailable) return null;
    const total = amount(payouts.totalAmount);
    const average = amount(payouts.averageAmount);
    const latest = amount(payouts.latest?.payoutAmount);
    const count = payouts.lifetimeCount ?? payouts.count ?? 0;
    const parts = [
      "You have " + count + " all-time payout" + (count === 1 ? "" : "s") + (total ? " totaling " + total : "") + ".",
      average ? "Your average payout is " + average + "." : "",
      latest ? "Your latest recorded payout is " + latest + (payouts.latest?.firm ? " from " + payouts.latest.firm : "") + "." : "",
      payouts.nextPayoutNumber ? "Your next one is payout number " + payouts.nextPayoutNumber + "." : "",
    ].filter(Boolean);
    return { capability: "operational.trading", source: "JARVIS payout ledger", answer: parts.join(" ") };
  }

  if (/\b(observer|local agent)\b/.test(lower) && /\b(status|online|connected|working|up)\b/.test(lower)) {
    const trading = runtime.trading as any;
    const observedAt = trading?.observer?.observedAt ?? trading?.account?.lastObservedAt ?? null;
    const connection = trading?.account?.connection ?? "UNKNOWN";
    return {
      capability: "operational.trading",
      source: "JARVIS Trading runtime",
      answer: observedAt
        ? "The trading Observer is " + String(connection).toLowerCase() + " and the latest observation was " + new Date(observedAt).toLocaleString() + "."
        : "The trading Observer state is " + String(connection).toLowerCase() + ". I do not have a recent observation timestamp.",
    };
  }

  if (/\b(net worth|liquidity|personal debt|how much debt|debt balance)\b/.test(lower)) {
    const finance = runtime.finance as any;
    if (!finance || finance.unavailable) return null;
    const metrics = finance.metrics ?? {};
    const parts: string[] = [];
    if (/\bnet worth\b/.test(lower) && amount(metrics.personalNetWorth)) parts.push("Your recorded personal net worth is " + amount(metrics.personalNetWorth) + ".");
    if (/\bliquidity\b/.test(lower) && amount(metrics.liquidity)) parts.push("Your recorded liquidity is " + amount(metrics.liquidity) + ".");
    if (/\b(debt|debt balance)\b/.test(lower) && amount(metrics.personalDebt)) parts.push("Your recorded personal debt is " + amount(metrics.personalDebt) + ".");
    if (parts.length) {
      parts.push("Finance snapshot as of " + (finance.asOf ? new Date(finance.asOf).toLocaleString() : "the latest synchronized state") + ".");
      return { capability: "personal.finance", source: "JARVIS Finance", answer: parts.join(" ") };
    }
  }

  if (/\b(next meeting|meeting today|meetings today|who am i meeting|my schedule|my calendar|appointment)\b/.test(lower)) {
    if (assistant.sources.calendar !== "CONNECTED") {
      return {
        capability: "personal.calendar",
        source: "capability state",
        answer: "Your calendar is not connected to JARVIS yet, so I cannot truthfully tell you your next meeting or schedule.",
      };
    }
    const next = upcomingMeeting(assistant);
    if (!next) {
      return { capability: "personal.calendar", source: "assistant calendar feed", answer: "I do not see an upcoming meeting in the connected calendar feed." };
    }
    const mins = minutesUntil(next.startAt);
    const timing = mins == null
      ? new Date(next.startAt).toLocaleString()
      : mins > 1
        ? "in " + mins + " minutes"
        : mins === 1
          ? "in 1 minute"
          : mins === 0
            ? "now"
            : Math.abs(mins) + " minutes ago";
    return {
      capability: "personal.calendar",
      source: next.source,
      answer: "Your next meeting is “" + next.title + "” " + timing + "." + (next.location ? " Location: " + next.location + "." : ""),
    };
  }

  if (/\b(waiting|waited|lobby|joined the meeting|in the meeting)\b/.test(lower) && /\b(meeting|person|guest|he|she|they|client|attendee)\b/.test(lower)) {
    if (assistant.sources.meetings !== "CONNECTED") {
      return {
        capability: "operational.meetings",
        source: "capability state",
        answer: "Meeting-presence data is not connected yet, so I cannot see whether someone is waiting or has joined.",
      };
    }
    const terms = queryTerms(question);
    const waitingPeople = [...assistant.meetingPresence.people]
      .filter(person => person.state === "WAITING")
      .map(person => ({
        person,
        score: terms.length
          ? terms.reduce((score, term) => score + ([person.person, person.meetingTitle].filter(Boolean).join(" ").toLowerCase().includes(term) ? 1 : 0), 0)
          : 0,
      }))
      .sort((a, b) => b.score - a.score || Date.parse(a.person.waitingSince ?? a.person.updatedAt) - Date.parse(b.person.waitingSince ?? b.person.updatedAt));

    const waiting = (terms.length ? waitingPeople.find(item => item.score > 0)?.person : waitingPeople[0]?.person) ?? null;
    if (!waiting) {
      return { capability: "operational.meetings", source: "meeting presence feed", answer: "I do not currently see a matching person marked as waiting in the connected meeting feed." };
    }
    const mins = minutesSince(waiting.waitingSince);
    const who = waiting.person || "A guest";
    return {
      capability: "operational.meetings",
      source: waiting.source,
      answer: who + " is marked as waiting" + (mins == null ? "" : " and has been waiting for about " + mins + " minute" + (mins === 1 ? "" : "s")) + ". I cannot know how much longer they will wait unless they or the meeting platform provides that information.",
    };
  }

  if (/\b(email|emailed|inbox|message from)\b/.test(lower) && /\b(my|me|they|he|she|client|meeting|email)\b/.test(lower)) {
    if (assistant.sources.email !== "CONNECTED") {
      return {
        capability: "personal.email",
        source: "capability state",
        answer: "Your email is not connected to JARVIS yet, so I cannot truthfully check your inbox or recent messages.",
      };
    }

    const emailSignals = assistant.communications.recent
      .filter(signal => signal.channel === "EMAIL")
      .map(signal => ({ signal, score: communicationScore(question, signal) }))
      .sort((a, b) => b.score - a.score || Date.parse(b.signal.receivedAt) - Date.parse(a.signal.receivedAt));

    const best = emailSignals.find(item => item.score > 0)?.signal ?? (queryTerms(question).length === 0 ? emailSignals[0]?.signal : null);
    if (!best) {
      return {
        capability: "personal.email",
        source: "assistant email feed",
        answer: "I do not see a matching recent email in the connected JARVIS email feed. That only means there is no match in the currently synchronized window.",
      };
    }

    return {
      capability: "personal.email",
      source: best.source,
      answer: "The latest matching email signal is from " + (best.from || "an unknown sender") + (best.subject ? " about “" + best.subject + "”" : "") + ", received " + new Date(best.receivedAt).toLocaleString() + ". " + best.summary,
    };
  }

  return null;
}

function stripKnowledgePrompt(query: string) {
  return query
    .replace(/^(hey\s+jarvis[,:\s]*)/i, "")
    .replace(/^(who|what)\s+(is|was|are|were)\s+/i, "")
    .replace(/^tell me (about|who|what)\s+/i, "")
    .replace(/^explain\s+/i, "")
    .replace(/[?]+$/g, "")
    .trim();
}

export async function lookupWorldKnowledgeFallback(query: string): Promise<DirectAnswer | null> {
  const lower = query.toLowerCase();
  if (/\b(today|latest|current|right now|news|price|score|weather|election|market)\b/.test(lower)) return null;

  const term = stripKnowledgePrompt(query);
  if (!term || term.length > 160) return null;

  try {
    const searchUrl = new URL("https://en.wikipedia.org/w/api.php");
    searchUrl.searchParams.set("action", "query");
    searchUrl.searchParams.set("list", "search");
    searchUrl.searchParams.set("srsearch", term);
    searchUrl.searchParams.set("srlimit", "1");
    searchUrl.searchParams.set("format", "json");
    searchUrl.searchParams.set("utf8", "1");

    const searchResponse = await fetch(searchUrl, {
      headers: { "User-Agent": "JarvisOS/0.2 personal-assistant fallback" },
      signal: AbortSignal.timeout(5000),
    });
    if (!searchResponse.ok) return null;
    const search = await searchResponse.json() as { query?: { search?: Array<{ title?: string }> } };
    const title = search.query?.search?.[0]?.title;
    if (!title) return null;

    const summaryResponse = await fetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title), {
      headers: { "User-Agent": "JarvisOS/0.2 personal-assistant fallback" },
      signal: AbortSignal.timeout(5000),
    });
    if (!summaryResponse.ok) return null;
    const summary = await summaryResponse.json() as { extract?: string; title?: string };
    const extract = summary.extract?.trim();
    if (!extract) return null;

    return {
      capability: "world.general",
      source: "Wikipedia fallback",
      answer: extract.length > 900 ? extract.slice(0, 897).trimEnd() + "…" : extract,
    };
  } catch {
    return null;
  }
}


export function needsLiveWorldSearch(query: string) {
  const lower = query.toLowerCase();
  return /\b(today|latest|current|right now|news|breaking|price|score|weather|recent|this week|this month)\b/.test(lower);
}

export async function lookupLiveWorldFallback(query: string): Promise<DirectAnswer | null> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey || !needsLiveWorldSearch(query)) return null;

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: true,
        include_raw_content: false,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) return null;
    const body = await response.json() as {
      answer?: string;
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };

    const direct = body.answer?.trim();
    if (direct) {
      return {
        capability: "world.web",
        source: "live web search",
        answer: direct.length > 1200 ? direct.slice(0, 1197).trimEnd() + "…" : direct,
      };
    }

    const snippets = (body.results ?? [])
      .slice(0, 3)
      .map(result => {
        const title = result.title?.trim() || "Source";
        const content = result.content?.trim() || "";
        return title + ": " + content;
      })
      .filter(Boolean);

    if (!snippets.length) return null;

    return {
      capability: "world.web",
      source: "live web search",
      answer: snippets.join(" ").slice(0, 1200),
    };
  } catch {
    return null;
  }
}
