"use client";

import { useActionState, useState } from "react";
import { Check, Copy, Layers, Loader2 } from "lucide-react";
import { runProgram, type ProgState } from "./actions";

const SAMPLE_CSV =
  "city,service,minPrice\nChicago,plumbing,89\nDenver,plumbing,79\nSeattle,plumbing,99\nChicago,electrical,99\nDenver,electrical,89\nSeattle,electrical,109";

export function ProgramForm() {
  const [state, formAction, pending] = useActionState<
    ProgState | null,
    FormData
  >(runProgram, null);
  const [tab, setTab] = useState<"preview" | "sitemap" | "manifest">("preview");
  const [copied, setCopied] = useState<string | null>(null);

  function copy(label: string, t: string) {
    navigator.clipboard.writeText(t).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <>
      <form
        action={formAction}
        className="glass-apple relative overflow-hidden rounded-2xl p-5 space-y-3"
      >
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">CSV (header row required)</span>
          <textarea
            name="csv"
            required
            rows={5}
            spellCheck={false}
            defaultValue={SAMPLE_CSV}
            className="w-full rounded-md border border-white/10 bg-card/60 px-3 py-2 font-mono text-xs focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Base URL</span>
            <input
              name="baseUrl"
              required
              defaultValue="https://example.com"
              className="h-9 w-full rounded-md border border-white/10 bg-card/60 px-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Slug pattern</span>
            <input
              name="slugPattern"
              required
              defaultValue="/{{city}}-{{service}}"
              className="h-9 w-full rounded-md border border-white/10 bg-card/60 px-3 font-mono text-xs focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Title pattern (≤70 chars)</span>
            <input
              name="titlePattern"
              required
              defaultValue="{{service}} services in {{city}} from ${{minPrice}}"
              className="h-9 w-full rounded-md border border-white/10 bg-card/60 px-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Meta pattern (≤160 chars)</span>
            <input
              name="metaPattern"
              required
              defaultValue="Local {{service}} pros in {{city}}. Same-day appointments, transparent pricing from ${{minPrice}}. Free quote."
              className="h-9 w-full rounded-md border border-white/10 bg-card/60 px-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
        </div>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Body template (HTML)</span>
          <textarea
            name="bodyTemplate"
            required
            rows={6}
            spellCheck={false}
            defaultValue={"<h1>{{service}} in {{city}}</h1>\n<p>Looking for {{service}} in {{city}}? Our local pros book same-day appointments starting at ${{minPrice}}.</p>\n<h2>What's included</h2>\n<p>Standard call-out, diagnosis, and a written quote before any work begins.</p>"}
            className="w-full rounded-md border border-white/10 bg-card/60 px-3 py-2 font-mono text-xs focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Primary column (for interlinking)</span>
            <input
              name="primaryColumn"
              defaultValue="city"
              className="h-9 w-full rounded-md border border-white/10 bg-card/60 px-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Secondary column</span>
            <input
              name="secondaryColumn"
              defaultValue="service"
              className="h-9 w-full rounded-md border border-white/10 bg-card/60 px-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center rounded-md bg-violet-500/15 px-5 text-sm font-medium text-violet-300 ring-1 ring-inset ring-violet-500/30 hover:bg-violet-500/25 disabled:opacity-50"
        >
          {pending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <Layers className="mr-2 size-4" />
              Generate
            </>
          )}
        </button>
      </form>

      {state && !state.ok && (
        <p className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-inset ring-rose-500/30">
          {state.error}
        </p>
      )}

      {state?.ok && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Rows parsed" value={state.result.rows.toString()} />
            <Stat label="Pages generated" value={state.result.pages.length.toString()} tone="emerald" />
            <Stat label="Duplicate slugs" value={state.result.duplicates.length.toString()} tone={state.result.duplicates.length > 0 ? "rose" : "emerald"} />
          </div>

          {state.result.warnings.length > 0 && (
            <section className="glass-apple relative overflow-hidden rounded-2xl p-5 space-y-2">
              <h3 className="text-sm font-semibold">Notes</h3>
              <ul className="space-y-1 text-xs">
                {state.result.warnings.map((w, i) => (
                  <li
                    key={i}
                    className="rounded-md bg-amber-500/10 px-2 py-1 text-amber-300 ring-1 ring-inset ring-amber-500/30"
                  >
                    ⚠ {w}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex flex-wrap gap-2 border-b border-white/[0.06]">
            {(["preview", "sitemap", "manifest"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                  tab === t
                    ? "border-violet-400 text-violet-300"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "preview"
                  ? `Page preview (${state.result.pages.length})`
                  : t === "sitemap"
                    ? "sitemap.xml"
                    : "manifest.json"}
              </button>
            ))}
          </div>

          {tab === "preview" && (
            <section className="glass-apple relative overflow-hidden rounded-2xl">
              <ul className="divide-y divide-white/[0.05]">
                {state.result.pages.slice(0, 30).map((p) => (
                  <li key={p.slug} className="px-5 py-3 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <code className="font-medium">{p.slug}</code>
                      {p.warnings.length > 0 && (
                        <span className="text-amber-300">
                          {p.warnings.length} warning
                          {p.warnings.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                    <p className="text-foreground/90">{p.title}</p>
                    <p className="text-muted-foreground">{p.meta}</p>
                    {p.related.length > 0 && (
                      <p className="text-[10px] text-muted-foreground">
                        Related ({p.related.length}):{" "}
                        {p.related.map((r) => r.slug).join(", ")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              {state.result.pages.length > 30 && (
                <p className="border-t border-white/5 px-5 py-2 text-[10px] text-muted-foreground">
                  Showing first 30 of {state.result.pages.length} pages — full
                  list is in the manifest.
                </p>
              )}
            </section>
          )}

          {tab === "sitemap" && (
            <CopyBlock
              label="sitemap.xml"
              code={state.result.sitemap}
              copied={copied === "sitemap"}
              onCopy={() => copy("sitemap", state.result.sitemap)}
            />
          )}
          {tab === "manifest" && (
            <CopyBlock
              label="manifest.json"
              code={state.result.manifest}
              copied={copied === "manifest"}
              onCopy={() => copy("manifest", state.result.manifest)}
            />
          )}
        </>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "emerald" | "amber" | "rose";
}) {
  const t = tone
    ? { emerald: "text-emerald-300", amber: "text-amber-300", rose: "text-rose-300" }[tone]
    : "";
  return (
    <div className="rounded-xl border border-white/5 bg-black/20 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${t}`}>{value}</div>
    </div>
  );
}

function CopyBlock({
  label,
  code,
  copied,
  onCopy,
}: {
  label: string;
  code: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <section className="glass-apple relative overflow-hidden rounded-2xl">
      <header className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
        <span className="text-sm font-semibold">{label}</span>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex h-7 items-center rounded-md bg-white/5 px-2 text-[11px] text-muted-foreground ring-1 ring-inset ring-white/10 hover:bg-white/10 hover:text-foreground"
        >
          {copied ? (
            <>
              <Check className="mr-1 size-3 text-emerald-300" />
              Copied
            </>
          ) : (
            <>
              <Copy className="mr-1 size-3" />
              Copy
            </>
          )}
        </button>
      </header>
      <pre className="max-h-[500px] overflow-auto p-4 font-mono text-[11px] leading-relaxed">
        {code}
      </pre>
    </section>
  );
}
