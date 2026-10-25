"use client";

/**
 * Recovery wrapper for server actions.
 *
 * A server-action POST can die OUTSIDE the action's own try/catch:
 * the dev server restarted since the page loaded (action IDs are
 * per-process), the gateway reset the connection, or the tab was
 * sitting on a pre-restart render. React then leaves the button in
 * its pending state with no feedback — the user sees a frozen
 * "Approving…" forever, and the fix (a reload) is not discoverable.
 *
 * Both helpers catch that failure, say so, and refresh the router —
 * which also picks up fresh action IDs, so the retry just works.
 */

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type MinimalResult = { ok: boolean; message?: string; error?: string };

const STALE_TITLE = "Couldn't reach the server";
const STALE_DESC =
  "The page was loaded before the last update, so its action expired. The page has been refreshed — please try again.";

/**
 * For direct-call surfaces (`startTransition(async () => { await action() })`).
 * Returns the action's result, or null when the POST itself failed —
 * callers should bail without extra toasts (this already fired one).
 */
export function useSafeCall() {
  const router = useRouter();
  return useCallback(
    async <T extends MinimalResult>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch {
        toast.error(STALE_TITLE, { description: STALE_DESC });
        router.refresh();
        return null;
      }
    },
    [router],
  );
}

/**
 * For useActionState surfaces. Wraps the server action so a failed POST
 * returns the previous state (clearing `pending`) instead of leaving
 * the form hanging, and fires the recovery toast + refresh.
 */
export function useWrappedActionState<A extends MinimalResult>() {
  const router = useRouter();
  return useCallback(
    async (
      action: (prev: A | null, formData: FormData) => Promise<A | null>,
      prev: A | null,
      formData: FormData,
    ): Promise<A | null> => {
      try {
        return await action(prev, formData);
      } catch {
        toast.error(STALE_TITLE, { description: STALE_DESC });
        router.refresh();
        return prev;
      }
    },
    [router],
  );
}
