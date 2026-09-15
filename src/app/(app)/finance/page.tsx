import { DomainScreen } from "@/components/dashboard/domain-screen";
import { loadDomainOverview } from "@/server/services/overview";

export const metadata = { title: "Finance" };

export default async function FinancePage() {
  const { overview, goals, moves } = await loadDomainOverview("finance");

  return (
    <DomainScreen
      domain="finance"
      {...(overview.worldState.slices.finance ? { slice: overview.worldState.slices.finance } : {})}
      goals={goals}
      moves={moves}
      mission="Run the whole financial system, not a balance list: every account has a purpose, every inbound dollar has a destination, and every major decision is answered in terms of the goals it moves."
      notImplemented={[
        "Bank, card and brokerage connections",
        "Transaction import and automatic classification",
        "Tax reserve calculation",
        "Any movement of money — permanently gated behind approval",
      ]}
    />
  );
}
