"use client";

import { useActionState, useRef, useState } from "react";
import { Check, Copy, Link2, Loader2, Wand2 } from "lucide-react";
import { runAutoLink, type AutoLinkState } from "./actions";

export function AutoLinkForm() {
  const [state, formAction, pending] = useActionState<
    AutoLinkState | null,
    FormData
  >(runAutoLink, null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [allCopied, setAllCopied] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  function copyAsHtml(idx: number, anchor: string, target: string) {
    const html = `<a href="${target}">${anchor}</a>`;
    navigator.clipboard.writeText(html).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    });
  }

  function applyAllAndCopy() {
    if (!state?.ok) return;
    const original = contentRef.current?.value ?? "";
    let result = original;
    // Apply each suggestion exactly once. Track the offsets we've already
    // wrapped to avoid double-wrapping.
    const applied: { from: number; to: number }[] = [];
    for (const s of state.suggestions) {
      const idx = result.toLowerCase().indexOf(s.anchor.toLowerCase());
      if (idx === -1) continue;
      // Skip if this position overlaps an already-wrapped region
      if (applied.some((a) => idx >= a.from && idx <= a.to)) continue;
      const matched = result.slice(idx, idx + s.anchor.length);
      const replacement = `<a href="${s.targetUrl}">${matched}</a>`;
      result =
        result.slice(0, idx) + replacement + result.slice(idx + s.anchor.length);
      const newTo = idx + replacement.length;
      // Shift later applied bounds
      for (const a of applied) {
        if (a.from > idx) {
          a.from += replacement.length - s.anchor.length;
          a.to += replacement.length - s.anchor.length;
        }
      }
      applied.push({ from: idx, to: newTo });
    }
    navigator.clipboard.writeText(result).then(() => {
      setAllCopied(true);
      setTimeout(() => setAllCopied(false), 1500);
    });
  }

  return (
    <>
      <form
        action={formAction}
        className="glass-apple relative overflow-hidden rounded-2xl p-5 space-y-3"
      >
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Content</span>
          <textarea
            ref={contentRef}
            name="content"
            required
            rows={8}
            spellCheck={false}
            placeholder="Paste your draft content here…"
            className="w-full rounded-md border border-white/10 bg-card/60 px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">
            Your internal pages — URL TAB title (one per line)
          </span>
          <textarea
            name="pages"
            required
            rows={6}
            spellCheck={false}
            placeholder={"https://example.com/seo-guide\tThe complete SEO guide\nhttps://example.com/keyword-research\tKeyword research basics"}
            className="w-full rounded-md border border-white/10 bg-card/60 px-3 py-2 font-mono text-xs focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center rounded-md bg-violet-500/15 px-5 text-sm font-medium text-violet-300 ring-1 ring-inset ring-violet-500/30 hover:bg-violet-500/25 disabled:opacity-50"
        >
          {pending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Proposing links…
            </>
          ) : (
            <>
              <Link2 className="mr-2 size-4" />
              Suggest links
            </>
          )}
        </button>
      </form>

      {state && !state.ok && (
        <p className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-inset ring-rose-500/30">
          {state.error}
        </p>
      )}

      {state?.ok && state.suggestions.length === 0 && (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-300 ring-1 ring-inset ring-amber-500/30">
          AI didn&apos;t find any link opportunities. Try expanding the page
          list or relaxing the content.
        </p>
      )}

      {state?.ok && state.suggestions.length > 0 && (
        <section className="glass-apple relative overflow-hidden rounded-2xl">
          <header className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3">
            <h3 className="text-sm font-semibold">
              {state.suggestions.length} link suggestion
              {state.suggestions.length === 1 ? "" : "s"}
            </h3>
            <button
              type="button"
              onClick={applyAllAndCopy}
              className="inline-flex h-8 items-center rounded-md bg-emerald-500/15 px-3 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30 hover:bg-emerald-500/25"
            >
              {allCopied ? (
                <>
                  <Check className="mr-1 size-3 text-emerald-300" />
                  Copied content
                </>
              ) : (
                <>
                  <Wand2 className="mr-1 size-3" />
                  Apply all + copy content
                </>
              )}
            </button>
          </header>
          <ul className="divide-y divide-white/[0.05]">
            {state.suggestions.map((s, i) => (
              <li key={i} className="space-y-1.5 px-5 py-3 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="font-medium">
                      <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-violet-200">
                        {s.anchor}
                      </span>{" "}
                      → <code className="text-muted-foreground">{s.targetUrl}</code>
                    </p>
                    <p className="text-muted-foreground">{s.reason}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyAsHtml(i, s.anchor, s.targetUrl)}
                    className="inline-flex h-7 shrink-0 items-center rounded-md bg-white/5 px-2 text-[11px] text-muted-foreground ring-1 ring-inset ring-white/10 hover:bg-white/10 hover:text-foreground"
                  >
                    {copiedIdx === i ? (
                      <>
                        <Check className="mr-1 size-3 text-emerald-300" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="mr-1 size-3" />
                        Copy &lt;a&gt;
                      </>
                    )}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
