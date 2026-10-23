"use server";

/**
 * Ads Autopilot server actions — the cockpit's write path.
 *
 * Every action follows the repo convention: `guardAction` first, zod
 * parse next, then the DB work, then a safe revalidate. Money-adjacent
 * actions (approve/dismiss) only ever change rows the UI shows; the
 * engine never spends without an APPROVED proposal.
 */

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { adAccounts, adAutomationEvents, adMetricSnapshots } from "@/db/schema";
import { guardAction } from "@/lib/action-guard";
import { safeRevalidatePath } from "@/lib/safe-revalidate";
import {
  pollDemoAccounts,
  runAllChecks,
  seedDemoData,
} from "@/lib/ads-engine";

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

function revalidateAds(): void {
  safeRevalidatePath("/ads");
  safeRevalidatePath("/ads/reports");
}

const accountSchema = z.object({
  platform: z.enum(["google", "meta"]),
  name: z.string().trim().min(1, "Give the account a name.").max(120),
  externalId: z
    .string()
    .trim()
    .max(80)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  clientId: z.coerce.number().int().positive().optional(),
  dailyBudget: z.coerce
    .number()
    .min(1, "Budget must be at least $1.")
    .max(1_000_000),
  metric: z.enum(["CPC", "CPA", "ROAS"]),
  targetValue: z.coerce.number().min(0).max(1_000_000),
  pauseThreshold: z.coerce.number().min(0).max(1_000_000),
  scaleThreshold: z.coerce.number().min(0).max(1_000_000),
});

export type AddAccountResult =
  | { ok: true; id: number; message?: string }
  | { ok: false; error: string };

export async function addAdAccount(
  _prev: AddAccountResult | null,
  formData: FormData,
): Promise<AddAccountResult> {
  await guardAction("edit");

  // Demo tick-box: seeds the canonical demo accounts (idempotent)
  // instead of creating a manual one.
  if (formData.get("demo") === "1") {
    const { created } = await seedDemoData();
    revalidateAds();
    if (created === 0) {
      return { ok: false, error: "Demo accounts already exist." };
    }
    return { ok: true, id: 0, message: `${created} demo account(s) added.` };
  }

  const parsed = accountSchema.safeParse({
    platform: formData.get("platform"),
    name: formData.get("name"),
    externalId: formData.get("externalId") ?? undefined,
    clientId: formData.get("clientId") || undefined,
    dailyBudget: formData.get("dailyBudget"),
    metric: formData.get("metric"),
    targetValue: formData.get("targetValue"),
    pauseThreshold: formData.get("pauseThreshold"),
    scaleThreshold: formData.get("scaleThreshold"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const d = parsed.data;

  // Direction sanity: for lower-is-better metrics the scale threshold
  // must sit below the pause threshold; for higher-is-better, above.
  const lowerBetter = d.metric !== "ROAS";
  if (lowerBetter && d.scaleThreshold > d.pauseThreshold) {
    return {
      ok: false,
      error:
        "For CPC/CPA the scale threshold must be BELOW the pause threshold (e.g. pause at $75, scale under $30).",
    };
  }
  if (!lowerBetter && d.scaleThreshold < d.pauseThreshold) {
    return {
      ok: false,
      error:
        "For ROAS the scale threshold must be ABOVE the pause threshold (e.g. pause under 1.6x, scale at 4.2x+).",
    };
  }

  try {
    const [row] = await db
      .insert(adAccounts)
      .values({
        platform: d.platform,
        name: d.name,
        externalId: d.externalId ?? `manual-${Date.now().toString(36)}`,
        clientId: d.clientId ?? null,
        isDemo: false,
        dailyBudget: d.dailyBudget,
        metric: d.metric,
        targetValue: d.targetValue,
        pauseThreshold: d.pauseThreshold,
        scaleThreshold: d.scaleThreshold,
      })
      .returning({ id: adAccounts.id });
    revalidateAds();
    return { ok: true, id: row.id };
  } catch {
    return {
      ok: false,
      error: "An account with that platform + id already exists.",
    };
  }
}

const guardrailsSchema = z.object({
  accountId: z.coerce.number().int().positive(),
  dailyBudget: z.coerce.number().min(1).max(1_000_000),
  metric: z.enum(["CPC", "CPA", "ROAS"]),
  targetValue: z.coerce.number().min(0).max(1_000_000),
  pauseThreshold: z.coerce.number().min(0).max(1_000_000),
  scaleThreshold: z.coerce.number().min(0).max(1_000_000),
});

export async function updateGuardrails(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await guardAction("edit");
  const parsed = guardrailsSchema.safeParse({
    accountId: formData.get("accountId"),
    dailyBudget: formData.get("dailyBudget"),
    metric: formData.get("metric"),
    targetValue: formData.get("targetValue"),
    pauseThreshold: formData.get("pauseThreshold"),
    scaleThreshold: formData.get("scaleThreshold"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const d = parsed.data;
  const lowerBetter = d.metric !== "ROAS";
  if (lowerBetter && d.scaleThreshold > d.pauseThreshold) {
    return {
      ok: false,
      error:
        "For CPC/CPA the scale threshold must be BELOW the pause threshold.",
    };
  }
  if (!lowerBetter && d.scaleThreshold < d.pauseThreshold) {
    return {
      ok: false,
      error:
        "For ROAS the scale threshold must be ABOVE the pause threshold.",
    };
  }

  await db
    .update(adAccounts)
    .set({
      dailyBudget: d.dailyBudget,
      metric: d.metric,
      targetValue: d.targetValue,
      pauseThreshold: d.pauseThreshold,
      scaleThreshold: d.scaleThreshold,
      updatedAt: new Date(),
    })
    .where(eq(adAccounts.id, d.accountId));
  revalidateAds();
  safeRevalidatePath(`/ads/accounts/${d.accountId}`);
  return { ok: true, message: "Guardrails updated." };
}

export async function deleteAdAccount(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await guardAction("settings");
  const id = z.coerce
    .number()
    .int()
    .positive()
    .safeParse(formData.get("accountId"));
  if (!id.success) return { ok: false, error: "Invalid account." };
  await db.delete(adAccounts).where(eq(adAccounts.id, id.data));
  revalidateAds();
  safeRevalidatePath("/ads/accounts/" + id.data);
  return { ok: true, message: "Account removed." };
}

export async function resumeAdAccount(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await guardAction("edit");
  const id = z.coerce
    .number()
    .int()
    .positive()
    .safeParse(formData.get("accountId"));
  if (!id.success) return { ok: false, error: "Invalid account." };

  await db
    .update(adAccounts)
    .set({ status: "ACTIVE", updatedAt: new Date() })
    .where(eq(adAccounts.id, id.data));
  await db.insert(adAutomationEvents).values({
    adAccountId: id.data,
    type: "RESUME",
    status: "LOGGED",
    reason: "Resumed by operator from the cockpit.",
  });
  revalidateAds();
  safeRevalidatePath(`/ads/accounts/${id.data}`);
  return { ok: true, message: "Account resumed." };
}

export async function syncDemoData(): Promise<ActionResult> {
  await guardAction("edit");
  const { polled } = await pollDemoAccounts();
  const { created } = await seedDemoData();
  revalidateAds();
  if (polled === 0 && created === 0) {
    return {
      ok: false,
      error: "No demo accounts yet — add one with the demo tick-box first.",
    };
  }
  return {
    ok: true,
    message: `Synced ${Math.max(polled, created)} demo account(s).`,
  };
}

export async function runEngineNow(): Promise<ActionResult> {
  await guardAction("edit");
  const { checked, acted } = await runAllChecks();
  revalidateAds();
  return {
    ok: true,
    message:
      acted > 0
        ? `Checked ${checked} account(s) — the engine acted on ${acted}.`
        : `Checked ${checked} account(s) — everything inside the guardrails.`,
  };
}

export async function resolveProposal(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await guardAction("edit");
  const id = z.coerce
    .number()
    .int()
    .positive()
    .safeParse(formData.get("eventId"));
  const decision = formData.get("decision");
  if (!id.success || (decision !== "approve" && decision !== "dismiss")) {
    return { ok: false, error: "Invalid proposal action." };
  }

  const [event] = await db
    .select()
    .from(adAutomationEvents)
    .where(
      and(
        eq(adAutomationEvents.id, id.data),
        eq(adAutomationEvents.type, "SCALE_PROPOSAL"),
      ),
    )
    .limit(1);
  if (!event) return { ok: false, error: "Proposal not found." };
  if (event.status !== "PENDING") {
    return { ok: false, error: "That proposal was already resolved." };
  }

  if (decision === "dismiss") {
    await db
      .update(adAutomationEvents)
      .set({ status: "DISMISSED", resolvedAt: new Date() })
      .where(eq(adAutomationEvents.id, id.data));
    revalidateAds();
    return { ok: true, message: "Suggestion dismissed." };
  }

  // Approve: bump the budget to the pre-computed proposal, then mark
  // the event EXECUTED so the audit trail shows exactly what ran.
  const [account] = await db
    .select()
    .from(adAccounts)
    .where(eq(adAccounts.id, event.adAccountId))
    .limit(1);
  if (!account) return { ok: false, error: "Account not found." };

  const newBudget = event.proposedBudget ?? account.dailyBudget * 1.2;
  await db
    .update(adAccounts)
    .set({ dailyBudget: newBudget, updatedAt: new Date() })
    .where(eq(adAccounts.id, account.id));
  await db
    .update(adAutomationEvents)
    .set({ status: "EXECUTED", resolvedAt: new Date() })
    .where(eq(adAutomationEvents.id, id.data));
  await db.insert(adAutomationEvents).values({
    adAccountId: account.id,
    type: "SCALE_APPLIED",
    status: "LOGGED",
    reason: `Budget increased to $${newBudget.toFixed(2)}/day (+${event.proposedPct ?? 20}%) after approval.`,
  });
  revalidateAds();
  return {
    ok: true,
    message: `Approved — daily budget is now $${newBudget.toFixed(2)}.`,
  };
}

export async function clearSnapshots(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await guardAction("settings");
  const id = z.coerce
    .number()
    .int()
    .positive()
    .safeParse(formData.get("accountId"));
  if (!id.success) return { ok: false, error: "Invalid account." };
  await db
    .delete(adMetricSnapshots)
    .where(eq(adMetricSnapshots.adAccountId, id.data));
  revalidateAds();
  safeRevalidatePath(`/ads/accounts/${id.data}`);
  return { ok: true, message: "Metric history cleared." };
}
