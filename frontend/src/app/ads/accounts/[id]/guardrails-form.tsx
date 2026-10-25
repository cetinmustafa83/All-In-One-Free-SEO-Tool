"use client";

/**
 * Guardrail editor — the same fields as on connect, editable any time.
 * Saves via server action; toasts + refresh on success.
 */

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import type { AdAccountRow } from "@/db/schema";
import { updateGuardrails, type ActionResult } from "../../actions";
import { useWrappedActionState } from "../../safe-action";

export function GuardrailsForm({ account }: { account: AdAccountRow }) {
  const wrapped = useWrappedActionState<ActionResult>();
  // Recovery wrapper: a stale action POST (dev restarted since load)
  // toasts + refreshes instead of leaving the save button spinning.
  const [state, formAction] = useActionState<ActionResult | null, FormData>(
    (prev, formData) => wrapped(updateGuardrails, prev, formData),
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
    // Keyed by updatedAt: after a save + refresh the server sends the
    // new values, and remounting keeps the uncontrolled inputs' default
    // state consistent (Base UI warns when defaults shift under it).
    <form
      action={formAction}
      key={account.updatedAt.getTime()}
      className="space-y-4"
    >
      <input type="hidden" name="accountId" value={account.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="g-budget">Daily budget ($)</Label>
          <Input
            id="g-budget"
            name="dailyBudget"
            type="number"
            min="1"
            step="0.01"
            defaultValue={account.dailyBudget}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g-metric">Guardrail metric</Label>
          <select
            id="g-metric"
            name="metric"
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
            defaultValue={account.metric}
          >
            <option value="ROAS">ROAS (higher is better)</option>
            <option value="CPA">CPA — cost per acquisition</option>
            <option value="CPC">CPC — cost per click</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g-target">Target {account.metric}</Label>
          <Input
            id="g-target"
            name="targetValue"
            type="number"
            min="0"
            step="0.01"
            defaultValue={account.targetValue}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="g-pause">Pause threshold {account.metric}</Label>
          <Input
            id="g-pause"
            name="pauseThreshold"
            type="number"
            min="0"
            step="0.01"
            defaultValue={account.pauseThreshold}
            required
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="g-scale">Scale threshold {account.metric}</Label>
          <Input
            id="g-scale"
            name="scaleThreshold"
            type="number"
            min="0"
            step="0.01"
            defaultValue={account.scaleThreshold}
            required
          />
          <p className="text-xs text-muted-foreground">
            {account.metric === "ROAS"
              ? "Higher is better: the engine pauses when ROAS falls to the pause threshold, and proposes +20% budget when it reaches the scale threshold."
              : "Lower is better: the engine pauses when the metric rises to the pause threshold, and proposes +20% budget when it drops to the scale threshold."}
          </p>
        </div>
      </div>
      <div className="flex justify-end">
        <SubmitButton pendingToast="Saving guardrails…">Save guardrails</SubmitButton>
      </div>
    </form>
  );
}
