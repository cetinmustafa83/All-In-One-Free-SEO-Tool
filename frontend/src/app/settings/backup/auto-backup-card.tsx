import { Clock } from "lucide-react";
import { FreshnessBadge } from "@/components/ui/freshness-badge";
import { saveAutoBackupSettings } from "./auto-backup-actions";

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Auto-backup status + controls. Daily snapshot of data.db via
 * SQLite's VACUUM INTO — happens silently in the background as part
 * of the same tick chain that runs the daily agent. Default ON;
 * users on tiny disks can disable + tune retention here.
 *
 * Server component: reads settings, renders the form. Form posts to
 * a server action that updates the settings; the page re-renders
 * with new values via revalidatePath.
 */
export function AutoBackupCard({
  enabled,
  cadenceHours,
  retention,
  lastRunIso,
  lastBytes,
  lastError,
}: {
  enabled: boolean;
  cadenceHours: number;
  retention: number;
  lastRunIso: string | null;
  lastBytes: number | null;
  lastError: string | null;
}) {
  return (
    <section className="glass-apple relative overflow-hidden rounded-2xl p-5 space-y-3">
      <header>
        <h2 className="text-base font-semibold inline-flex items-center gap-2">
          <Clock className="size-4 text-emerald-300" />
          Automatic daily backup
        </h2>
        <p className="text-[11px] text-muted-foreground">
          Quietly takes a consistent snapshot of data.db every {cadenceHours}h
          via SQLite&apos;s online VACUUM. Old backups beyond the retention
          count get pruned. Backups stay on the same disk — for true safety
          also copy them off-site (Syncthing / Dropbox / Restic / Borg).
        </p>
      </header>

      <div className="grid gap-2 sm:grid-cols-3 text-xs">
        <div className="rounded-md bg-white/[0.03] p-2 ring-1 ring-inset ring-white/5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Status
          </p>
          <p className={enabled ? "text-emerald-300" : "text-muted-foreground"}>
            {enabled ? "Enabled" : "Disabled"}
          </p>
        </div>
        <div className="rounded-md bg-white/[0.03] p-2 ring-1 ring-inset ring-white/5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Last run
          </p>
          <div className="flex items-center gap-2">
            <FreshnessBadge capturedAt={lastRunIso} source="Backup" />
            {typeof lastBytes === "number" && lastBytes > 0 && (
              <span className="text-muted-foreground">
                {fmtBytes(lastBytes)}
              </span>
            )}
          </div>
        </div>
        <div className="rounded-md bg-white/[0.03] p-2 ring-1 ring-inset ring-white/5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Retention
          </p>
          <p>{retention} most recent</p>
        </div>
      </div>

      {lastError && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
          <span className="font-semibold">Last backup failed:</span> {lastError}
        </div>
      )}

      <form
        action={saveAutoBackupSettings}
        className="flex flex-wrap items-end gap-3 border-t border-white/[0.06] pt-3"
      >
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={enabled}
            className="size-3.5 rounded border-white/20 bg-white/[0.04]"
          />
          <span>Enabled</span>
        </label>
        <label className="text-xs">
          <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
            Cadence (hours)
          </span>
          <input
            name="cadence_hours"
            type="number"
            min="1"
            max="720"
            defaultValue={cadenceHours}
            className="mt-0.5 h-7 w-20 rounded-md border border-white/10 bg-white/[0.04] px-2 text-foreground"
          />
        </label>
        <label className="text-xs">
          <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
            Keep N most recent
          </span>
          <input
            name="retention"
            type="number"
            min="1"
            max="365"
            defaultValue={retention}
            className="mt-0.5 h-7 w-20 rounded-md border border-white/10 bg-white/[0.04] px-2 text-foreground"
          />
        </label>
        <button
          type="submit"
          className="h-7 rounded-md bg-emerald-500/15 px-3 text-[11px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30 hover:bg-emerald-500/25"
        >
          Save
        </button>
      </form>
    </section>
  );
}
