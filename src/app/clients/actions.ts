"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clients, type ClientSocialLinks } from "@/db/schema";
import { detectTechStack } from "@/lib/tech-detect";
import { fetchSiteMetadata, type SiteMetadata } from "@/lib/site-metadata";
import { logActivity } from "@/lib/activity";
import { currentUserId } from "@/lib/auth";
import { callBackend } from "@/lib/backend";
import { guardAction } from "@/lib/action-guard";
import { siteFactsFor } from "@/lib/apply-task-templates";
import {
  CHECKED_TEMPLATE_TITLES,
  templateSatisfied,
} from "@/lib/template-preflight";

// Task 14.5b: createClient, updateClient, deleteClient, quickAddClient,
// applyStackTemplates, applyNicheTemplates and redetectTechStack are thin
// proxies over /api/internal/clients/* — the DB effects (client rows, the
// template engine, activity log, share tokens) live in
// backend/src/clients.rs. The zod schemas stay Next-side so the UI error
// strings are byte-identical; the Rust endpoint re-validates for direct
// callers. What stays Next-side on purpose (no HTTP client in the Rust
// backend — no new Cargo deps): detectTechStack, fetchSiteMetadata and the
// template-preflight site read. The preflight verdicts travel with the
// request as {title, evidence} pairs; a title without a verdict is kept,
// which is exactly templateSatisfied(null-facts) behaviour.

const niches = ["local", "ecommerce", "saas", "blog", "services"] as const;

const optionalString = z
  .string()
  .trim()
  .max(500)
  .optional()
  .or(z.literal("").transform(() => undefined));

const clientInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  url: z
    .string()
    .trim()
    .min(1, "URL is required")
    .transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`))
    .pipe(z.string().url("Enter a valid URL")),
  niche: z.enum(niches).optional().or(z.literal("").transform(() => undefined)),
  // Optional pre-populated fields (from auto-fetch). All best-effort.
  logoUrl: optionalString,
  description: optionalString,
  address: optionalString,
  phone: optionalString,
  email: optionalString,
  gbpUrl: optionalString,
  facebook: optionalString,
  twitter: optionalString,
  instagram: optionalString,
  linkedin: optionalString,
  youtube: optionalString,
  tiktok: optionalString,
});

/**
 * The Rust template engine (candidate data, skip-logging, dedupe, insert)
 * needs to know which templates the live site already satisfies. The facts
 * come from reading the site — an HTTP job that stays here — so this reads
 * the site once and turns it into per-title verdicts for the backend.
 */
async function templatePrecheck(
  url: string | null | undefined,
): Promise<{ title: string; evidence: string }[]> {
  const facts = await siteFactsFor(url);
  if (!facts || !facts.reachable) return [];
  const out: { title: string; evidence: string }[] = [];
  for (const title of CHECKED_TEMPLATE_TITLES) {
    const verdict = templateSatisfied(title, facts);
    if (verdict) out.push({ title, evidence: verdict.evidence });
  }
  return out;
}

export type ClientMetadataResult =
  | { ok: true; metadata: SiteMetadata }
  | { ok: false; error: string };

/**
 * Fetch og/JSON-LD/social/favicon data for a URL so the add-client form can
 * pre-populate fields. Errors return a friendly message rather than throwing.
 */
export async function fetchClientMetadata(
  rawUrl: string,
): Promise<ClientMetadataResult> {
  await guardAction("read");
  const trimmed = rawUrl?.trim();
  if (!trimmed) {
    return { ok: false, error: "Enter a URL first." };
  }
  try {
    const metadata = await fetchSiteMetadata(trimmed);
    if (!metadata.reachable) {
      return {
        ok: false,
        error:
          "Couldn't reach that URL. Check it loads in a browser, then try again.",
      };
    }
    return { ok: true, metadata };
  } catch (err) {
    return { ok: false, error: (err as Error).message || "Fetch failed." };
  }
}

export type CreateClientResult =
  | { ok: true; id: number }
  | { ok: false; errors: Record<string, string> };

export async function createClient(
  _prev: CreateClientResult | null,
  formData: FormData,
): Promise<CreateClientResult> {
  await guardAction("edit", formData.get("clientId"));
  const raw = {
    name: formData.get("name"),
    url: formData.get("url"),
    niche: formData.get("niche") ?? undefined,
    logoUrl: formData.get("logoUrl") ?? undefined,
    description: formData.get("description") ?? undefined,
    address: formData.get("address") ?? undefined,
    phone: formData.get("phone") ?? undefined,
    email: formData.get("email") ?? undefined,
    gbpUrl: formData.get("gbpUrl") ?? undefined,
    facebook: formData.get("facebook") ?? undefined,
    twitter: formData.get("twitter") ?? undefined,
    instagram: formData.get("instagram") ?? undefined,
    linkedin: formData.get("linkedin") ?? undefined,
    youtube: formData.get("youtube") ?? undefined,
    tiktok: formData.get("tiktok") ?? undefined,
  };

  const parsed = clientInput.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString() ?? "_";
      if (!errors[key]) errors[key] = issue.message;
    }
    return { ok: false, errors };
  }

  let detectedStack: string[] | null = null;
  try {
    const detection = await detectTechStack(parsed.data.url);
    detectedStack = detection.technologies.map((t) => t.name);
  } catch {
    // Detection is best-effort — site may be unreachable, blocked, etc.
    // We still create the client; user can retry detection from the detail page.
  }

  const result = await callBackend<{
    ok: true;
    id: number;
    redirect: string;
  }>("/api/internal/clients/create", {
    body: {
      ...parsed.data,
      techStack: detectedStack,
      precheck: await templatePrecheck(parsed.data.url),
      userId: await currentUserId(),
    },
  });

  revalidatePath("/");
  revalidatePath("/clients");

  // Two audits start here, in order, while the user works through the
  // onboarding wizard.
  //
  // The crawl goes first and it is the important one. Until this was
  // wired up, a brand-new client's only audit was runAiSiteAudit, which
  // sets pagesCrawled: 1 — so the first thing anyone saw about their
  // site, and anything built on top of it, described the homepage and
  // nothing else. The full crawler was already sitting here unused.
  //
  // Progress is written to audits.pagesCrawled as it goes, and the
  // wizard reads it, so this is visible rather than silent.
  void (async () => {
    try {
      const { runAuditForClient } = await import("@/app/audits/actions");
      await runAuditForClient(result.id);
    } catch {
      // Best-effort — re-runnable from the client page.
    }
    try {
      const { runAiSiteAudit } = await import("@/lib/ai-site-audit");
      await runAiSiteAudit({ clientId: result.id, url: parsed.data.url });
    } catch {
      // Silent — user can re-run from the AI audit page if it failed.
    }
  })();

  // First-add: drop into the smart-onboarding wizard so they get a 30-day
  // plan generated end-to-end. Existing clients still go straight to the
  // detail page (their wizard is reachable via the "Re-plan" button).
  redirect(result.redirect);
}
export async function applyStackTemplates(clientId: number) {
  await guardAction("edit", clientId);
  const [client] = await db
    .select({ url: clients.url })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) return;

  await callBackend(`/api/internal/clients/${clientId}/apply-templates`, {
    body: {
      kind: "stack",
      precheck: await templatePrecheck(client.url),
      userId: await currentUserId(),
    },
  });

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/tasks");
  revalidatePath("/");
}


export async function applyNicheTemplates(clientId: number) {
  await guardAction("edit", clientId);
  const [client] = await db
    .select({ url: clients.url })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) return;

  await callBackend(`/api/internal/clients/${clientId}/apply-templates`, {
    body: {
      kind: "niche",
      precheck: await templatePrecheck(client.url),
      userId: await currentUserId(),
    },
  });

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function redetectTechStack(clientId: number) {
  await guardAction("edit", clientId);
  const [client] = await db
    .select({ url: clients.url })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) return;

  try {
    const detection = await detectTechStack(client.url);
    await callBackend(`/api/internal/clients/${clientId}/redetect-stack`, {
      body: { technologies: detection.technologies.map((t) => t.name) },
    });
  } catch {
    // ignore — keep existing data
  }

  revalidatePath(`/clients/${clientId}`);
}

const updateClientInput = clientInput.extend({
  id: z.coerce.number().int().positive(),
});

export type UpdateClientResult =
  | { ok: true; id: number }
  | { ok: false; errors: Record<string, string> };

export async function updateClient(
  _prev: UpdateClientResult | null,
  formData: FormData,
): Promise<UpdateClientResult> {
  await guardAction("edit", formData.get("clientId"));
  const raw = {
    id: formData.get("id"),
    name: formData.get("name"),
    url: formData.get("url"),
    niche: formData.get("niche") ?? undefined,
    logoUrl: formData.get("logoUrl") ?? undefined,
    description: formData.get("description") ?? undefined,
    address: formData.get("address") ?? undefined,
    phone: formData.get("phone") ?? undefined,
    email: formData.get("email") ?? undefined,
    gbpUrl: formData.get("gbpUrl") ?? undefined,
    facebook: formData.get("facebook") ?? undefined,
    twitter: formData.get("twitter") ?? undefined,
    instagram: formData.get("instagram") ?? undefined,
    linkedin: formData.get("linkedin") ?? undefined,
    youtube: formData.get("youtube") ?? undefined,
    tiktok: formData.get("tiktok") ?? undefined,
  };

  const parsed = updateClientInput.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString() ?? "_";
      if (!errors[key]) errors[key] = issue.message;
    }
    return { ok: false, errors };
  }

  const result = await callBackend<{
    ok: true;
    id: number;
    redirect: string;
  }>(`/api/internal/clients/${parsed.data.id}/update`, {
    body: {
      ...parsed.data,
      userId: await currentUserId(),
    },
  });

  revalidatePath("/clients");
  revalidatePath(`/clients/${parsed.data.id}`);
  redirect(result.redirect);
}

/**
 * Re-fetches site metadata + tech stack for an existing client and merges
 * non-empty fields into the record. Manually-set values are preserved when
 * the live site doesn't return anything for that field.
 */
export async function refreshClientMetadata(
  clientId: number,
): Promise<{ ok: boolean; error?: string }> {
  await guardAction("edit", clientId);
  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) return { ok: false, error: "Client not found" };

  const meta = await fetchSiteMetadata(client.url).catch(() => null);
  if (!meta || !meta.reachable) {
    return {
      ok: false,
      error: "Couldn't reach the site. Check the URL and try again.",
    };
  }

  // Merge: only overwrite fields if the fetched value is non-empty
  const next: Partial<typeof clients.$inferInsert> = { updatedAt: new Date() };
  if (meta.name && !client.name) next.name = meta.name;
  if (meta.logoUrl) next.logoUrl = meta.logoUrl;
  if (meta.description) next.description = meta.description;
  if (meta.address) next.address = meta.address;
  if (meta.phone) next.phone = meta.phone;
  if (meta.email) next.email = meta.email;
  if (meta.gbpUrl) next.gbpUrl = meta.gbpUrl;

  // Social: merge — keep existing, add anything new from fetch
  const incoming = meta.socialLinks ?? {};
  const existing: ClientSocialLinks = client.socialLinks ?? {};
  const merged: ClientSocialLinks = { ...existing };
  for (const k of Object.keys(incoming) as (keyof ClientSocialLinks)[]) {
    if (!merged[k] && incoming[k]) merged[k] = incoming[k];
  }
  if (Object.keys(merged).length > 0) next.socialLinks = merged;

  // Tech stack
  try {
    const detection = await detectTechStack(client.url);
    next.techStack = detection.technologies.map((t) => t.name);
  } catch {
    // ignore
  }

  await db.update(clients).set(next).where(eq(clients.id, clientId));

  await logActivity({
    kind: "client.created",
    message: `Refreshed metadata for ${client.name}.`,
    level: "info",
    clientId,
    entityType: "client",
    entityId: clientId,
  });

  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}

/** Form-friendly wrapper around refreshClientMetadata (returns void). */
export async function refreshClientMetadataForm(clientId: number): Promise<void> {
  await guardAction("edit", clientId);
  await refreshClientMetadata(clientId);
}

export type QuickAddResult =
  | { ok: true; id: number }
  | { ok: false; error: string };

/**
 * One-shot client onboarding: take a URL, do everything else automatically.
 * Metadata fetch + tech detection run here (external HTTP), the insert,
 * template seeding and activity log happen in backend/src/clients.rs, and
 * the baseline snapshot stays here (it dynamic-imports the capture stack).
 *
 * Used by the global "Add client" modal so onboarding is ~3 seconds.
 */
export async function quickAddClient(rawUrl: string): Promise<QuickAddResult> {
  await guardAction("edit");
  const url = rawUrl?.trim();
  if (!url) return { ok: false, error: "URL is required" };
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;

  // Fetch metadata + tech in parallel — both best-effort.
  const [meta, techDetection] = await Promise.all([
    fetchSiteMetadata(normalized).catch(() => null),
    detectTechStack(normalized).catch(() => null),
  ]);

  if (!meta || !meta.reachable) {
    return {
      ok: false,
      error:
        "Couldn't reach that URL. Check it loads in a browser, then try again.",
    };
  }

  const techStack = techDetection?.technologies.map((t) => t.name) ?? null;

  const result = await callBackend<QuickAddResult>(
    "/api/internal/clients/quick-add",
    {
      body: {
        url: normalized,
        meta: {
          name: meta.name,
          url: meta.url,
          logoUrl: meta.logoUrl,
          description: meta.description,
          address: meta.address,
          phone: meta.phone,
          email: meta.email,
          gbpUrl: meta.gbpUrl,
          socialLinks: meta.socialLinks ?? {},
        },
        techStack,
        precheck: await templatePrecheck(meta.url),
        userId: await currentUserId(),
      },
    },
  );

  // Freeze the starting line now, not tonight.
  //
  // The daily agent snapshots any client without one, so a baseline
  // always arrives eventually — but "eventually" is up to 24 hours, and
  // anyone who adds a client and starts fixing things the same afternoon
  // gets a baseline of a site already partly improved. The first monthly
  // report then understates the work by exactly that much.
  //
  // Best-effort: a client that could not be measured is still a client.
  if (result.ok) {
    revalidatePath("/");
    revalidatePath("/clients");
    try {
      const { captureClientSnapshot } = await import("@/lib/client-snapshots");
      await captureClientSnapshot({ clientId: result.id, kind: "baseline" });
    } catch {
      // The daily agent will take one. Nothing here is worth failing an
      // add over.
    }
  }
  return result;
}

export async function deleteClient(id: number) {
  await guardAction("settings", id);
  const result = await callBackend<{ ok: true; redirect: string }>(
    `/api/internal/clients/${id}/delete`,
    { body: {} },
  );
  revalidatePath("/");
  revalidatePath("/clients");
  redirect(result.redirect);
}
