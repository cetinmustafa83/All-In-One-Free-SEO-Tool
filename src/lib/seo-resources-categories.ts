/**
 * Category label map. Split out from `seo-resources-loader.ts` so client
 * components can import the labels without pulling in the DB client.
 */

export const CATEGORY_LABELS: Record<string, string> = {
  "profile-creation": "Profile creation",
  "social-bookmarking": "Social bookmarking",
  "directory-submission": "Directory submission",
  "image-submission": "Image submission",
  "pdf-submission": "PDF submission",
  "business-networking": "Business networking",
  "infographics-submission": "Infographics",
  "seo-audit-tools": "SEO audit tools",
  "wiki-submission": "Wiki submission",
  "ping-submission": "Ping submission",
  portfolio: "Portfolio sites",
  "blog-submission": "Blog submission",
  "rss-feed": "RSS feeds",
  showcase: "Showcase sites",
  "web-2.0": "Web 2.0",
  "video-sharing": "Video sharing",
  "story-sharing": "Story sharing",
  "search-engine-submission": "Search engine submission",
  "forum-posting": "Forum posting",
  "press-release": "Press release",
  "social-networking": "Social networking",
  "classified-submission": "Classified submission",
  "article-submission": "Article submission",
  gov: ".gov sites",
  edu: ".edu sites",
  "local-citation": "Local citation",
};
