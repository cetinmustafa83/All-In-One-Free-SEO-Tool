import { disavowFilename, exportCsvProxy } from "@/lib/export-proxy";

export const dynamic = "force-dynamic";

/**
 * Google disavow file — since 14.8b a thin proxy over the Rust backend's
 * POST /api/internal/exports/disavow (byte-for-byte port of the original
 * status='disavow' backlinks query grouped by source_domain with
 * localeCompare-sorted domain blocks; verified against
 * backend/fixtures/14.8/). User resolution and ?clientId/?client
 * normalization live in src/lib/export-proxy.ts; the filename is computed
 * HERE because the original semantics operate on the raw query string
 * (`?clientId=` truthiness + `replace(/[^0-9]/g, "")`).
 *
 * The per-client page links ?clientId=; old links used ?client=.
 * exportScope reads both. Reading only `client` meant the per-client
 * button downloaded every client's disavowed domains — a file meant
 * for one Search Console property.
 */
export async function GET(req: Request) {
  const raw = disavowFilename(
    new URL(req.url).searchParams.get("clientId") ??
      new URL(req.url).searchParams.get("client"),
  );
  return exportCsvProxy(req, "/api/internal/exports/disavow", raw);
}
