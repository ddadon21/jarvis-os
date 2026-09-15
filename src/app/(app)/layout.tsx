import type { ReactNode } from "react";
import { BottomTabs, SideRail } from "@/components/shell/nav";
import { TopBar } from "@/components/shell/top-bar";
import { loadOverview } from "@/server/services/overview";

/**
 * The application shell.
 *
 * Renders on the server and reads the mission rollup directly, so the header
 * status is correct on first paint rather than arriving after a client fetch.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const overview = await loadOverview();

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar
        status={overview.mission.overall}
        headline={overview.mission.headline}
        dataSource={overview.dataSource === "dev" ? "dev data" : "live"}
      />

      <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-6 px-4 py-5 sm:px-6 lg:py-8">
        <SideRail />
        {/* Bottom padding clears the mobile tab bar. */}
        <main className="min-w-0 flex-1 pb-24 lg:pb-0">{children}</main>
      </div>

      <BottomTabs />
    </div>
  );
}
