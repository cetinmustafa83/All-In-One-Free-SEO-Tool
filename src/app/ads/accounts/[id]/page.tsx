import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Megaphone, Settings2 } from "lucide-react";
import { db } from "@/db/client";
import { adAccounts, adAutomationEvents, adMetricSnapshots, clients } from "@/db/schema";
import { metricIsHigherBetter } from "@/lib/ads-engine";
import { PageHeader } from "@/components/shell/page-header";
import { AreaChart } from "@/components/ui/area-chart";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertFeed } from "../../alert-feed";
import { ResumeButton } from "../../resume-button";
import { GuardrailsForm } from "./guardrails-form";

export const dynamic = "force-dynamic";

export default async function AdAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const accountId = Number(id);
  if (!Number.isInteger(accountId) || accountId <= 0) notFound();

  const [account] = await db
    .select()
    .from(adAccounts)
    .where(eq(adAccounts.id, accountId))
    .limit(1);
  if (!account) notFound();

  const [snapshots, events, [client]] = await Promise.all([
    db
      .select()
      .from(adMetricSnapshots)
      .where(eq(adMetricSnapshots.adAccountId, accountId))
      .orderBy(desc(adMetricSnapshots.ts))
      .limit(120),
    db
      .select()
      .from(adAutomationEvents)
      .where(eq(adAutomationEvents.adAccountId, accountId))
      .orderBy(desc(adAutomationEvents.createdAt))
      .limit(30),
    account.clientId
      ? db
          .select({ name: clients.name })
          .from(clients)
          .where(eq(clients.id, account.clientId))
          .limit(1)
      : Promise.resolve([null]),
  ]);

  const chartData = [...snapshots]
    .reverse()
    .slice(-60)
    .map((s) => ({
      name: new Date(s.ts).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      value:
        account.metric === "ROAS"
          ? s.roas
          : account.metric === "CPA"
            ? s.cpa
            : s.cpc,
    }));

  const spend14 = snapshots.reduce((sum, s) => sum + s.spend, 0);
  const clicks14 = snapshots.reduce((sum, s) => sum + s.clicks, 0);
  const conv14 = snapshots.reduce((sum, s) => sum + s.conversions, 0);
  const rev14 = snapshots.reduce((sum, s) => sum + s.revenue, 0);
  const latest = snapshots[0];
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

  const money = (v: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: account.currency,
      maximumFractionDigits: 2,
    }).format(v);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        icon={Megaphone}
        accent="violet"
        title={account.name}
        description={`${account.platform === "google" ? "Google Ads" : "Meta Ads"}${account.isDemo ? " · demo account" : ""}${client?.name ? ` · client: ${client.name}` : ""} · id ${account.externalId}`}
        crumbs={[
          { href: "/tools", label: "All tools" },
          { href: "/ads", label: "Ads Autopilot" },
          { label: account.name },
        ]}
        actions={
          account.status === "PAUSED" ? (
            <ResumeButton accountId={account.id} />
          ) : (
            <Badge
              variant={
                breached ? "destructive" : account.status === "ACTIVE" ? "secondary" : "outline"
              }
            >
              {account.status.toLowerCase()}
              {breached ? " · outside guardrail" : ""}
            </Badge>
          )
        }
      />

      {/* Totals over the retained window */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Spend (window)", value: money(spend14) },
          { label: "Clicks", value: clicks14.toLocaleString() },
          { label: "Conversions", value: conv14.toFixed(1) },
          { label: "Revenue", value: money(rev14) },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-bold tabular-nums">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Metric chart + guardrails side by side */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {account.metric} — last {chartData.length} polls
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AreaChart
              data={chartData}
              formatValue={account.metric === "ROAS" ? "decimal" : "$%v"}
              colorClass={
                account.metric === "ROAS" ? "text-emerald-400" : "text-amber-400"
              }
              height={240}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings2 className="size-4 text-violet-400" />
              Guardrails
            </CardTitle>
          </CardHeader>
          <CardContent>
            <GuardrailsForm account={account} />
          </CardContent>
        </Card>
      </div>

      {/* Automation history */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Automation history</CardTitle>
        </CardHeader>
        <CardContent>
          <AlertFeed events={events} />
        </CardContent>
      </Card>
    </div>
  );
}
