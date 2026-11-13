import type { AuditActorType, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";

export type AuditEvent = {
  action: string;
  userId?: string | null;
  companyId?: string | null;
  actorType?: AuditActorType;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Journal d'audit en ajout seul. Ne jamais y consigner de secret (mot de passe,
 * jeton, code TOTP) : uniquement des identifiants et un contexte minimal.
 */
export async function recordAudit(event: AuditEvent, tx: Prisma.TransactionClient | typeof prisma = prisma): Promise<void> {
  try {
    await tx.auditLog.create({
      data: {
        action: event.action,
        userId: event.userId ?? null,
        companyId: event.companyId ?? null,
        actorType: event.actorType ?? (event.userId ? "USER" : "SYSTEM"),
        entityType: event.entityType,
        entityId: event.entityId,
        metadata: event.metadata,
        ipAddress: event.ip ?? null,
        userAgent: event.userAgent ?? null,
      },
    });
  } catch (error) {
    // L'audit ne doit pas faire échouer l'opération métier, mais l'échec doit être visible.
    console.error("[audit] échec d'écriture", event.action, error);
  }
}
