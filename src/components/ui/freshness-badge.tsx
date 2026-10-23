import { cn } from "@/lib/utils";

/**
 * Tiny pill that shows how stale a piece of data is. Use anywhere a
 * chart / table / panel is sourced from a periodic sync (GSC, GA4,
 * rank-check, audit run) so the user knows whether they're looking at
 * something live or 3-day-old cached numbers.
 *
 * Color tiers:
 *   - emerald: ≤ 1 hour old (live-ish)
 *   - neutral: ≤ 24 hours old (today)
 *   - amber:   ≤ 7 days old (this week)
 *   - red:     > 7 days old (stale — likely the user disconnected
 *              an integration or the runner stalled)
 *
 * The tooltip carries the absolute timestamp so a pro can still see
 * the exact second.
 *
 * Usage:
 *   <FreshnessBadge capturedAt={chart.lastSyncedAt} source="GSC" />
 *
 * If `capturedAt` is null/undefined the badge renders "no data" in
 * neutral — handy for empty-table headers.
 */
export function FreshnessBadge({
  capturedAt,
  source,
  className,
}: {
  capturedAt: Date | string | number | null | undefined;
  /** Optional source name (e.g. "GSC", "GA4", "Rank check"). Shows in the tooltip. */
  source?: string;
  className?: string;
}) {
  if (capturedAt === null || capturedAt === undefined) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-inset ring-border",
          className,
        )}
        title={source ? `${source}: no data yet` : "no data yet"}
      >
        <span className="size-1.5 rounded-full bg-muted-foreground/50" />
        no data yet
      </span>
    );
  }

  const date =
    capturedAt instanceof Date ? capturedAt : new Date(capturedAt);
  const ms = Date.now() - date.getTime();
  const label = relativeLabel(ms);
  const tier = tierFor(ms);
  const tierCls = {
    fresh: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
    today: "bg-muted text-muted-foreground ring-border",
    week: "bg-amber-500/10 text-amber-300 ring-amber-500/30",
    stale: "bg-red-500/10 text-red-300 ring-red-500/30",
  }[tier];
  const dotCls = {
    fresh: "bg-emerald-400",
    today: "bg-muted-foreground/50",
    week: "bg-amber-400",
    stale: "bg-red-400",
  }[tier];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset tabular-nums",
        tierCls,
        className,
      )}
      title={`${source ? `${source} ` : ""}captured ${date.toLocaleString()}`}
    >
      <span className={cn("size-1.5 rounded-full", dotCls)} />
      {label}
    </span>
  );
}

function tierFor(ms: number): "fresh" | "today" | "week" | "stale" {
  const HOUR = 3_600_000;
  const DAY = HOUR * 24;
  if (ms <= HOUR) return "fresh";
  if (ms <= DAY) return "today";
  if (ms <= DAY * 7) return "week";
  return "stale";
}

function relativeLabel(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
