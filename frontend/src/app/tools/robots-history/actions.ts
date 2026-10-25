"use server";

import { revalidatePath } from "next/cache";
import { snapshotRobots } from "@/lib/robots-snapshots";
import { callBackend } from "@/lib/backend";
import { guardAction } from "@/lib/action-guard";

// ---------------------------------------------------------------------------
// Task 14.6a: loadSnapshots is a thin proxy over
// /api/internal/tools/robots-history/list (backend/src/tools_basic.rs) —
// the Rust endpoint mirrors listSnapshots()'s parseHost + latest-20 query
// and returns fetchedAt as ISO strings; this proxy converts them back into
// the Date objects the RobotsSnapshot type promises, so call sites are
// unchanged. runSnapshot is NOT ported: snapshotRobots fetches /robots.txt
// over the network and stays Next-side.
// ---------------------------------------------------------------------------

export type SnapshotState =
  | { ok: true; changed: boolean }
  | { ok: false; error: string };

export async function runSnapshot(
  _prev: SnapshotState | null,
  formData: FormData,
): Promise<SnapshotState> {
  await guardAction("edit", formData.get("clientId"));
  const host = String(formData.get("host") ?? "").trim();
  if (!host) return { ok: false, error: "Enter a domain." };
  const r = await snapshotRobots(host);
  revalidatePath("/tools/robots-history");
  if (!r.ok) return { ok: false, error: r.error ?? "Snapshot failed" };
  return { ok: true, changed: r.changed };
}

export async function loadSnapshots(host: string) {
  await guardAction("read");
  const rows = await callBackend<
    {
      id: number;
      clientId: number | null;
      hostname: string;
      content: string;
      contentHash: string;
      status: number | null;
      fetchedAt: string;
    }[]
  >("/api/internal/tools/robots-history/list", { body: { host } });
  return rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    hostname: r.hostname,
    content: r.content,
    contentHash: r.contentHash,
    status: r.status,
    fetchedAt: new Date(r.fetchedAt),
  }));
}
