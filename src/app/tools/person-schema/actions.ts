"use server";

import { callBackend } from "@/lib/backend";
import { currentUserId } from "@/lib/auth";
import { clientIdFromRequest } from "@/lib/client-context";
import { guardAction } from "@/lib/action-guard";

// ---------------------------------------------------------------------------
// Task 14.6a: savePersonSchema is a thin proxy over
// /api/internal/tools/person-schema/save — the saveToolRun DB effect
// (tool_runs insert, label.slice(0,200), JSON columns) lives in
// backend/src/tools_basic.rs. The original's try/catch stays here so a
// backend failure surfaces as { ok:false, error } exactly like a DB failure
// did before the port. clientId/userId are resolved Next-side where the
// request context lives (saveToolRun's own resolution, 14.5a principle).
// ---------------------------------------------------------------------------

export type SaveState =
  | { ok: true; runId: number }
  | { ok: false; error: string }
  | null;

export async function savePersonSchema(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  await guardAction("edit", formData.get("clientId"));
  const name = String(formData.get("name") ?? "").trim();
  const jsonld = String(formData.get("jsonld") ?? "").trim();
  if (!name) return { ok: false, error: "Person name is required." };
  if (!jsonld) return { ok: false, error: "Generate the JSON-LD first." };
  try {
    const r = await callBackend<
      { ok: true; runId: number } | { ok: false; error: string }
    >("/api/internal/tools/person-schema/save", {
      body: {
        name,
        jsonld,
        clientId: await clientIdFromRequest(),
        userId: await currentUserId(),
      },
    });
    if (!r.ok) return { ok: false, error: r.error ?? "Save failed." };
    return { ok: true, runId: r.runId };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Save failed.",
    };
  }
}
