"use client";

import { useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import { mentionToOutreach } from "../../actions";

/**
 * One-click "convert this mention to an outreach prospect" button.
 * Used most often for unlinked positive mentions — fastest path from
 * "they wrote nice things about us" to "ask them for a link."
 */
export function MentionToOutreachButton({
  mentionId,
  clientId,
  authorName,
  url,
}: {
  mentionId: number;
  clientId: number;
  authorName: string | null;
  url: string;
}) {
  const [, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  if (done) {
    return (
      <span className="text-[10px] text-emerald-300">✓ Added to outreach</span>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setPending(true);
        startTransition(async () => {
          const r = await mentionToOutreach({
            mentionId,
            clientId,
            authorName,
            url,
          });
          setPending(false);
          if (r.ok) setDone(true);
        });
      }}
      className="inline-flex items-center gap-1 rounded-md bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium text-violet-300 ring-1 ring-inset ring-violet-500/30 hover:bg-violet-500/25 disabled:opacity-50"
    >
      {pending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Send className="size-3" />
      )}
      Reach out
    </button>
  );
}
