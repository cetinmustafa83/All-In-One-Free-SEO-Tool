import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { audits, auditIssues } from "@/db/schema";
import {
  authenticateRequest,
  jsonError,
  jsonOk,
  requireScope,
} from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const key = await authenticateRequest(req);
  if (!key) return jsonError(401, "Unauthorized");
  if (!requireScope(key, "read")) return jsonError(403, "Read scope required.");

  const { id } = await params;
  const aid = Number(id);
  if (!Number.isFinite(aid)) return jsonError(400, "Invalid audit id");

  const [audit] = await db
    .select()
    .from(audits)
    .where(eq(audits.id, aid))
    .limit(1);
  if (!audit) return jsonError(404, "Audit not found");

  const issues = await db
    .select({
      id: auditIssues.id,
      severity: auditIssues.severity,
      type: auditIssues.type,
      url: auditIssues.url,
      message: auditIssues.message,
      status: auditIssues.status,
      category: auditIssues.category,
      aiGenerated: auditIssues.aiGenerated,
    })
    .from(auditIssues)
    .where(eq(auditIssues.auditId, aid))
    .orderBy(asc(auditIssues.severity));

  const sorted = issues.sort(
    (a, b) =>
      (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9),
  );

  return jsonOk({ audit, issues: sorted, issueCount: sorted.length });
}
