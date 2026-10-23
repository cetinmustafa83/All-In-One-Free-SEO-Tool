/**
 * Programmatic SEO toolkit. Hand it:
 *   - A CSV of rows (e.g. one per city × service combo)
 *   - A page template using {{column}} mustache-style placeholders
 *   - URL slug pattern, title pattern, meta-description pattern
 *
 * We render every row, validate uniqueness of slugs, surface duplicates,
 * generate a sitemap.xml of all output URLs, and emit:
 *   - HTML files (one per row)
 *   - A JSON manifest the user can ship to a static-site builder
 *   - A sitemap.xml entry block ready to paste
 *   - An internal-linking heuristic suggesting 3-5 related pages per row
 *     (rows that share a column value)
 *
 * Pure server-side. No external API.
 */

export type ProgRow = Record<string, string>;

export type ProgramOptions = {
  rows: ProgRow[];
  slugPattern: string; // e.g. "/{{city}}-plumber"
  titlePattern: string;
  metaPattern: string;
  bodyTemplate: string; // full HTML body
  baseUrl: string;
  /** Column to use for related-page interlinking. Each row will get links to
   *  3-5 other rows that share a different column value than this one. */
  primaryColumn?: string;
  secondaryColumn?: string;
};

export type RenderedPage = {
  slug: string;
  title: string;
  meta: string;
  body: string;
  url: string;
  related: { slug: string; anchor: string }[];
  warnings: string[];
};

export type ProgramResult = {
  rows: number;
  pages: RenderedPage[];
  duplicates: string[];
  sitemap: string;
  manifest: string;
  warnings: string[];
};

const PLACEHOLDER_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;

function fill(template: string, row: ProgRow): string {
  return template.replace(PLACEHOLDER_RE, (_, key) => {
    const v = row[key as string];
    return v === undefined ? "" : String(v);
  });
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/\/-/g, "/")
    .replace(/-\//g, "/")
    .slice(0, 200);
}

export function generateProgramPages(opts: ProgramOptions): ProgramResult {
  const out: RenderedPage[] = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const warnings: string[] = [];

  // Build secondary-column index for interlinking
  const indexBySecondary = new Map<string, number[]>();
  if (opts.secondaryColumn) {
    opts.rows.forEach((row, i) => {
      const key = row[opts.secondaryColumn!] ?? "";
      if (!key) return;
      const cur = indexBySecondary.get(key) ?? [];
      cur.push(i);
      indexBySecondary.set(key, cur);
    });
  }

  opts.rows.forEach((row, i) => {
    const rawSlug = fill(opts.slugPattern, row);
    const slug = slugify(rawSlug.startsWith("/") ? rawSlug : `/${rawSlug}`);
    if (seen.has(slug)) {
      duplicates.push(slug);
      warnings.push(`Row ${i + 1}: duplicate slug "${slug}"`);
      return;
    }
    seen.add(slug);

    const title = fill(opts.titlePattern, row).trim().slice(0, 80);
    const meta = fill(opts.metaPattern, row).trim().slice(0, 160);
    const body = fill(opts.bodyTemplate, row);
    const url = `${opts.baseUrl.replace(/\/$/, "")}${slug}`;

    const pageWarnings: string[] = [];
    if (!title) pageWarnings.push("Empty title");
    if (title.length < 30) pageWarnings.push("Title shorter than 30 chars");
    if (title.length > 70) pageWarnings.push("Title longer than 70 chars");
    if (!meta) pageWarnings.push("Empty meta description");
    if (meta.length < 120) pageWarnings.push("Meta description shorter than 120 chars");
    if (meta.length > 160) pageWarnings.push("Meta description longer than 160 chars");
    if (body.length < 300) pageWarnings.push("Body very thin (<300 chars)");

    // Interlinking — pull rows that share secondaryColumn but differ on
    // primaryColumn. Take up to 5.
    const related: { slug: string; anchor: string }[] = [];
    if (opts.secondaryColumn && opts.primaryColumn) {
      const secKey = row[opts.secondaryColumn] ?? "";
      const peers = indexBySecondary.get(secKey) ?? [];
      const primaryVal = row[opts.primaryColumn];
      for (const peerIdx of peers) {
        if (peerIdx === i) continue;
        const peer = opts.rows[peerIdx];
        if (peer[opts.primaryColumn] === primaryVal) continue;
        const peerSlug = slugify(fill(opts.slugPattern, peer));
        const peerTitle = fill(opts.titlePattern, peer);
        related.push({
          slug: peerSlug.startsWith("/") ? peerSlug : `/${peerSlug}`,
          anchor: peerTitle.slice(0, 80),
        });
        if (related.length >= 5) break;
      }
    }

    out.push({
      slug,
      title,
      meta,
      body,
      url,
      related,
      warnings: pageWarnings,
    });
  });

  // Sitemap
  const sitemap =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    out
      .map(
        (p) =>
          `  <url>\n    <loc>${escapeXml(p.url)}</loc>\n    <changefreq>weekly</changefreq>\n  </url>`,
      )
      .join("\n") +
    "\n</urlset>";

  // Manifest — JSON the user can ship to a static-site generator
  const manifest = JSON.stringify(
    out.map((p) => ({
      slug: p.slug,
      title: p.title,
      meta: p.meta,
      url: p.url,
      related: p.related.map((r) => r.slug),
    })),
    null,
    2,
  );

  if (out.length > 0 && out.length < 25) {
    warnings.push(
      "Programmatic SEO works best with 100+ rows. Below 25, you're better off writing each page manually.",
    );
  }
  if (out.length > 5000) {
    warnings.push(
      `${out.length} pages — Google may crawl this slowly. Submit a sitemap and consider faceted-nav rules.`,
    );
  }

  return {
    rows: opts.rows.length,
    pages: out,
    duplicates: Array.from(new Set(duplicates)),
    sitemap,
    manifest,
    warnings,
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Parse CSV (RFC 4180-ish — handles quoted commas, escaped quotes).
 * First row is header.
 */
export function parseCsv(text: string): ProgRow[] {
  const lines: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        cur.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        cur.push(field);
        field = "";
        if (cur.length > 1 || cur[0] !== "") lines.push(cur);
        cur = [];
      } else {
        field += c;
      }
    }
  }
  if (field || cur.length) {
    cur.push(field);
    if (cur.length > 1 || cur[0] !== "") lines.push(cur);
  }
  if (lines.length < 2) return [];
  const headers = lines[0].map((h) => h.trim());
  const out: ProgRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row: ProgRow = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (lines[i][j] ?? "").trim();
    }
    out.push(row);
  }
  return out;
}
