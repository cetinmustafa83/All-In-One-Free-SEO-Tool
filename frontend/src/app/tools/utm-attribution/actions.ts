"use server";

import { callBackend } from "@/lib/backend";
import { currentUserId } from "@/lib/auth";
import { clientIdFromRequest } from "@/lib/client-context";
import { guardAction } from "@/lib/action-guard";

// ---------------------------------------------------------------------------
// Task 14.6b: runAttribution is a thin proxy over
// /api/internal/tools/utm-attribution/run — the whole computation
// (parsePastedTouches, classifyChannel, first/last/assisted/linear/position
// aggregation) now lives in backend/src/tools_compute.rs, which also writes
// the tool_runs row (the saveToolRun port). The action's own empty-input
// checks stay here so the UI error strings are byte-identical; the Rust
// endpoint re-validates the same rules for direct API callers. The exported
// types are unchanged for the client components that import them, and —
// like the original — there is no revalidatePath and no try/catch: the
// result envelope ({ ok, result } | { ok, error }) comes straight from the
// backend.
// ---------------------------------------------------------------------------

export type UtmTouch = {
  timestamp: string;
  campaign: string;
  source: string;
  medium: string;
  content?: string;
  term?: string;
  landingPath?: string;
  sessionId?: string;
  userId?: string;
};

export type ChannelStats = {
  channel: string;
  firstTouches: number;
  lastTouches: number;
  assistedTouches: number;
  linearCredit: number;
  positionCredit: number;
  /** Conversions where this channel was anywhere in the path. */
  pathInclusion: number;
};

export type AttributionResult = {
  totalTouches: number;
  totalConversions: number;
  uniqueUsers: number;
  /** Stats per channel — first-touch, last-touch, assisted, linear, position-based. */
  channels: ChannelStats[];
  /** Top conversion paths as channel sequences. */
  topPaths: { path: string[]; count: number }[];
  averagePathLength: number;
};

export type AttrState =
  | { ok: true; result: AttributionResult }
  | { ok: false; error: string }
  | null;

export async function runAttribution(
  _prev: AttrState,
  formData: FormData,
): Promise<AttrState> {
  await guardAction("edit", formData.get("clientId"));
  const raw = String(formData.get("touches") ?? "").trim();
  if (!raw) return { ok: false, error: "Paste touch data first." };
  return callBackend<AttrState>(
    "/api/internal/tools/utm-attribution/run",
    {
      body: {
        touches: raw,
        clientId: await clientIdFromRequest(),
        userId: await currentUserId(),
      },
    },
  );
}
