/**
 * YouTube Data API v3 — free, 10,000 quota units/day.
 *
 * Search endpoint costs 100 units/call → 100 searches/day on the free
 * quota. We surface video titles, view counts, channel, and aggregated
 * keyword phrases so users find content angles + estimate topic demand.
 *
 * The user supplies their own API key (free, generated in Google Cloud
 * Console under "YouTube Data API v3"). We never embed our own.
 *
 * Docs: https://developers.google.com/youtube/v3/docs
 */

import { setSetting, getSetting, deleteSetting } from "./settings-store";

export async function getYouTubeApiKey(): Promise<string | null> {
  const fromDb = await getSetting<string>("youtube.api_key");
  if (fromDb) return fromDb;
  return process.env.YOUTUBE_API_KEY ?? null;
}

export async function setYouTubeApiKey(key: string): Promise<void> {
  await setSetting("youtube.api_key", key);
}

export async function clearYouTubeApiKey(): Promise<void> {
  await deleteSetting("youtube.api_key");
}

export type YouTubeVideo = {
  videoId: string;
  title: string;
  description: string;
  channelTitle: string;
  publishedAt: string;
  thumbnail: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  durationSec: number;
  tags: string[];
};

type SearchItem = {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
  };
};

type VideosItem = {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
    tags?: string[];
  };
  contentDetails?: { duration?: string };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
};

export async function searchYouTube(opts: {
  query: string;
  limit?: number;
  order?: "relevance" | "viewCount" | "date";
}): Promise<{ ok: true; videos: YouTubeVideo[] } | { ok: false; error: string }> {
  const key = await getYouTubeApiKey();
  if (!key) {
    return {
      ok: false,
      error: "YouTube API key required. Add one in Settings → API keys.",
    };
  }

  const limit = Math.min(50, Math.max(1, opts.limit ?? 25));

  // Step 1: search → returns videoIds + minimal snippets (100 units)
  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("q", opts.query);
  searchUrl.searchParams.set("maxResults", String(limit));
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("order", opts.order ?? "relevance");
  searchUrl.searchParams.set("key", key);

  let searchRes: Response;
  try {
    searchRes = await fetch(searchUrl.toString());
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (!searchRes.ok) {
    return {
      ok: false,
      error: `YouTube search failed: ${searchRes.status} ${(await searchRes.text()).slice(0, 200)}`,
    };
  }
  const searchData = (await searchRes.json()) as { items?: SearchItem[] };
  const ids = (searchData.items ?? [])
    .map((i) => i.id?.videoId)
    .filter((v): v is string => !!v);
  if (ids.length === 0) return { ok: true, videos: [] };

  // Step 2: videos.list → fetch contentDetails + statistics + tags (1 unit/video)
  const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  videosUrl.searchParams.set("part", "snippet,contentDetails,statistics");
  videosUrl.searchParams.set("id", ids.join(","));
  videosUrl.searchParams.set("key", key);
  let videosRes: Response;
  try {
    videosRes = await fetch(videosUrl.toString());
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (!videosRes.ok) {
    return {
      ok: false,
      error: `YouTube videos.list failed: ${videosRes.status}`,
    };
  }
  const videosData = (await videosRes.json()) as { items?: VideosItem[] };

  const videos: YouTubeVideo[] = (videosData.items ?? []).map((v) => ({
    videoId: v.id ?? "",
    title: v.snippet?.title ?? "",
    description: v.snippet?.description ?? "",
    channelTitle: v.snippet?.channelTitle ?? "",
    publishedAt: v.snippet?.publishedAt ?? "",
    thumbnail:
      v.snippet?.thumbnails?.medium?.url ??
      v.snippet?.thumbnails?.default?.url ??
      "",
    viewCount: Number(v.statistics?.viewCount ?? 0),
    likeCount: Number(v.statistics?.likeCount ?? 0),
    commentCount: Number(v.statistics?.commentCount ?? 0),
    durationSec: parseISODuration(v.contentDetails?.duration ?? "PT0S"),
    tags: v.snippet?.tags ?? [],
  }));

  return { ok: true, videos };
}

/**
 * Extract recurring keyword phrases from a list of video titles. Tags
 * (when available) are heavily weighted because they're the channel's
 * own categorisation. Returns top N phrases by frequency.
 */
export function aggregateKeywords(videos: YouTubeVideo[]): {
  phrase: string;
  count: number;
}[] {
  const phraseCount = new Map<string, number>();

  for (const v of videos) {
    // Tags carry 3x weight
    for (const t of v.tags) {
      const norm = t.trim().toLowerCase();
      if (norm.length < 3 || norm.length > 80) continue;
      phraseCount.set(norm, (phraseCount.get(norm) ?? 0) + 3);
    }
    // 2-3 word phrases from title
    const tokens = v.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .filter((w) => !STOP_WORDS.has(w));
    for (let i = 0; i < tokens.length - 1; i++) {
      const bigram = `${tokens[i]} ${tokens[i + 1]}`;
      phraseCount.set(bigram, (phraseCount.get(bigram) ?? 0) + 1);
      if (i < tokens.length - 2) {
        const trigram = `${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`;
        phraseCount.set(trigram, (phraseCount.get(trigram) ?? 0) + 1);
      }
    }
  }

  return Array.from(phraseCount.entries())
    .filter(([, c]) => c >= 2)
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from",
  "has", "have", "he", "her", "his", "i", "in", "is", "it", "its",
  "of", "on", "or", "she", "that", "the", "their", "they", "this",
  "to", "was", "were", "what", "when", "where", "who", "will", "with",
  "you", "your", "my", "me", "do", "does", "we", "us", "our", "if",
  "how", "why", "vs", "via",
]);

/**
 * ISO 8601 duration parser (PT1H2M30S → 3750).
 */
function parseISODuration(iso: string): number {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}
