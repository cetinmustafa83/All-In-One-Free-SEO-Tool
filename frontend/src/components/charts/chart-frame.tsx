"use client";

import type { CSSProperties, ReactNode } from "react";
import { ResponsiveContainer } from "recharts";

/**
 * The one place every recharts chart gets its container from.
 *
 * Why this exists: recharts' ResponsiveContainer measures its parent
 * with a ResizeObserver *after* mount, and its own default for the
 * pre-measurement size is literally `initialDimension: { width: -1,
 * height: -1 }` (see node_modules/recharts/.../ResponsiveContainer.d.ts).
 * Whenever the first observation lands late or never (display:none
 * parents, fast route transitions, print rendering) recharts logs
 * "width(-1) and height(-1)" and can leave a zero-sized chart that
 * never recovers — the `width(-1)` crash class this app hit in dev.
 *
 * ChartFrame always passes a real initialDimension so the very first
 * render already has a plausible size; the ResizeObserver corrects it
 * to the exact pixel size on the next frame. The initial size is only
 * ever visible for that one frame, if at all — pick something close to
 * how the chart is actually laid out so there is no visible flash.
 */
export function ChartFrame({
  children,
  className,
  style,
  initialWidth = 640,
  initialHeight = 200,
  debounce,
}: {
  children: ReactNode;
  /** Sizing classes for the wrapper div (e.g. "h-52", "h-6 w-24"). */
  className?: string;
  /** Inline styles for the wrapper div (e.g. { height: 200 }). */
  style?: CSSProperties;
  /** Width recharts uses before the first real measurement. */
  initialWidth?: number;
  /** Height recharts uses before the first real measurement. */
  initialHeight?: number;
  /** Optional debounce (ms) for resize events, passed through. */
  debounce?: number;
}) {
  return (
    <div className={className} style={style}>
      <ResponsiveContainer
        width="100%"
        height="100%"
        initialDimension={{ width: initialWidth, height: initialHeight }}
        debounce={debounce}
      >
        {children}
      </ResponsiveContainer>
    </div>
  );
}
