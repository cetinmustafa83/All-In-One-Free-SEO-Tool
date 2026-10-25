import { cn } from "@/lib/utils";

/**
 * Inline jargon explainer. Wrap a single SEO term in `<JargonTerm>`
 * and it gets:
 *   - dotted underline (signals "hover me")
 *   - native `title` tooltip with the plain-English definition
 *   - subtle cursor-help on hover
 *
 * Uses a built-in glossary of the 25 terms a beginner most commonly
 * trips on. Unknown terms render as plain text without an underline
 * so component callers can sprinkle this on anything without first
 * checking the glossary.
 *
 * Usage:
 *   <p>Your <JargonTerm term="canonical" /> tag tells Google which
 *   version of a page is the main one.</p>
 *
 * For a custom definition on the fly:
 *   <JargonTerm term="rel=canonical" definition="..." />
 */
const GLOSSARY: Record<string, string> = {
  canonical:
    "A signal to Google about the main version of this page when similar pages exist. Prevents duplicate content from competing with itself.",
  "meta description":
    "The snippet of text shown under a page's title in Google search results. Not a direct ranking factor, but heavily influences click-through rate.",
  "title tag":
    "The page title shown in the browser tab and as the clickable headline in search results. Most important on-page SEO element.",
  serp:
    "Search Engine Results Page — the page Google shows after someone runs a search.",
  ctr:
    "Click-Through Rate — the percentage of people who see your search result and actually click it.",
  cwv:
    "Core Web Vitals — Google's three speed/UX metrics: LCP (loading), INP (responsiveness), CLS (visual stability).",
  lcp:
    "Largest Contentful Paint — how long it takes for the biggest element on the page (usually a hero image) to load. Target: under 2.5 seconds.",
  cls:
    "Cumulative Layout Shift — how much elements jump around as the page loads. Target: under 0.1.",
  inp:
    "Interaction to Next Paint — how quickly the page responds when you tap or click something. Target: under 200ms.",
  schema:
    "Structured data (JSON-LD) you embed on a page so Google can show rich results — review stars, FAQ accordions, recipe cards, product prices, etc.",
  "rich result":
    "An enhanced Google search listing — stars, prices, FAQs, images — driven by structured data.",
  "alt text":
    "The descriptive text on an image used by screen readers and shown when an image fails to load. Helps accessibility AND image-search ranking.",
  hreflang:
    "An HTML tag that tells Google which language/region version of a page to show different visitors. Used by international sites.",
  "robots.txt":
    "A file at the root of your site that tells crawlers which pages they're allowed to fetch.",
  sitemap:
    "An XML file listing every page on your site, given to Google so it can discover and re-crawl pages faster.",
  cannibalization:
    "When two or more pages on the same site target the same query — they end up competing with each other and neither ranks well.",
  "content decay":
    "The slow drop in traffic to a page that used to perform well. Usually means the content has gone stale or competitors have updated theirs.",
  "striking distance":
    "A keyword you rank for in positions 11-20 — close enough to page one that a small content tweak can push you over.",
  "share of voice":
    "Your slice of total search-result impressions for a set of tracked keywords, vs your competitors.",
  "e-e-a-t":
    "Experience, Expertise, Authoritativeness, Trustworthiness — Google's guidelines for what makes content worth ranking.",
  "ai overview":
    "Google's AI-generated answer that appears above the regular search results on commercial queries. Now shows on roughly 47% of queries.",
  geo:
    "Generative Engine Optimization — getting your content cited inside AI-generated answers (ChatGPT, Perplexity, Claude, Gemini, Google AI Overviews).",
  "llms.txt":
    "A proposed plain-text file (analogous to robots.txt) that lets a site tell LLMs which content they can use and how.",
  backlink:
    "A link from someone else's website to yours. Still one of the strongest ranking signals.",
  "anchor text":
    "The clickable text of a link. Tells Google what the linked page is about.",
  nap:
    "Name, Address, Phone — the three pieces of business info that need to match exactly everywhere online (Google Business Profile, Yelp, your site, etc.) for local SEO.",
  gbp:
    "Google Business Profile — your business listing in Google Maps and the local pack.",
  gsc:
    "Google Search Console — Google's free dashboard showing how often your pages appear in search, who clicks, and what queries trigger them.",
  ga4:
    "Google Analytics 4 — the current version of Google Analytics; tracks traffic, behavior, and conversions on your site.",
  "indexability":
    "Whether Google is allowed to add a page to its search index (it can crawl + isn't blocked by noindex/canonical).",
  "page experience":
    "Google's bundle of UX signals: Core Web Vitals + mobile-friendliness + HTTPS + no intrusive interstitials.",
};

export function JargonTerm({
  term,
  definition,
  children,
  className,
}: {
  /** The term to look up in the glossary. Case-insensitive. */
  term: string;
  /** Custom definition that overrides the built-in glossary. */
  definition?: string;
  /** Display text. Defaults to the term itself. */
  children?: React.ReactNode;
  className?: string;
}) {
  const def = definition ?? GLOSSARY[term.toLowerCase()];
  const text = children ?? term;
  if (!def) {
    // Unknown term — render plain text so this component is safe to
    // sprinkle anywhere without breaking the UI when glossary misses.
    return <>{text}</>;
  }
  return (
    <span
      title={def}
      className={cn(
        "cursor-help border-b border-dotted border-muted-foreground/60 decoration-muted-foreground/60 underline-offset-2",
        className,
      )}
    >
      {text}
    </span>
  );
}
