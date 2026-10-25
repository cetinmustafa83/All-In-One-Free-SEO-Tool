"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clients, tasks } from "@/db/schema";
import { currentUserId } from "@/lib/auth";
import { callBackend } from "@/lib/backend";
import { guardAction } from "@/lib/action-guard";

// ---------------------------------------------------------------------------
// Task 14.5a: setTaskStatus, deleteTask, createTask, logTaskTime and the
// three bulk actions are now thin proxies over /api/internal/tasks/* —
// the DB effects (completion attribution, activity-log entries, recurrence
// spawning) live in backend/src/tasks.rs. guardAction stays FIRST and
// revalidation stays here. applyPlaybookToClient, setTaskRecurrence and
// setTaskEstimate are NOT in the 14.5a scope and keep their direct DB code.
// ---------------------------------------------------------------------------

export async function setTaskStatus(
  taskId: number,
  status: "todo" | "in_progress" | "done" | "skipped",
) {
  await guardAction("edit");
  if (!Number.isFinite(taskId) || taskId <= 0) return;

  await callBackend(`/api/internal/tasks/${taskId}/status`, {
    body: {
      status,
      // Who completed it — resolved here, where the session lives.
      userId: status === "done" ? await currentUserId() : null,
    },
  });

  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function deleteTask(taskId: number) {
  await guardAction("edit");
  if (!Number.isFinite(taskId) || taskId <= 0) return;
  await callBackend(`/api/internal/tasks/${taskId}/delete`, { body: {} });
  revalidatePath("/tasks");
  revalidatePath("/");
}

const newTaskSchema = z.object({
  clientId: z.coerce.number().int().positive(),
  title: z.string().trim().min(2).max(200),
  whyItMatters: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  dueInDays: z.coerce.number().int().min(0).max(365).optional(),
  recurringInterval: z
    .enum(["daily", "weekly", "monthly", "quarterly"])
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type CreateTaskResult =
  | { ok: true; id: number }
  | { ok: false; error: string };

export async function createTask(
  _prev: CreateTaskResult | null,
  formData: FormData,
): Promise<CreateTaskResult> {
  await guardAction("edit", formData.get("clientId"));
  const raw = {
    clientId: formData.get("clientId"),
    title: formData.get("title"),
    whyItMatters: formData.get("whyItMatters") ?? undefined,
    priority: formData.get("priority") ?? "medium",
    dueInDays: formData.get("dueInDays") ?? undefined,
    recurringInterval:
      formData.get("recurringInterval") === ""
        ? undefined
        : (formData.get("recurringInterval") ?? undefined),
  };
  // zod stays Next-side so the UI error strings are byte-identical; the
  // Rust endpoint re-validates the same rules for direct callers.
  const parsed = newTaskSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const result = await callBackend<CreateTaskResult>(
    "/api/internal/tasks/create",
    {
      body: { ...parsed.data, userId: await currentUserId() },
    },
  );

  if (result.ok) {
    revalidatePath("/tasks");
    revalidatePath("/");
  }
  return result;
}

export async function setTaskRecurrence(
  taskId: number,
  recurringInterval:
    | "daily"
    | "weekly"
    | "monthly"
    | "quarterly"
    | null,
) {
  await guardAction("edit");
  if (!Number.isFinite(taskId) || taskId <= 0) return;
  await db
    .update(tasks)
    .set({ recurringInterval, updatedAt: new Date() })
    .where(eq(tasks.id, taskId));
  revalidatePath("/tasks");
}

export async function logTaskTime(input: {
  taskId: number;
  /** Minutes to add. Negative subtracts. */
  minutes: number;
}): Promise<{ ok: true; total: number } | { ok: false; error: string }> {
  await guardAction("edit");
  if (!Number.isFinite(input.taskId) || input.taskId <= 0) {
    return { ok: false, error: "Invalid task" };
  }
  if (!Number.isFinite(input.minutes) || input.minutes === 0) {
    return { ok: false, error: "Enter minutes" };
  }
  const result = await callBackend<
    { ok: true; total: number } | { ok: false; error: string }
  >(`/api/internal/tasks/${input.taskId}/time`, {
    body: { minutes: input.minutes },
  });
  if (!result.ok) return result;
  revalidatePath("/tasks");
  revalidatePath("/capacity");
  return result;
}

export async function setTaskEstimate(
  taskId: number,
  estimatedMinutes: number | null,
): Promise<void> {
  await guardAction("edit");
  if (!Number.isFinite(taskId) || taskId <= 0) return;
  const v =
    estimatedMinutes === null || !Number.isFinite(estimatedMinutes)
      ? null
      : Math.max(0, Math.round(estimatedMinutes));
  await db
    .update(tasks)
    .set({ estimatedMinutes: v, updatedAt: new Date() })
    .where(eq(tasks.id, taskId));
  revalidatePath("/tasks");
  revalidatePath("/capacity");
}

// Bulk operations

function validIds(ids: number[]): number[] {
  return ids.filter((id) => Number.isFinite(id) && id > 0);
}

export async function bulkSetTaskStatus(
  ids: number[],
  status: "todo" | "in_progress" | "done" | "skipped",
) {
  await guardAction("edit");
  const valid = validIds(ids);
  if (valid.length === 0) return;
  await callBackend("/api/internal/tasks/bulk-status", {
    body: {
      ids,
      status,
      userId: status === "done" ? await currentUserId() : null,
    },
  });
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function bulkSetTaskPriority(
  ids: number[],
  priority: "high" | "medium" | "low",
) {
  await guardAction("edit");
  const valid = validIds(ids);
  if (valid.length === 0) return;
  await callBackend("/api/internal/tasks/bulk-priority", {
    body: { ids, priority },
  });
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function bulkDeleteTasks(ids: number[]) {
  await guardAction("edit");
  const valid = validIds(ids);
  if (valid.length === 0) return;
  await callBackend("/api/internal/tasks/bulk-delete", { body: { ids } });
  revalidatePath("/tasks");
  revalidatePath("/");
}

import { getPlaybook } from "@/lib/niche-templates";

export async function applyPlaybookToClient(input: {
  playbookId: string;
  clientId: number;
}): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  await guardAction("edit", input?.clientId);
  if (!Number.isFinite(input.clientId) || input.clientId <= 0) {
    return { ok: false, error: "Invalid client" };
  }
  const pb = getPlaybook(input.playbookId);
  if (!pb) return { ok: false, error: "Unknown playbook" };

  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, input.clientId))
    .limit(1);
  if (!client) return { ok: false, error: "Client not found" };

  const now = Date.now();
  const rows = pb.tasks.map((t) => ({
    clientId: input.clientId,
    title: t.title,
    description: t.description,
    whyItMatters: t.whyItMatters,
    priority: t.priority,
    status: "todo" as const,
    dueDate:
      typeof t.offsetDays === "number"
        ? new Date(now + t.offsetDays * 86_400_000)
        : null,
  }));

  await db.insert(tasks).values(rows);
  revalidatePath("/tasks");
  revalidatePath("/");
  return { ok: true, created: rows.length };
}
