"use server";

import { revalidatePath } from "next/cache";
import { pingAll } from "@/lib/uptime";
import { callBackend } from "@/lib/backend";
import { guardAction } from "@/lib/action-guard";

// ---------------------------------------------------------------------------
// Task 14.6a: addTarget/deleteTarget/toggleTarget are thin proxies over
// /api/internal/tools/uptime/* — the DB effects (uptime_targets) live in
// backend/src/tools_basic.rs. runPingNow is NOT ported: pingAll performs
// outbound HTTP pings and stays Next-side.
// ---------------------------------------------------------------------------

export async function addTarget(formData: FormData) {
  await guardAction("edit", formData.get("clientId"));
  const url = String(formData.get("url") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim() || null;
  const expectedStatus = Number(formData.get("expectedStatus") ?? 200);
  const expectedText = String(formData.get("expectedText") ?? "").trim() || null;
  if (!url) return { ok: false as const, error: "URL required." };
  if (!/^https?:\/\//i.test(url))
    return { ok: false as const, error: "URL must start with http(s)://" };
  // JSON cannot carry NaN: an explicit null tells the Rust endpoint the
  // coercion produced NaN, which failed the original insert with SQLite's
  // NOT NULL error — the endpoint reproduces that exact failure.
  await callBackend("/api/internal/tools/uptime/add", {
    body: {
      url,
      label,
      expectedStatus: Number.isFinite(expectedStatus) ? expectedStatus : null,
      expectedText,
    },
  });
  revalidatePath("/tools/uptime");
  return { ok: true as const };
}

export async function deleteTarget(id: number) {
  await guardAction("edit");
  await callBackend("/api/internal/tools/uptime/delete", { body: { id } });
  revalidatePath("/tools/uptime");
}

export async function toggleTarget(id: number, enabled: boolean) {
  await guardAction("edit");
  await callBackend("/api/internal/tools/uptime/toggle", {
    body: { id, enabled },
  });
  revalidatePath("/tools/uptime");
}

export async function runPingNow() {
  await guardAction("edit");
  const r = await pingAll();
  revalidatePath("/tools/uptime");
  return r;
}
