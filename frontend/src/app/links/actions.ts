"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { shortLinks } from "@/db/schema";
import { findUniqueSlug } from "@/lib/short-links";
import { logActivity } from "@/lib/activity";
import { callBackend } from "@/lib/backend";
import { guardAction } from "@/lib/action-guard";

const createSchema = z.object({
  clientId: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  destination: z
    .string()
    .trim()
    .min(1)
    .transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`))
    .pipe(z.string().url()),
  label: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  customSlug: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  utmSource: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  utmMedium: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  utmCampaign: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  utmTerm: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  utmContent: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type CreateShortLinkResult =
  | { ok: true; id: number; slug: string }
  | { ok: false; error: string };

export async function createShortLink(
  _prev: CreateShortLinkResult | null,
  formData: FormData,
): Promise<CreateShortLinkResult> {
  await guardAction("edit", formData.get("clientId"));
  const parsed = createSchema.safeParse({
    clientId: formData.get("clientId") || undefined,
    destination: formData.get("destination"),
    label: formData.get("label") ?? undefined,
    customSlug: formData.get("customSlug") ?? undefined,
    utmSource: formData.get("utmSource") ?? undefined,
    utmMedium: formData.get("utmMedium") ?? undefined,
    utmCampaign: formData.get("utmCampaign") ?? undefined,
    utmTerm: formData.get("utmTerm") ?? undefined,
    utmContent: formData.get("utmContent") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // 14.13: the slug check/uniqueness, the insert and the activity log live
  // on the Rust backend now (zod already normalized `destination` above;
  // the backend re-validates the shape message-for-message).
  const created = await callBackend<
    | { ok: true; id: number; slug: string }
    | { ok: false; error: string }
  >("/api/internal/short-links/create", {
    body: {
      clientId: parsed.data.clientId,
      destination: parsed.data.destination,
      label: parsed.data.label,
      customSlug: parsed.data.customSlug,
      utmSource: parsed.data.utmSource,
      utmMedium: parsed.data.utmMedium,
      utmCampaign: parsed.data.utmCampaign,
      utmTerm: parsed.data.utmTerm,
      utmContent: parsed.data.utmContent,
    },
  });
  if (!created.ok) {
    return { ok: false, error: created.error };
  }

  revalidatePath("/links");
  if (parsed.data.clientId)
    revalidatePath(`/clients/${parsed.data.clientId}`);
  return { ok: true, id: created.id, slug: created.slug };
}

export async function deleteShortLink(id: number): Promise<void> {
  await guardAction("edit");
  if (!Number.isFinite(id) || id <= 0) return;
  // 14.13: the delete (and its FK cascade over short_link_clicks) moved to
  // the Rust backend.
  await callBackend("/api/internal/short-links/delete", { body: { id } });
  revalidatePath("/links");
}

const csvImportSchema = z.object({
  clientId: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  csv: z.string().min(2),
});

export type ImportShortLinksResult =
  | { ok: true; created: number; skipped: number; errors: string[] }
  | { ok: false; error: string };

/**
 * CSV format: destination[,label[,custom_slug[,utm_source[,utm_medium[,utm_campaign]]]]]
 * Lines starting with # are ignored. Rows whose first cell isn't a valid
 * URL are skipped. Custom slugs that collide get auto-replaced.
 */
export async function importShortLinksCsv(
  _prev: ImportShortLinksResult | null,
  formData: FormData,
): Promise<ImportShortLinksResult> {
  await guardAction("edit", formData.get("clientId"));
  const parsed = csvImportSchema.safeParse({
    clientId: formData.get("clientId") || undefined,
    csv: formData.get("csv"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const lines = parsed.data.csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const line of lines) {
    const cells = parseCsvRow(line);
    const dest = cells[0]?.trim();
    if (!dest || !/^https?:\/\//i.test(dest)) {
      skipped++;
      continue;
    }
    try {
      new URL(dest);
    } catch {
      skipped++;
      continue;
    }

    const label = cells[1]?.trim() || null;
    let customSlug = cells[2]?.trim() || null;
    if (customSlug && !/^[A-Za-z0-9_-]+$/.test(customSlug)) {
      customSlug = null;
    }
    const utmSource = cells[3]?.trim() || null;
    const utmMedium = cells[4]?.trim() || null;
    const utmCampaign = cells[5]?.trim() || null;

    let slug = customSlug;
    if (slug) {
      const [existing] = await db
        .select({ id: shortLinks.id })
        .from(shortLinks)
        .where(eq(shortLinks.slug, slug))
        .limit(1);
      if (existing) {
        errors.push(`Slug "${slug}" already exists — generated a new one`);
        slug = await findUniqueSlug();
      }
    } else {
      slug = await findUniqueSlug();
    }

    try {
      await db.insert(shortLinks).values({
        clientId: parsed.data.clientId ?? null,
        slug,
        destination: dest,
        label,
        utmSource,
        utmMedium,
        utmCampaign,
      });
      created++;
    } catch {
      skipped++;
    }
  }

  if (parsed.data.clientId) {
    await logActivity({
      kind: "task.created",
      message: `CSV imported ${created} short links${skipped ? ` (${skipped} skipped)` : ""}`,
      clientId: parsed.data.clientId,
      entityType: "short_link",
    });
  }

  revalidatePath("/links");
  return { ok: true, created, skipped, errors };
}

function parseCsvRow(row: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inQuote = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (inQuote) {
      if (ch === '"' && row[i + 1] === '"') {
        buf += '"';
        i++;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        buf += ch;
      }
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === ",") {
        out.push(buf);
        buf = "";
      } else buf += ch;
    }
  }
  out.push(buf);
  return out;
}
