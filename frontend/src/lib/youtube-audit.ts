/**
 * YouTube SEO audit. Hand it a YouTube URL — we fetch public metadata
 * via oEmbed + watch-page scrape, run a 14-point checklist, AI writes
 * fix steps for failing items.
 *
 * Two data paths:
 *   1. YouTube Data API v3 if a key is set (richer + faster)
 *   2. oEmbed + watch-page scrape (no key, slightly more limited)
 */

import { callAI } from "./ai-call";
import { getSetting } from "./settings-store";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export type YouTubeMeta = {
  videoId: string;
  url: string;
  title: string | null;
  description: string | null;
  channel: string | null;
  publishedAt: string | null;
  durationSeconds: number | null;
  viewCount: number | null;
  likeCount: number | null;
  thumbnailUrl: string | null;
  thumbnailWidth: number | null;
  tags: string[];
  hasCaptions: boolean | null;
  defaultLanguage: string | null;
  category: string | null;
};

export type YouTubeCheck = {
  id: string;
  title: string;
  category:
    | "title"
    | "description"
    | "discoverability"
    | "engagement"
    | "freshness"
    | "thumbnail"
    | "metadata";
  pass: boolean;
  severity: "high" | "medium" | "low";
  message: string;
};

export type YouTubeAuditResult = {
  ok: boolean;
  meta: YouTubeMeta | null;
  checks: YouTubeCheck[];
  passing: number;
  failing: number;
  fixSteps: string;
  error?: string;
};

export function extractVideoId(input: string): string | null {
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const re of patterns) {
    const m = input.match(re);
    if (m) return m[1];
  }
  return null;
}

export async function auditYouTube(opts: {
  url: string;
  targetKeyword?: string;
}): Promise<YouTubeAuditResult> {
  const videoId = extractVideoId(opts.url);
  if (!videoId) {
    return empty("Couldn't parse a YouTube video ID from the input.");
  }
  const canonical = `https://www.youtube.com/watch?v=${videoId}`;

  const apiKey = await getSetting<string>("youtube.api_key");
  let meta: YouTubeMeta | null = null;
  if (apiKey) {
    try {
      meta = await fetchViaApi(videoId, apiKey);
    } catch {
      // fall through to scrape
    }
  }
  if (!meta) {
    meta = await fetchViaScrape(videoId, canonical);
  }
  if (!meta) {
    return empty("Couldn't fetch this video. Verify it exists + is public.");
  }

  const checks = runChecklist(meta, opts.targetKeyword?.trim() || null);
  const passing = checks.filter((c) => c.pass).length;
  const failing = checks.length - passing;

  const failingChecks = checks.filter((c) => !c.pass);
  const fixSteps = await aiFixSteps({ meta, failingChecks, targetKeyword: opts.targetKeyword });

  return {
    ok: true,
    meta,
    checks,
    passing,
    failing,
    fixSteps,
  };
}

function runChecklist(
  m: YouTubeMeta,
  targetKeyword: string | null,
): YouTubeCheck[] {
  const out: YouTubeCheck[] = [];
  const title = m.title ?? "";
  const description = m.description ?? "";

  // Title checks
  out.push({
    id: "title-length",
    category: "title",
    title: "Title is 30-70 chars",
    pass: title.length >= 30 && title.length <= 75,
    severity: "high",
    message:
      title.length < 30
        ? `Title is ${title.length} chars — too short. Sub-30 char titles underperform on YouTube discovery.`
        : title.length > 75
          ? `Title is ${title.length} chars — YouTube truncates above ~70 in browse views.`
          : `Title is ${title.length} chars.`,
  });

  if (targetKeyword) {
    const lower = title.toLowerCase();
    const lowerKw = targetKeyword.toLowerCase();
    out.push({
      id: "title-keyword",
      category: "title",
      title: "Primary keyword in title",
      pass: lower.includes(lowerKw),
      severity: "high",
      message: lower.includes(lowerKw)
        ? `"${targetKeyword}" appears in the title.`
        : `Title doesn't include "${targetKeyword}".`,
    });
    out.push({
      id: "title-keyword-early",
      category: "title",
      title: "Keyword in first 50 chars of title",
      pass: lower.slice(0, 50).includes(lowerKw),
      severity: "medium",
      message: lower.slice(0, 50).includes(lowerKw)
        ? "Keyword is front-loaded — best for SERP + browse CTR."
        : "Keyword appears late in the title — front-load it.",
    });
  }

  // Description checks
  out.push({
    id: "description-length",
    category: "description",
    title: "Description ≥250 chars total",
    pass: description.length >= 250,
    severity: "high",
    message:
      description.length === 0
        ? "Description is empty."
        : description.length < 250
          ? `Description is ${description.length} chars — too short.`
          : `Description is ${description.length} chars.`,
  });
  out.push({
    id: "description-substantial",
    category: "description",
    title: "Description ≥1000 chars (recommended)",
    pass: description.length >= 1000,
    severity: "low",
    message:
      description.length >= 1000
        ? "Substantial description — YouTube uses this for indexing."
        : `Only ${description.length} chars. Top channels typically write 1000-2000 char descriptions.`,
  });
  if (targetKeyword) {
    const firstChunk = description.slice(0, 200).toLowerCase();
    out.push({
      id: "description-keyword-early",
      category: "description",
      title: "Keyword in first 200 chars of description",
      pass: firstChunk.includes(targetKeyword.toLowerCase()),
      severity: "high",
      message: firstChunk.includes(targetKeyword.toLowerCase())
        ? "Keyword appears above-the-fold (before 'show more')."
        : "Keyword missing from the first paragraph — most-visible part.",
    });
  }
  // Chapters detection: look for "00:00" then "0:XX" or "XX:XX" timestamps
  const hasChapters =
    /(?:^|\n)\s*0?0:00\b/.test(description) &&
    (description.match(/(?:^|\n)\s*\d{1,2}:\d{2}\b/g) ?? []).length >= 3;
  out.push({
    id: "chapters",
    category: "discoverability",
    title: "Chapters / timestamps in description",
    pass: hasChapters,
    severity: "medium",
    message: hasChapters
      ? "Timestamp chapters detected — boosts YouTube search + reuse for Google video snippets."
      : "No timestamp chapters detected. Add at least 3 (must start with 00:00).",
  });

  // Hashtags
  const hashtags = (description.match(/#[\w-]{2,30}/g) ?? []).length;
  out.push({
    id: "hashtags",
    category: "discoverability",
    title: "≥3 hashtags in description",
    pass: hashtags >= 3,
    severity: "low",
    message:
      hashtags >= 3
        ? `${hashtags} hashtags found — visible above the title on mobile.`
        : `${hashtags} hashtags — add 3-5 (max 15 — over-tagging is penalized).`,
  });

  // Tags
  out.push({
    id: "tags",
    category: "discoverability",
    title: "5+ tags set",
    pass: m.tags.length >= 5,
    severity: "medium",
    message:
      m.tags.length >= 5
        ? `${m.tags.length} tags — covers discovery angles.`
        : `${m.tags.length} tags. Tags still affect related-video routing despite YouTube downplaying them.`,
  });

  // Captions
  out.push({
    id: "captions",
    category: "discoverability",
    title: "Closed captions available",
    pass: m.hasCaptions === true,
    severity: "medium",
    message:
      m.hasCaptions === true
        ? "Captions are present — improves accessibility, watch time, and Google indexing of spoken content."
        : "No captions detected. YouTube auto-generates them; add a corrected version for accuracy.",
  });

  // Thumbnail
  out.push({
    id: "thumbnail-hires",
    category: "thumbnail",
    title: "High-resolution thumbnail (≥720p)",
    pass: !!m.thumbnailUrl && (m.thumbnailWidth ?? 0) >= 720,
    severity: "high",
    message:
      m.thumbnailUrl
        ? (m.thumbnailWidth ?? 0) >= 720
          ? `Thumbnail at ${m.thumbnailWidth}px — sharp.`
          : `Thumbnail is only ${m.thumbnailWidth}px. Upload a 1280×720 custom thumbnail.`
        : "No thumbnail detected — YouTube auto-generated thumbnails underperform custom by 2-3x.",
  });

  // Engagement
  if (m.viewCount !== null && m.likeCount !== null && m.viewCount > 0) {
    const ratio = (m.likeCount / m.viewCount) * 100;
    out.push({
      id: "like-ratio",
      category: "engagement",
      title: "Like ratio ≥1% (industry healthy)",
      pass: ratio >= 1,
      severity: "low",
      message:
        ratio >= 1
          ? `${ratio.toFixed(2)}% like ratio — healthy.`
          : `${ratio.toFixed(2)}% like ratio — under 1% suggests retention or expectations mismatch.`,
    });
  }

  // Freshness
  if (m.publishedAt) {
    const daysSince = (Date.now() - new Date(m.publishedAt).getTime()) / 86_400_000;
    out.push({
      id: "freshness",
      category: "freshness",
      title: "Recent enough OR explicitly evergreen",
      pass: daysSince < 730 || (m.title?.toLowerCase().includes("guide") ?? false),
      severity: "low",
      message:
        daysSince < 365
          ? `Published ${Math.round(daysSince)} days ago — fresh.`
          : daysSince < 730
            ? `${Math.round(daysSince)} days old — start planning a refresh / re-upload.`
            : `${Math.round(daysSince)} days old. If it still gets traffic, re-record or update the description with a 2026 note.`,
    });
  }

  // Metadata defaults
  out.push({
    id: "default-language",
    category: "metadata",
    title: "Default language set",
    pass: !!m.defaultLanguage,
    severity: "low",
    message: m.defaultLanguage
      ? `Language: ${m.defaultLanguage}`
      : "No default language set — YouTube can't reliably suggest the right audience.",
  });

  return out;
}

const SYSTEM_PROMPT = `You write fix instructions for YouTube SEO. Given the metadata + a list of failing checks, return one markdown block per failing check. Each block:

- Heading: "## <exact title verbatim>"
- 3-5 numbered specific steps
- Mention which YouTube Studio section to use ("YouTube Studio → Content → details", "Add captions in YouTube Studio → Subtitles", etc)
- ≤120 words

Output markdown only, no preamble, no closing summary.`;

async function aiFixSteps(opts: {
  meta: YouTubeMeta;
  failingChecks: YouTubeCheck[];
  targetKeyword?: string;
}): Promise<string> {
  if (opts.failingChecks.length === 0) return "";
  const userPrompt = [
    `Video: "${opts.meta.title}" by ${opts.meta.channel ?? "(unknown)"}`,
    `URL: ${opts.meta.url}`,
    opts.targetKeyword ? `Target keyword: "${opts.targetKeyword}"` : "",
    `Description length: ${opts.meta.description?.length ?? 0} chars`,
    `Tags: ${opts.meta.tags.join(", ") || "(none)"}`,
    "",
    "Failing checks (write fix steps for each):",
    ...opts.failingChecks.map((c) => `- ${c.title} — ${c.message}`),
    "",
    "Write the fix-step markdown blocks now.",
  ]
    .filter(Boolean)
    .join("\n");

  const out = await callAI({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 1200,
    temperature: 0.4,
    timeoutMs: 30_000,
    feature: "general",
  });
  return out ?? "";
}

// =============== Data fetchers ===============

async function fetchViaApi(
  videoId: string,
  apiKey: string,
): Promise<YouTubeMeta | null> {
  const url = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=snippet,contentDetails,statistics&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    items?: {
      snippet?: {
        title?: string;
        description?: string;
        channelTitle?: string;
        publishedAt?: string;
        tags?: string[];
        defaultLanguage?: string;
        defaultAudioLanguage?: string;
        categoryId?: string;
        thumbnails?: Record<string, { url: string; width: number; height: number }>;
      };
      contentDetails?: { duration?: string; caption?: string };
      statistics?: { viewCount?: string; likeCount?: string };
    }[];
  };
  const item = data.items?.[0];
  if (!item) return null;
  const s = item.snippet ?? {};
  const cd = item.contentDetails ?? {};
  const stat = item.statistics ?? {};
  const thumb =
    s.thumbnails?.maxres ??
    s.thumbnails?.high ??
    s.thumbnails?.standard ??
    s.thumbnails?.medium ??
    s.thumbnails?.default ??
    null;

  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title: s.title ?? null,
    description: s.description ?? null,
    channel: s.channelTitle ?? null,
    publishedAt: s.publishedAt ?? null,
    durationSeconds: parseDuration(cd.duration ?? ""),
    viewCount: stat.viewCount ? Number(stat.viewCount) : null,
    likeCount: stat.likeCount ? Number(stat.likeCount) : null,
    thumbnailUrl: thumb?.url ?? null,
    thumbnailWidth: thumb?.width ?? null,
    tags: s.tags ?? [],
    hasCaptions: cd.caption === "true" ? true : cd.caption === "false" ? false : null,
    defaultLanguage: s.defaultLanguage ?? s.defaultAudioLanguage ?? null,
    category: s.categoryId ?? null,
  };
}

async function fetchViaScrape(
  videoId: string,
  url: string,
): Promise<YouTubeMeta | null> {
  // First: oEmbed for title + thumbnail + channel
  let oEmbed: {
    title?: string;
    author_name?: string;
    thumbnail_url?: string;
    thumbnail_width?: number;
  } | null = null;
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { signal: AbortSignal.timeout(6_000) },
    );
    if (res.ok) oEmbed = await res.json();
  } catch {
    // ignore
  }

  // Then scrape the watch page for description, tags, length
  let html: string | null = null;
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html",
        "accept-language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) html = await res.text();
  } catch {
    // ignore
  }

  if (!oEmbed && !html) return null;

  let description: string | null = null;
  let tags: string[] = [];
  let publishedAt: string | null = null;
  let durationSeconds: number | null = null;
  let hasCaptions: boolean | null = null;
  let viewCount: number | null = null;

  if (html) {
    // Description from og:description
    const ogDesc = html.match(
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i,
    );
    description = ogDesc?.[1] ?? null;
    // Try ytInitialPlayerResponse for richer fields
    const blob = html.match(/ytInitialPlayerResponse\s*=\s*({[\s\S]*?});/);
    if (blob) {
      try {
        const parsed = JSON.parse(blob[1]) as {
          videoDetails?: {
            shortDescription?: string;
            keywords?: string[];
            lengthSeconds?: string;
            viewCount?: string;
          };
          microformat?: {
            playerMicroformatRenderer?: {
              publishDate?: string;
              uploadDate?: string;
            };
          };
          captions?: { playerCaptionsTracklistRenderer?: unknown };
        };
        const v = parsed.videoDetails ?? {};
        if (v.shortDescription) description = v.shortDescription;
        tags = v.keywords ?? [];
        durationSeconds = v.lengthSeconds ? Number(v.lengthSeconds) : null;
        viewCount = v.viewCount ? Number(v.viewCount) : null;
        publishedAt =
          parsed.microformat?.playerMicroformatRenderer?.publishDate ??
          parsed.microformat?.playerMicroformatRenderer?.uploadDate ??
          null;
        hasCaptions = !!parsed.captions?.playerCaptionsTracklistRenderer;
      } catch {
        // ignore
      }
    }
  }

  const title = oEmbed?.title ?? null;
  const channel = oEmbed?.author_name ?? null;
  const thumbnailUrl = oEmbed?.thumbnail_url ?? null;
  const thumbnailWidth = oEmbed?.thumbnail_width ?? null;

  return {
    videoId,
    url,
    title,
    description,
    channel,
    publishedAt,
    durationSeconds,
    viewCount,
    likeCount: null, // not in scrape
    thumbnailUrl,
    thumbnailWidth,
    tags,
    hasCaptions,
    defaultLanguage: null,
    category: null,
  };
}

function parseDuration(iso: string): number | null {
  // PT1H2M3S → 3723
  if (!iso || !iso.startsWith("PT")) return null;
  let s = 0;
  const h = iso.match(/(\d+)H/);
  const m = iso.match(/(\d+)M/);
  const sec = iso.match(/(\d+)S/);
  if (h) s += Number(h[1]) * 3600;
  if (m) s += Number(m[1]) * 60;
  if (sec) s += Number(sec[1]);
  return s || null;
}

function empty(error: string): YouTubeAuditResult {
  return {
    ok: false,
    meta: null,
    checks: [],
    passing: 0,
    failing: 0,
    fixSteps: "",
    error,
  };
}
