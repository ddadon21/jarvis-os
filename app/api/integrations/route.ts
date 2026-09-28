import { getJarvisIntegrationRegistry } from "../../../lib/jarvis-integration-registry";

export const runtime = "nodejs";

export async function GET() {
  const integrations = await getJarvisIntegrationRegistry();
  return Response.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    integrations,
  });
}
