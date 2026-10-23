export const dynamic = "force-dynamic";

import { ExternalLink, Video } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { getYouTubeApiKey } from "@/lib/youtube-research";
import { YouTubeResearch } from "./youtube-research";
import { saveYouTubeKey, clearYouTubeKey } from "./actions";

export default async function YouTubeResearchPage() {
  const key = await getYouTubeApiKey();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="YouTube keyword research"
        description="Real video data from YouTube — view counts, channels, recurring tag phrases. The free YouTube Data API gives 100 searches a day and zero extra cost."
        icon={Video}
        accent="rose"
      />

      {!key ? (
        <section className="glass-apple relative overflow-hidden rounded-2xl p-5">
          <h2 className="text-base font-semibold">Add your YouTube API key</h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>
              Go to the{" "}
              <a
                href="https://console.cloud.google.com/apis/library/youtube.googleapis.com"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-rose-300 hover:underline"
              >
                YouTube Data API page
                <ExternalLink className="size-3" />
              </a>{" "}
              in Google Cloud Console.
            </li>
            <li>Enable the API for any project.</li>
            <li>
              Credentials → Create credentials → API key. Restrict it to
              YouTube Data API v3 if you like.
            </li>
            <li>Paste it below — we store it locally only.</li>
          </ol>
          <form action={saveYouTubeKey} className="mt-4 flex gap-2">
            <input
              name="key"
              required
              type="password"
              autoComplete="off"
              placeholder="AIza…"
              className="h-9 flex-1 rounded-md border border-white/10 bg-card/60 px-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
            <button
              type="submit"
              className="inline-flex h-9 items-center rounded-md bg-rose-500/15 px-4 text-xs font-medium text-rose-300 ring-1 ring-inset ring-rose-500/30 hover:bg-rose-500/25"
            >
              Save key
            </button>
          </form>
        </section>
      ) : (
        <>
          <YouTubeResearch />
          <form action={clearYouTubeKey}>
            <button
              type="submit"
              className="text-xs text-muted-foreground hover:text-rose-300 hover:underline"
            >
              Disconnect YouTube key
            </button>
          </form>
        </>
      )}
    </div>
  );
}
