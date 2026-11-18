import { adminRoute } from "@/server/http/api";
import { exportAuditCsv, listAudit } from "@/server/modules/admin/audit";
import { recordAudit } from "@/server/audit/audit";
import { auditQuery } from "@/lib/schemas/admin";

export const GET = adminRoute<Record<string, never>, undefined, typeof auditQuery>({ query: auditQuery }, async ({ auth, query, meta }) => {
  if (query.format !== "csv") return listAudit(query);
  const csv = await exportAuditCsv(query);
  await recordAudit({ action: "admin.audit_export", userId: auth.user.id, actorType: "SUPER_ADMIN", metadata: { filter: { ...query, format: undefined } }, ...meta });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="journal-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
