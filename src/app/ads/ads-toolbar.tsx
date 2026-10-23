"use client";

/**
 * Cockpit toolbar: run the engine on demand, sync demo accounts, and
 * open the connect dialog. Actions run in a transition with a toast —
 * the page revalidates itself when the server action returns.
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddAccountForm } from "./add-account-form";
import { runEngineNow, syncDemoData } from "./actions";
import { useSafeCall } from "./safe-action";

export function AdsToolbar({ clients }: { clients: { id: number; name: string }[] }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const safeCall = useSafeCall();

  function runAction(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    startTransition(async () => {
      // safeCall: a failed action POST (stale dev build, reset connection)
      // toasts + refreshes here; we just bail — the error UI is handled.
      const res = await safeCall(fn);
      if (!res) return;
      if (res.ok) {
        toast.success(res.message ?? "Done.");
        router.refresh();
      } else {
        toast.error(res.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => runAction(runEngineNow)}
      >
        <Play data-icon="inline-start" />
        Run engine now
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => runAction(syncDemoData)}
      >
        <RefreshCw data-icon="inline-start" className={pending ? "animate-spin" : ""} />
        Sync demo data
      </Button>
      <AddAccountForm clients={clients} />
    </div>
  );
}
