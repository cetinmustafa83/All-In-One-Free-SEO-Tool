/**
 * Checks whether the connected Google account granted the gmail.readonly
 * scope (which the outreach reply poller needs). Caches the answer in
 * workspace settings for 12h so we don't hammer Google on every page load.
 */

import { getAccessToken } from "./google-oauth";
import { getSetting, setSetting } from "./settings-store";

const CACHE_MS = 12 * 60 * 60 * 1000;

export async function hasGmailScope(): Promise<boolean> {
  const checkedAt = await getSetting<number>(
    "google.gmail_scope_checked_at",
  ).catch(() => null);
  const cached = await getSetting<boolean>("google.gmail_scope_ok").catch(
    () => null,
  );
  if (
    typeof checkedAt === "number" &&
    typeof cached === "boolean" &&
    Date.now() - checkedAt < CACHE_MS
  ) {
    return cached;
  }

  let ok = false;
  try {
    const token = await getAccessToken();
    const res = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      { headers: { authorization: `Bearer ${token}` } },
    );
    ok = res.ok;
  } catch {
    ok = false;
  }

  await Promise.all([
    setSetting("google.gmail_scope_ok", ok),
    setSetting("google.gmail_scope_checked_at", Date.now()),
  ]).catch(() => {});

  return ok;
}

/**
 * Force-refresh the scope cache — call after the OAuth callback so the
 * banner disappears immediately when the user reconnects.
 */
export async function refreshGmailScopeCache(): Promise<boolean> {
  await setSetting("google.gmail_scope_checked_at", 0).catch(() => {});
  return hasGmailScope();
}
