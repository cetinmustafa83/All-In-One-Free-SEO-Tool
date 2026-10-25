"use server";

import { revalidatePath } from "next/cache";
import { buildMigrationMap, type MigrationMap } from "@/lib/migration-mapper";
import { callBackend } from "@/lib/backend";
import { currentUserId } from "@/lib/auth";
import { clientIdFromRequest } from "@/lib/client-context";
import { guardAction } from "@/lib/action-guard";

// ---------------------------------------------------------------------------
// Task 14.6a: importToRedirectRules keeps the COMPUTE half Next-side
// (buildMigrationMap is pure fuzzy matching — a later wave) and sends the
// pre-shaped rows to /api/internal/tools/migration-map/import, which does
// the redirect_rules inserts in backend/src/tools_basic.rs (14.5b
// verdicts-over-the-wire).
//
// Task 14.6b: runMapping is now the proxy over
// /api/internal/tools/migration-map/run — the fuzzy matcher, the config
// renderers and the tool_runs write live in backend/src/tools_compute.rs.
// The one piece that stays Next-side is the WHATWG `new URL` shaping
// (pathname/search with dot-segment resolution and percent-encoding), which
// every helper in the mapper leaned on; the proxy pre-shapes each URL into
// { url, pathname, search, ok } (ok:false = the original's try/catch
// fallbacks) and the Rust side does everything else. Validation, error
// strings and the try/catch around the call stay here, byte-identical.
// ---------------------------------------------------------------------------

export type MigrationState =
  | {
      ok: true;
      map: MigrationMap;
      output: { nginx: string; apache: string; nextjs: string };
    }
  | { ok: false; error: string };

function splitList(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 1000);
}

export type ImportState =
  | { ok: true; inserted: number }
  | { ok: false; error: string };

/**
 * Take old + new URL lists, run the mapper, and persist confident-match
 * rows (≥85% confidence) into redirect_rules. The user can then edit /
 * delete from the redirect manager.
 */
export async function importToRedirectRules(
  _prev: ImportState | null,
  formData: FormData,
): Promise<ImportState> {
  await guardAction("edit", formData.get("clientId"));
  const oldRaw = String(formData.get("oldUrls") ?? "");
  const newRaw = String(formData.get("newUrls") ?? "");
  const olds = splitList(oldRaw);
  const news = splitList(newRaw);
  if (olds.length === 0 || news.length === 0)
    return { ok: false, error: "Both URL lists are required." };

  try {
    const map = buildMigrationMap({ oldUrls: olds, newUrls: news });
    const usable = map.rows.filter((r) => r.newUrl && r.confidence >= 0.85);
    if (usable.length === 0)
      return {
        ok: false,
        error: "No high-confidence matches to import. Review the table first.",
      };

    // Row shaping uses the exact `new URL` semantics the original used;
    // rows that fail to parse are skipped like the original's per-row
    // try/catch. The note text is baked here so it is byte-identical.
    const rows: { sourcePath: string; targetUrl: string; note: string }[] = [];
    for (const r of usable) {
      try {
        const u = new URL(
          /^https?:\/\//i.test(r.oldUrl) ? r.oldUrl : `https://x${r.oldUrl}`,
        );
        const sourcePath = u.pathname + (u.search ?? "");
        rows.push({
          sourcePath,
          targetUrl: r.newUrl ?? "",
          note: `Auto-imported from migration map (${(r.confidence * 100).toFixed(0)}% confidence)`,
        });
      } catch {
        // skip invalid rows
      }
    }

    const result = await callBackend<{ ok: boolean; inserted: number }>(
      "/api/internal/tools/migration-map/import",
      { body: { rows } },
    );
    revalidatePath("/tools/redirects-manager");
    return { ok: true, inserted: result.inserted };
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? "Import failed" };
  }
}

/**
 * One URL pre-shaped with the exact WHATWG semantics the mapper's helpers
 * relied on (`new URL(scheme-prepended)`): pathname + search, or ok:false
 * when the URL failed to parse — the Rust side reproduces the catch arms
 * (samePath string equality, tokenize over the raw url, pathOnly = raw url)
 * from that flag.
 */
type ShapedUrl = {
  url: string;
  pathname: string;
  search: string;
  ok: boolean;
};

function shapeUrl(raw: string): ShapedUrl {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://x${raw}`);
    return { url: raw, pathname: u.pathname, search: u.search, ok: true };
  } catch {
    return { url: raw, pathname: "", search: "", ok: false };
  }
}

export async function runMapping(
  _prev: MigrationState | null,
  formData: FormData,
): Promise<MigrationState> {
  await guardAction("edit", formData.get("clientId"));
  const oldRaw = String(formData.get("oldUrls") ?? "");
  const newRaw = String(formData.get("newUrls") ?? "");
  const olds = splitList(oldRaw);
  const news = splitList(newRaw);
  if (olds.length === 0)
    return { ok: false, error: "Paste old URLs (one per line)." };
  if (news.length === 0)
    return { ok: false, error: "Paste new URLs (one per line)." };
  try {
    const r = await callBackend<{
      ok: true;
      map: MigrationMap;
      output: { nginx: string; apache: string; nextjs: string };
    }>("/api/internal/tools/migration-map/run", {
      body: {
        olds: olds.map(shapeUrl),
        news: news.map(shapeUrl),
        clientId: await clientIdFromRequest(),
        userId: await currentUserId(),
      },
    });
    return { ok: true, map: r.map, output: r.output };
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? "Mapping failed" };
  }
}
