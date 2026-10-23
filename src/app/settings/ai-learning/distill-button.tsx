"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { runDistill } from "./actions";

export function DistillButton() {
  const [, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      {result && (
        <span className="text-xs text-muted-foreground">{result}</span>
      )}
      <button
        type="button"
        disabled={running}
        onClick={() => {
          setRunning(true);
          setResult(null);
          startTransition(async () => {
            const r = await runDistill();
            setRunning(false);
            if (r.ok) {
              setResult(
                r.ruleCount > 0
                  ? `+${r.ruleCount} new/updated rule${r.ruleCount === 1 ? "" : "s"}`
                  : "No new rules — not enough recent corrections.",
              );
            } else {
              setResult(`Error: ${r.error ?? "unknown"}`);
            }
          });
        }}
        className="inline-flex h-9 items-center rounded-md bg-violet-500/15 px-4 text-xs font-medium text-violet-300 ring-1 ring-inset ring-violet-500/30 hover:bg-violet-500/25 disabled:opacity-50"
      >
        {running ? (
          <>
            <Loader2 className="mr-2 size-3 animate-spin" />
            Distilling…
          </>
        ) : (
          "Distill recent corrections"
        )}
      </button>
    </div>
  );
}
