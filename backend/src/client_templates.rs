//! GENERATED FILE — backend/src/client_templates.rs (Task 14.5b).
//! Source of truth: src/lib/niche-templates.ts (niche data) and
//! src/lib/tech-stack-templates.ts (stack data + detection-label map).
//! Regenerate with: bun backend/tools/gen-templates.ts
//! Do NOT edit by hand — the smoke tests assert parity via the generator.

/// One task-template row (structurally NicheTaskTemplate / StackTaskTemplate).
pub struct Template {
    pub title: &'static str,
    pub description: &'static str,
    pub why_it_matters: &'static str,
    pub priority: &'static str,
}

// ── Niche templates (src/lib/niche-templates.ts) ────────────────────────────

pub static NICHE_LOCAL: &[Template] = &[
    Template { title: "Claim and verify your Google Business Profile", description: "Search your business name on Google. If the GBP card on the right shows 'Own this business?', click it and verify.", why_it_matters: "Google Business Profile is the single biggest local-SEO ranking factor. Until it's verified, you can't appear in the local 3-pack at all.", priority: "high" },
    Template { title: "Confirm NAP consistency across the web", description: "Make sure Name, Address, and Phone match exactly across your site, GBP, Yelp, Facebook, and major directories.", why_it_matters: "Google uses NAP consistency as a trust signal for local businesses. Even small mismatches (St. vs Street) can dilute local rankings.", priority: "high" },
    Template { title: "Set up a system to request Google reviews", description: "Generate a short review link from your GBP and add it to email signatures, receipts, and follow-up messages.", why_it_matters: "Review count and recency are direct ranking factors for the local pack. Aim for at least 1–2 new reviews per month.", priority: "high" },
    Template { title: "Add LocalBusiness schema to your homepage", description: "Add JSON-LD structured data with name, address, telephone, openingHours, and geo coordinates.", why_it_matters: "LocalBusiness schema helps Google understand you're a physical-location business and powers rich features in search.", priority: "medium" },
    Template { title: "Build dedicated landing pages for each service area", description: "If you serve multiple cities, create one page per city with unique content (not just a swap of city name).", why_it_matters: "Generic 'we serve all of California' pages don't rank for city-level searches. Dedicated city pages do.", priority: "medium" },
    Template { title: "Audit local citations for accuracy", description: "Check listings on Yelp, Facebook, BBB, Apple Maps, Bing Places, plus 5–10 niche directories for your industry.", why_it_matters: "Outdated citations confuse Google about your real address and phone — clean them up to consolidate signals.", priority: "medium" },
];

pub static NICHE_ECOMMERCE: &[Template] = &[
    Template { title: "Add Product schema to every product page", description: "Use JSON-LD with name, image, description, sku, brand, offers (price, availability), and aggregateRating.", why_it_matters: "Product schema unlocks rich results in Google: price, stock status, ratings — directly improving CTR and qualified clicks.", priority: "high" },
    Template { title: "Optimize product image file sizes and alt text", description: "Run a bulk image audit. Convert to WebP, target under 100KB each, and write descriptive alt text using product name + key attributes.", why_it_matters: "Images drive product-page LCP and unlock Google Images traffic, which converts well for ecommerce.", priority: "high" },
    Template { title: "Audit faceted navigation for indexable junk URLs", description: "Check filters and sort parameters. Anything that creates near-duplicate URLs (color=red&size=L vs size=L&color=red) needs canonicals or noindex.", why_it_matters: "Uncontrolled facets can generate millions of low-value pages, wasting crawl budget and creating duplicate-content problems.", priority: "high" },
    Template { title: "Write unique copy for category and collection pages", description: "Add a 100–300 word intro to each major category page above the product grid, covering buyer intent and key attributes.", why_it_matters: "Category pages often rank for the highest-volume commercial queries — but only if they have content beyond a product grid.", priority: "medium" },
    Template { title: "Set up clean breadcrumb navigation with schema", description: "Visible breadcrumbs (Home › Category › Subcategory › Product) plus BreadcrumbList JSON-LD.", why_it_matters: "Breadcrumbs improve internal linking, navigation depth, and unlock breadcrumb display in Google search results.", priority: "medium" },
    Template { title: "Plan how to handle out-of-stock products", description: "Decide: keep page live with 'out of stock' (good for SEO), redirect to category, or 410. Document the rule.", why_it_matters: "Killing pages too aggressively destroys earned rankings and backlinks. Keeping them live with proper schema is usually best.", priority: "low" },
];

pub static NICHE_SAAS: &[Template] = &[
    Template { title: "Build comparison pages for each major competitor", description: "Create '[Your product] vs [Competitor]' pages — fair, detailed, with feature tables. Aim for 5–10 of these.", why_it_matters: "Comparison queries are bottom-of-funnel and high-intent. Owning these pages captures buyers actively evaluating you.", priority: "high" },
    Template { title: "Build integration pages for every tool you connect to", description: "One page per integration (e.g. '/integrations/slack') describing the use case, setup, and benefit.", why_it_matters: "Buyers search for 'X integration Y' before purchase. Integration pages capture that intent and double as sales collateral.", priority: "high" },
    Template { title: "Set up programmatic SEO for use-case landing pages", description: "Identify a templatable pattern (e.g. 'Time tracking for [industry]') and ship 20–100 variants powered from a single template + dataset.", why_it_matters: "Programmatic SEO is one of the highest-leverage tactics for SaaS — it scales coverage of long-tail use cases dramatically.", priority: "medium" },
    Template { title: "Write SoftwareApplication schema for your homepage", description: "Add JSON-LD with applicationCategory, offers (pricing tiers), aggregateRating from real reviews.", why_it_matters: "Helps Google place you in software-specific search features and review-rich snippets when applicable.", priority: "medium" },
    Template { title: "Build a deep, hub-and-spoke help center", description: "Central /docs hub linking to every feature article. Articles target informational queries from users — and rank.", why_it_matters: "Documentation is high-quality, naturally linked content. SaaS sites often rank for product-related questions through docs alone.", priority: "medium" },
    Template { title: "Add FAQ schema to pricing and feature pages", description: "Wrap real questions and answers in FAQPage JSON-LD on pages where users have purchase questions.", why_it_matters: "FAQ rich results take up extra real estate in search and improve CTR on commercial-intent pages.", priority: "low" },
];

pub static NICHE_BLOG: &[Template] = &[
    Template { title: "Build a content calendar for the next 90 days", description: "Plan 1–2 posts per week mapped to topic clusters, with target keywords and pillar links.", why_it_matters: "Consistent publishing on a clear topic plan beats sporadic posts. Topic depth signals authority to Google.", priority: "high" },
    Template { title: "Identify your top 3 topic clusters and pillar pages", description: "Pick the 3 broadest topics you want to own. For each, plan a 3000+ word pillar page and 5–10 supporting articles.", why_it_matters: "Topical authority — covering a subject deeply — is one of Google's strongest content-quality signals after the helpful-content updates.", priority: "high" },
    Template { title: "Audit content decay — flag posts losing traffic", description: "Pull GSC data, identify posts that lost >30% of clicks YoY. For each, decide: refresh, merge, or retire.", why_it_matters: "Refreshing decaying content recovers traffic at a fraction of the cost of new posts. It's the highest-ROI content task.", priority: "high" },
    Template { title: "Add Article schema with author + datePublished + dateModified", description: "Especially for YMYL or expertise-heavy content — make author bylines, credentials, and update dates explicit.", why_it_matters: "E-E-A-T (Experience, Expertise, Authoritativeness, Trust) is now a major Google signal, especially after the helpful-content updates.", priority: "medium" },
    Template { title: "Improve internal linking on top-performing posts", description: "On each top-traffic article, add 5–10 contextual links to related pillar/cluster pages.", why_it_matters: "Internal links pass authority from your strongest pages to weaker ones, lifting cluster-wide rankings.", priority: "medium" },
    Template { title: "Set up author pages with E-E-A-T signals", description: "Real photo, bio with credentials, links to past work, social profiles, schema with sameAs links.", why_it_matters: "Strong author signals separate trustworthy content from AI-generated noise — increasingly important post-helpful-content updates.", priority: "low" },
];

pub static NICHE_SERVICES: &[Template] = &[
    Template { title: "Build dedicated pages for each service you offer", description: "Don't bundle services on one page. One page per service, each ~800–1500 words, addressing the specific buyer's questions.", why_it_matters: "Buyers search for specific services, not bundles. Dedicated pages rank for those specific queries.", priority: "high" },
    Template { title: "Add Service schema to each service page", description: "Use Service or ProfessionalService JSON-LD with serviceType, areaServed, provider, and offers if you have pricing.", why_it_matters: "Schema helps Google place you in service-related searches and unlock rich features for service businesses.", priority: "medium" },
    Template { title: "Publish 3–5 detailed case studies", description: "Real client, real outcome with numbers (or anonymized if needed), the process you used, and lessons learned.", why_it_matters: "Case studies are the strongest trust signal on a services site — both for ranking E-E-A-T and converting buyers who land.", priority: "high" },
    Template { title: "Build prominent trust signals on every page", description: "Awards, certifications, client logos, real testimonials with names and photos, real team photos.", why_it_matters: "Service buyers are evaluating risk. Trust signals reduce perceived risk and improve both rankings (E-E-A-T) and conversion.", priority: "medium" },
    Template { title: "Create a clear About page with team and credentials", description: "Real names, photos, credentials, years of experience. Link to LinkedIn profiles via sameAs schema.", why_it_matters: "Anonymous service businesses underperform. Real people with credentials are a major trust + E-E-A-T win.", priority: "medium" },
    Template { title: "Set up a FAQ section addressing buyer objections", description: "Mine sales calls for the 10 most common questions. Answer them on a page with FAQPage schema.", why_it_matters: "Answering buyer objections directly improves conversion rate and unlocks FAQ rich results in search.", priority: "low" },
];

/// getNicheTemplates(niche) — unknown/null niches get nothing.
pub fn niche_templates(niche: Option<&str>) -> &'static [Template] {
    match niche {
        Some("local") => NICHE_LOCAL,
        Some("ecommerce") => NICHE_ECOMMERCE,
        Some("saas") => NICHE_SAAS,
        Some("blog") => NICHE_BLOG,
        Some("services") => NICHE_SERVICES,
        _ => &[],
    }
}

// ── Tech-stack templates (src/lib/tech-stack-templates.ts) ──────────────────

pub static STACK_WORDPRESS: &[Template] = &[
    Template { title: "Install Rank Math or Yoast SEO", description: "Pick one (don't run both). Yoast is more popular, Rank Math has more features in the free tier.", why_it_matters: "Gives you a single place to control titles, meta descriptions, schema, sitemaps, redirects, and breadcrumbs without editing theme files.", priority: "high" },
    Template { title: "Enable caching — install LiteSpeed Cache or WP Rocket", description: "LiteSpeed Cache is free if your host supports LiteSpeed (most do). WP Rocket is paid but works on any host.", why_it_matters: "WordPress is slow out of the box. Caching is the single biggest speed win — usually 2–4× faster page loads, directly improving Core Web Vitals.", priority: "high" },
    Template { title: "Install ShortPixel or Smush — convert images to WebP", description: "Bulk-convert and lazy-load all your images. Set quality to 80–85 for the best size/quality ratio.", why_it_matters: "Images are typically 60–80% of page weight on WordPress sites. WebP is 25–35% smaller than JPEG with no visible quality loss.", priority: "high" },
    Template { title: "Audit and remove unused plugins", description: "Each active plugin adds load time. Anything you haven't touched in 3+ months — review, deactivate, delete.", why_it_matters: "Plugin bloat is the #1 reason WP sites are slow. 5 quality plugins beats 25 mediocre ones every time.", priority: "medium" },
    Template { title: "Set up Cloudflare (free tier) as a CDN", description: "Sign up at cloudflare.com → Add site → Update nameservers at your registrar. Auto-minify CSS/JS/HTML in Cloudflare.", why_it_matters: "Free CDN serves static assets from servers near your visitors, plus DDoS protection. ~30% speed improvement on most sites.", priority: "medium" },
    Template { title: "Configure permalinks: Settings → Permalinks → Post name", description: "Default WordPress permalinks are ?p=123. Change to /post-name/ format.", why_it_matters: "Clean URLs with the post slug help users and search engines understand what's on the page.", priority: "medium" },
    Template { title: "Disable directory indexing in .htaccess", description: "Add: Options -Indexes", why_it_matters: "Without this, anyone can browse your /wp-content/uploads/ folder. Security + cleaner crawl signals.", priority: "low" },
];

pub static STACK_SHOPIFY: &[Template] = &[
    Template { title: "Pick an SEO app — install Smart SEO or Plug in SEO", description: "Smart SEO auto-generates JSON-LD and alt text. Plug in SEO is free and audits your store on a schedule.", why_it_matters: "Shopify hides theme files behind a Liquid templating layer — these apps give you SEO control without theme editing.", priority: "high" },
    Template { title: "Audit installed apps in Settings → Apps", description: "Each app loads scripts on every page. Remove any abandoned apps you no longer use, even if they're free.", why_it_matters: "Shopify hosts your store fast — apps are the main speed killer. Removing 2-3 unused apps often shaves 500–1000ms from LCP.", priority: "high" },
    Template { title: "Compress all product images — keep under 100 KB each", description: "Use Crush.pics or TinyPNG (Shopify integration available). Aim for WebP format where supported.", why_it_matters: "Shopify recommends max 100KB per image. Larger images hurt mobile LCP and bandwidth-limited users (huge slice of e-commerce buyers).", priority: "high" },
    Template { title: "Disable currency converter / pop-up apps if not strictly needed", description: "Currency converters typically add 600–800ms. Pop-up apps add even more.", why_it_matters: "Speed beats fancy. A fast checkout converts better than a slow one with a currency selector.", priority: "medium" },
    Template { title: "Set canonical to .com on collection paginated URLs", description: "/collections/all?page=2 should canonical to /collections/all to avoid duplicate-content issues.", why_it_matters: "Pagination is one of the most common Shopify SEO mistakes — Google sees 50 near-identical pages.", priority: "medium" },
    Template { title: "Write a unique 100–300 word intro on every collection page", description: "Shopify's default collection page is just a product grid. Add an SEO description above the grid in the collection's Description field.", why_it_matters: "Collection pages often rank for the highest-volume commercial queries — but only if there's content above the grid.", priority: "medium" },
    Template { title: "Submit sitemap.xml to Google Search Console", description: "Shopify auto-generates /sitemap.xml. Submit it once at search.google.com/search-console.", why_it_matters: "Helps Google discover new products and collections faster, especially for stores adding inventory regularly.", priority: "low" },
];

pub static STACK_WIX: &[Template] = &[
    Template { title: "Switch from Wix Editor to Wix Studio if possible", description: "Wix Studio gives more control over technical SEO. Migration is involved but worth it for serious projects.", why_it_matters: "Wix's classic Editor has known speed limitations. Studio addresses many of them.", priority: "medium" },
    Template { title: "Use Wix SEO tools panel — set page-level title + meta description", description: "Pages → SEO tools panel for each page. Don't leave any pages with default Wix-generated titles.", why_it_matters: "Wix's auto-generated titles are usually generic and miss the keyword. Manual override is the single biggest Wix SEO win.", priority: "high" },
    Template { title: "Compress every image before uploading — target under 200KB", description: "Wix doesn't compress images well. Pre-compress with TinyPNG or Squoosh before upload.", why_it_matters: "Wix sites tend to ship oversized images. This is the #1 lever for Wix Core Web Vitals.", priority: "high" },
    Template { title: "Set up redirects: Settings → SEO → Redirect URLs", description: "Any old URL needs a 301 to its new location. Wix handles this through the SEO settings panel.", why_it_matters: "Without 301s, you lose ranking authority on every URL change. Free Wix-native fix.", priority: "medium" },
    Template { title: "Honest note: accept Wix's limits", description: "Wix has speed limitations you can't fully fix without leaving the platform. Focus on what's controllable: titles, content, images, internal linking.", why_it_matters: "Setting realistic expectations beats chasing impossible 95+ Lighthouse scores on Wix. Compete on content quality instead.", priority: "low" },
];

pub static STACK_SQUARESPACE: &[Template] = &[
    Template { title: "Use SEO panel on every page: Page Settings → SEO", description: "Set unique title + meta description on each page. Don't accept Squarespace's auto-generated defaults.", why_it_matters: "Default Squarespace titles are usually 'Page Title — Site Title' — generic and underperforming for clicks.", priority: "high" },
    Template { title: "Enable AMP for blog posts: Marketing → AMP", description: "AMP makes mobile blog posts load instantly. Free toggle.", why_it_matters: "AMP improves mobile pageviews-per-session on content-heavy sites — though Google's reliance on AMP has waned.", priority: "low" },
    Template { title: "Add image alt text via the image editor on every block", description: "Click image → Edit → Caption / Alt text field.", why_it_matters: "Squarespace's image-heavy templates make alt text crucial for both accessibility and Google Image Search.", priority: "high" },
    Template { title: "Use Custom Code Injection to add Google Analytics 4 + Tag Manager", description: "Settings → Advanced → Code Injection → paste GA4/GTM scripts in Header.", why_it_matters: "Squarespace's built-in analytics is limited. GA4 + GTM unlock proper conversion tracking.", priority: "medium" },
    Template { title: "Enable HTTPS in Settings → Advanced → SSL", description: "If not already enabled — set to 'Secure' (HTTPS only).", why_it_matters: "Required for ranking and to prevent the 'Not secure' browser warning.", priority: "high" },
];

pub static STACK_WEBFLOW: &[Template] = &[
    Template { title: "Add page-level title + meta description in Page Settings", description: "Open each page → Settings → SEO → fill in.", why_it_matters: "Webflow gives you full SEO control but doesn't auto-fill anything. Empty SEO panels = generic site-name fallback.", priority: "high" },
    Template { title: "Set up Open Graph and Twitter Card images on every page", description: "Page Settings → SEO → Open Graph image. Use 1200×630.", why_it_matters: "Critical for social shares. Webflow makes this trivially configurable.", priority: "medium" },
    Template { title: "Enable site-wide HTTPS in Project Settings → Hosting", description: "Toggle SSL on. Free with all Webflow paid plans.", why_it_matters: "Required for ranking + browser trust.", priority: "high" },
    Template { title: "Use Webflow CMS for blog/listings, not static pages", description: "Repeating content (blog posts, case studies) belongs in CMS Collections, not duplicated static pages.", why_it_matters: "Static duplication creates accidental near-duplicates. CMS Collections give you templated, schema-friendly listings.", priority: "medium" },
    Template { title: "Add JSON-LD via Page Settings → Custom Code → Inside <head>", description: "Webflow doesn't auto-generate schema. Paste JSON-LD per page or use a CMS-driven script.", why_it_matters: "Schema unlocks rich results — critical for any commercial-intent page.", priority: "medium" },
];

pub static STACK_NEXTJS: &[Template] = &[
    Template { title: "Replace <img> with next/image throughout", description: "Auto-handles responsive sizing, WebP/AVIF conversion, and lazy loading. Set priority on the LCP image.", why_it_matters: "Single biggest Core Web Vitals win on Next.js sites. Often shaves 30–50% off LCP.", priority: "high" },
    Template { title: "Use generateMetadata in App Router for dynamic SEO", description: "Each page exports an async generateMetadata that returns title, description, openGraph, etc.", why_it_matters: "Default Next.js doesn't auto-generate per-page meta. Without generateMetadata you get the same site-wide title on every URL.", priority: "high" },
    Template { title: "Add app/sitemap.ts and app/robots.ts", description: "Next.js will auto-generate /sitemap.xml and /robots.txt at build time. Both required for serious SEO.", why_it_matters: "Without these you have no sitemap and no crawl directives — Google crawls inefficiently.", priority: "high" },
    Template { title: "Move analytics to next/script with strategy='afterInteractive'", description: "import Script from 'next/script'. Don't use plain <script> tags — they block render.", why_it_matters: "Render-blocking analytics is the most common reason Next.js sites have a slow INP.", priority: "medium" },
    Template { title: "Enable ISR (Incremental Static Regeneration) on content pages", description: "Add export const revalidate = 3600 to content pages. Serves static HTML, refreshes hourly.", why_it_matters: "Static HTML is the fastest possible delivery. ISR gives you static speed with dynamic-ish freshness.", priority: "medium" },
    Template { title: "Preload critical fonts with next/font", description: "Use next/font/google or next/font/local. Set display: swap.", why_it_matters: "Font loading is a major CLS contributor. next/font handles preload + swap automatically.", priority: "medium" },
];

pub static STACK_DRUPAL: &[Template] = &[
    Template { title: "Install the Metatag module + Schema.org Metatag", description: "Adds proper meta tags + JSON-LD support across content types.", why_it_matters: "Drupal core has minimal SEO support — these modules are non-negotiable.", priority: "high" },
    Template { title: "Install Pathauto — auto-generate SEO-friendly URL aliases", description: "Replaces /node/123 with /your-page-title. Configure URL patterns per content type.", why_it_matters: "Default Drupal URLs are unreadable. Pathauto fixes this site-wide.", priority: "high" },
    Template { title: "Install Redirect module to manage 301s", description: "Captures URL changes and ensures old paths redirect to new ones.", why_it_matters: "Drupal CMS edits often change URLs. Without redirects you lose all earned rankings.", priority: "high" },
    Template { title: "Enable XML Sitemap module + submit to Google Search Console", description: "Generate /sitemap.xml automatically based on content type rules.", why_it_matters: "Speeds up indexing of new content, especially on large Drupal sites.", priority: "medium" },
];

pub static STACK_MAGENTO: &[Template] = &[
    Template { title: "Enable canonical URLs for products and categories", description: "Stores → Configuration → Catalog → Catalog → Search Engine Optimization → Use Canonical Link Meta Tag = Yes (both products and categories).", why_it_matters: "Magento generates many URL variations per product. Without canonicals, ranking signals split across them.", priority: "high" },
    Template { title: "Configure URL Suffix and remove .html if present", description: "Stores → Configuration → Catalog → Catalog → Search Engine Optimization → set Product URL Suffix to empty.", why_it_matters: "Cleaner URLs without .html are easier to read and slightly better for CTR.", priority: "medium" },
    Template { title: "Install a caching extension (Varnish + Redis)", description: "Magento is slow without proper caching. Varnish for full-page, Redis for session/object cache.", why_it_matters: "Magento has the worst out-of-box speed of any major e-commerce platform. Caching brings it from unusable to fast.", priority: "high" },
    Template { title: "Audit installed extensions — disable any you don't actively use", description: "Each Magento extension can add multiple JS bundles per page.", why_it_matters: "Magento sites bloat fast with extensions. Quarterly audit + removal keeps speed reasonable.", priority: "medium" },
];

pub static STACK_WOOCOMMERCE: &[Template] = &[
    Template { title: "Add Product schema to all product pages", description: "Yoast/Rank Math do this automatically — verify it's enabled. Test with Google's Rich Results Test on a product URL.", why_it_matters: "Product schema unlocks price, stock, ratings in Google search results — directly improving CTR for commercial intent.", priority: "high" },
    Template { title: "Audit faceted-nav indexing — apply noindex to filter URLs", description: "Filtered shop URLs like /shop/?color=red shouldn't all be indexed. In Yoast/Rank Math, noindex query-param URLs.", why_it_matters: "Faceted nav can generate millions of low-value pages, eating crawl budget and creating duplicate content.", priority: "high" },
    Template { title: "Set canonical for variation product URLs", description: "Variations like /shirt/?attribute=red should canonical to /shirt/.", why_it_matters: "Variations confuse Google about which URL to rank. Canonicalizing to the parent product consolidates ranking signals.", priority: "medium" },
];

pub static STACK_CUSTOM: &[Template] = &[
    Template { title: "Add canonical link tags to every page", description: "<link rel='canonical' href='https://yoursite.com/page'>", why_it_matters: "Without canonicals, Google has to guess which URL is the 'real' one. Custom builds often forget this.", priority: "high" },
    Template { title: "Generate and submit a sitemap.xml", description: "Either build it programmatically from your routes, or use a generator. Submit to Google Search Console.", why_it_matters: "Helps Google find pages it wouldn't otherwise crawl.", priority: "high" },
    Template { title: "Add JSON-LD schema for your business type", description: "At minimum: Organization or LocalBusiness on the homepage. Extend with Product / Article / FAQ on relevant pages.", why_it_matters: "Schema is hand-coded on custom sites — easy to skip, but unlocks rich results in search.", priority: "high" },
    Template { title: "Enable HTTP/2 or HTTP/3 + gzip/brotli compression", description: "Configure at your CDN or web server level. Should be on by default on modern hosts.", why_it_matters: "Free 20–40% load-time improvement. Custom builds sometimes ship with HTTP/1.1 by mistake.", priority: "medium" },
    Template { title: "Configure proper cache-control headers for static assets", description: "JS/CSS/images: cache-control: public, max-age=31536000, immutable. HTML: no-cache or short max-age.", why_it_matters: "Long cache TTLs on assets dramatically improve repeat visits — common omission on custom builds.", priority: "medium" },
    Template { title: "Add structured logging for crawler hits", description: "Log Googlebot/Bingbot user agents to a separate stream. Review monthly for crawl errors.", why_it_matters: "Custom builds can break crawl access without anyone noticing for weeks.", priority: "low" },
];

/// detectionLabelToKey + templates, fused: a detected label → its rows.
pub fn stack_templates_for_label(label: &str) -> Option<&'static [Template]> {
    match label {

        "WordPress" => Some(STACK_WORDPRESS),
        "Shopify" => Some(STACK_SHOPIFY),
        "Wix" => Some(STACK_WIX),
        "Squarespace" => Some(STACK_SQUARESPACE),
        "Webflow" => Some(STACK_WEBFLOW),
        "Next.js" => Some(STACK_NEXTJS),
        "Drupal" => Some(STACK_DRUPAL),
        "Magento" => Some(STACK_MAGENTO),
        "WooCommerce" => Some(STACK_WOOCOMMERCE),
        _ => None,
    }
}

/// pickStackTemplates(detectedStack): every matched platform's rows in
/// detection order; falls back to the "custom" set when nothing matched.
pub fn pick_stack_templates(detected: Option<&[String]>) -> Vec<&'static Template> {
    let mut out: Vec<&'static Template> = Vec::new();
    let mut matched = false;
    if let Some(labels) = detected {
        for label in labels {
            if let Some(rows) = stack_templates_for_label(label) {
                matched = true;
                out.extend(rows.iter());
            }
        }
    }
    if !matched {
        out.extend(STACK_CUSTOM.iter());
    }
    out
}
