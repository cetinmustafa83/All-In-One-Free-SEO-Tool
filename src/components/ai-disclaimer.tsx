import { Info } from "lucide-react";

/**
 * Small "AI can make mistakes" disclaimer to drop next to any AI-generated
 * output. Renders as muted small text with an info icon. Use the `inline`
 * variant inside a card footer / list, or the `block` variant as a
 * standalone notice.
 */
export function AiDisclaimer({
  variant = "block",
  text,
}: {
  variant?: "block" | "inline";
  text?: string;
}) {
  const message =
    text ??
    "AI can make mistakes — review carefully before applying any change.";
  if (variant === "inline") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70 italic">
        <Info className="size-2.5" />
        {message}
      </span>
    );
  }
  return (
    <div className="flex items-start gap-1.5 rounded-md bg-amber-500/[0.04] px-2.5 py-1.5 text-[10px] text-amber-200/70 italic ring-1 ring-inset ring-amber-500/15">
      <Info className="mt-0.5 size-3 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
