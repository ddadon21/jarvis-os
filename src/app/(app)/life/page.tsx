import { DomainScreen } from "@/components/dashboard/domain-screen";
import { loadDomainOverview } from "@/server/services/overview";

export const metadata = { title: "Life" };

export default async function LifePage() {
  const { overview, goals, moves } = await loadDomainOverview("life");

  return (
    <DomainScreen
      domain="life"
      {...(overview.worldState.slices.life ? { slice: overview.worldState.slices.life } : {})}
      goals={goals}
      moves={moves}
      mission="Keep commitments, relocation and major purchases honest against the financial picture. This domain exists to prevent decisions made in isolation — it is not a habit tracker and will not become one."
      notImplemented={[
        "Calendar integration",
        "Commitment capture",
        "Relocation and purchase planning tools",
      ]}
    />
  );
}
