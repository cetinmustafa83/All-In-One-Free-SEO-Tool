import Link from "next/link";
import { ArrowLeft, CalendarClock } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { FreshnessForm } from "./form";

export default function FreshnessPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link
        href="/tools"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" />
        All tools
      </Link>

      <PageHeader
        title="Freshness audit"
        description="AI-search systems (AI Overviews, Perplexity, ChatGPT) skip pages that look undated or stale. This audit fetches every freshness signal on your page — HTTP header, meta tags, JSON-LD dateModified, <time> elements, and visible 'Last updated' text — flags gaps and disagreements, and gives you a ready-to-paste JSON-LD + meta patch."
        icon={CalendarClock}
        accent="emerald"
      />

      <FreshnessForm />
    </div>
  );
}
