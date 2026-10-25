"use server";

import { revalidatePath } from "next/cache";
import { callBackend } from "@/lib/backend";
import { guardAction } from "@/lib/action-guard";

// Task 14.5a: the status updates now live in backend/src/audits.rs; these
// proxies keep the guard, the id validation and the revalidation halves.

type IssueStatus = "new" | "resolved" | "ignored" | "false_positive";

export async function setIssueStatus(
  issueId: number,
  status: IssueStatus,
  auditId: number,
) {
  await guardAction("edit");
  if (!Number.isFinite(issueId) || issueId <= 0) return;
  await callBackend(`/api/internal/audits/issues/${issueId}/status`, {
    body: { status, auditId },
  });
  revalidatePath(`/audits/${auditId}`);
}

export async function setStatusForType(
  auditId: number,
  type: string,
  status: IssueStatus,
) {
  await guardAction("edit");
  if (!Number.isFinite(auditId) || auditId <= 0) return;
  await callBackend(`/api/internal/audits/${auditId}/issues-type`, {
    body: { type, status },
  });
  revalidatePath(`/audits/${auditId}`);
}
