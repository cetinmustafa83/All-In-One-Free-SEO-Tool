"use server";

import { revalidatePath } from "next/cache";
import { callBackend } from "@/lib/backend";
import { guardAction } from "@/lib/action-guard";

// ---------------------------------------------------------------------------
// Task 14.6a: all five actions are thin proxies over /api/internal/tools/
// redirects/* — the DB effects (redirect_rules + not_found_log) live in
// backend/src/tools_basic.rs. guardAction stays FIRST, the hand-rolled
// validation stays here so the UI error strings are byte-identical (the
// Rust endpoint re-validates the same rules for direct callers), and
// revalidatePath stays Next-only.
// ---------------------------------------------------------------------------

export async function addRule(formData: FormData) {
  await guardAction("edit", formData.get("clientId"));
  const sourcePath = String(formData.get("sourcePath") ?? "").trim();
  const targetUrl = String(formData.get("targetUrl") ?? "").trim();
  const statusCode = Number(formData.get("statusCode") ?? 301);
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!sourcePath || !targetUrl)
    return { ok: false as const, error: "Source path + target URL required." };
  if (!sourcePath.startsWith("/"))
    return { ok: false as const, error: "Source path must start with /" };
  if (!/^https?:\/\//i.test(targetUrl) && !targetUrl.startsWith("/"))
    return { ok: false as const, error: "Target must be absolute URL or /-prefixed path." };
  if (![301, 302, 307, 308, 410].includes(statusCode))
    return { ok: false as const, error: "Status code must be 301/302/307/308/410." };
  await callBackend("/api/internal/tools/redirects/add", {
    body: { sourcePath, targetUrl, statusCode, note },
  });
  revalidatePath("/tools/redirects-manager");
  return { ok: true as const };
}

export async function deleteRule(id: number) {
  await guardAction("edit");
  await callBackend("/api/internal/tools/redirects/delete", { body: { id } });
  revalidatePath("/tools/redirects-manager");
}

export async function record404(formData: FormData) {
  await guardAction("edit", formData.get("clientId"));
  const sourcePath = String(formData.get("sourcePath") ?? "").trim();
  if (!sourcePath) return { ok: false as const };
  await callBackend("/api/internal/tools/redirects/404/record", {
    body: { sourcePath },
  });
  revalidatePath("/tools/redirects-manager");
  return { ok: true as const };
}

export async function resolve404(formData: FormData) {
  await guardAction("edit", formData.get("clientId"));
  const id = Number(formData.get("id"));
  const targetUrl = String(formData.get("targetUrl") ?? "").trim();
  if (!Number.isFinite(id) || !targetUrl) return { ok: false as const };
  const r = await callBackend<{ ok: boolean }>(
    "/api/internal/tools/redirects/404/resolve",
    { body: { id, targetUrl } },
  );
  if (!r.ok) return { ok: false as const };
  revalidatePath("/tools/redirects-manager");
  return { ok: true as const };
}

export async function deleteNotFound(id: number) {
  await guardAction("edit");
  await callBackend("/api/internal/tools/redirects/404/delete", {
    body: { id },
  });
  revalidatePath("/tools/redirects-manager");
}
