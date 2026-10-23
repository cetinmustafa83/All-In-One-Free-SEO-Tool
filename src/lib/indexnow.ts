/**
 * IndexNow — free protocol used by Bing, Yandex, Naver, Seznam to accept
 * URL submissions for fresh indexing. No API key in the auth sense; you
 * generate a 32-char key, host a `/{key}.txt` file containing the key on
 * the same host, then POST a list of URLs.
 *
 * Spec: https://www.indexnow.org/documentation
 *
 * We use Bing's endpoint by default (api.indexnow.org forwards to all
 * participating engines).
 */

import { randomBytes, createHash } from "node:crypto";

import { getSetting, setSetting } from "./settings-store";

const ENDPOINT = "https://api.indexnow.org/IndexNow";

/**
 * One stable workspace-wide key. Lazy-create on first submit.
 */
export async function getOrCreateIndexNowKey(): Promise<string> {
  const existing = await getSetting<string>("indexnow.key");
  if (existing && /^[a-f0-9]{32}$/i.test(existing)) return existing;
  const key = randomBytes(16).toString("hex");
  await setSetting("indexnow.key", key);
  return key;
}

export async function getIndexNowKey(): Promise<string | null> {
  return (await getSetting<string>("indexnow.key")) ?? null;
}

export type IndexNowResult =
  | { ok: true; submitted: number; status: number }
  | { ok: false; error: string; status?: number };

/**
 * Submit URLs to IndexNow. The host owning the URLs must serve the key
 * file at `/{key}.txt` returning the key as plain text — engines verify
 * before accepting submissions.
 *
 * Returns ok=true even on 200 ("Success") and 202 ("Accepted but invalid
 * — the key file is missing or wrong"). The latter is not really success
 * — we surface it via the `status` field so callers can warn.
 */
export async function submitToIndexNow(opts: {
  host: string;
  urls: string[];
  key?: string;
}): Promise<IndexNowResult> {
  const urls = opts.urls.filter((u) => /^https?:\/\//i.test(u)).slice(0, 10000);
  if (urls.length === 0) return { ok: false, error: "No URLs to submit" };

  const host = normaliseHost(opts.host);
  if (!host) return { ok: false, error: "Invalid host" };

  // Engines require all URLs to belong to the same host as the key file.
  for (const u of urls) {
    try {
      const h = new URL(u).hostname.toLowerCase();
      if (h !== host) {
        return {
          ok: false,
          error: `URL ${u} doesn't match host ${host}. All URLs must share the same hostname.`,
        };
      }
    } catch {
      return { ok: false, error: `Invalid URL: ${u}` };
    }
  }

  const key = opts.key ?? (await getOrCreateIndexNowKey());

  const body = {
    host,
    key,
    keyLocation: `https://${host}/${key}.txt`,
    urlList: urls,
  };

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message ?? "Network error",
    };
  }

  // 200 = Success. 202 = "Accepted but invalid key" (host serves wrong file).
  // 400 = bad request. 403 = forbidden (key/keyLocation mismatch).
  // 422 = unprocessable. 429 = throttled.
  if (res.status === 200) return { ok: true, submitted: urls.length, status: 200 };
  if (res.status === 202)
    return {
      ok: true,
      submitted: urls.length,
      status: 202,
    };

  return {
    ok: false,
    error: indexNowError(res.status),
    status: res.status,
  };
}

function indexNowError(status: number): string {
  switch (status) {
    case 400:
      return "Bad request — check the URLs.";
    case 403:
      return "Forbidden — the key file at /{key}.txt isn't reachable or doesn't match.";
    case 422:
      return "Unprocessable — usually a host/URL mismatch.";
    case 429:
      return "Throttled — too many submissions, try again later.";
    default:
      return `IndexNow returned status ${status}`;
  }
}

function normaliseHost(input: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Verify the user's site is actually serving the IndexNow key file.
 * Pure HTTP; returns ok=true if the file content matches our key.
 */
export async function verifyKeyFile(opts: {
  host: string;
  key: string;
}): Promise<{ ok: boolean; error?: string }> {
  const host = normaliseHost(opts.host);
  if (!host) return { ok: false, error: "Invalid host" };
  const url = `https://${host}/${opts.key}.txt`;
  try {
    const res = await fetch(url, {
      headers: { accept: "text/plain" },
      redirect: "follow",
    });
    if (!res.ok) {
      return { ok: false, error: `${url} returned ${res.status}` };
    }
    const body = (await res.text()).trim();
    if (body !== opts.key) {
      return {
        ok: false,
        error: `Key file content doesn't match. Expected "${opts.key}", got "${body.slice(0, 80)}".`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Stable hash of a URL set for dedupe — so we don't re-submit the same
 * batch repeatedly during a session.
 */
export function hashUrlSet(urls: string[]): string {
  return createHash("sha1")
    .update(urls.slice().sort().join("\n"))
    .digest("hex");
}
