"use server";

import { revalidatePath } from "next/cache";
import { callBackend } from "@/lib/backend";
import { guardAction } from "@/lib/action-guard";

// Task 14.5a: the CSV parse, header sniffing, dedupe and insert now live in
// backend/src/keywords.rs; this is a thin proxy. The quoted-CSV parser that
// used to live here moved with it (the backlinks variant is a separate
// port — the two parsers differ on lone \r handling).

export type ImportResult =
  | { ok: true; added: number; skipped: number; total: number }
  | { ok: false; error: string };

export async function importKeywords(
  _prev: ImportResult | null,
  formData: FormData,
): Promise<ImportResult> {
  await guardAction("edit", formData.get("clientId"));
  const csv = String(formData.get("csv") ?? "").trim();
  const targetClientId = Number(formData.get("clientId"));

  const result = await callBackend<ImportResult>("/api/internal/keywords/import", {
    body: { clientId: targetClientId, csv },
  });

  if (result.ok) {
    revalidatePath("/keywords");
  }
  return result;
}
