export const dynamic = "force-dynamic";

import { Zap } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { getOrCreateIndexNowKey } from "@/lib/indexnow";
import { IndexNowForm } from "./indexnow-form";

export default async function IndexNowPage() {
  const key = await getOrCreateIndexNowKey();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="IndexNow submitter"
        description="Push fresh URLs to Bing, Yandex, Naver, Seznam in seconds. Free, no API key required — just one verification file on your server."
        icon={Zap}
        accent="cyan"
      />

      <section className="glass-apple relative overflow-hidden rounded-2xl p-5 text-sm">
        <h2 className="text-base font-semibold">One-time setup</h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-muted-foreground">
          <li>
            Save a plain-text file to the root of your site at{" "}
            <code className="rounded bg-white/5 px-1.5 py-0.5 ring-1 ring-inset ring-white/10">
              /{key}.txt
            </code>
          </li>
          <li>
            The file must contain exactly this string (no quotes, no
            whitespace):
            <pre className="mt-1 overflow-x-auto rounded-md bg-black/20 p-2 font-mono text-xs">
              {key}
            </pre>
          </li>
          <li>
            Submit URLs below. Engines will fetch the key file to verify
            ownership before accepting submissions.
          </li>
        </ol>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Same key is reused across all your sites. Don&apos;t change it once
          set up.
        </p>
      </section>

      <IndexNowForm />
    </div>
  );
}
