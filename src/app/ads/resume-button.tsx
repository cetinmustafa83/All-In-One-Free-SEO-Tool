"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Play } from "lucide-react";
import { SubmitButton } from "@/components/ui/submit-button";
import { resumeAdAccount, type ActionResult } from "./actions";

/** One-tap "turn it back on" for an engine-paused account. */
export function ResumeButton({ accountId }: { accountId: number }) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(
    resumeAdAccount,
    null,
  );
  const router = useRouter();

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(state.message);
      router.refresh();
    } else {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <form action={formAction}>
      <input type="hidden" name="accountId" value={accountId} />
      <SubmitButton
        size="sm"
        variant="outline"
        pendingToast="Resuming…"
        pendingToastDescription="The engine will keep watching it."
      >
        <Play data-icon="inline-start" />
        Resume
      </SubmitButton>
    </form>
  );
}
