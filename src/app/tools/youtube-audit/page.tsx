export const dynamic = "force-dynamic";

import { Video } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { YtAuditForm } from "./form";

export default function YouTubeAuditPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="YouTube SEO audit"
        description="Paste any public YouTube video URL. We pull title / description / tags / captions / thumbnail / engagement, run a 14-point checklist (title length, keyword placement, description depth, chapters, hashtags, tags, captions, thumbnail resolution, like ratio, freshness), and AI writes step-by-step fix instructions for each failing item. Free — uses oEmbed + watch-page scrape (or your YouTube Data API key for richer data)."
        icon={Video}
        accent="rose"
      />
      <YtAuditForm />
    </div>
  );
}
