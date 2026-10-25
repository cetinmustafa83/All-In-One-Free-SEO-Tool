"use client";

/**
 * Brand-mention sentiment trend chart. Server passes pre-bucketed daily
 * counts for {positive, neutral, negative} over the last N days; we
 * render a stacked-bar chart in pure SVG (no chart lib).
 */

export type SentimentBucket = {
  date: string; // YYYY-MM-DD
  positive: number;
  neutral: number;
  negative: number;
};

export function SentimentChart({
  buckets,
}: {
  buckets: SentimentBucket[];
}) {
  if (buckets.length === 0) {
    return (
      <p className="px-5 py-6 text-sm text-muted-foreground">
        No data yet. Run a scan to capture mentions.
      </p>
    );
  }

  const max = buckets.reduce(
    (m, b) => Math.max(m, b.positive + b.neutral + b.negative),
    0,
  );
  if (max === 0) {
    return (
      <p className="px-5 py-6 text-sm text-muted-foreground">
        No mentions in the period.
      </p>
    );
  }

  const W = 700;
  const H = 180;
  const pad = { top: 10, right: 10, bottom: 22, left: 32 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const barW = innerW / buckets.length - 2;

  return (
    <div className="overflow-x-auto">
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="block max-w-full"
      >
        {/* Y axis */}
        {[0, max / 2, max].map((v) => {
          const y = pad.top + innerH - (v / max) * innerH;
          return (
            <g key={v}>
              <line
                x1={pad.left}
                x2={W - pad.right}
                y1={y}
                y2={y}
                stroke="currentColor"
                opacity={0.08}
              />
              <text
                x={pad.left - 6}
                y={y + 3}
                fontSize={9}
                textAnchor="end"
                fill="currentColor"
                opacity={0.5}
              >
                {Math.round(v)}
              </text>
            </g>
          );
        })}
        {buckets.map((b, i) => {
          const total = b.positive + b.neutral + b.negative;
          const x = pad.left + i * (barW + 2);
          let yCursor = pad.top + innerH;
          // Stack: negative (bottom), neutral, positive (top) — visually
          // we want positive on top so it "grows up" optically.
          const segs: { color: string; v: number }[] = [
            { color: "#f87171", v: b.negative }, // rose
            { color: "rgba(255,255,255,0.18)", v: b.neutral },
            { color: "#34d399", v: b.positive }, // emerald
          ];
          return (
            <g key={b.date}>
              {segs.map((s, idx) => {
                const h = total > 0 ? (s.v / max) * innerH : 0;
                const yTop = yCursor - h;
                yCursor = yTop;
                if (h === 0) return null;
                return (
                  <rect
                    key={idx}
                    x={x}
                    y={yTop}
                    width={Math.max(2, barW)}
                    height={h}
                    fill={s.color}
                    rx={1}
                  >
                    <title>
                      {b.date}: {b.positive} positive, {b.neutral} neutral,{" "}
                      {b.negative} negative
                    </title>
                  </rect>
                );
              })}
            </g>
          );
        })}
        {/* X axis labels (every Nth) */}
        {buckets
          .filter((_, i) => i % Math.ceil(buckets.length / 7) === 0)
          .map((b) => {
            const idx = buckets.indexOf(b);
            const x = pad.left + idx * (barW + 2) + barW / 2;
            return (
              <text
                key={b.date}
                x={x}
                y={H - 6}
                fontSize={9}
                textAnchor="middle"
                fill="currentColor"
                opacity={0.5}
              >
                {b.date.slice(5)}
              </text>
            );
          })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-sm bg-emerald-400" /> positive
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-sm bg-white/20" /> neutral
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-sm bg-rose-400" /> negative
        </span>
      </div>
    </div>
  );
}
