"use client";

import { useState, useTransition } from "react";
import { Globe, Loader2 } from "lucide-react";
import { setBrowserScrapedAiEnabled } from "./actions";

/**
 * Compact opt-in toggle for browser-mode AI-search scrapers (Google
 * AI Mode + Microsoft Copilot). These don't need an API key but each
 * scrape adds ~15-20s per keyword per platform, so it's off by default.
 * Rendered inline above the check button on the per-client visibility
 * page — the natural place to think about "am I also checking AI Mode
 * + Copilot on this run?"
 */
export function BrowserModeAiToggle({ initial }: { initial: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    startTransition(async () => {
      await setBrowserScrapedAiEnabled(next);
    });
  }

  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${
        enabled
          ? "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200"
          : "border-white/10 bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06]"
      }`}
    >
      <input
        type="checkbox"
        checked={enabled}
        onChange={toggle}
        disabled={pending}
        className="sr-only"
      />
      {pending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Globe className="size-3" />
      )}
      <span>
        Also scan Google AI Mode + Copilot
      </span>
      <span
        className={`ml-0.5 inline-block size-2 rounded-full ${
          enabled ? "bg-emerald-400" : "bg-white/20"
        }`}
      />
      <span className="ml-1 text-[9px] font-normal opacity-70">
        (browser-mode, adds ~30s/keyword)
      </span>
    </label>
  );
}
