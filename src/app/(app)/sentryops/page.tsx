import { DomainScreen } from "@/components/dashboard/domain-screen";
import { loadDomainOverview } from "@/server/services/overview";

export const metadata = { title: "SentryOps" };

export default async function SentryOpsPage() {
  const { overview, goals, moves } = await loadDomainOverview("sentryops");

  return (
    <DomainScreen
      domain="sentryops"
      {...(overview.worldState.slices.sentryops ? { slice: overview.worldState.slices.sentryops } : {})}
      goals={goals}
      moves={moves}
      mission="Find the strongest evidence-backed opportunity in public safety operations. Field observations and public records are kept as separate kinds of evidence, and a hypothesis advances only when the current stage's bar is met — including when that means abandoning the current direction."
      notImplemented={[
        "Public records, procurement and contract research",
        "Competitor and vendor tracking",
        "Agency and observation capture",
        "Any outbound contact with an agency",
      ]}
    />
  );
}
