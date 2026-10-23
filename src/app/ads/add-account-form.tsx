"use client";

/**
 * "Add ad account" dialog — connect a Google / Meta account or, for a
 * risk-free look around, tick the demo box and let the synthesiser
 * seed realistic accounts (the identical engine runs on them).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { addAdAccount, type AddAccountResult } from "./actions";

type ClientOption = { id: number; name: string };

const METRIC_PRESETS: Record<
  string,
  { target: number; pause: number; scale: number; hint: string }
> = {
  ROAS: {
    target: 3.2,
    pause: 1.6,
    scale: 4.2,
    hint: "Higher is better. Pause BELOW the floor, scale when it beats the ceiling.",
  },
  CPA: {
    target: 42,
    pause: 75,
    scale: 30,
    hint: "Lower is better. Pause ABOVE the ceiling, scale when it beats the floor.",
  },
  CPC: {
    target: 1.5,
    pause: 2.5,
    scale: 1,
    hint: "Lower is better. Pause ABOVE the ceiling, scale when it beats the floor.",
  },
};

export function AddAccountForm({ clients }: { clients: ClientOption[] }) {
  const [open, setOpen] = useState(false);
  const [demo, setDemo] = useState(false);
  const [metric, setMetric] = useState("ROAS");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Direct-call pattern: the handler awaits the server action and
  // toasts/closes in the same transition — no effect, no setState-in-
  // effect cascade (the compiler lint rightly rejects that shape).
  function handleAction(formData: FormData) {
    startTransition(async () => {
      const res: AddAccountResult = await addAdAccount(null, formData);
      if (res.ok) {
        toast.success(res.message || "Account connected.");
        setDemo(false);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  const preset = METRIC_PRESETS[metric];

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus data-icon="inline-start" />
        Add ad account
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Connect an ad account"
        description="Google or Meta. No API keys needed for the demo mode — the numbers are synthetic, the automation is real."
        size="lg"
      >
        <form action={handleAction} className="space-y-4">
          <label className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4">
            <input
              type="checkbox"
              name="demo"
              value="1"
              checked={demo}
              onChange={(e) => setDemo(e.target.checked)}
              className="mt-0.5 size-4 accent-violet-500"
            />
            <span className="text-sm">
              <span className="flex items-center gap-1.5 font-medium">
                <Sparkles className="size-3.5 text-violet-400" />
                Use demo data
              </span>
              <span className="text-muted-foreground">
                Seeds 3 realistic accounts with 14 days of history. Nothing
                touches a real ad platform.
              </span>
            </span>
          </label>

          {!demo && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ad-platform">Platform</Label>
                <select
                  id="ad-platform"
                  name="platform"
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                  defaultValue="google"
                >
                  <option value="google">Google Ads</option>
                  <option value="meta">Meta Ads (Facebook & Instagram)</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ad-name">Account name</Label>
                <Input
                  id="ad-name"
                  name="name"
                  placeholder="Acme Coffee — Search"
                  required
                  maxLength={120}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ad-external">Account ID (optional)</Label>
                <Input
                  id="ad-external"
                  name="externalId"
                  placeholder="123-456-7890 or act_12345"
                  maxLength={80}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ad-client">Link to client (optional)</Label>
                <select
                  id="ad-client"
                  name="clientId"
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                  defaultValue=""
                >
                  <option value="">— none —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ad-budget">Daily budget ($)</Label>
                <Input
                  id="ad-budget"
                  name="dailyBudget"
                  type="number"
                  min="1"
                  step="0.01"
                  defaultValue={50}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ad-metric">Guardrail metric</Label>
                <select
                  id="ad-metric"
                  name="metric"
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                  value={metric}
                  onChange={(e) => setMetric(e.target.value)}
                >
                  <option value="ROAS">ROAS (higher is better)</option>
                  <option value="CPA">CPA — cost per acquisition</option>
                  <option value="CPC">CPC — cost per click</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ad-target">Target {metric}</Label>
                <Input
                  id="ad-target"
                  name="targetValue"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={preset.target}
                  key={`t-${metric}`}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ad-pause">Pause threshold {metric}</Label>
                <Input
                  id="ad-pause"
                  name="pauseThreshold"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={preset.pause}
                  key={`p-${metric}`}
                  required
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ad-scale">Scale threshold {metric}</Label>
                <Input
                  id="ad-scale"
                  name="scaleThreshold"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={preset.scale}
                  key={`s-${metric}`}
                  required
                />
                <p className="text-xs text-muted-foreground">{preset.hint}</p>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-white/[0.06] pt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <SubmitButton
              pendingToast={demo ? "Seeding demo accounts…" : "Connecting…"}
              pendingToastDescription="This runs the engine once the data lands."
            >
              {demo ? "Seed demo accounts" : "Connect account"}
            </SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}
