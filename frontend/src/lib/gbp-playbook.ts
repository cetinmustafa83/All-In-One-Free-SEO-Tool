/**
 * GBP optimization playbook. Static, opinionated checklist + audience-
 * growth tactics that apply to any business with a Google Business
 * Profile (which now includes nearly every client per the project
 * direction — local OR not).
 *
 * The page that consumes this scores the client's setup against each
 * item using whatever data we already have (gbpUrl, hours, address,
 * social links, scraped review count) and surfaces quick wins.
 */

export type PlaybookItem = {
  id: string;
  title: string;
  whyItMatters: string;
  /** Higher = more impactful. */
  weight: 1 | 2 | 3 | 4 | 5;
  /** "everyone" applies to all businesses; others scope to a niche. */
  appliesTo: ("everyone" | "local" | "ecommerce" | "saas" | "blog" | "services")[];
  /** Cadence — once / weekly / monthly / quarterly. */
  cadence: "once" | "weekly" | "monthly" | "quarterly";
  /** Plain copy of the action a user takes. */
  action: string;
  /** Optional URL to deep-link from the playbook card. */
  toolPath?: string;
};

export const GBP_PLAYBOOK: PlaybookItem[] = [
  // -------- One-time setup --------
  {
    id: "claim-listing",
    title: "Claim and verify your GBP listing",
    whyItMatters:
      "Unverified listings can be edited by anyone. Verification unlocks reply-to-reviews, posts, products, and Q&A.",
    weight: 5,
    appliesTo: ["everyone"],
    cadence: "once",
    action: "Visit business.google.com, claim/create the listing, complete the postcard or video verification.",
  },
  {
    id: "complete-profile",
    title: "Fill 100% of profile fields",
    whyItMatters:
      "Google explicitly ranks complete profiles higher. Hours, services, attributes, products — every field is a ranking signal.",
    weight: 5,
    appliesTo: ["everyone"],
    cadence: "once",
    action: "Open the dashboard. Walk every field — categories, services, attributes, hours, holiday hours, photos, products.",
  },
  {
    id: "primary-category",
    title: "Pick the most specific primary category",
    whyItMatters:
      "Specific (\"Italian Restaurant\") beats generic (\"Restaurant\") for relevance. Add 5-9 secondary categories too.",
    weight: 5,
    appliesTo: ["everyone"],
    cadence: "once",
    action: "Settings → Category. Pick the closest match, then add up to 9 secondary categories that genuinely fit.",
  },
  {
    id: "service-area",
    title: "Define service area accurately (if applicable)",
    whyItMatters:
      "Service-area businesses outrank in towns they list. Don't list cities you don't serve — Google penalises stuffing.",
    weight: 4,
    appliesTo: ["local", "services"],
    cadence: "once",
    action: "Settings → Service area. List the cities/zip codes you actually serve.",
  },
  {
    id: "products-services",
    title: "Add Products and Services with descriptions",
    whyItMatters:
      "Products / services appear as a carousel in your panel. Each entry is keyword real estate Google indexes.",
    weight: 4,
    appliesTo: ["everyone"],
    cadence: "once",
    action: "Add 5-10 Products / Services. Each one: name, photo, 100-300 word description with target keywords.",
  },

  // -------- Recurring: review acquisition --------
  {
    id: "request-reviews",
    title: "Ask for reviews from happy customers",
    whyItMatters:
      "Review velocity (reviews per week) is one of the strongest local ranking signals. New reviews > old reviews.",
    weight: 5,
    appliesTo: ["everyone"],
    cadence: "weekly",
    action: "Send the GBP review-request short URL to recent customers. Aim for 2-5 new reviews/week.",
  },
  {
    id: "reply-reviews",
    title: "Reply to every review (positive + negative) within 48h",
    whyItMatters:
      "Reply rate is a confirmed ranking signal. Negative replies handled well also build trust with prospects browsing.",
    weight: 5,
    appliesTo: ["everyone"],
    cadence: "weekly",
    action: "Use the AI review-reply tool to draft, then personalise. Don't auto-post — paste with edits.",
    toolPath: "/gbp",
  },
  {
    id: "review-keywords",
    title: "Encourage reviewers to mention services / city",
    whyItMatters:
      "Reviews that mention your services or location boost your relevance for those keywords. Don't script — gently prompt.",
    weight: 3,
    appliesTo: ["local", "services"],
    cadence: "weekly",
    action: "After an oil change: \"If you have a moment, a quick review mentioning your service in [city] really helps us out.\"",
  },

  // -------- Recurring: content --------
  {
    id: "post-update",
    title: "Publish a Google Post weekly",
    whyItMatters:
      "Posts stay live for ~7 days and signal an active business. Profiles posting weekly outrank dormant ones for the same keywords.",
    weight: 4,
    appliesTo: ["everyone"],
    cadence: "weekly",
    action: "1 image + 100-300 words + a CTA. Mix types: offer, event, news, product spotlight.",
  },
  {
    id: "photo-upload",
    title: "Upload 3-5 fresh photos every week",
    whyItMatters:
      "Profiles with frequent fresh photos get 35% more clicks to website and 42% more requests for directions (Google's data).",
    weight: 4,
    appliesTo: ["everyone"],
    cadence: "weekly",
    action: "Take 3-5 photos: storefront, team, products, behind-the-scenes. Upload through the dashboard, not the app.",
  },
  {
    id: "qa-monitor",
    title: "Monitor + answer Q&A on your profile",
    whyItMatters:
      "Anyone can post a Q&A on your listing. Unanswered or wrong-answered Q&A surface in your panel and drive misleading impressions.",
    weight: 3,
    appliesTo: ["everyone"],
    cadence: "weekly",
    action: "Check the Q&A tab. Pre-seed the most common questions yourself with full keyword-rich answers.",
  },

  // -------- Recurring: insights --------
  {
    id: "review-insights",
    title: "Review GBP Insights monthly: discovery vs direct vs branded",
    whyItMatters:
      "Tracking which queries surface your profile shows what Google associates you with. Mismatch = wrong category or stuffed services.",
    weight: 3,
    appliesTo: ["everyone"],
    cadence: "monthly",
    action: "Performance → Search queries. Note the top 10. If they don't match your niche, your category is probably off.",
  },
  {
    id: "competitor-audit",
    title: "Audit 3 top-ranking competitor profiles",
    whyItMatters:
      "Competitors who rank above you in the local pack are usually doing 1-2 things you aren't. Reverse-engineer their photos, posts, services.",
    weight: 3,
    appliesTo: ["local", "services"],
    cadence: "monthly",
    action: "For each, list: # photos, last post date, # reviews vs you, services breadth. Copy what works.",
  },
  {
    id: "nap-audit",
    title: "NAP consistency check across top citations",
    whyItMatters:
      "Inconsistent name, address, phone across directories tanks local rankings. Any tiny variance (Ave. vs Avenue) hurts.",
    weight: 4,
    appliesTo: ["local", "services"],
    cadence: "quarterly",
    action: "Compare against the top citation directories for your country. Fix any mismatches.",
    toolPath: "/citations",
  },

  // -------- Audience growth tactics --------
  {
    id: "messaging-on",
    title: "Turn on Messaging + reply within 1 hour",
    whyItMatters:
      "GBP messaging adds a direct lead channel. Google ranks profiles with active messaging higher (and shows a green \"Responds quickly\" badge).",
    weight: 3,
    appliesTo: ["local", "services", "ecommerce"],
    cadence: "once",
    action: "Dashboard → Messages → On. Set notifications. Aim for sub-1h response time during business hours.",
  },
  {
    id: "booking-link",
    title: "Add a booking / reservation link",
    whyItMatters:
      "Direct booking from the profile bypasses your website + reduces friction. Google surfaces a \"Book\" button on supported categories.",
    weight: 3,
    appliesTo: ["local", "services"],
    cadence: "once",
    action: "Use a free integration partner (Calendly, Schedulista, etc.) or paste your own booking URL.",
  },
  {
    id: "social-cross-promote",
    title: "Cross-promote your GBP on social + in email signature",
    whyItMatters:
      "Direct (\"branded\") searches for your business on Google strengthen relevance signals. Drive them deliberately.",
    weight: 2,
    appliesTo: ["everyone"],
    cadence: "once",
    action: "Add the short URL (g.page/...) to email signatures, social bios, and order confirmations.",
  },
  {
    id: "ugc-photos",
    title: "Encourage customers to upload photos with their reviews",
    whyItMatters:
      "User-uploaded photos count more than business-uploaded ones for showing freshness. They also auto-tag with location/time.",
    weight: 3,
    appliesTo: ["local", "ecommerce", "services"],
    cadence: "monthly",
    action: "In review-request copy: \"If you snap a photo, even better — it helps other customers know what to expect.\"",
  },
  {
    id: "events",
    title: "Publish events as Google Posts",
    whyItMatters:
      "Event posts surface in Google's events search + your panel for the duration. Free promotion for any in-person or webinar event.",
    weight: 2,
    appliesTo: ["everyone"],
    cadence: "monthly",
    action: "When you have an event, post it as type \"Event\" with start/end times and a clear CTA.",
  },
];

/**
 * Filter the playbook to items relevant for a client's niche, then sort
 * by weight (biggest first).
 */
export function playbookFor(niche: string | null | undefined): PlaybookItem[] {
  const normalized = (niche ?? "everyone") as PlaybookItem["appliesTo"][number];
  return GBP_PLAYBOOK.filter(
    (i) => i.appliesTo.includes("everyone") || i.appliesTo.includes(normalized),
  ).sort((a, b) => b.weight - a.weight);
}

/**
 * Score a client's GBP setup using whatever signals we have.
 * Returns a 0-100 number plus the items that contributed to the gap.
 */
export function scoreGbpProfile(input: {
  hasGbpUrl: boolean;
  hasAddress: boolean;
  hasPhone: boolean;
  hasHours: boolean;
  reviewCount: number | null;
  ratingAverage: number | null;
}): { score: number; missing: string[] } {
  const missing: string[] = [];
  let score = 0;
  let max = 0;

  // Profile presence — 25
  max += 25;
  if (input.hasGbpUrl) score += 25;
  else missing.push("GBP listing URL");

  // NAP completeness — 30
  max += 30;
  if (input.hasAddress) score += 12;
  else missing.push("Address");
  if (input.hasPhone) score += 10;
  else missing.push("Phone");
  if (input.hasHours) score += 8;
  else missing.push("Operating hours");

  // Review presence — 25
  max += 25;
  const rc = input.reviewCount ?? 0;
  if (rc >= 50) score += 25;
  else if (rc >= 20) score += 18;
  else if (rc >= 5) score += 10;
  else if (rc >= 1) score += 4;
  else missing.push("Reviews (need at least 5 to start)");

  // Rating — 20
  max += 20;
  const r = input.ratingAverage ?? 0;
  if (r >= 4.6) score += 20;
  else if (r >= 4.0) score += 14;
  else if (r >= 3.0) score += 8;
  else if (r > 0) score += 3;

  return {
    score: Math.round((score / max) * 100),
    missing,
  };
}
