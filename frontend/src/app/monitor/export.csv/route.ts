import { exportCsvProxy } from "@/lib/export-proxy";

export const dynamic = "force-dynamic";

/**
 * Page-monitor CSV export — since 14.8b a thin proxy over the Rust backend's
 * POST /api/internal/exports/monitor (byte-for-byte port of the original
 * drizzle INNER JOIN monitored_pages + LEFT JOIN clients query + csvResponse,
 * filename page-changes.csv, verified against backend/fixtures/14.8/).
 * User resolution and ?clientId/?client normalization live in
 * src/lib/export-proxy.ts.
 */
export async function GET(req: Request) {
  return exportCsvProxy(req, "/api/internal/exports/monitor");
}
