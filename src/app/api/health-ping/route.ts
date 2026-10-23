/**
 * Tiny liveness probe. Used by the restart flow to poll for the server
 * coming back. Side effect: writes the detected port to `.seo-port` so
 * the launcher always knows the right port to bind on next start.
 */

import { rememberPort, detectPortFromRequest } from "@/lib/port-memory";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  void rememberPort(detectPortFromRequest(req)).catch(() => undefined);
  return Response.json({ ok: true, t: Date.now() });
}
