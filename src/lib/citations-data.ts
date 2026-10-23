/**
 * Country-specific citation / local-listing directories.
 *
 * Curated list of free local-business directories per country, ranked
 * by typical SEO impact. Used by the citations builder + the per-client
 * GBP / local pages to show "you should also list here" suggestions.
 *
 * All entries link to the public submission page. None require paid
 * accounts — only signup. Where a country lacks specialised directories,
 * we fall back to global "anywhere" entries.
 */

export type CitationCategory =
  | "core_global"
  | "maps"
  | "review_platform"
  | "general_directory"
  | "industry_directory"
  | "local_chamber"
  | "social";

export type CitationEntry = {
  name: string;
  url: string;
  /** Page where the user submits a listing. */
  submitUrl?: string;
  category: CitationCategory;
  /** Typical SEO weight 1–5 (5 = should-have for this country). */
  importance: 1 | 2 | 3 | 4 | 5;
  notes?: string;
  /** Country codes (ISO-3166 alpha-2) where this matters. */
  countries: ("ANY" | string)[];
};

export const CITATIONS: CitationEntry[] = [
  // ============== Global / always relevant ==============
  {
    name: "Google Business Profile",
    url: "https://www.google.com/business/",
    submitUrl: "https://www.google.com/business/",
    category: "core_global",
    importance: 5,
    notes: "The single most important listing in any country.",
    countries: ["ANY"],
  },
  {
    name: "Bing Places for Business",
    url: "https://www.bingplaces.com/",
    submitUrl: "https://www.bingplaces.com/",
    category: "core_global",
    importance: 4,
    notes: "Powers Bing, Yahoo, DuckDuckGo local results.",
    countries: ["ANY"],
  },
  {
    name: "Apple Business Connect",
    url: "https://businessconnect.apple.com/",
    category: "maps",
    importance: 4,
    notes: "Required for Apple Maps + Siri local results.",
    countries: ["ANY"],
  },
  {
    name: "Facebook Business Page",
    url: "https://www.facebook.com/business/pages",
    category: "social",
    importance: 3,
    countries: ["ANY"],
  },
  {
    name: "LinkedIn Company Page",
    url: "https://www.linkedin.com/company/setup/new/",
    category: "social",
    importance: 3,
    countries: ["ANY"],
  },
  {
    name: "Trustpilot",
    url: "https://business.trustpilot.com/signup",
    category: "review_platform",
    importance: 4,
    notes: "Reviews surface in Google snippets globally.",
    countries: ["ANY"],
  },
  {
    name: "OpenStreetMap (Nominatim)",
    url: "https://www.openstreetmap.org/",
    category: "maps",
    importance: 2,
    notes: "Free, used by Apple Maps, DuckDuckGo, Bing fallback.",
    countries: ["ANY"],
  },
  {
    name: "Foursquare / Factual",
    url: "https://foursquare.com/products/listings",
    category: "general_directory",
    importance: 3,
    notes: "Powers Snapchat, Tinder, Apple Maps secondary data.",
    countries: ["ANY"],
  },

  // ============== United States ==============
  {
    name: "Yelp",
    url: "https://biz.yelp.com/signup",
    category: "review_platform",
    importance: 5,
    countries: ["US", "CA"],
  },
  {
    name: "Yellow Pages (US)",
    url: "https://www.yellowpages.com/",
    category: "general_directory",
    importance: 3,
    countries: ["US"],
  },
  {
    name: "Better Business Bureau",
    url: "https://www.bbb.org/get-listed",
    category: "general_directory",
    importance: 4,
    notes: "Trust signal — A+ rating shows in SERPs.",
    countries: ["US"],
  },
  {
    name: "Angi (formerly Angie's List)",
    url: "https://www.angi.com/",
    category: "industry_directory",
    importance: 3,
    notes: "Strong for home services.",
    countries: ["US"],
  },
  {
    name: "MapQuest",
    url: "https://www.mapquest.com/",
    category: "maps",
    importance: 2,
    countries: ["US", "CA"],
  },
  {
    name: "US Chamber of Commerce",
    url: "https://www.uschamber.com/",
    category: "local_chamber",
    importance: 2,
    notes: "Plus your local city/county chamber.",
    countries: ["US"],
  },

  // ============== United Kingdom ==============
  {
    name: "Yell.com",
    url: "https://www.yell.com/biz/",
    category: "general_directory",
    importance: 4,
    countries: ["GB"],
  },
  {
    name: "Thomson Local",
    url: "https://www.thomsonlocal.com/",
    category: "general_directory",
    importance: 3,
    countries: ["GB"],
  },
  {
    name: "Scoot",
    url: "https://www.scoot.co.uk/",
    category: "general_directory",
    importance: 2,
    countries: ["GB"],
  },
  {
    name: "Cylex UK",
    url: "https://www.cylex-uk.co.uk/",
    category: "general_directory",
    importance: 2,
    countries: ["GB"],
  },
  {
    name: "Hotfrog UK",
    url: "https://www.hotfrog.co.uk/",
    category: "general_directory",
    importance: 2,
    countries: ["GB"],
  },

  // ============== Canada ==============
  {
    name: "Canada411 / YellowPages.ca",
    url: "https://www.yellowpages.ca/",
    category: "general_directory",
    importance: 4,
    countries: ["CA"],
  },
  {
    name: "Cylex Canada",
    url: "https://www.cylex.ca/",
    category: "general_directory",
    importance: 2,
    countries: ["CA"],
  },

  // ============== Australia ==============
  {
    name: "Yellow Pages Australia",
    url: "https://www.yellowpages.com.au/",
    category: "general_directory",
    importance: 4,
    countries: ["AU"],
  },
  {
    name: "True Local",
    url: "https://www.truelocal.com.au/",
    category: "general_directory",
    importance: 3,
    countries: ["AU"],
  },
  {
    name: "Hotfrog AU",
    url: "https://www.hotfrog.com.au/",
    category: "general_directory",
    importance: 2,
    countries: ["AU"],
  },
  {
    name: "Womo",
    url: "https://www.womo.com.au/",
    category: "review_platform",
    importance: 3,
    countries: ["AU"],
  },

  // ============== India ==============
  {
    name: "JustDial",
    url: "https://www.justdial.com/",
    category: "general_directory",
    importance: 5,
    countries: ["IN"],
  },
  {
    name: "Sulekha",
    url: "https://www.sulekha.com/",
    category: "general_directory",
    importance: 4,
    countries: ["IN"],
  },
  {
    name: "IndiaMART",
    url: "https://www.indiamart.com/",
    category: "industry_directory",
    importance: 4,
    notes: "Strongest for B2B / wholesale.",
    countries: ["IN"],
  },
  {
    name: "TradeIndia",
    url: "https://www.tradeindia.com/",
    category: "industry_directory",
    importance: 3,
    countries: ["IN"],
  },

  // ============== Germany ==============
  {
    name: "GelbeSeiten",
    url: "https://www.gelbeseiten.de/",
    category: "general_directory",
    importance: 5,
    countries: ["DE"],
  },
  {
    name: "Das Örtliche",
    url: "https://www.dasoertliche.de/",
    category: "general_directory",
    importance: 4,
    countries: ["DE"],
  },
  {
    name: "11880.com",
    url: "https://www.11880.com/",
    category: "general_directory",
    importance: 3,
    countries: ["DE"],
  },
  {
    name: "Kununu",
    url: "https://www.kununu.com/",
    category: "review_platform",
    importance: 3,
    notes: "Employer reviews — strong B2B signal.",
    countries: ["DE", "AT"],
  },

  // ============== France ==============
  {
    name: "PagesJaunes",
    url: "https://www.pagesjaunes.fr/",
    category: "general_directory",
    importance: 5,
    countries: ["FR"],
  },
  {
    name: "Mappy",
    url: "https://fr.mappy.com/",
    category: "maps",
    importance: 3,
    countries: ["FR"],
  },

  // ============== Spain ==============
  {
    name: "Páginas Amarillas",
    url: "https://www.paginasamarillas.es/",
    category: "general_directory",
    importance: 5,
    countries: ["ES"],
  },
  {
    name: "QDQ",
    url: "https://www.qdq.com/",
    category: "general_directory",
    importance: 3,
    countries: ["ES"],
  },

  // ============== Italy ==============
  {
    name: "PagineGialle",
    url: "https://www.paginegialle.it/",
    category: "general_directory",
    importance: 5,
    countries: ["IT"],
  },
  {
    name: "Tuugo Italia",
    url: "https://www.tuugo.it/",
    category: "general_directory",
    importance: 2,
    countries: ["IT"],
  },

  // ============== Netherlands ==============
  {
    name: "Telefoonboek",
    url: "https://www.telefoonboek.nl/",
    category: "general_directory",
    importance: 4,
    countries: ["NL"],
  },
  {
    name: "Detelefoongids.nl",
    url: "https://www.detelefoongids.nl/",
    category: "general_directory",
    importance: 4,
    countries: ["NL"],
  },

  // ============== Brazil ==============
  {
    name: "TeleListas",
    url: "https://www.telelistas.net/",
    category: "general_directory",
    importance: 5,
    countries: ["BR"],
  },
  {
    name: "Apontador",
    url: "https://www.apontador.com.br/",
    category: "general_directory",
    importance: 4,
    countries: ["BR"],
  },
  {
    name: "GuiaMais",
    url: "https://www.guiamais.com.br/",
    category: "general_directory",
    importance: 3,
    countries: ["BR"],
  },

  // ============== Mexico ==============
  {
    name: "Sección Amarilla",
    url: "https://www.seccionamarilla.com.mx/",
    category: "general_directory",
    importance: 5,
    countries: ["MX"],
  },

  // ============== Japan ==============
  {
    name: "Tabelog",
    url: "https://tabelog.com/",
    category: "review_platform",
    importance: 5,
    notes: "Restaurant focus, but the dominant Japan local platform.",
    countries: ["JP"],
  },
  {
    name: "Ekiten",
    url: "https://www.ekiten.jp/",
    category: "general_directory",
    importance: 4,
    countries: ["JP"],
  },
  {
    name: "iタウンページ (NTT)",
    url: "https://itp.ne.jp/",
    category: "general_directory",
    importance: 4,
    countries: ["JP"],
  },

  // ============== South Korea ==============
  {
    name: "Naver Place",
    url: "https://smartplace.naver.com/",
    category: "core_global",
    importance: 5,
    notes: "Naver dominates Korean search; this is essential.",
    countries: ["KR"],
  },
  {
    name: "Daum Place",
    url: "https://place.map.kakao.com/",
    category: "maps",
    importance: 4,
    countries: ["KR"],
  },

  // ============== UAE / GCC ==============
  {
    name: "Yellow Pages UAE",
    url: "https://www.yellowpages.ae/",
    category: "general_directory",
    importance: 4,
    countries: ["AE"],
  },
  {
    name: "Connect.ae",
    url: "https://www.connect.ae/",
    category: "general_directory",
    importance: 3,
    countries: ["AE"],
  },

  // ============== Singapore ==============
  {
    name: "Yellow Pages Singapore",
    url: "https://www.yellowpages.com.sg/",
    category: "general_directory",
    importance: 4,
    countries: ["SG"],
  },
  {
    name: "Streetdirectory",
    url: "https://www.streetdirectory.com/",
    category: "maps",
    importance: 3,
    countries: ["SG"],
  },

  // ============== South Africa ==============
  {
    name: "Brabys",
    url: "https://www.brabys.com/",
    category: "general_directory",
    importance: 4,
    countries: ["ZA"],
  },
  {
    name: "Ananzi",
    url: "https://www.ananzi.co.za/",
    category: "general_directory",
    importance: 3,
    countries: ["ZA"],
  },
];

/**
 * Returns the citation list for a country, prioritised by importance.
 * Always includes "ANY" entries at the top, then country-specific.
 */
export function citationsForCountry(country: string): CitationEntry[] {
  const upper = country.toUpperCase();
  const global = CITATIONS.filter((c) => c.countries.includes("ANY"));
  const local = CITATIONS.filter(
    (c) => !c.countries.includes("ANY") && c.countries.includes(upper),
  );
  return [...global, ...local].sort((a, b) => b.importance - a.importance);
}
