"use server";

import { revalidatePath } from "next/cache";
import {
  buildMigrationMap,
  renderRedirectMap,
  type MigrationMap,
} from "@/lib/migration-mapper";
import { saveToolRun } from "@/lib/tool-runs";
import { callBackend } from "@/lib/backend";
import { guardAction } from "@/lib/action-guard";

// ---------------------------------------------------------------------------
// Task 14.6a: importToRedirectRules keeps the COMPUTE half Next-side
// (buildMigrationMap is pure fuzzy matching — a later wave) and sends the
// pre-shaped rows to /api/internal/tools/migration-map/import, which does
// the redirect_rules inserts in backend/src/tools_basic.rs (14.5b
// verdicts-over-the-wire). runMapping stays entirely Next-side: it writes
// tool_runs via saveToolRun and renders config output, no port yet.
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
    const map = buildMigrationMap({ oldUrls: olds, newUrls: news });
    const output = renderRedirectMap(map);
    await saveToolRun({
      toolId: "migration-map",
      label: `${olds.length} → ${news.length} URLs · ${map.rows.length} matched`,
      input: { oldCount: olds.length, newCount: news.length },
      result: { ok: true, map, output },
    }).catch(() => undefined);
    return { ok: true, map, output };
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? "Mapping failed" };
  }
}
