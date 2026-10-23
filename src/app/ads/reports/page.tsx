import { desc, eq } from "drizzle-orm";
import { FileDown, Megaphone } from "lucide-react";
import { db } from "@/db/client";
import { adAccounts, adAutomationEvents, adMetricSnapshots, clients } from "@/db/schema";
import { fmtMetric, metricIsHigherBetter } from "@/lib/ads-engine";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AreaChart } from "@/components/ui/area-chart";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

const PERIODS = [
  { days: 7, label: "Last 7 days" },
  { days: 14, label: "Last 14 days" },
  { days: 30, label: "Last 30 days" },
];

const money = (v: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(v);

/** Module-scope helper: the purity rule exempts non-component helpers,
 * and a server component reading a clock is exactly what "force-dynamic"
 * is for. */
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86400_000);
}

function generatedLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function AdsReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; days?: string }>;
}) {
  const sp = await searchParams;
  const accounts = await db
    .select()
    .from(adAccounts)
    .orderBy(desc(adAccounts.updatedAt));

  const selectedId = Number(sp.account) || accounts[0]?.id || 0;
  const days = PERIODS.some((p) => String(p.days) === sp.days)
    ? Number(sp.days)
    : 14;
  const account = accounts.find((a) => a.id === selectedId);

  let rows: (typeof adMetricSnapshots.$inferSelect)[] = [];
  let events: (typeof adAutomationEvents.$inferSelect)[] = [];
  let clientName: string | null = null;

  if (account) {
    const since = daysAgo(days);
    [rows, events] = await Promise.all([
      db
        .select()
        .from(adMetricSnapshots)
        .where(eq(adMetricSnapshots.adAccountId, account.id))
        .orderBy(desc(adMetricSnapshots.ts))
        .limit(400)
        .then((r) => r.filter((s) => new Date(s.ts) >= since)),
      db
        .select()
        .from(adAutomationEvents)
        .where(eq(adAutomationEvents.adAccountId, account.id))
        .orderBy(desc(adAutomationEvents.createdAt))
        .limit(20),
    ]);
    if (account.clientId) {
      const [c] = await db
        .select({ name: clients.name })
        .from(clients)
        .where(eq(clients.id, account.clientId))
        .limit(1);
      clientName = c?.name ?? null;
    }
  }

  const spend = rows.reduce((s, r) => s + r.spend, 0);
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const conv = rows.reduce((s, r) => s + r.conversions, 0);
  const rev = rows.reduce((s, r) => s + r.revenue, 0);
  const impr = rows.reduce((s, r) => s + r.impressions, 0);

  const chartData = [...rows]
    .reverse()
    .map((s) => ({
      name: new Date(s.ts).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      value:
        account?.metric === "CPA" ? s.cpa : account?.metric === "CPC" ? s.cpc : s.roas,
    }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="print:hidden">
        <PageHeader
          icon={FileDown}
          accent="violet"
          title="Ads report"
          description="A clean, client-ready summary of what the autopilot did and what the money did. Print or save as PDF — agencies can letterhead it."
          crumbs={[
            { href: "/tools", label: "All tools" },
            { href: "/ads", label: "Ads Autopilot" },
            { label: "Report" },
          ]}
          actions={<PrintButton />}
        />
      </div>

      {accounts.length === 0 || !account ? (
        <Card>
          <CardContent className="p-6">
            <EmptyState
              icon={Megaphone}
              title="Nothing to report yet"
              body="Connect an ad account (or seed the demo) and run the engine — reports summarise real snapshots."
              size="lg"
              primary={{ href: "/ads", label: "Open the cockpit" }}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Controls (screen only) */}
          <form
            method="get"
            className="print:hidden flex flex-wrap items-end gap-3"
          >
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Account</label>
              <select
                name="account"
                defaultValue={String(account.id)}
                className="h-9 rounded-md border border-border bg-background px-3 text-sm"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Period</label>
              <select
                name="days"
                defaultValue={String(days)}
                className="h-9 rounded-md border border-border bg-background px-3 text-sm"
              >
                {PERIODS.map((p) => (
                  <option key={p.days} value={p.days}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="h-9 rounded-md border border-border bg-background px-4 text-sm hover:bg-muted"
            >
              Update
            </button>
          </form>

          {/* The report itself */}
          <Card className="print:border-0 print:shadow-none">
            <CardContent className="space-y-6 p-6 sm:p-8">
              <header className="border-b border-border pb-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">
                  Ads performance report
                </p>
                <h2 className="mt-1 text-2xl font-bold">{account.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {account.platform === "google" ? "Google Ads" : "Meta Ads"}
                  {clientName ? ` · prepared for ${clientName}` : ""} ·{" "}
                  {PERIODS.find((p) => p.days === days)?.label} · generated{" "}
                  {generatedLabel()}
                </p>
              </header>

              <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  { k: "Spend", v: money(spend, account.currency) },
                  { k: "Revenue", v: money(rev, account.currency) },
                  {
                    k: "ROAS",
                    v: spend > 0 ? `${(rev / spend).toFixed(2)}x` : "—",
                  },
                  {
                    k: account.metric,
                    v: rows[0]
                      ? fmtMetric(
                          account.metric,
                          account.metric === "ROAS"
                            ? rows[0].roas
                            : account.metric === "CPA"
                              ? rows[0].cpa
                              : rows[0].cpc,
                        )
                      : "—",
                  },
                  { k: "Clicks", v: clicks.toLocaleString() },
                  {
                    k: "Conv. rate",
                    v: clicks > 0 ? `${((conv / clicks) * 100).toFixed(2)}%` : "—",
                  },
                ].map((s) => (
                  <div key={s.k}>
                    <p className="text-xs text-muted-foreground">{s.k}</p>
                    <p className="text-lg font-bold tabular-nums">{s.v}</p>
                  </div>
                ))}
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold">
                  {account.metric} trend
                </h3>
                <AreaChart
                  data={chartData}
                  formatValue={account.metric === "ROAS" ? "decimal" : "$%v"}
                  colorClass="text-violet-400"
                  height={200}
                />
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold">
                  Guardrails in force
                </h3>
                <p className="text-sm text-muted-foreground">
                  Daily budget {money(account.dailyBudget, account.currency)} ·
                  target {fmtMetric(account.metric, account.targetValue)} ·
                  auto-pause at{" "}
                  {fmtMetric(account.metric, account.pauseThreshold)} (
                  {metricIsHigherBetter(account.metric) ? "floor" : "ceiling"}) ·
                  scale proposal at{" "}
                  {fmtMetric(account.metric, account.scaleThreshold)}
                </p>
              </section>

              {events.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">
                    What the autopilot did
                  </h3>
                  <ul className="space-y-1.5">
                    {events.slice(0, 10).map((e) => (
                      <li key={e.id} className="text-sm">
                        <span className="font-medium">
                          {e.type.replaceAll("_", " ").toLowerCase()}
                        </span>
                        <span className="text-muted-foreground">
                          {" "}
                          — {e.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <footer className="border-t border-border pt-3 text-xs text-muted-foreground">
                Generated by Ads Autopilot · {impr.toLocaleString()} impressions
                analysed · nothing spends without an approved proposal.
              </footer>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
