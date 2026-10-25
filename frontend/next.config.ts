import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained server build under .next/standalone — the
  // packaging script copies it into dist/ alongside a bundled Node binary
  // so end-users can run the app by double-clicking, no Node install required.
  output: "standalone",

  experimental: {
    // Turbopack compiles this app's ~100 routes with a large native
    // working set (peak anon-rss observed at 3.3 GB). On memory-capped
    // sandboxes the kernel OOM-kills next-server mid-compile and the
    // dev server dies without a trace in dev.log. A tighter limit makes
    // Turbopack collect its compile state aggressively instead of
    // ballooning; routes compile marginally slower and the server
    // survives. The on-disk .next/dev cache keeps restarts cheap.
    // 1024 (down from 1536): peak RSS was still OOMing at ~3.3 GB when a
    // browser shared the box — the lower cap trims the spike enough for
    // both to fit in a 4 GB sandbox.
    turbopackMemoryLimit: 1024,
  },

  // Native modules and ones that load files from disk at runtime must not be
  // bundled by Next — let Node's normal resolution handle them.
  serverExternalPackages: [
    "pdfkit",
    "better-sqlite3",
    "playwright",
    "playwright-core",
    "tesseract.js",
    // Native binding (.node file) inside js-binding.js — Turbopack 16
    // can't place it in an ESM chunk. Leaving as external lets Node's
    // standard require() handle it correctly at runtime.
    "@resvg/resvg-js",
    "satori",
    "qrcode",
  ],

  // Hide the dev-mode "Compiling…" bottom-left indicator. For self-hosters
  // running locally this is visual noise. Removed in production builds
  // automatically; this disables it in dev too.
  devIndicators: false,

  /**
   * Framing policy.
   *
   * The app set no frame headers at all, which meant any site could put
   * /settings or /clients in an invisible iframe and trick a logged-in
   * user into clicking things — classic clickjacking. It only became
   * obvious while adding a page that genuinely SHOULD be framed.
   *
   * So: deny framing everywhere, then carve out the one route designed
   * for it. `frame-ancestors *` on /embed is deliberate — an agency
   * embeds the grader on their own marketing site and we have no way to
   * know that hostname in advance. The route is safe to frame because it
   * exposes no account data and carries no session-authenticated
   * actions: it grades a URL the caller typed and writes a lead row.
   */
  /**
   * Phase 14.9 cutover — serve ported /api/* from the Rust backend.
   *
   * Background: the backend has been progressively ported to Rust (axum,
   * port 3100) behind the strangler-fig plan in docs/architecture-split-plan.md.
   * Through phase 14.8 every ported endpoint kept a Next route handler that
   * proxied to Rust (or implemented it in TS). This rewrite retires those
   * handlers: the ported route files under src/app/api are deleted and any
   * /api/* path that no Next handler claims is transparently proxied to the
   * Rust process instead.
   *
   * Why `fallback`: Next checks rewrite classes in a fixed order —
   * filesystem routes (static route.ts paths) → afterFiles rewrites →
   * dynamic routes → fallback rewrites. The 15 /api handlers that are
   * deliberately NOT ported (PDF, backup/restore, desktop ops, google
   * oauth, mcp, webhooks/[token], …) include dynamic-segment routes, and
   * an afterFiles rewrite would shadow those. A fallback rewrite only
   * fires when neither the filesystem nor dynamic routes matched —
   * exactly "the paths the deleted handlers used to own".
   *
   * Gated on API_BACKEND_URL: unset (or empty) = classic Next-only mode,
   * which is the rollback switch — restore the deleted route files from
   * git and everything runs in-process again. When set, the Rust backend
   * must be running (backend/up.sh) or every ported /api path fails.
   *
   * Security note: this also exposes /api/internal/* through the Next
   * origin for the first time. Those endpoints are guarded by the
   * x-internal-token check backend-side (anonymous requests get 401),
   * so the public surface is unchanged in practice.
   */
  async rewrites() {
    const backend = process.env.API_BACKEND_URL;
    if (!backend) return [];
    return {
      fallback: [
        {
          source: "/api/:path*",
          destination: `${backend}/api/:path*`,
        },
      ],
    };
  },

  async headers() {
    return [
      {
        source: "/embed/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
        ],
      },
      {
        // Everything EXCEPT /embed. Next applies every matching rule, so
        // a plain `/:path*` catch-all also hit the embed route and its
        // X-Frame-Options: SAMEORIGIN won — the widget was served
        // unframeable, which silently breaks the entire feature: the
        // agency's iframe renders blank and nothing reports an error.
        source: "/((?!embed/).*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self'",
          },
          // Not framing-related, but the same class of cheap header the
          // app was missing entirely.
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
