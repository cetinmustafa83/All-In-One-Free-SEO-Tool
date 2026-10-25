"use client";

/**
 * The alert feed — every automation decision the engine has made, in
 * order. PENDING scale proposals carry one-tap Approve / Dismiss;
 * nothing else in the app can move money, so the buttons are the whole
 * governance model.
 */

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowUpRight,
  Check,
  PauseCircle,
  ShieldAlert,
  X,
} from "lucide-react";
import { SubmitButton } from "@/components/ui/submit-button";
import type { AdAutomationEventRow } from "@/db/schema";
import { resolveProposal, type ActionResult } from "./actions";
import { useWrappedActionState } from "./safe-action";

type EventRow = AdAutomationEventRow;

const ICONS = {
  AUTO_PAUSE: PauseCircle,
  MONITOR_ALERT: ShieldAlert,
  SCALE_PROPOSAL: ArrowUpRight,
  SCALE_APPLIED: ArrowUpRight,
  RESUME: Check,
  POLL_ERROR: ShieldAlert,
} as const;

const TONES: Record<string, string> = {
  AUTO_PAUSE: "text-rose-400",
  MONITOR_ALERT: "text-amber-400",
  SCALE_PROPOSAL: "text-emerald-400",
  SCALE_APPLIED: "text-emerald-400",
  RESUME: "text-muted-foreground",
  POLL_ERROR: "text-rose-400",
};

function when(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function ProposalActions({ event }: { event: EventRow }) {
  const wrapped = useWrappedActionState<ActionResult>();
  // The action goes through the recovery wrapper: a stale/dead action
  // POST (dev restart, gateway hiccup) toasts + refreshes instead of
  // leaving the Approve button spinning forever.
  const [state, formAction] = useActionState<ActionResult | null, FormData>(
    (prev, formData) => wrapped(resolveProposal, prev, formData),
    null,
  );
  const router = useRouter();

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message);
      router.refresh();
    } else {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <div className="flex gap-2">
      <form action={formAction}>
        <input type="hidden" name="eventId" value={event.id} />
        <input type="hidden" name="decision" value="approve" />
        <SubmitButton size="sm" pendingToast="Approving…">
          <Check data-icon="inline-start" />
          Approve
        </SubmitButton>
      </form>
      <form action={formAction}>
        <input type="hidden" name="eventId" value={event.id} />
        <input type="hidden" name="decision" value="dismiss" />
        <SubmitButton size="sm" variant="outline" pendingToast="Dismissing…">
          <X data-icon="inline-start" />
          Dismiss
        </SubmitButton>
      </form>
    </div>
  );
}

export function AlertFeed({ events }: { events: EventRow[] }) {
  if (events.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Nothing yet. The engine speaks up when an account trips a guardrail
        or beats a scale target.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-white/[0.06]">
      {events.map((e) => {
        const Icon = ICONS[e.type] ?? ShieldAlert;
        const pending = e.type === "SCALE_PROPOSAL" && e.status === "PENDING";
        return (
          <li key={e.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <Icon className={`mt-0.5 size-4 shrink-0 ${TONES[e.type] ?? ""}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <Link
                  href={`/ads/accounts/${e.adAccountId}`}
                  className="text-sm font-medium hover:underline"
                >
                  Account #{e.adAccountId}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {e.type.replaceAll("_", " ").toLowerCase()} · {when(e.createdAt)}
                </span>
                {pending && (
                  <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
                    waiting for you
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">{e.reason}</p>
              {pending && (
                <div className="mt-2">
                  <ProposalActions event={e} />
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}