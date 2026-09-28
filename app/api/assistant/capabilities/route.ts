import { getJarvisRuntimeContext } from "../../../../lib/jarvis-context";
import { getJarvisCapabilities } from "../../../../lib/jarvis-assistant-tools";

export const runtime = "nodejs";

export async function GET() {
  const runtimeContext = await getJarvisRuntimeContext();
  const capabilities = await getJarvisCapabilities(runtimeContext);

  return Response.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    capabilities,
  });
}
