"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { runCrux, type CruxState } from "./actions";
import { ratingForMetric } from "@/lib/crux-thresholds";

export function CruxForm() {
  const [state, formAction, pending] = useActionState<CruxState, FormData>(
    runCrux,
    null,
  );

  return (
    <>
      <form action={formAction} className="glass-apple relative overflow-hidden rounded-2xl p-5 space-y-3">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">URL</span>
            <input
              name="url"
              required
              placeholder="https://example.com/blog/post"
              className="h-9 w-full rounded-md border border-white/10 bg-card/60 px-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Form factor</span>
            <select
              name="formFactor"
              defaultValue="PHONE"
              className="flex h-9 w-full rounded-md border border-white/10 bg-card/60 px-3 text-sm"
            >
              <option value="PHONE">Phone</option>
              <option value="DESKTOP">Desktop</option>
              <option value="ALL_FORM_FACTORS">All</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-9 items-center self-end rounded-md bg-emerald-500/15 px-4 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-3 animate-spin" /> : "Run"}
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Falls back to origin-level data when the URL itself doesn&apos;t
          have enough traffic.
        </p>
      </form>

      {state && "error" in state && state.error && (
        <p className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-inset ring-rose-500/30">
          {state.error}
        </p>
      )}

      {state && "hasData" in state && !state.hasData && !state.error && (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-300 ring-1 ring-inset ring-amber-500/30">
          No CrUX data available — this URL/origin has too little Chrome
          traffic over the last 28 days. Try a more popular page or use the{" "}
          <a href="/cwv" className="underline">
            synthetic PageSpeed scan
          </a>{" "}
          instead.
        </p>
      )}

      {state && "hasData" in state && state.hasData && (
        <>
          <p className="text-xs text-muted-foreground">
            {state.scope === "url" ? "URL-level" : "Origin-level"} ·{" "}
            {state.formFactor} · period {state.collectionPeriod?.start} →{" "}
            {state.collectionPeriod?.end}
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            {state.metrics.lcp && (
              <MetricCard
                label="LCP"
                fullName="Largest Contentful Paint"
                value={`${(state.metrics.lcp.p75 / 1000).toFixed(2)}s`}
                rating={ratingForMetric("lcp", state.metrics.lcp.p75)}
                histogram={state.metrics.lcp.histogram}
                buckets={["≤2.5s", "≤4s", ">4s"]}
              />
            )}
            {state.metrics.inp && (
              <MetricCard
                label="INP"
                fullName="Interaction to Next Paint"
                value={`${state.metrics.inp.p75}ms`}
                rating={ratingForMetric("inp", state.metrics.inp.p75)}
                histogram={state.metrics.inp.histogram}
                buckets={["≤200ms", "≤500ms", ">500ms"]}
              />
            )}
            {state.metrics.cls && (
              <MetricCard
                label="CLS"
                fullName="Cumulative Layout Shift"
                value={state.metrics.cls.p75.toFixed(3)}
                rating={ratingForMetric("cls", state.metrics.cls.p75)}
                histogram={state.metrics.cls.histogram}
                buckets={["≤0.1", "≤0.25", ">0.25"]}
              />
            )}
            {state.metrics.fcp && (
              <MetricCard
                label="FCP"
                fullName="First Contentful Paint"
                value={`${(state.metrics.fcp.p75 / 1000).toFixed(2)}s`}
                rating={ratingForMetric("fcp", state.metrics.fcp.p75)}
                histogram={state.metrics.fcp.histogram}
                buckets={["≤1.8s", "≤3s", ">3s"]}
              />
            )}
            {state.metrics.ttfb && (
              <MetricCard
                label="TTFB"
                fullName="Time to First Byte"
                value={`${(state.metrics.ttfb.p75 / 1000).toFixed(2)}s`}
                rating={ratingForMetric("ttfb", state.metrics.ttfb.p75)}
                histogram={state.metrics.ttfb.histogram}
                buckets={["≤0.8s", "≤1.8s", ">1.8s"]}
              />
            )}
          </div>
        </>
      )}
    </>
  );
}

const RATING_TONE: Record<string, string> = {
  good: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  needs_improvement: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  poor: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
};

const RATING_LABEL: Record<string, string> = {
  good: "Good",
  needs_improvement: "Needs work",
  poor: "Poor",
};

function MetricCard({
  label,
  fullName,
  value,
  rating,
  histogram,
  buckets,
}: {
  label: string;
  fullName: string;
  value: string;
  rating: "good" | "needs_improvement" | "poor";
  histogram: { density: number }[];
  buckets: string[];
}) {
  const total = histogram.reduce((s, h) => s + h.density, 0) || 1;
  return (
    <div className="glass-apple relative overflow-hidden rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">{label}</h3>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {fullName}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${RATING_TONE[rating]}`}
        >
          {RATING_LABEL[rating]}
        </span>
      </div>
      <div className="mt-3 text-2xl font-semibold tabular-nums">{value}</div>
      <p className="text-[10px] text-muted-foreground">75th percentile</p>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-white/5">
        {histogram.map((h, i) => (
          <div
            key={i}
            className={
              i === 0
                ? "bg-emerald-400"
                : i === 1
                  ? "bg-amber-400"
                  : "bg-rose-400"
            }
            style={{ width: `${(h.density / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[9px] text-muted-foreground">
        {buckets.map((b, i) => (
          <span key={i}>
            {b} · {Math.round((histogram[i]?.density ?? 0) * 100)}%
          </span>
        ))}
      </div>
    </div>
  );
}
