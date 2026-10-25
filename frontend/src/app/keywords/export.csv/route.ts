import { exportCsvProxy } from "@/lib/export-proxy";

export const dynamic = "force-dynamic";

/**
 * Keywords CSV export — since 14.8b a thin proxy over the Rust backend's
 * POST /api/internal/exports/keywords (byte-for-byte port of the original
 * route INCLUDING its bespoke local csvEscape — trigger class [",\n], no
 * \r — the full unfiltered keyword_rankings scan folded to the latest row
 * per keyword, and the keywords-<UTC date>.csv filename; verified against
 * backend/fixtures/14.8/). User resolution and ?clientId/?client
 * normalization live in src/lib/export-proxy.ts.
 */
export async function GET(req: Request) {
  return exportCsvProxy(req, "/api/internal/exports/keywords");
}
