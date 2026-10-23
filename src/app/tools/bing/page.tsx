export const dynamic = "force-dynamic";

import Link from "next/link";
import { ExternalLink, Search } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { getBingApiKey } from "@/lib/bing-webmaster";
import { BingTool } from "./bing-tool";
import { saveBingKey, clearBingKey } from "./actions";

export default async function BingToolPage() {
  const key = await getBingApiKey();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Bing Webmaster Tools"
        description="Free Bing organic data — top queries, top pages, crawl issues, URL submission. Bing's API is free and lower-quota than IndexNow but returns proper search-analytics rows."
        icon={Search}
        accent="cyan"
      />

      {!key ? (
        <section className="glass-apple relative overflow-hidden rounded-2xl p-5">
          <h2 className="text-base font-semibold">Add your Bing API key</h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>
              Go to{" "}
              <a
                href="https://www.bing.com/webmasters"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-cyan-300 hover:underline"
              >
                Bing Webmaster Tools
                <ExternalLink className="size-3" />
              </a>{" "}
              and sign in.
            </li>
            <li>Settings (gear) → API Access → Generate API key.</li>
            <li>Copy and paste it below — it&apos;s stored locally.</li>
          </ol>
          <form action={saveBingKey} className="mt-4 flex gap-2">
            <input
              name="key"
              required
              type="password"
              autoComplete="off"
              placeholder="Bing API key"
              className="h-9 flex-1 rounded-md border border-white/10 bg-card/60 px-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
            <button
              type="submit"
              className="inline-flex h-9 items-center rounded-md bg-cyan-500/15 px-4 text-xs font-medium text-cyan-300 ring-1 ring-inset ring-cyan-500/30 hover:bg-cyan-500/25"
            >
              Save key
            </button>
          </form>
        </section>
      ) : (
        <BingTool />
      )}

      {key && (
        <form action={clearBingKey}>
          <button
            type="submit"
            className="text-xs text-muted-foreground hover:text-rose-300 hover:underline"
          >
            Disconnect Bing key
          </button>
        </form>
      )}

      <div className="rounded-xl border border-white/5 bg-black/20 p-4 text-xs text-muted-foreground">
        Want to push fresh URLs to Bing instantly? Use the{" "}
        <Link href="/tools/indexnow" className="underline">
          IndexNow tool
        </Link>{" "}
        — same engine, simpler protocol, no key needed.
      </div>
    </div>
  );
}
