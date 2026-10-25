"use client";

import { useActionState, useState, useTransition } from "react";
import { ExternalLink, Plus, Check } from "lucide-react";
import {
  findLinkProspects,
  trackProspect,
  type ProspectSearchResult,
} from "./actions";

const STRATEGY_LABELS: Record<string, string> = {
  resource_pages: "Resource page",
  links_pages: "Links page",
  guest_post: "Guest post",
  competitor_mentions: "Competitor mention",
  broken_link: "Broken link",
  industry_directories: "Directory",
};

export function ProspectFinder({
  clients,
}: {
  clients: { id: number; name: string; url: string }[];
}) {
  const [state, formAction, pending] = useActionState<
    ProspectSearchResult | null,
    FormData
  >(findLinkProspects, null);

  const [clientId, setClientId] = useState(String(clients[0]?.id ?? ""));
  const [tracked, setTracked] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  return (
    <>
      <form
        action={formAction}
        className="glass-apple relative overflow-hidden rounded-2xl p-5"
      >
        <div className="grid gap-3 md:grid-cols-[200px_1fr_1fr_auto]">
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Client</span>
            <select
              name="clientId"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-white/10 bg-card/60 px-3 text-sm"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Topic / niche</span>
            <input
              name="topic"
              required
              placeholder="vegan recipes"
              className="h-9 w-full rounded-md border border-white/10 bg-card/60 px-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">
              Competitor domain (optional)
            </span>
            <input
              name="competitor"
              placeholder="competitor.com"
              className="h-9 w-full rounded-md border border-white/10 bg-card/60 px-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-9 items-center self-end rounded-md bg-emerald-500/15 px-4 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50"
          >
            {pending ? "Searching…" : "Find prospects"}
          </button>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Uses search operators across resource pages, write-for-us pages,
          directories, and competitor mentions. Free — no API key, no
          quotas.
        </p>
      </form>

      {state && !state.ok && (
        <p className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-inset ring-rose-500/30">
          {state.error}
        </p>
      )}

      {state?.ok && (
        <section className="glass-apple relative overflow-hidden rounded-2xl">
          <header className="border-b border-white/[0.06] px-5 py-4">
            <h2 className="text-base font-semibold">
              {state.results.length} prospects
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Click + to track as a submission for the selected client.
            </p>
          </header>
          {state.results.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              No results. Try a broader topic.
            </p>
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {state.results.map((p) => {
                const key = p.url;
                const isTracked = tracked.has(key);
                return (
                  <li
                    key={key}
                    className="flex items-start gap-3 px-5 py-3 text-sm"
                  >
                    <span className="mt-0.5 shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-muted-foreground ring-1 ring-inset ring-white/10">
                      {STRATEGY_LABELS[p.strategy] ?? p.strategy}
                    </span>
                    <div className="min-w-0 flex-1">
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 truncate font-medium hover:underline"
                      >
                        {p.title || p.domain}
                        <ExternalLink className="size-3 opacity-60" />
                      </a>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {p.domain}
                      </div>
                      {p.snippet && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {p.snippet}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={isTracked}
                      onClick={() => {
                        startTransition(async () => {
                          const fd = new FormData();
                          fd.set("url", p.url);
                          fd.set("clientId", clientId);
                          fd.set("strategy", p.strategy);
                          await trackProspect(fd);
                          setTracked((s) => new Set(s).add(key));
                        });
                      }}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium ring-1 ring-inset disabled:opacity-50"
                      style={{
                        background: isTracked
                          ? "rgba(16,185,129,0.15)"
                          : "rgba(255,255,255,0.05)",
                        color: isTracked ? "#6ee7b7" : "var(--muted-foreground)",
                      }}
                    >
                      {isTracked ? (
                        <>
                          <Check className="size-3" />
                          Tracked
                        </>
                      ) : (
                        <>
                          <Plus className="size-3" />
                          Track
                        </>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
