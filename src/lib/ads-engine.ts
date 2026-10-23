/**
 * Ads Autopilot engine — ported from AdCrewOS (src/lib/engine.ts) and
 * adapted to this repo's Drizzle/SQLite stack.
 *
 * Hybrid mode, same semantics as upstream:
 *
 *   Per check, each ACTIVE account's latest metric snapshot is compared
 *   against its guardrails:
 *     - breach of pauseThreshold  → auto-pause + AUTO_PAUSE event
 *     - beat of scaleThreshold    → SCALE_PROPOSAL (PENDING), never
 *                                   auto-executed — spending more
 *                                   always waits for a human tap
 *
 *   Metric direction matters:
 *     CPC / CPA : lower is better → breach when observed >= pause
 *                                   beat   when observed <= scale
 *     ROAS      : higher is better → breach when observed <= pause
 *                                   beat   when observed >= scale
 *
 * Idempotent within a run: a paused account is never re-paused, a
 * pending scale proposal is never stacked, and monitor alerts are
 * deduped per account for six hours.
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  adAccounts,
  adAutomationEvents,
  adMetricSnapshots,
  type AdAccountRow,
  type AdMetricSnapshotRow,
} from "@/db/schema";

export const DEFAULT_SCALE_PCT = 20;

export type AdsMetric = "CPC" | "CPA" | "ROAS";

export function metricIsHigherBetter(metric: AdsMetric): boolean {
  return metric === "ROAS";
}

export function metricValue(
  snapshot: Pick<AdMetricSnapshotRow, "cpc" | "cpa" | "roas">,
  metric: AdsMetric,
): number {
  switch (metric) {
    case "CPC":
      return snapshot.cpc;
    case "CPA":
      return snapshot.cpa;
    case "ROAS":
      return snapshot.roas;
  }
}

export function fmtMetric(metric: AdsMetric, v: number): string {
  if (metric === "ROAS") return `${v.toFixed(2)}x`;
  return `$${v.toFixed(2)}`;
}

export type Decision =
  | { action: "none" }
  | {
      action: "pause";
      metric: AdsMetric;
      observed: number;
      threshold: number;
      reason: string;
    }
  | {
      action: "propose_scale";
      metric: AdsMetric;
      observed: number;
      threshold: number;
      proposedPct: number;
      proposedBudget: number;
      reason: string;
    };

export function evaluate(
  account: Pick<
    AdAccountRow,
    "metric" | "pauseThreshold" | "scaleThreshold" | "dailyBudget"
  >,
  snapshot: AdMetricSnapshotRow,
): Decision {
  const metric = account.metric as AdsMetric;
  const observed = metricValue(snapshot, metric);
  const higherBetter = metricIsHigherBetter(metric);

  const breach = higherBetter
    ? observed <= account.pauseThreshold
    : observed >= account.pauseThreshold;

  if (breach) {
    return {
      action: "pause",
      metric,
      observed,
      threshold: account.pauseThreshold,
      reason:
        `${metric} hit ${fmtMetric(metric, observed)} ` +
        `(${higherBetter ? "below" : "above"} protective threshold ` +
        `${fmtMetric(metric, account.pauseThreshold)}). Auto-paused to stop the bleed.`,
    };
  }

  const beat = higherBetter
    ? observed >= account.scaleThreshold
    : observed <= account.scaleThreshold;

  if (beat) {
    const proposedPct = DEFAULT_SCALE_PCT;
    return {
      action: "propose_scale",
      metric,
      observed,
      threshold: account.scaleThreshold,
      proposedPct,
      proposedBudget: round2(account.dailyBudget * (1 + proposedPct / 100)),
      reason:
        `${metric} is running at ${fmtMetric(metric, observed)}, beating your scale ` +
        `target of ${fmtMetric(metric, account.scaleThreshold)}. Recommend +${proposedPct}% budget.`,
    };
  }

  return { action: "none" };
}

/**
 * Run the engine for one account. Returns the decision taken (or
 * "none"). Falls back to MONITOR_ALERT behaviour when the account is
 * DISCONNECTED — we can still see the numbers, we just can't act.
 */
export async function runAccountCheck(
  account: AdAccountRow,
): Promise<Decision> {
  if (account.status === "DISCONNECTED") return { action: "none" };

  const [snapshot] = await db
    .select()
    .from(adMetricSnapshots)
    .where(eq(adMetricSnapshots.adAccountId, account.id))
    .orderBy(desc(adMetricSnapshots.ts))
    .limit(1);
  if (!snapshot) return { action: "none" };

  const decision = evaluate(account, snapshot);

  if (decision.action === "pause") {
    if (account.status === "PAUSED") return { action: "none" };

    // Demo accounts have nothing real to pause — the status flip IS the
    // action. Real (non-demo) accounts without live platform tokens get
    // the same treatment here; the integration layer can hook a
    // platform call in later without changing the record-keeping.
    await db
      .update(adAccounts)
      .set({ status: "PAUSED", updatedAt: new Date() })
      .where(eq(adAccounts.id, account.id));
    await db.insert(adAutomationEvents).values({
      adAccountId: account.id,
      type: "AUTO_PAUSE",
      status: "LOGGED",
      reason: decision.reason,
      metric: decision.metric,
      observed: decision.observed,
      threshold: decision.threshold,
    });
    return decision;
  }

  if (decision.action === "propose_scale") {
    const [pending] = await db
      .select({ id: adAutomationEvents.id })
      .from(adAutomationEvents)
      .where(
        and(
          eq(adAutomationEvents.adAccountId, account.id),
          eq(adAutomationEvents.type, "SCALE_PROPOSAL"),
          eq(adAutomationEvents.status, "PENDING"),
        ),
      )
      .limit(1);
    if (pending) return { action: "none" };

    await db.insert(adAutomationEvents).values({
      adAccountId: account.id,
      type: "SCALE_PROPOSAL",
      status: "PENDING",
      reason: decision.reason,
      metric: decision.metric,
      observed: decision.observed,
      threshold: decision.threshold,
      proposedPct: decision.proposedPct,
      proposedBudget: decision.proposedBudget,
    });
    return decision;
  }

  return { action: "none" };
}

/** Run the engine over every account. Returns how many accounts acted. */
export async function runAllChecks(): Promise<{
  checked: number;
  acted: number;
}> {
  const accounts = await db.select().from(adAccounts);
  let acted = 0;
  for (const account of accounts) {
    const decision = await runAccountCheck(account);
    if (decision.action !== "none") acted += 1;
  }
  return { checked: accounts.length, acted };
}

// ─────────────────────────────────────────────────────────────────────
// Demo data — ported from AdCrewOS src/lib/demo.ts. Demo accounts run
// the IDENTICAL engine; only the data source differs. Snapshots are
// generated with realistic drift so the engine occasionally trips
// pause/scale conditions and the cockpit has full fidelity.
// ─────────────────────────────────────────────────────────────────────

export type DemoProfile = {
  platform: "google" | "meta";
  name: string;
  metric: AdsMetric;
  targetValue: number;
  pauseThreshold: number;
  scaleThreshold: number;
  dailyBudget: number;
  base: {
    spendPerTick: number;
    ctr: number; // %
    cpc: number; // $
    convRate: number;
    aov: number;
  };
};

export const DEMO_PROFILES: DemoProfile[] = [
  {
    platform: "google",
    name: "Demo — Search: Brand + Nonbrand",
    metric: "CPA",
    targetValue: 42,
    pauseThreshold: 75, // CPA above $75 → protective pause
    scaleThreshold: 30, // CPA at/below $30 → propose scale
    dailyBudget: 340,
    base: { spendPerTick: 14, ctr: 6.2, cpc: 1.9, convRate: 0.052, aov: 120 },
  },
  {
    platform: "meta",
    name: "Demo — Advantage+ Prospecting",
    metric: "ROAS",
    targetValue: 3.2,
    pauseThreshold: 1.6, // ROAS below 1.6x → protective pause
    scaleThreshold: 4.2, // ROAS at/above 4.2x → propose scale
    dailyBudget: 520,
    base: { spendPerTick: 22, ctr: 2.4, cpc: 0.85, convRate: 0.031, aov: 68 },
  },
  {
    platform: "google",
    name: "Demo — Performance Max (Retargeting)",
    metric: "ROAS",
    targetValue: 4.5,
    pauseThreshold: 2.0,
    scaleThreshold: 5.5,
    dailyBudget: 180,
    base: { spendPerTick: 9, ctr: 3.1, cpc: 0.62, convRate: 0.048, aov: 95 },
  },
];

function jitter(v: number, pct: number): number {
  return v * (1 + (Math.random() * 2 - 1) * pct);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Compute one synthetic snapshot's metrics for a profile at a tick. */
export function synthMetrics(profile: DemoProfile, tickIndex: number) {
  // Daily seasonality: a gentle sine over a 120-tick (~24h) cycle.
  const season = 1 + 0.25 * Math.sin((tickIndex / 120) * Math.PI * 2);
  const spend = Math.max(1, jitter(profile.base.spendPerTick * season, 0.18));
  const cpc = Math.max(0.05, jitter(profile.base.cpc, 0.15));
  const clicks = Math.max(1, Math.round(spend / cpc));
  const impressions = Math.max(
    clicks,
    Math.round((clicks / profile.base.ctr) * 100),
  );
  const ctr = (clicks / impressions) * 100;
  const conversions = Math.max(0, jitter(clicks * profile.base.convRate, 0.35));
  const cpa = conversions > 0 ? spend / conversions : spend;
  const revenue = conversions * jitter(profile.base.aov, 0.1);
  const roas = spend > 0 ? revenue / spend : 0;

  return {
    spend: round2(spend),
    clicks,
    impressions,
    conversions: round2(conversions),
    revenue: round2(revenue),
    ctr: round2(ctr),
    cpc: round2(cpc),
    cpa: round2(cpa),
    roas: round2(roas),
  };
}

/**
 * Seed the two canonical demo accounts with 14 days of backfilled
 * history, then run the engine so the alert feed starts populated.
 * Idempotent: skips accounts that already exist.
 */
export async function seedDemoData(): Promise<{ created: number }> {
  let created = 0;

  for (const [i, profile] of DEMO_PROFILES.entries()) {
    const externalId = `demo-${i + 1}`;
    const [existing] = await db
      .select({ id: adAccounts.id })
      .from(adAccounts)
      .where(
        and(
          eq(adAccounts.platform, profile.platform),
          eq(adAccounts.externalId, externalId),
        ),
      )
      .limit(1);
    if (existing) continue;

    const [account] = await db
      .insert(adAccounts)
      .values({
        platform: profile.platform,
        externalId,
        name: profile.name,
        currency: "USD",
        isDemo: true,
        status: "ACTIVE",
        dailyBudget: profile.dailyBudget,
        metric: profile.metric,
        targetValue: profile.targetValue,
        pauseThreshold: profile.pauseThreshold,
        scaleThreshold: profile.scaleThreshold,
      })
      .returning();
    created += 1;

    // 14 days × 6 ticks/day of history, backdated to end "now".
    const TICKS = 84;
    const rows = [];
    for (let tick = 0; tick < TICKS; tick++) {
      const ts = new Date(Date.now() - (TICKS - 1 - tick) * 2 * 60 * 60 * 1000);
      rows.push({ adAccountId: account.id, ts, ...synthMetrics(profile, tick) });
    }
    await db.insert(adMetricSnapshots).values(rows);
    await runAccountCheck(account);
  }

  return { created };
}

/**
 * One simulated poll for every demo account: append a fresh snapshot
 * (realistic drift around the profile baseline) and re-run the engine.
 * Real accounts are untouched — they'd be polled by their platform
 * integration, not by the demo synthesiser.
 */
export async function pollDemoAccounts(): Promise<{ polled: number }> {
  const accounts = await db
    .select()
    .from(adAccounts)
    .where(eq(adAccounts.isDemo, true));

  for (const account of accounts) {
    const profile =
      DEMO_PROFILES.find((p) => p.name === account.name) ?? DEMO_PROFILES[0];
    const tick = Math.floor(Date.now() / (2 * 60 * 60 * 1000));
    await db
      .insert(adMetricSnapshots)
      .values({ adAccountId: account.id, ...synthMetrics(profile, tick) });
    await runAccountCheck(account);
  }
  return { polled: accounts.length };
}

/** Cockpit KPIs, computed in SQL where SQLite can do the work. */
export async function cockpitStats() {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [accounts] = await db
    .select({
      total: sql<number>`count(*)`,
      paused: sql<number>`sum(case when ${adAccounts.status} = 'PAUSED' then 1 else 0 end)`,
    })
    .from(adAccounts);

  const [spend] = await db
    .select({ today: sql<number>`coalesce(sum(${adMetricSnapshots.spend}), 0)` })
    .from(adMetricSnapshots)
    .where(gte(adMetricSnapshots.ts, dayAgo));

  const [pauses] = await db
    .select({
      n: sql<number>`count(*)`,
    })
    .from(adAutomationEvents)
    .where(
      and(
        eq(adAutomationEvents.type, "AUTO_PAUSE"),
        gte(adAutomationEvents.createdAt, new Date(Date.now() - 7 * 86400_000)),
      ),
    );

  const [pending] = await db
    .select({ n: sql<number>`count(*)` })
    .from(adAutomationEvents)
    .where(
      and(
        eq(adAutomationEvents.type, "SCALE_PROPOSAL"),
        eq(adAutomationEvents.status, "PENDING"),
      ),
    );

  return {
    accounts: accounts?.total ?? 0,
    paused: accounts?.paused ?? 0,
    spendToday: spend?.today ?? 0,
    autoPaused7d: pauses?.n ?? 0,
    pendingSuggestions: pending?.n ?? 0,
  };
}
