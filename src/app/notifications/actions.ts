"use server";

import { guardAction } from "@/lib/action-guard";
import { callBackend } from "@/lib/backend";

// Task 14.5a: the aggregate (audits complete/failed, per-client score-drop
// detection, monitored-page changes, update available/applied) is computed
// by the Rust backend (backend/src/notifications.rs). This proxy converts
// the wire format's ISO `at` strings back into the Date objects the
// Notification type promises.

export type Notification = {
  id: string; // composite to support multiple sources
  kind:
    | "audit_complete"
    | "audit_failed"
    | "page_change"
    | "score_drop"
    | "update_available"
    | "update_applied";
  level: "success" | "warning" | "error" | "info";
  title: string;
  body: string;
  href: string;
  at: Date;
};

export async function recentNotifications(): Promise<Notification[]> {
  await guardAction("personal");
  const r = await callBackend<{
    notifications: Array<Omit<Notification, "at"> & { at: string }>;
  }>("/api/internal/notifications/recent", { method: "GET" });
  return r.notifications.map((n) => ({ ...n, at: new Date(n.at) }));
}
