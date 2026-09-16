import { getOrSeedFinanceState, ingestFinanceState } from "../../../../lib/finance-live";
import { FinanceAccountState, FinanceLiabilityState } from "../../../../lib/jarvis-runtime";

export const runtime = "nodejs";

export async function GET() {
  const state = await getOrSeedFinanceState();
  const ageMs = Math.max(0, Date.now() - Date.parse(state.asOf));
  return Response.json({
    state,
    live: state.mode === "DIRECT",
    ageSeconds: Number.isFinite(ageMs) ? Math.round(ageMs / 1000) : null,
  });
}

type FinanceIngestBody = {
  accounts?: FinanceAccountState[];
  liabilities?: FinanceLiabilityState[];
  source?: string;
  asOf?: string;
  connectionCount?: number;
  transactionHistory?: string;
  recurringHistory?: string;
  note?: string;
};

export async function POST(request: Request) {
  const secret = process.env.JARVIS_FINANCE_SECRET;
  if (!secret) {
    return Response.json({ ok: false, error: "Direct finance ingest is locked until JARVIS_FINANCE_SECRET is configured." }, { status: 503 });
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as FinanceIngestBody;
  if (!Array.isArray(body.accounts) || body.accounts.length === 0) {
    return Response.json({ ok: false, error: "accounts are required" }, { status: 400 });
  }

  const state = await ingestFinanceState({
    accounts: body.accounts,
    liabilities: Array.isArray(body.liabilities) ? body.liabilities : [],
    mode: "DIRECT",
    source: typeof body.source === "string" ? body.source : "DIRECT FINANCE INGEST",
    asOf: body.asOf,
    connectionCount: body.connectionCount,
    transactionHistory: body.transactionHistory,
    recurringHistory: body.recurringHistory,
    note: body.note,
  });

  return Response.json({ ok: true, state });
}
