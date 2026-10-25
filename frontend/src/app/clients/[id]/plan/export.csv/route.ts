import { currentUser } from "@/lib/auth";
import { callBackend } from "@/lib/backend";

/**
 * The plan as a file, because "download it on the same page" is what
 * people actually asked for.
 *
 * CSV rather than PDF: this is a working schedule that gets pasted into
 * a spreadsheet, forwarded, and edited. A PDF of it would look more
 * finished and be less useful. The branded PDF report is a different
 * document with a different job.
 *
 * Since 14.8c the bytes come from the Rust backend
 * (POST /api/internal/exports/plan — a byte-for-byte port incl. the
 * groupPlanByWeek week bucketing; golden fixture
 * backend/fixtures/14.8/plan.csv). This route stays for what needed a
 * Next runtime:
 *
 *   * the route-param parsing the original did: Number.parseInt(id, 10) +
 *     Number.isInteger() — a non-integer id 404s right here, no backend
 *     round-trip (same short-circuit the original had);
 *   * the user resolution canAccessClient() did internally:
 *     scopedClientIds() → currentUser() (session cookie → users row). The
 *     proxy passes `userId`; the Rust side re-derives the same scope
 *     (owner/manager unrestricted, member/viewer client_members IN(ids),
 *     empty assignment = sees nothing, null user = solo install). This is
 *     deliberately NOT the exportScope() the other export routes use — the
 *     plan download guards ONE client, so an inaccessible or missing client
 *     is the original's 404 "Not found", which the backend reports as
 *     {"ok":false,"notFound":true} and is mapped to the identical Response
 *     here.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const clientId = Number.parseInt(id, 10);
  if (!Number.isInteger(clientId)) {
    return new Response("Not found", { status: 404 });
  }

  const me = await currentUser();
  const r = await callBackend<
    | {
        ok: true;
        filename: string;
        contentType: string;
        disposition: string;
        csv: string;
      }
    | { ok: false; notFound: true }
  >("/api/internal/exports/plan", {
    body: { userId: me?.id ?? null, clientId },
  });

  if (!r.ok) return new Response("Not found", { status: 404 });
  return new Response(r.csv, {
    headers: {
      "content-type": r.contentType,
      "content-disposition": r.disposition,
    },
  });
}
