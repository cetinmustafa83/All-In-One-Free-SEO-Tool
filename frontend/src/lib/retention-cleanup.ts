/**
 * Disk + DB retention. Without this, four tables grow without bound:
 *   - serp_screenshots — JPG files on disk; the biggest disk eater
 *   - ai_calls          — token/cost logs; ~1 KB per row
 *   - activity_log      — every user action; ~200 B per row
 *   - system_errors     — captured server-side errors; can spike
 *
 * After enough months on a busy install (multi-client agency, daily
 * audits, hourly rank checks) the data.db can outgrow the disk and
 * the screenshots folder can hit GBs. This module ages out old
 * records on a slow cadence (default once per day) so the install
 * stays small and healthy without the user needing to think about it.
 *
 * Defaults (override via the matching settings):
 *   - retention.screenshots_days = 90 (3 months of SERP screenshots)
 *   - retention.ai_calls_days    = 180 (6 months of usage)
 *   - retention.activity_days    = 180
 *   - retention.errors_days      = 30  (errors are noise after a month)
 *   - retention.cadence_hours    = 24
 *
 * No data tied to billing or reports is touched. Audits and
 * audit_issues are kept forever — they're the historical record
 * users compare against.
 */

import path from "node:path";
import { existsSync, unlinkSync, rmSync, readdirSync, statSync } from "node:fs";
import { lt } from "drizzle-orm";
import { db } from "@/db/client";
import {
  serpScreenshots,
  aiCalls,
  activityLog,
  systemErrors,
} from "@/db/schema";
import { getSetting, setSetting } from "./settings-store";
import { dataDir } from "./data-dir";

const DEFAULTS = {
  screenshotsDays: 90,
  aiCallsDays: 180,
  activityDays: 180,
  errorsDays: 30,
  cadenceHours: 24,
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

let inFlight = false;

type CleanupSummary = {
  screenshotsRows: number;
  screenshotsFiles: number;
  aiCallsRows: number;
  activityRows: number;
  errorRows: number;
};

export async function tickRetentionCleanup(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const enabled = await getSetting<boolean>("retention.enabled");
    // Default ON — users who want forever-history can disable.
    if (enabled === false) return;

    const cadenceHoursRaw = await getSetting<number>("retention.cadence_hours");
    const cadenceMs =
      (typeof cadenceHoursRaw === "number" && cadenceHoursRaw > 0
        ? cadenceHoursRaw
        : DEFAULTS.cadenceHours) * HOUR_MS;

    const lastRun = await getSetting<string>("retention.last_run_at");
    if (lastRun) {
      const last = new Date(lastRun);
      if (Date.now() - last.getTime() < cadenceMs) return;
    }

    const summary = await runCleanup();
    await setSetting("retention.last_run_at", new Date().toISOString());
    await setSetting("retention.last_summary", JSON.stringify(summary));
    await setSetting("retention.last_error", "");
  } catch (err) {
    try {
      await setSetting(
        "retention.last_error",
        (err as Error).message ?? "unknown",
      );
    } catch {
      // best-effort
    }
  } finally {
    inFlight = false;
  }
}

async function runCleanup(): Promise<CleanupSummary> {
  const [
    screenshotsDaysRaw,
    aiCallsDaysRaw,
    activityDaysRaw,
    errorsDaysRaw,
  ] = await Promise.all([
    getSetting<number>("retention.screenshots_days"),
    getSetting<number>("retention.ai_calls_days"),
    getSetting<number>("retention.activity_days"),
    getSetting<number>("retention.errors_days"),
  ]);

  const screenshotsDays = posInt(screenshotsDaysRaw) ?? DEFAULTS.screenshotsDays;
  const aiCallsDays = posInt(aiCallsDaysRaw) ?? DEFAULTS.aiCallsDays;
  const activityDays = posInt(activityDaysRaw) ?? DEFAULTS.activityDays;
  const errorsDays = posInt(errorsDaysRaw) ?? DEFAULTS.errorsDays;

  const summary: CleanupSummary = {
    screenshotsRows: 0,
    screenshotsFiles: 0,
    aiCallsRows: 0,
    activityRows: 0,
    errorRows: 0,
  };

  // 1. Screenshots — delete physical files first, then DB rows. Keep
  //    ordering so a crash mid-cleanup doesn't leave dangling files
  //    we can't find.
  try {
    const cutoff = new Date(Date.now() - screenshotsDays * DAY_MS);
    const stale = await db
      .select({
        id: serpScreenshots.id,
        filePath: serpScreenshots.filePath,
      })
      .from(serpScreenshots)
      .where(lt(serpScreenshots.capturedAt, cutoff));

    for (const s of stale) {
      if (s.filePath && existsSync(s.filePath)) {
        try {
          unlinkSync(s.filePath);
          summary.screenshotsFiles++;
        } catch {
          // best-effort
        }
      }
    }
    if (stale.length > 0) {
      await db
        .delete(serpScreenshots)
        .where(lt(serpScreenshots.capturedAt, cutoff));
      summary.screenshotsRows = stale.length;
    }

    // Sweep orphan empty dirs under <dataDir>/screenshots/<keywordId>/
    pruneEmptyScreenshotDirs();
  } catch {
    // Continue with other cleanups
  }

  // 2. ai_calls older than retention
  try {
    const cutoff = new Date(Date.now() - aiCallsDays * DAY_MS);
    const result = await db.delete(aiCalls).where(lt(aiCalls.createdAt, cutoff));
    // better-sqlite3 doesn't always return changes via Drizzle; we
    // computed-the-deletion-count by selecting first if we needed it.
    // For a tick runner the exact count isn't critical — log "ran".
    summary.aiCallsRows = (result as { changes?: number }).changes ?? 0;
  } catch {
    // continue
  }

  // 3. activity_log
  try {
    const cutoff = new Date(Date.now() - activityDays * DAY_MS);
    const result = await db
      .delete(activityLog)
      .where(lt(activityLog.createdAt, cutoff));
    summary.activityRows = (result as { changes?: number }).changes ?? 0;
  } catch {
    // continue
  }

  // 4. system_errors — age by lastSeenAt (deduped errors keep
  //    accumulating occurrences, so creation date isn't the right
  //    aging signal; "last time we hit this same error" is).
  try {
    const cutoff = new Date(Date.now() - errorsDays * DAY_MS);
    const result = await db
      .delete(systemErrors)
      .where(lt(systemErrors.lastSeenAt, cutoff));
    summary.errorRows = (result as { changes?: number }).changes ?? 0;
  } catch {
    // continue
  }

  return summary;
}

function posInt(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
}

function pruneEmptyScreenshotDirs(): void {
  const root = path.join(dataDir(), "screenshots");
  if (!existsSync(root)) return;
  let dirs: string[] = [];
  try {
    dirs = readdirSync(root);
  } catch {
    return;
  }
  for (const d of dirs) {
    const fp = path.join(root, d);
    try {
      const stat = statSync(fp);
      if (!stat.isDirectory()) continue;
      const inside = readdirSync(fp);
      if (inside.length === 0) {
        rmSync(fp, { recursive: false, force: true });
      }
    } catch {
      // best-effort
    }
  }
}
