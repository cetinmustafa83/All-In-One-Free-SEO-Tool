"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { callBackend } from "@/lib/backend";
import { guardAction } from "@/lib/action-guard";

// Task 14.5a: addBacklink, setBacklinkStatus, deleteBacklink, logBuiltLink
// (including the auto short-link creation, ported from lib/short-links.ts)
// and importAhrefsBacklinks (chunked insert + sourceUrl dedupe) are thin
// proxies over /api/internal/backlinks/* — the DB effects live in
// backend/src/backlinks.rs. The zod schemas stay Next-side so the UI error
// strings are byte-identical; the Rust endpoint re-validates for direct
// callers.

const backlinkInput = z.object({
  clientId: z.coerce.number().int().positive(),
  sourceUrl: z
    .string()
    .trim()
    .min(1)
    .transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`))
    .pipe(z.string().url()),
  targetUrl: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
  anchorText: z.string().trim().max(200).optional().or(z.literal("").transform(() => undefined)),
  domainAuthority: z.coerce
    .number()
    .min(0)
    .max(100)
    .optional()
    .or(z.literal("").transform(() => undefined))
    .or(z.nan().transform(() => undefined)),
  notes: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
});

export type AddBacklinkResult =
  | { ok: true; id: number }
  | { ok: false; error: string };

export async function addBacklink(
  _prev: AddBacklinkResult | null,
  formData: FormData,
): Promise<AddBacklinkResult> {
  await guardAction("edit", formData.get("clientId"));
  const raw = {
    clientId: formData.get("clientId"),
    sourceUrl: formData.get("sourceUrl"),
    targetUrl: formData.get("targetUrl") ?? undefined,
    anchorText: formData.get("anchorText") ?? undefined,
    domainAuthority: formData.get("domainAuthority") ?? undefined,
    notes: formData.get("notes") ?? undefined,
  };
  const parsed = backlinkInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const result = await callBackend<AddBacklinkResult>("/api/internal/backlinks/add", {
    body: parsed.data,
  });

  if (result.ok) {
    revalidatePath("/backlinks");
    revalidatePath(`/clients/${parsed.data.clientId}`);
  }
  return result;
}

export async function setBacklinkStatus(
  backlinkId: number,
  status: "active" | "lost" | "disavow",
) {
  await guardAction("edit");
  await callBackend(`/api/internal/backlinks/${backlinkId}/status`, {
    body: { status },
  });
  revalidatePath("/backlinks");
}

export async function deleteBacklink(backlinkId: number) {
  await guardAction("edit");
  await callBackend(`/api/internal/backlinks/${backlinkId}/delete`, {
    body: {},
  });
  revalidatePath("/backlinks");
}

// =============== Manual link log ===============

const linkLogInput = z.object({
  clientId: z.coerce.number().int().positive(),
  sourceUrl: z
    .string()
    .trim()
    .min(1)
    .transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`))
    .pipe(z.string().url()),
  targetUrl: z
    .string()
    .trim()
    .min(1)
    .transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`))
    .pipe(z.string().url())
    .optional()
    .or(z.literal("").transform(() => undefined)),
  anchorText: z.string().trim().max(200).optional().or(z.literal("").transform(() => undefined)),
  method: z
    .enum([
      "guest_post",
      "outreach",
      "citation",
      "broken_link",
      "resource_page",
      "directory",
      "social_profile",
      "podcast",
      "interview",
      "other",
    ])
    .default("other"),
  rel: z
    .enum(["dofollow", "nofollow", "ugc", "sponsored"])
    .optional()
    .or(z.literal("").transform(() => undefined)),
  domainAuthority: z.coerce
    .number()
    .min(0)
    .max(100)
    .optional()
    .or(z.literal("").transform(() => undefined))
    .or(z.nan().transform(() => undefined)),
  placedAt: z
    .string()
    .trim()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  notes: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
});

export type LogLinkResult = { ok: true; id: number } | { ok: false; error: string };

/**
 * Log an outbound link the SEO actually built. Goes into the same backlinks
 * table as discovered links but with source="manual" so reports can split
 * "links built this period" from "links observed this period."
 */
export async function logBuiltLink(
  _prev: LogLinkResult | null,
  formData: FormData,
): Promise<LogLinkResult> {
  await guardAction("edit", formData.get("clientId"));
  const raw = {
    clientId: formData.get("clientId"),
    sourceUrl: formData.get("sourceUrl"),
    targetUrl: formData.get("targetUrl") ?? undefined,
    anchorText: formData.get("anchorText") ?? undefined,
    method: formData.get("method") || "other",
    rel: formData.get("rel") ?? undefined,
    domainAuthority: formData.get("domainAuthority") ?? undefined,
    placedAt: formData.get("placedAt") ?? undefined,
    notes: formData.get("notes") ?? undefined,
  };
  const parsed = linkLogInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const result = await callBackend<LogLinkResult>("/api/internal/backlinks/log-built", {
    body: parsed.data,
  });

  if (result.ok) {
    revalidatePath("/backlinks");
    revalidatePath(`/backlinks/c/${parsed.data.clientId}`);
    revalidatePath(`/clients/${parsed.data.clientId}`);
    revalidatePath("/links");
  }
  return result;
}

// =============== Ahrefs Webmaster Tools CSV import ===============

export type AhrefsImportResult =
  | {
      ok: true;
      inserted: number;
      skipped: number;
      duplicates: number;
    }
  | { ok: false; error: string };

/**
 * Ingest a CSV exported from Ahrefs Webmaster Tools (free for verified
 * site owners). Mapping, dedup by (clientId, sourceUrl) and the chunked
 * inserts live in backend/src/backlinks.rs; this stays the guard + shape
 * keeper so the UI error strings and result type are unchanged.
 */
export async function importAhrefsBacklinks(
  clientId: number,
  csvText: string,
): Promise<AhrefsImportResult> {
  await guardAction("edit", clientId);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return { ok: false, error: "Invalid clientId" };
  }
  if (!csvText || csvText.length < 10) {
    return { ok: false, error: "CSV is empty or too short" };
  }

  const result = await callBackend<AhrefsImportResult>(
    "/api/internal/backlinks/import-ahrefs",
    { body: { clientId, csvText } },
  );

  if (result.ok) {
    revalidatePath("/backlinks");
    revalidatePath(`/backlinks/c/${clientId}`);
  }
  return result;
}
