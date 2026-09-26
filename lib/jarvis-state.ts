export type Domain = "TRADING" | "FINANCE" | "SENTRYOPS" | "LIFE";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
};

export type GoalState = "RED" | "YELLOW" | "GREEN";

export type JarvisGoal = {
  name: string;
  value: number;
  state: GoalState;
};

export type JarvisMemory = {
  id: string;
  domain: Domain | "CORE";
  fact: string;
  createdAt: string;
};

export type JarvisNextMove = {
  title: string;
  reason: string;
  domain: Domain | "CORE";
};

export type JarvisClientState = {
  version: 1;
  activeDomain: Domain;
  messages: ChatMessage[];
  memories: JarvisMemory[];
  goals: JarvisGoal[];
  nextMove: JarvisNextMove;
};

const STORAGE_KEY = "jarvis-os-state-v1";

export const defaultGoals: JarvisGoal[] = [
  { name: "Debt Freedom", value: 18, state: "RED" },
  { name: "$10K Liquid", value: 34, state: "YELLOW" },
  { name: "Move Out", value: 27, state: "RED" },
  { name: "GR Supra", value: 11, state: "RED" },
];

export const defaultState: JarvisClientState = {
  version: 1,
  activeDomain: "TRADING",
  messages: [
    {
      role: "assistant",
      content:
        "Core online. I’m running in foundation mode. Trading, Finance, SentryOps, and Life are separated. Tell me what you want to accomplish, and I’ll keep the reasoning in the correct lane.",
      createdAt: new Date().toISOString(),
    },
  ],
  memories: [],
  goals: defaultGoals,
  nextMove: {
    title: "Connect real data sources",
    reason:
      "Start with secure persistence, then finance and trading data so Jarvis can replace placeholders with live state.",
    domain: "CORE",
  },
};

export function loadJarvisState(): JarvisClientState {
  if (typeof window === "undefined") return defaultState;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;

    const parsed = JSON.parse(raw) as Partial<JarvisClientState>;
    if (parsed.version !== 1) return defaultState;

    return {
      version: 1,
      activeDomain: isDomain(parsed.activeDomain) ? parsed.activeDomain : defaultState.activeDomain,
      messages: Array.isArray(parsed.messages) && parsed.messages.length > 0 ? parsed.messages.slice(-80) : defaultState.messages,
      memories: Array.isArray(parsed.memories) ? parsed.memories.slice(-100) : [],
      goals: Array.isArray(parsed.goals) && parsed.goals.length > 0 ? parsed.goals : defaultGoals,
      nextMove: parsed.nextMove && typeof parsed.nextMove.title === "string" ? parsed.nextMove : defaultState.nextMove,
    };
  } catch {
    return defaultState;
  }
}

export function saveJarvisState(state: JarvisClientState): void {
  if (typeof window === "undefined") return;

  const compact: JarvisClientState = {
    ...state,
    messages: state.messages.slice(-80),
    memories: state.memories.slice(-100),
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
}

export function mergeMemories(current: JarvisMemory[], updates: Array<{ domain?: string; fact?: string }>): JarvisMemory[] {
  const seen = new Set(current.map((item) => `${item.domain}:${item.fact.trim().toLowerCase()}`));
  const next = [...current];

  for (const update of updates) {
    const fact = typeof update.fact === "string" ? update.fact.trim() : "";
    const domain = isDomain(update.domain) ? update.domain : "CORE";
    if (!fact || fact.length > 280) continue;

    const key = `${domain}:${fact.toLowerCase()}`;
    if (seen.has(key)) continue;

    seen.add(key);
    next.push({
      id: crypto.randomUUID(),
      domain,
      fact,
      createdAt: new Date().toISOString(),
    });
  }

  return next.slice(-100);
}

function isDomain(value: unknown): value is Domain {
  return value === "TRADING" || value === "FINANCE" || value === "SENTRYOPS" || value === "LIFE";
}
