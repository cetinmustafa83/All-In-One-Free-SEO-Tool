/**
 * Bridge to the Rust backend (Task 14.5a — plan rule R5: server actions
 * become thin proxies over REST once their domain is ported).
 *
 * Server-only by construction: node:fs here means any accidental client
 * import fails the build, and the token never reaches the browser bundle.
 * No "use client" anywhere in this file.
 *
 * Token resolution mirrors backend/src/internal.rs exactly:
 *   1. SEO_INTERNAL_TOKEN env var (trimmed, non-empty),
 *   2. else <dataDir()>/.seo-internal-token — the file the Rust process
 *      generates (32 random bytes as hex, mode 0600) on first use,
 *      resolved through the SAME data-dir logic both sides use.
 */

import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./data-dir";

const BASE = process.env.SEO_BACKEND_URL ?? "http://127.0.0.1:3100";

function internalToken(): string {
  const env = process.env.SEO_INTERNAL_TOKEN;
  if (env && env.trim()) return env.trim();
  try {
    const file = path.join(dataDir(), ".seo-internal-token");
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

export type BackendInit = {
  method?: "GET" | "POST";
  /** JSON body — undefined means no body. */
  body?: unknown;
};

/**
 * POST/GET a JSON endpoint on the Rust backend. Returns the parsed JSON
 * response, or throws an Error carrying the backend's error message
 * (transport failures, non-2xx statuses). Business-level results keep the
 * action's own { ok: false, error } shape and come back as data.
 */
export async function callBackend<T = unknown>(
  pathname: string,
  init?: BackendInit,
): Promise<T> {
  const token = internalToken();
  const hasBody = init?.body !== undefined;
  let res: Response;
  try {
    res = await fetch(`${BASE}${pathname}`, {
      method: init?.method ?? "POST",
      headers: {
        ...(hasBody ? { "content-type": "application/json" } : {}),
        ...(token ? { "x-internal-token": token } : {}),
      },
      body: hasBody ? JSON.stringify(init?.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new Error(
      `Backend unreachable (${(err as Error).message}) — SEO backend not running on ${BASE}?`,
    );
  }

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    let message =
      text.length > 0 ? text.slice(0, 200) : `Backend request failed (${res.status})`;
    if (parsed && typeof parsed === "object") {
      const e = (parsed as { error?: unknown }).error;
      if (typeof e === "string" && e.length > 0) message = e;
    }
    throw new Error(message);
  }

  return parsed as T;
}
