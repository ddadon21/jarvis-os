import type { Confidence, Domain, EvidenceKind, Importance } from "@/core/types";

/**
 * Memory is layered, not a single vector store.
 *
 * Dumping everything into one embedding index destroys the properties that
 * make facts useful: a trade's entry price is not "semantically similar" to
 * anything, it is exactly $4,512.25 and it belongs in a column. The rule for
 * this codebase is that a fact which fits a relational table stays in a
 * relational table, and the memory system stores what genuinely does not —
 * context, narrative, lessons, documents.
 */

export const memoryClasses = [
  /** Current task/conversation state. Ephemeral, bounded, not durable truth. */
  "working",
  /** Long-lived context owned by one domain. Scoped to that domain only. */
  "domain",
  /** Significant outcomes and the lessons drawn from them. */
  "episodic",
  /** Research, contracts, reports, uploads. Chunked; original kept in Storage. */
  "document",
  /**
   * Relational facts — trades, transactions, goals, agencies. Listed here for
   * completeness, but NOT stored in the memories table. This value exists so
   * code can talk about where a fact lives without pretending it lives here.
   */
  "structured",
  /** Embedding-backed recall over the above. An index, not a source of truth. */
  "semantic",
] as const;
export type MemoryClass = (typeof memoryClasses)[number];

/** Memory classes that are actually persisted as memory records. */
export const storableMemoryClasses = [
  "working",
  "domain",
  "episodic",
  "document",
] as const satisfies readonly MemoryClass[];
export type StorableMemoryClass = (typeof storableMemoryClasses)[number];

export interface MemoryRecord {
  readonly id: string;
  readonly userId: string;
  readonly memoryClass: StorableMemoryClass;
  readonly domain: Domain;
  readonly title: string;
  readonly content: string;
  /** Short form used when packing context for an agent under a token budget. */
  readonly summary?: string;
  readonly importance: Importance;
  readonly tags: readonly string[];
  readonly evidenceKind: EvidenceKind;
  readonly confidence: Confidence;
  /** What produced this memory: `user`, an agent id, or an integration name. */
  readonly source: string;
  /** Row in a domain table this memory describes, when applicable. */
  readonly sourceRef?: { readonly table: string; readonly id: string };
  /**
   * Beliefs go stale. A memory is valid over an interval, and a newer memory
   * can supersede it rather than overwrite it — the old belief and the moment
   * it was replaced are both worth keeping.
   */
  readonly validFrom: string;
  readonly validUntil?: string;
  readonly supersededById?: string;
  readonly createdAt: string;
  readonly lastAccessedAt?: string;
  readonly accessCount: number;
}

export interface MemoryDraft {
  readonly memoryClass: StorableMemoryClass;
  readonly domain: Domain;
  readonly title: string;
  readonly content: string;
  readonly summary?: string;
  readonly importance?: Importance;
  readonly tags?: readonly string[];
  readonly evidenceKind?: EvidenceKind;
  readonly confidence?: Confidence;
  readonly source: string;
  readonly sourceRef?: { readonly table: string; readonly id: string };
  readonly validFrom?: string;
}

/**
 * The slice of memory a given agent may read.
 *
 * Least-context is a security control as much as a cost control: the SentryOps
 * research agent has no business seeing transaction history, and the cheapest
 * way to guarantee that is for the query itself to be incapable of returning it.
 */
export interface MemoryScope {
  readonly domains: readonly Domain[];
  readonly classes: readonly StorableMemoryClass[];
  /** Hard cap on records returned, to keep prompts bounded. */
  readonly maxRecords: number;
}

export interface MemoryQuery {
  readonly scope: MemoryScope;
  readonly text?: string;
  readonly tags?: readonly string[];
  readonly minImportance?: Importance;
  /** Excludes memories superseded or expired before this instant. */
  readonly asOf?: string;
  readonly limit?: number;
}
