import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "@/lib/secure-compare";
import { SESSION_COOKIE, verifySession } from "@/lib/session-token";
import { expectedToken } from "@/lib/password-token";

/**
 * The auth gate. Three modes, in order of precedence:
 *
 *   accounts  — real user accounts exist. A signed session cookie is
 *               required. This is what an agency runs.
 *   password  — no accounts, but APP_PASSWORD is set. One shared
 *               password, one cookie. What a solo self-hoster runs.
 *   open      — neither. Local development, and the historical default.
 *
 * The proxy (formerly middleware.ts) does not open the database, so it
 * cannot itself discover which mode applies. It asks the Node side
 * — see `accountsAreEnabled()` below for why the obvious process.env
 * approach was not enough.
 *
 * What middleware decides is only redirect-or-pass. Who the user is and
 * what they may see is decided on the Node side by `currentUser()` and
 * `visibleClientIds()`, which can actually query. Middleware getting it
 * slightly wrong means an extra redirect; it does not mean an
 * authorization hole.
 */

const COOKIE_NAME = "stb_auth";

/**
 * Is this install using accounts?
 *
 * `instrumentation.ts` sets SEO_ACCOUNTS_ENABLED at boot, and the Edge
 * sandbox does read process.env — but only the snapshot taken when the
 * sandbox was created. When the first owner registers, the Node runtime
 * flips that variable and the Edge side never sees it.
 *
 * That was not a theoretical gap. Measured against a running server: the
 * owner registered, the session cookie was issued correctly, and every
 * page stayed reachable with no cookie at all. Restarting closed the
 * gate; nothing else did.
 *
 * So: trust the env var when it says yes, and otherwise ask the Node
 * runtime, at most once every `MODE_TTL_MS`. Once the answer is yes it
 * is cached forever — you cannot un-register the first user, so the
 * transition only ever runs one way.
 *
 * Cost in the common case (a solo install that never enables accounts):
 * one tiny same-process request every 30 seconds per worker.
 */
const MODE_TTL_MS = 30_000;
let cachedAccounts = false;
let cachedAt = 0;

async function accountsAreEnabled(origin: string): Promise<boolean> {
  if (cachedAccounts) return true;
  if (process.env.SEO_ACCOUNTS_ENABLED === "1") {
    cachedAccounts = true;
    return true;
  }
  if (Date.now() - cachedAt < MODE_TTL_MS) return false;
  cachedAt = Date.now();
  try {
    const res = await fetch(`${origin}/api/auth/mode`, { cache: "no-store" });
    if (!res.ok) return false;
    const { mode } = (await res.json()) as { mode?: string };
    if (mode === "accounts") {
      cachedAccounts = true;
      return true;
    }
  } catch {
    // The Node side is unreachable or the route 500'd. Returning false
    // means we fall back to whatever APP_PASSWORD says, which is the
    // behaviour this install had before accounts existed — not an
    // escalation, and it does not wedge the app closed over a blip.
  }
  return false;
}

/**
 * Paths the password gate must NOT cover.
 *
 * Everything below carries its own authentication (a share token, an
 * API key, a webhook token) or is meant to be reachable by someone who
 * will never have the workspace password. Gating them behind the cookie
 * broke the exact features that only matter once APP_PASSWORD is set —
 * i.e. every real deployment:
 *
 *   /portal/[token]      client magic-links showed clients a login wall
 *   /api/v1/*            the public API 401'd valid Bearer keys, because
 *                        middleware only ever checked the cookie
 *   /api/webhooks/[token] inbound webhooks were rejected outright
 *   /api/v1/health       the HTA launcher and START scripts poll this to
 *                        decide whether the server came up
 *
 * These are not unauthenticated: api-auth.ts hashes and checks the
 * Bearer key, the portal requires a 16+ char unguessable share token,
 * and webhook routes match on their own token. The password gate was a
 * second, incompatible auth scheme layered on top.
 */
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  // Account setup and invited-user signup. Both are self-guarding:
  // /register refuses once an owner exists, /invite requires a token.
  "/register",
  "/invite",
  "/api/auth/register",
  // Middleware itself calls this to learn the auth mode. It must be
  // public or the lookup would recurse into the gate it is feeding.
  "/api/auth/mode",
  "/manifest.webmanifest",
  "/sw.js",
  "/icon-192.png",
  "/icon-512.png",
  "/favicon.ico",
  // Short-link redirector — must be public so external visitors clicking
  // the link reach the destination without hitting the auth gate.
  "/r",
  // Client portal. Authenticated by the per-client share token in the
  // path; the client has no workspace password and never will.
  "/portal",
  // Public API. Authenticated by `Authorization: Bearer seo_live_...`
  // in api-auth.ts — a different scheme from the browser cookie.
  "/api/v1",
  // Inbound webhooks. Authenticated by the token in the path.
  "/api/webhooks",
  // Remote MCP endpoint. Authenticated by `Authorization: Bearer <token>`
  // inside the route — an MCP client sends a token, never a browser
  // cookie, so the session gate would reject every legitimate call.
  // The route refuses outright until a token has been generated.
  "/api/mcp",
  // Edge-worker fix set. Called by a Cloudflare worker with a Bearer
  // token and no cookie; the route checks the token itself
  // (edgeTokenMatches) and answers 401 without one. Gated here, every
  // password-protected install silently stopped applying edge fixes.
  "/api/edge",
  // The embeddable site grader. Public by definition — it lives in an
  // iframe on the agency's marketing site and is aimed at strangers.
  // It exposes no client data: it grades a URL the caller supplies and
  // writes a lead row. SSRF is refused inside runAudit and the endpoint
  // is rate-limited per IP prefix (see lib/grader-public.ts).
  "/embed/grader",
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return true;
  }
  if (pathname.startsWith("/_next/")) return true;
  return false;
}

/**
 * Normalise `x-forwarded-host` to match the browser's `origin` when a
 * proxy chain has rewritten it.
 *
 * Why this exists: Next.js validates every forwarded Server Actions
 * request by comparing the `origin` header against `x-forwarded-host`
 * and aborts with "Invalid Server Actions request." on a mismatch.
 * Behind a multi-hop gateway (terminating TLS, then re-proxying through
 * an internal hostname), the outer hop stamps `x-forwarded-host` with
 * its INTERNAL host while `origin` still carries the public host the
 * browser actually sees. Every form submission and every action call
 * then fails validation — not because the action is wrong, but because
 * two proxies disagreed about the name of the same server.
 *
 * The fix is to trust `origin` (the browser is the one thing in the
 * chain that cannot be spoofed by an intermediary hop): when both
 * headers exist and disagree, rewrite `x-forwarded-host` to the origin's
 * host so the downstream validation sees one consistent value.
 */
function normaliseForwardedHost(req: NextRequest, requestHeaders: Headers): void {
  const origin = req.headers.get("origin");
  // A sandboxed iframe (or a stripped-down client) can send the literal
  // string "null" — there is no usable host in it, and rewriting against
  // it would just trade one mismatch for another.
  if (!origin || origin === "null") return;

  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    // Malformed origin — leave the headers untouched rather than
    // guessing; the downstream check will decide.
    return;
  }
  if (!originHost) return;

  // x-forwarded-host can be a comma list when several proxies append;
  // validation cares about the first (client-facing) entry.
  const forwarded = requestHeaders.get("x-forwarded-host");
  const forwardedHost = forwarded?.split(",")[0]?.trim();

  // Already consistent — nothing to do. This is the direct-access case
  // (browser → Next with no rewriting hop): host and origin agree.
  if (forwardedHost === originHost) return;

  // Two ways to get here, and BOTH used to break every Server Action:
  //
  //   1. A proxy hop stamped x-forwarded-host with its INTERNAL host
  //      (the outer gateway's name for this machine) while origin still
  //      carries the public host the browser sees.
  //   2. NO x-forwarded-host at all — the chain only forwarded `host`,
  //      and Next then compares origin against that, which disagrees
  //      for exactly the same reason. (The first cut of this fix only
  //      handled case 1 and the error kept firing on installs whose
  //      gateway doesn't send the header.)
  //
  // Either way the repair is the same: force x-forwarded-host to the
  // origin's host. The validation in the action handler prefers
  // x-forwarded-host over host, so setting it — even when it was
  // previously absent — makes both cases pass, and it is also the
  // semantically correct value: the browser's origin is the one thing
  // in the chain that cannot be spoofed by an intermediary hop.
  requestHeaders.set("x-forwarded-host", originHost);
}

/**
 * Read `?embed=1` once at the edge and forward the bit to the rest of
 * the request as an `x-embed` request header. The root layout reads
 * that header via `next/headers` and skips rendering the shell chrome
 * — that's how the per-client tool drawer loads tools cleanly in an
 * iframe without duplicating the app's sidebar / top bar / floating
 * widgets.
 *
 * Doing this here (server-side) instead of via a client useEffect
 * avoids the "flash of full shell" the iframe used to show before
 * hydration caught up.
 */
function applyEmbedHeader(req: NextRequest): Headers {
  const requestHeaders = new Headers(req.headers);
  if (req.nextUrl.searchParams.get("embed") === "1") {
    requestHeaders.set("x-embed", "1");
  }
  // The client portal gets the same treatment, always.
  //
  // The portal draws itself as a full-screen overlay, so it LOOKED
  // right — but the app shell was still being rendered underneath it,
  // and the agency's entire sidebar, including the product name and
  // every internal nav link, was sitting in the HTML the client
  // received. Invisible on screen, fully present to a screen reader,
  // "view source", or anything scraping the page.
  //
  // For a white-labelled portal that is the whole ballgame: it names the
  // product the agency is reselling. Handled here rather than in the
  // page because the layout renders before the page can say anything.
  if (req.nextUrl.pathname.startsWith("/portal/")) {
    requestHeaders.set("x-embed", "1");
  }
  // Same for the public grader widget. It renders inside an iframe on
  // somebody else's website; shipping the agency's navigation into that
  // page would put a "Clients" link on a stranger's screen.
  if (req.nextUrl.pathname.startsWith("/embed/")) {
    requestHeaders.set("x-embed", "1");
  }
  return requestHeaders;
}

export async function proxy(req: NextRequest) {
  const requestHeaders = applyEmbedHeader(req);
  normaliseForwardedHost(req, requestHeaders);
  const passthrough = () =>
    NextResponse.next({ request: { headers: requestHeaders } });

  const { pathname } = req.nextUrl;
  // Public paths first, before the mode lookup — /api/auth/mode is one
  // of them, and asking it whether we should gate it would recurse.
  if (isPublicPath(pathname)) return passthrough();

  const required = process.env.APP_PASSWORD;
  const accountsEnabled = await accountsAreEnabled(req.nextUrl.origin);

  // Neither accounts nor a password → open mode, unchanged from before.
  // Still forward the x-embed header so the layout sees it.
  if (!accountsEnabled && !required) return passthrough();

  if (accountsEnabled) {
    const secret = process.env.SEO_SESSION_SECRET;
    // The secret is written by instrumentation before the first request.
    // If it somehow isn't there, fail closed rather than waving everyone
    // through — an auth gate that opens on a misconfiguration is worse
    // than one that locks you out, because you never find out.
    const claims = secret
      ? await verifySession(req.cookies.get(SESSION_COOKIE)?.value, secret)
      : null;
    if (claims) return passthrough();
    return challenge(req, pathname, "/login");
  }

  const cookie = req.cookies.get(COOKIE_NAME);
  if (cookie?.value && required) {
    const expected = await expectedToken(required);
    if (timingSafeEqual(cookie.value, expected)) {
      return passthrough();
    }
  }

  return challenge(req, pathname, "/login");
}

function challenge(req: NextRequest, pathname: string, to: string) {
  // Browser-style request → redirect to the login page.
  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    const url = new URL(to, req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return new NextResponse(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

export const config = {
  matcher: [
    /*
     * Run on every path EXCEPT:
     *  - /_next/static (static assets)
     *  - /_next/image (image optimization)
     *  - static files, by an explicit list of extensions
     *
     * The exclusion used to be "any path with a dot in it". That also
     * excluded every data export — /clients/export.csv,
     * /backlinks/disavow.txt, /clients/[id]/plan/plan.pdf and the rest —
     * so on a password-protected install they downloaded with no login
     * at all. .csv, .txt and .pdf are deliberately NOT in this list.
     */
    "/((?!_next/static|_next/image|.*\\.(?:png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|otf|css|js|map|webmanifest)$).*)",
  ],
};
