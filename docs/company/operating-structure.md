# Himie Johnson Ventures — Future Operating Structure

**Status: direction only. Not authorized for implementation.**
Do not build the GPT/Claude executive layer, the Company Constitution system or
Founder Away Mode until Dwight explicitly authorizes it. Until then, all work
must stay compatible with this structure and must not make it harder to reach.

Recorded 2026-10-05 from Dwight's own statement of direction.

## Hierarchy

```
DWIGHT — Founder / CEO
  ↓
HIMIE JOHNSON VENTURES COMPANY CONSTITUTION (versioned)
  ↓
JARVIS — shared truth, orchestration, governance, memory and authority layer
  ↓
GPT ↔ CLAUDE — peer executive intelligences
  ↓
CHIEF OF STAFF / SPECIALIZED AGENT WORKFORCE
  ↓
TOOLS, DATA, CODE, RESEARCH, FINANCES, SENTRYOPS, TRADING SYSTEMS
AND FUTURE REVENUE OPERATIONS
```

## Authority

- Dwight remains Founder/CEO.
- Jarvis and the versioned Company Constitution hold authority and are the source of truth.
- Neither GPT nor Claude may rewrite company doctrine, widen its own authority or
  become the ultimate source of truth.

## GPT and Claude as peer executives

They are business partners under Dwight and the Constitution, not competitors,
and they do not blindly agree.

Default leanings (defaults, not permanent monopolies):

| GPT | Claude |
| --- | --- |
| Strategy, company standards | Technical architecture |
| Cross-domain reasoning, prioritization | Implementation, engineering execution |
| Capital strategy, scope control | Codebase reasoning, deep technical analysis |
| Executive review, contradiction detection | Debugging, testing |
| Whether work actually advances the mission | |

- Jarvis should eventually route each class of task to whichever model is
  demonstrably best at it, based on evidence.
- For important decisions, one model creates and the other challenges/reviews.
- They disagree when evidence warrants it and resolve disagreement through
  evidence, testing, company policy and clearly defined decision rights — not by
  automatically compromising.

## Founder-independent operations

The target is durable founder-independent operations, not uncontrolled AI
autonomy. Over months and years, as data, revenue, customers, processes and
operating evidence accumulate, Dwight should be able to step away for weeks,
months or longer while the company:

- preserves its standards and mission;
- continues safe authorized operations;
- protects and improves existing revenue systems;
- detects failures and repairs reversible internal problems;
- continues approved research, engineering, monitoring, QA and optimization;
- refuses scope creep;
- maintains complete institutional memory;
- keeps financial and operational state current;
- escalates consequential decisions instead of guessing;
- sends Dwight notifications, questions and approval requests when his authority is required;
- keeps a complete audit trail of what happened, why, which person or model made
  the recommendation, what evidence supported it and what changed;
- survives a failure or outage of any single model provider.

Eventually this becomes a formal **Founder Away Mode** with tested authority
levels, budgets, escalation rules, provider failover, stop conditions,
emergency handling and return-to-Founder briefs.

## Wealth objective

Use Dwight's real financial, business, trading, product and operating data to
move him through successive wealth stages toward $100M — not technology for its
own sake. Always optimize for the current real stage, evidence and constraints,
never fantasy numbers or reckless risk.

## Doctrine

- Mission first.
- Finish before expanding.
- Continuously detect gaps.
- Controlled aggression.
- Do not build version 20 while version 3 is still broken.
- Jarvis does not reward activity. It rewards completed outcomes.
- Evidence before claims.
- The smallest reversible effective intervention before redesign.
- Close the loop, verify the result, then expand.

## How the current system already fits (2026-10-05)

- Doctrine and governance live in one git-versioned file,
  `lib/jarvis-core-policy.ts`. No agent or chat tool can edit doctrine,
  permissions or its own authority; trading rules change only behind the owner login.
- Authority levels already exist: AUTO_PROCEED, USER_AUTHORIZED,
  WAIT_FOR_DWIGHT, BLOCKED. Approvals are stored server-side with who decided and why.
- Every agent result records the model that produced it, its tool calls and its
  evidence, and is labelled VERIFIED / OBSERVED / CLAIMED; QA flags claims without evidence.
- Model choices are centralized in `lib/jarvis-models.ts`, the natural place for
  future task-class routing and failover.
- The Chief of Staff (EXECUTIVE) is a workforce agent, so an executive layer can sit above it.
- The learning pipeline never self-promotes; live order execution stays blocked
  (see `docs/trading/ea-roadmap.md`).

## Known gaps against this structure (not yet authorized to fix)

1. **No mid-run provider failover.** Agents pick Claude if configured, else GPT;
   if the chosen provider fails mid-task, the task fails honestly instead of
   switching providers.
2. **No versioned Constitution.** Doctrine in code is the older six-line list,
   not the doctrine above, and decisions do not record a Constitution version.
3. **QA is rule-based**, not a second-model challenger review.
4. **Approvals do not reach Dwight.** They appear only in the Workforce inbox;
   no push/email notifications and no return-to-Founder brief.
5. **Audit trail is partial.** It records the recommending model and evidence,
   but not the reviewing model or the points of disagreement.

## Rules for work until authorization

- Do not implement the GPT/Claude executive layer, Constitution system or Away Mode.
- Do not add anything that lets an agent or model change doctrine, permissions or its own authority.
- Keep model selection centralized; do not hard-code a single provider into new features.
- Keep recording model, evidence and decision-maker on every result and approval.
- Escalate consequential or irreversible actions to Dwight.
