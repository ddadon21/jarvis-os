import { DomainScreen } from "@/components/dashboard/domain-screen";
import { loadDomainOverview } from "@/server/services/overview";

export const metadata = { title: "Trading" };

export default async function TradingPage() {
  const { overview, goals, moves } = await loadDomainOverview("trading");

  return (
    <DomainScreen
      domain="trading"
      {...(overview.worldState.slices.trading ? { slice: overview.worldState.slices.trading } : {})}
      goals={goals}
      moves={moves}
      mission="Learn the real trading process from evidence: every executed trade, every skipped setup, the context around both, and whether the plan was followed. Analysis comes after the dataset, and live autonomy comes long after that."
      notImplemented={[
        "Tradovate, TradeLocker and TradingView connections",
        "Automatic trade capture — journaling is manual until a feed exists",
        "Market data and economic calendar ingestion",
        "Strategy backtesting and the shadow trader",
        "Any order placement, live or paper",
      ]}
    />
  );
}
