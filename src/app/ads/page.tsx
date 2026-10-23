import { desc, inArray } from "drizzle-orm";
import {
  Bell,
  Bot,
  Landmark,
  Megaphone,
  PauseCircle,
  Wallet,
} from "lucide-react";
import { db } from "@/db/client";
import {
  adAccounts,
  adAutomationEvents,
  adMetricSnapshots,
  clients,
} from "@/db/schema";
import { cockpitStats, fmtMetric, metricIsHigherBetter } from "@/lib/ads-engine";
import { PageHeader } from "@/components/shell/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AdsToolbar } from "./ads-toolbar";
import { AlertFeed } from "./alert-feed";
import { ResumeButton } from "./resume-button";

export const metadata = { title: "Ads Autopilot — SEO Tool" };

export const dynamic = "force-dynamic";

const money = (v: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(v);

export default async function AdsCockpitPage() {
  const [accounts, stats, clientRows] = await Promise.all([
    db.select().from(adAccounts).orderBy(desc(adAccounts.updatedAt)),
    cockpitStats(),
    db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .orderBy(clients.name),
  ]);

  const accountIds = accounts.map((a) => a.id);
  const [snapshots, events] = await Promise.all([
    accountIds.length
      ? db
          .select()
          .from(adMetricSnapshots)
          .where(inArray(adMetricSnapshots.adAccountId, accountIds))
          .orderBy(desc(adMetricSnapshots.ts))
          .limit(500)
      : Promise.resolve([]),
    db
      .select()
      .from(adAutomationEvents)
      .orderBy(desc(adAutomationEvents.createdAt))
      .limit(50),
  ]);

  const clientName = new Map(clientRows.map((c) => [c.id, c.name]));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        icon={Megaphone}
        accent="violet"
        title="Ads Autopilot"
        description="Your Google and Meta ads, watched around the clock. Protective breaches are paused automatically; winners are proposed for more budget and wait for your tap. Nothing spends without you."
        actions={<AdsToolbar clients={clientRows} />}
        crumbs={[{ href: "/tools", label: "All tools" }, { label: "Ads Autopilot" }]}
      />

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <EmptyState
              icon={Landmark}
              title="No ad accounts connected"
              body="Connect a Google or Meta account — or seed the demo workspace and watch the engine pause a loser and propose scaling a winner, all with fake money."
              size="lg"
            />
            <div className="flex justify-center">
              <AdsToolbar clients={clientRows} />
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Ad accounts"
              value={stats.accounts}
              hint={`${stats.paused} paused by the engine`}
              accent="violet"
              icon={Landmark}
            />
            <StatCard
              label="Spend, last 24h"
              value={money(stats.spendToday)}
              accent="cyan"
              icon={Wallet}
            />
            <StatCard
              label="Auto-paused (7d)"
              value={stats.autoPaused7d}
              hint="money saved while you were away"
              accent="rose"
              icon={PauseCircle}
            />
            <StatCard
              label="Grow-this? suggestions"
              value={stats.pendingSuggestions}
              hint="waiting for your approval"
              accent="emerald"
              icon={Bell}
            />
          </div>

          {/* Account cards */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {accounts.map((account) => {
              const rows = snapshots.filter(
                (s) => s.adAccountId === account.id,
              );
              const latest = rows[0];
              const spark = [...rows]
                .reverse()
                .slice(-28)
                .map((s) =>
                  account.metric === "ROAS"
                    ? s.roas
                    : account.metric === "CPA"
                      ? s.cpa
                      : s.cpc,
                );
              const higherBetter = metricIsHigherBetter(account.metric);
              const live = latest
                ? account.metric === "ROAS"
                  ? latest.roas
                  : account.metric === "CPA"
                    ? latest.cpa
                    : latest.cpc
                : null;
              const breached =
                live !== null &&
                (higherBetter
                  ? live <= account.pauseThreshold
                  : live >= account.pauseThreshold);

              return (
                <Card key={account.id} className="flex flex-col">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base leading-snug">
                        <a
                          href={`/ads/accounts/${account.id}`}
                          className="hover:underline"
                        >
                          {account.name}
                        </a>
                      </CardTitle>
                      <Badge
                        variant={
                          account.status === "PAUSED"
                            ? "destructive"
                            : account.status === "ACTIVE"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {account.status.toLowerCase()}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {account.platform === "google" ? "Google Ads" : "Meta Ads"}
                      {account.clientId && clientName.has(account.clientId)
                        ? ` · ${clientName.get(account.clientId)}`
                        : ""}
                      {account.isDemo ? " · demo" : ""} ·{" "}
                      {money(account.dailyBudget, account.currency)}/day
                    </p>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col justify-between gap-3">
                    <div className="flex items-end justify-between gap-2">
                      <div>
                        <p className="text-2xl font-bold tabular-nums">
                          {live === null
                            ? "—"
                            : fmtMetric(account.metric, live)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {account.metric} now · target{" "}
                          {fmtMetric(account.metric, account.targetValue)}
                        </p>
                      </div>
                      {breached && account.status === "ACTIVE" && (
                        <Badge variant="destructive">outside guardrail</Badge>
                      )}
                    </div>

                    {/* 28-tick spark */}
                    {spark.length > 1 && (
                      <svg
                        viewBox="0 0 100 28"
                        preserveAspectRatio="none"
                        className="h-8 w-full text-violet-400"
                      >
                        <polyline
                          points={spark
                            .map((v, i) => {
                              const max = Math.max(...spark);
                              const min = Math.min(...spark);
                              const range = max - min || 1;
                              return `${(i * 100) / (spark.length - 1)},${28 - ((v - min) / range) * 28}`;
                            })
                            .join(" ")}
                          fill="none"
                          strokeWidth="1.5"
                          strokeLinejoin="round"
                          strokeLinecap="round"
                          vectorEffect="non-scaling-stroke"
                          stroke="currentColor"
                        />
                      </svg>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        Pause at {fmtMetric(account.metric, account.pauseThreshold)}{" "}
                        · scale at{" "}
                        {fmtMetric(account.metric, account.scaleThreshold)}
                      </span>
                      {account.status === "PAUSED" && (
                        <ResumeButton accountId={account.id} />
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Alert feed */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="size-4 text-violet-400" />
                Alert feed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AlertFeed events={events} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
