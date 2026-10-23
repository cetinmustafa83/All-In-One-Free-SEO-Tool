import Link from "next/link";
import { AlertCircle, ExternalLink } from "lucide-react";
import { hasGmailScope } from "@/lib/gmail-scope";
import { getGoogleConnectionStatus } from "@/lib/google-oauth";

/**
 * Server component shown on outreach surfaces when Google IS connected
 * but the gmail.readonly scope wasn't granted. Tells the user how to
 * unlock auto-detection of replies. Renders nothing if Google's not
 * connected at all (the existing "connect Google" prompt covers that).
 */
export async function GmailScopeBanner() {
  let status: Awaited<ReturnType<typeof getGoogleConnectionStatus>>;
  try {
    status = await getGoogleConnectionStatus();
  } catch {
    return null;
  }
  if (!status.configured) return null;

  let scopeOk = true;
  try {
    scopeOk = await hasGmailScope();
  } catch {
    scopeOk = true; // don't show the banner on a transient error
  }
  if (scopeOk) return null;

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        <div className="space-y-1">
          <p className="font-medium">
            Reply auto-detection is off — Gmail scope wasn&apos;t granted.
          </p>
          <p className="text-amber-200/80">
            The daily-agent uses Gmail (read-only) to flip outreach contacts
            to &quot;replied&quot; when the recipient writes back. To turn it
            on, reconnect Google and tick the Gmail permission.
          </p>
          <Link
            href="/settings/google"
            className="inline-flex items-center gap-1 text-amber-100 underline hover:no-underline"
          >
            Reconnect Google
            <ExternalLink className="size-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
