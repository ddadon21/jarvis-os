import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";

/**
 * Liveness probe.
 *
 * Reports the configured data source deliberately: knowing whether a
 * deployment is serving development data is the first thing worth checking
 * when a number looks wrong.
 */
export async function GET() {
  const env = serverEnv();

  return NextResponse.json({
    status: "ok",
    appEnv: env.APP_ENV,
    dataSource: env.JARVIS_DATA_SOURCE,
    time: new Date().toISOString(),
  });
}
