/**
 * Smart-link redirector helpers. Generates URL-safe slugs, builds the
 * UTM-decorated destination URL, and provides a small set of helpers
 * the route handler + UI both rely on.
 *
 * 14.13 (write-gateway wave 1): recordClick moved onto the Rust
 * /api/internal/short-links/click endpoint (the UA/referer truncation and
 * the accept-language country guess moved with it), findUniqueSlug reads
 * through the db-gateway. Nothing in this module touches SQLite directly
 * any more.
 */

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db-gateway";
import { shortLinks, type ShortLink } from "@/db/schema";
import { callBackend } from "./backend";

const ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export function generateSlug(length = 6): string {
  const buf = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[buf[i] % ALPHABET.length];
  }
  return out;
}

export async function findUniqueSlug(): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const slug = generateSlug(6 + Math.floor(attempt / 2));
    const [existing] = await db
      .select({ id: shortLinks.id })
      .from(shortLinks)
      .where(eq(shortLinks.slug, slug))
      .limit(1);
    if (!existing) return slug;
  }
  // Fallback to longer slug — collision after 6 attempts is astronomical
  return generateSlug(10);
}

export function buildDestinationUrl(link: ShortLink): string {
  let url: URL;
  try {
    url = new URL(link.destination);
  } catch {
    return link.destination;
  }
  const utm: [string, string | null][] = [
    ["utm_source", link.utmSource],
    ["utm_medium", link.utmMedium],
    ["utm_campaign", link.utmCampaign],
    ["utm_term", link.utmTerm],
    ["utm_content", link.utmContent],
  ];
  for (const [k, v] of utm) {
    if (v && v.length > 0) url.searchParams.set(k, v);
  }
  return url.toString();
}

/**
 * Record a click against a short link via the Rust backend, which owns the
 * truncation (UA ≤ 200, referer ≤ 500) and the country guess from the
 * accept-language header — so we never hold raw IPs / fingerprintable
 * data, and the two writes (click row + counter) commit atomically.
 * Throws on transport failure / business error so the caller's
 * fire-and-forget `.catch` keeps its old meaning.
 */
export async function recordClick(opts: {
  shortLinkId: number;
  userAgent: string | null;
  referer: string | null;
  acceptLanguage: string | null;
}): Promise<void> {
  const res = await callBackend<
    { ok: true } | { ok: false; error: string }
  >("/api/internal/short-links/click", {
    body: {
      shortLinkId: opts.shortLinkId,
      userAgent: opts.userAgent,
      referer: opts.referer,
      acceptLanguage: opts.acceptLanguage,
    },
  });
  if (!res.ok) throw new Error("error" in res ? res.error : "click failed");
}
