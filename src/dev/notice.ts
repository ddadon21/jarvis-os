/**
 * DEVELOPMENT DATA.
 *
 * Everything under `src/dev` is invented. None of it comes from a broker, a
 * bank, a public record or the user. It exists so the shell can be built and
 * reasoned about before any integration exists.
 *
 * Two rules, and they are not negotiable:
 *   1. Every surface rendering this data must say so. `dataQuality: "mock"`
 *      flows through World State into the UI badge for exactly this reason.
 *   2. No number in here may ever be presented as a real balance, position or
 *      market fact. A dashboard that lies convincingly is worse than no
 *      dashboard.
 */

export const DEV_DATA_NOTICE =
  "Development data — invented figures for layout and logic only. Not real balances, positions or market facts.";

/** Stand-in user id used until Supabase Auth is wired up. */
export const DEV_USER_ID = "00000000-0000-4000-8000-000000000001";
