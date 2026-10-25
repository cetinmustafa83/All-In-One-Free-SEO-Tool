/**
 * Shared proxy plumbing for the CSV export routes (Tasks 14.8a + 14.8b).
 *
 * The src/app/{clients,competitors,audits,backlinks,tasks,outreach,reports,
 * monitor,keywords}/export.csv/route.ts downloads and the
 * src/app/backlinks/disavow.txt route became thin proxies over the Rust
 * backend's POST /api/internal/exports/* endpoints (byte-for-byte ports of
 * the original drizzle+csvResponse implementations — golden fixtures
 * in backend/fixtures/14.8/). What stays in Next is exactly what needed a
 * Next runtime:
 *
 *   * the user resolution exportScope() did internally: scopedClientIds()
 *     → currentUser() (session cookie → users row). The proxy resolves the
 *     user and passes `userId`; the Rust side re-derives the same
 *     visibleClientIds scope (owner/manager unrestricted, member/viewer
 *     client_members IN(ids), empty assignment IN(-1), null = solo install).
 *   * the `?clientId=` / legacy `?client=` normalization exportScope did:
 *     a present-but-empty value is NO filter; only a raw value Number()ing
 *     to a positive integer narrows the export; anything else (0, negative,
 *     unparseable) becomes the always-false filter, which the body carries
 *     as the `-1` sentinel ("an unparseable clientId yields an empty export
 *     rather than everything").
 *   * 14.8b disavow only: the FILENAME is raw-string semantics the original
 *     route computed from the query string itself (clientId truthiness +
 *     `replace(/[^0-9]/g, "")` — "?clientId=abc" yields
 *     disavow-client-.txt), so it is computed here where that regex IS the
 *     semantics and passed in the body; every other byte comes back from
 *     the backend envelope.
 *
 * The CSV bytes, filename, content-type and disposition come back verbatim
 * from the backend envelope; the route wraps them in a Response with the
 * same transport headers the original csvResponse() produced, status 200
 * always — including the header-only empty result.
 */

import { currentUser } from "./auth";
import { callBackend } from "./backend";

export type ExportResult = {
  ok: true;
  filename: string;
  contentType: string;
  disposition: string;
  csv: string;
};

/** The raw `?clientId=` / legacy `?client=` query value (first wins). */
export function rawClientParam(req: Request): string | null {
  const params = new URL(req.url).searchParams;
  // exportScope: `params.get("clientId") ?? params.get("client")` — the
  // first param wins when present, even if its value is "".
  return params.get("clientId") ?? params.get("client");
}

/**
 * disavow.txt route filename logic, verbatim:
 *   const filename = clientId
 *     ? `disavow-client-${clientId.replace(/[^0-9]/g, "")}.txt`
 *     : `disavow-all.txt`;
 * (empty-string raw is falsy → disavow-all.txt; non-digit suffixes are
 * stripped — "?clientId=abc" → disavow-client-.txt).
 */
export function disavowFilename(raw: string | null): string {
  return raw
    ? `disavow-client-${raw.replace(/[^0-9]/g, "")}.txt`
    : "disavow-all.txt";
}

export async function exportCsvProxy(
  req: Request,
  endpoint: string,
  filename?: string,
): Promise<Response> {
  const raw = rawClientParam(req);
  let clientId: number | null = null;
  if (raw !== null && raw !== "") {
    const id = Number(raw);
    clientId = Number.isInteger(id) && id > 0 ? id : -1;
  }

  const me = await currentUser();

  const r = await callBackend<ExportResult>(endpoint, {
    body: {
      userId: me?.id ?? null,
      clientId,
      ...(filename !== undefined ? { filename } : {}),
    },
  });

  return new Response(r.csv, {
    status: 200,
    headers: {
      "content-type": r.contentType,
      "content-disposition": r.disposition,
    },
  });
}
