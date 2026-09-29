import { sleep } from "workflow";

export async function jarvisWorkforceLoop(cadenceMinutes = 15, loopToken: string | null = null) {
  "use workflow";

  while (true) {
    const result = await runWorkforceHeartbeat(loopToken);
    if (!result.continue) return result;
    await sleep(cadenceMinutes * 60_000);
  }
}

async function runWorkforceHeartbeat(loopToken: string | null): Promise<{ continue: boolean; ranAt: string | null; status: string }> {
  "use step";

  const [{ getWorkforceState }, { runWorkforceCycle }] = await Promise.all([
    import("../lib/jarvis-runtime"),
    import("../lib/jarvis-workforce"),
  ]);

  const state = await getWorkforceState();
  if (state?.autonomy?.enabled === false) {
    return { continue: false, ranAt: state.lastCycleAt, status: state.status };
  }
  if (state?.autonomy?.loopToken && state.autonomy.loopToken !== loopToken) {
    return { continue: false, ranAt: state.lastCycleAt, status: state.status };
  }

  try {
    const workforce = await runWorkforceCycle();
    return { continue: true, ranAt: workforce.lastCycleAt, status: workforce.status };
  } catch (error) {
    console.error("Durable workforce heartbeat failed", error);
    return { continue: true, ranAt: state?.lastCycleAt ?? null, status: "DEGRADED" };
  }
}
