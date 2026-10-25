"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  aggregateKeywords,
  searchYouTube,
  type YouTubeVideo,
} from "@/lib/youtube-research";
import { saveToolRun } from "@/lib/tool-runs";
import { callBackend } from "@/lib/backend";
import { guardAction } from "@/lib/action-guard";

// ---------------------------------------------------------------------------
// Task 14.6a: saveYouTubeKey/clearYouTubeKey are thin proxies over
// /api/internal/tools/settings/set|delete — the workspace_settings upsert /
// delete (setYouTubeApiKey wraps the settings store with key
// "youtube.api_key") lives in backend/src/tools_basic.rs.
// researchOnYouTube is NOT ported: searchYouTube calls the YouTube Data API
// over the network and stays Next-side.
// ---------------------------------------------------------------------------

export async function saveYouTubeKey(formData: FormData): Promise<void> {
  await guardAction("edit", formData.get("clientId"));
  const key = String(formData.get("key") ?? "").trim();
  if (!key) return;
  await callBackend("/api/internal/tools/settings/set", {
    body: { key: "youtube.api_key", value: key },
  });
  revalidatePath("/tools/youtube");
}

export async function clearYouTubeKey(): Promise<void> {
  await guardAction("edit");
  await callBackend("/api/internal/tools/settings/delete", {
    body: { key: "youtube.api_key" },
  });
  revalidatePath("/tools/youtube");
}

const schema = z.object({
  query: z.string().trim().min(2).max(200),
  order: z.enum(["relevance", "viewCount", "date"]).default("relevance"),
});

export type YouTubeResearchState =
  | {
      ok: true;
      query: string;
      videos: YouTubeVideo[];
      keywords: { phrase: string; count: number }[];
    }
  | { ok: false; error: string };

export async function researchOnYouTube(
  _prev: YouTubeResearchState | null,
  formData: FormData,
): Promise<YouTubeResearchState> {
  await guardAction("edit", formData.get("clientId"));
  const parsed = schema.safeParse({
    query: formData.get("query"),
    order: formData.get("order") || undefined,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const result = await searchYouTube({
    query: parsed.data.query,
    limit: 25,
    order: parsed.data.order,
  });
  if (!result.ok) return result;

  const keywords = aggregateKeywords(result.videos);
  const out: YouTubeResearchState = {
    ok: true,
    query: parsed.data.query,
    videos: result.videos,
    keywords,
  };
  await saveToolRun({
    toolId: "youtube",
    label: `${parsed.data.query} · ${result.videos.length} videos`,
    input: { query: parsed.data.query, order: parsed.data.order },
    result: out,
  }).catch(() => undefined);
  return out;
}
