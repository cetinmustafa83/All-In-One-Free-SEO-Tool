import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared empty-state component. Use this in place of "render nothing"
 * or a bare empty table whenever a list / panel / detail view has no
 * data yet. The goal is to give the user (especially a beginner) a
 * clear "what to do next" instead of a dead-end.
 *
 * Pattern:
 *   <EmptyState
 *     icon={Users}
 *     title="No clients yet"
 *     body="Add your first website to unlock audits, keyword tracking, and reports."
 *     primary={{ href: "/clients/new", label: "Add a client" }}
 *     secondary={{ href: "/learn", label: "How does this work?" }}
 *   />
 *
 * Size variants:
 *   - "md" (default): center of a table / list page
 *   - "sm": inline inside a card or sidebar widget
 *   - "lg": full-page when the route itself has nothing to show
 */
export type EmptyStateAction = {
  href?: string;
  onClick?: () => void;
  label: string;
};

export function EmptyState({
  icon: Icon,
  title,
  body,
  primary,
  secondary,
  size = "md",
  className,
}: {
  icon?: LucideIcon;
  title: string;
  body?: string;
  primary?: EmptyStateAction;
  secondary?: EmptyStateAction;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizeCls = {
    sm: "py-6",
    md: "py-10",
    lg: "py-16",
  }[size];
  const iconSize = {
    sm: "size-7",
    md: "size-9",
    lg: "size-12",
  }[size];
  const titleSize = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-xl",
  }[size];

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        sizeCls,
        className,
      )}
    >
      {Icon && (
        <div className="mb-3 grid place-items-center rounded-full bg-muted/40 p-3 ring-1 ring-inset ring-border">
          <Icon className={cn(iconSize, "text-muted-foreground")} />
        </div>
      )}
      <div className={cn("font-semibold text-foreground", titleSize)}>
        {title}
      </div>
      {body && (
        <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
          {body}
        </p>
      )}
      {(primary || secondary) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {primary && (
            <ActionPill action={primary} variant="primary" />
          )}
          {secondary && (
            <ActionPill action={secondary} variant="secondary" />
          )}
        </div>
      )}
    </div>
  );
}

function ActionPill({
  action,
  variant,
}: {
  action: EmptyStateAction;
  variant: "primary" | "secondary";
}) {
  const cls =
    variant === "primary"
      ? "bg-primary text-primary-foreground hover:bg-primary/90"
      : "border border-border bg-card text-foreground hover:bg-accent";
  const inner = (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
        cls,
      )}
    >
      {action.label}
    </span>
  );
  if (action.href) {
    return <Link href={action.href}>{inner}</Link>;
  }
  return (
    <button type="button" onClick={action.onClick}>
      {inner}
    </button>
  );
}
