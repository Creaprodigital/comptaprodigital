import { adminRoute } from "@/server/http/api";
import { sendMail } from "@/server/mail/mailer";
import { mailTemplates } from "@/server/mail/templates";
import { recordAudit } from "@/server/audit/audit";
import { AppError } from "@/server/http/errors";
import { testEmailSchema } from "@/lib/schemas/admin";
import { RATE_LIMITS } from "@/server/security/rate-limit";

export const POST = adminRoute<Record<string, never>, typeof testEmailSchema>({ body: testEmailSchema, rateLimit: RATE_LIMITS.contact }, async ({ auth, body, meta }) => {
  try {
    await sendMail(mailTemplates.adminTest(body.to));
  } catch (error) {
    throw new AppError(502, "MAIL_FAILED", `Envoi impossible : ${error instanceof Error ? error.message.slice(0, 200) : "erreur inconnue"}`);
  }
  await recordAudit({ action: "admin.mail_test", userId: auth.user.id, actorType: "SUPER_ADMIN", metadata: { to: body.to }, ...meta });
  return { sent: true };
});
