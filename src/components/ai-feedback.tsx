"use client";

import { useState, useTransition } from "react";
import { ThumbsDown, ThumbsUp, Check } from "lucide-react";
import { logAiFeedbackAction } from "./ai-feedback-action";

type Feature =
  | "exec_summary"
  | "blog_draft"
  | "title_rewrite"
  | "meta_rewrite"
  | "review_reply"
  | "content_idea"
  | "general";

/**
 * Drop-in feedback widget for any AI output. Renders thumbs-up/thumbs-down,
 * with a thumbs-down expanding into a "what should it have said?" textarea
 * that feeds the learning loop. Stateless — caller passes the AI output text.
 */
export function AiFeedback({
  feature,
  aiOutput,
  clientId,
  size = "md",
}: {
  feature: Feature;
  aiOutput: string;
  clientId?: number | null;
  size?: "sm" | "md";
}) {
  const [state, setState] = useState<
    "idle" | "down-open" | "submitting" | "thanks"
  >("idle");
  const [correction, setCorrection] = useState("");
  const [note, setNote] = useState("");
  const [, startTransition] = useTransition();

  const submit = (rating: 1 | -1, withCorrection = false) => {
    setState("submitting");
    startTransition(async () => {
      await logAiFeedbackAction({
        feature,
        clientId: clientId ?? null,
        aiOutput,
        rating,
        correctedOutput: withCorrection ? correction : undefined,
        note: withCorrection ? note : undefined,
      });
      setState("thanks");
      setTimeout(() => setState("idle"), 2200);
    });
  };

  if (state === "thanks") {
    return (
      <div
        className={`inline-flex items-center gap-1 ${
          size === "sm" ? "text-[10px]" : "text-xs"
        } text-emerald-300`}
      >
        <Check className="size-3" />
        Thanks — the tool will use this next time.
      </div>
    );
  }

  if (state === "down-open") {
    return (
      <div className="space-y-2 rounded-md border border-rose-500/30 bg-rose-500/5 p-3">
        <p className="text-xs font-medium text-rose-200">
          What should it have said?
        </p>
        <textarea
          rows={3}
          value={correction}
          onChange={(e) => setCorrection(e.target.value)}
          placeholder="Paste a corrected version (this is what teaches the model best)…"
          className="w-full rounded-md border border-white/10 bg-card/60 px-3 py-2 text-xs focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Or describe the issue (one line)…"
          className="h-8 w-full rounded-md border border-white/10 bg-card/60 px-3 text-xs focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setState("idle")}
            className="rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => submit(-1, true)}
            disabled={!correction && !note}
            className="rounded-md bg-rose-500/15 px-3 py-1 text-[10px] font-medium text-rose-300 ring-1 ring-inset ring-rose-500/30 hover:bg-rose-500/25 disabled:opacity-50"
          >
            Submit feedback
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-1 ${
        size === "sm" ? "text-[10px]" : "text-xs"
      } text-muted-foreground`}
    >
      <span>Helpful?</span>
      <button
        type="button"
        onClick={() => submit(1)}
        disabled={state === "submitting"}
        className="rounded-md p-1 hover:bg-emerald-500/10 hover:text-emerald-300 disabled:opacity-50"
        aria-label="Thumbs up"
      >
        <ThumbsUp className={size === "sm" ? "size-3" : "size-3.5"} />
      </button>
      <button
        type="button"
        onClick={() => setState("down-open")}
        disabled={state === "submitting"}
        className="rounded-md p-1 hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-50"
        aria-label="Thumbs down"
      >
        <ThumbsDown className={size === "sm" ? "size-3" : "size-3.5"} />
      </button>
    </div>
  );
}
