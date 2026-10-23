/**
 * Pure-data CWV thresholds. Extracted from `crux.ts` so client components
 * can use them without dragging in the server-only DB-backed key fetcher.
 */

export type CwvKind = "lcp" | "inp" | "cls" | "fcp" | "ttfb";

export function ratingForMetric(
  kind: CwvKind,
  p75: number,
): "good" | "needs_improvement" | "poor" {
  switch (kind) {
    case "lcp":
      if (p75 <= 2500) return "good";
      if (p75 <= 4000) return "needs_improvement";
      return "poor";
    case "inp":
      if (p75 <= 200) return "good";
      if (p75 <= 500) return "needs_improvement";
      return "poor";
    case "cls":
      if (p75 <= 0.1) return "good";
      if (p75 <= 0.25) return "needs_improvement";
      return "poor";
    case "fcp":
      if (p75 <= 1800) return "good";
      if (p75 <= 3000) return "needs_improvement";
      return "poor";
    case "ttfb":
      if (p75 <= 800) return "good";
      if (p75 <= 1800) return "needs_improvement";
      return "poor";
  }
}
