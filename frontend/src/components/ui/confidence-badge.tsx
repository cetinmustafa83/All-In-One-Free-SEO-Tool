import { cn } from "@/lib/utils";

/**
 * Confidence pill for AI / heuristic output.
 *
 * The CLAUDE.md design spec calls for three tiers:
 *   - "definitely" — Google's docs say to do this OR our heuristic has
 *                    high-quality evidence. Red so the user takes it
 *                    seriously.
 *   - "probably"   — Strong signal but context-dependent. Amber.
 *   - "test"       — Best-effort guess; the user should A/B test or
 *                    eyeball before committing. Neutral.
 *
 * Use anywhere an AI suggestion, a content recommendation, or a
 * heuristic verdict is shown. Forces the model to admit when its
 * confidence is low instead of presenting all output as equal-weight.
 *
 * Usage:
 *   <ConfidenceBadge level="definitely" reason="Title exceeds 60 chars and gets truncated in 90% of SERPs (Google docs)" />
 *
 * `reason` becomes the native tooltip — should be one sentence.
 */
export type ConfidenceLevel = "definitely" | "probably" | "test";

const LABEL: Record<ConfidenceLevel, string> = {
  definitely: "Definitely fix",
  probably: "Probably worth it",
  test: "Worth testing",
};

const CLS: Record<ConfidenceLevel, string> = {
  definitely:
    "bg-red-500/10 text-red-300 ring-red-500/30",
  probably:
    "bg-amber-500/10 text-amber-300 ring-amber-500/30",
  test:
    "bg-muted text-muted-foreground ring-border",
};

const DOT: Record<ConfidenceLevel, string> = {
  definitely: "bg-red-400",
  probably: "bg-amber-400",
  test: "bg-muted-foreground/50",
};

export function ConfidenceBadge({
  level,
  reason,
  showDot = true,
  className,
}: {
  level: ConfidenceLevel;
  /** One-sentence "why this confidence" — surfaces in the native tooltip. */
  reason?: string;
  showDot?: boolean;
  className?: string;
}) {
  return (
    <span
      title={reason}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
        CLS[level],
        className,
      )}
    >
      {showDot && (
        <span className={cn("size-1.5 rounded-full", DOT[level])} />
      )}
      {LABEL[level]}
    </span>
  );
}
