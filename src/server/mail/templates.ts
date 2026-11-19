import { siteConfig } from "@/config/site";
import { env } from "@/server/env";
import type { MailMessage } from "@/server/mail/mailer";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function appUrl(pathname: string): string {
  return new URL(pathname, env().APP_URL).toString();
}

type Layout = {
  to: string;
  subject: string;
  greeting: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footnote?: string;
  replyTo?: string;
  /** Signature du message ; par défaut, l'équipe de la plateforme. */
  signature?: string | null;
};

function render({ to, subject, greeting, paragraphs, action, footnote, replyTo, signature }: Layout): MailMessage {
  const signatureLine = signature === undefined ? `— L'équipe ${siteConfig.name}` : signature;
  const text = [
    greeting,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    ...(action ? [`${action.label} : ${action.url}`, ""] : []),
    ...(footnote ? [footnote, ""] : []),
    ...(signatureLine ? [signatureLine] : []),
  ]
    .join("\n")
    .trimEnd();

  const html = `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:24px;background:#F8FAFC;font-family:Arial,Helvetica,sans-serif;color:#14213D;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:12px;border:1px solid #E2E8F0;">
      <tr><td style="padding:24px 32px;border-bottom:1px solid #E2E8F0;font-size:18px;font-weight:700;color:#14213D;">${escapeHtml(siteConfig.name)}</td></tr>
      <tr><td style="padding:32px;font-size:15px;line-height:1.6;">
        <p style="margin:0 0 16px;">${escapeHtml(greeting).replace(/\n/g, "<br>")}</p>
        ${paragraphs.map((p) => `<p style="margin:0 0 16px;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("\n        ")}
        ${
          action
            ? `<p style="margin:24px 0;"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#2563EB;color:#FFFFFF;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">${escapeHtml(action.label)}</a></p>
        <p style="margin:0 0 16px;font-size:13px;color:#64748B;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>${escapeHtml(action.url)}</p>`
            : ""
        }
        ${footnote ? `<p style="margin:0;font-size:13px;color:#64748B;">${escapeHtml(footnote)}</p>` : ""}
      </td></tr>
    </table>
  </body>
</html>`;

  return { to, subject, text, html, replyTo };
}

const euros = (amount: string) => `${amount.replace(".", ",")} €`;
const longDate = (date: Date) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }).format(date);

export const mailTemplates = {
  accountDeleted(to: string, firstName: string) {
    return render({
      to,
      subject: `Votre compte a été supprimé — ${siteConfig.name}`,
      greeting: `Bonjour ${firstName},`,
      paragraphs: [
        "Comme vous l'avez demandé, votre compte a été supprimé : vos données personnelles ont été effacées ou anonymisées, et vous ne pouvez plus vous connecter.",
        "Les pièces et écritures comptables des entreprises que vous gériez sont conservées pendant la durée légale (dix ans), sans être accessibles, conformément aux obligations de conservation.",
        "Si vous n'êtes pas à l'origine de cette demande, contactez-nous immédiatement en répondant à cet e-mail.",
      ],
    });
  },
  adminTest(to: string) {
    return render({
      to,
      subject: `E-mail de test — ${siteConfig.name}`,
      greeting: "Bonjour,",
      paragraphs: ["Cet e-mail de test a été envoyé depuis l'administration pour vérifier la configuration d'envoi (serveur SMTP, nom d'expéditeur, adresse de réponse et pied de page)."],
    });
  },
  paymentFailed(to: string, firstName: string, amount: string) {
    return render({
      to,
      subject: `Échec du paiement de votre abonnement — ${siteConfig.name}`,
      greeting: `Bonjour ${firstName},`,
      paragraphs: [
        `Le paiement de ${euros(amount)} pour votre abonnement n'a pas pu être effectué.`,
        "Stripe, notre prestataire de paiement, tentera à nouveau le prélèvement dans les prochains jours. Pour éviter toute interruption, vérifiez ou mettez à jour votre moyen de paiement.",
      ],
      action: { label: "Gérer mon abonnement", url: appUrl("/app/abonnement") },
    });
  },
  trialEnding(to: string, firstName: string, planName: string, endsAt: Date) {
    return render({
      to,
      subject: `Votre essai se termine le ${longDate(endsAt)} — ${siteConfig.name}`,
      greeting: `Bonjour ${firstName},`,
      paragraphs: [
        `Votre période d'essai de la formule ${planName} se termine le ${longDate(endsAt)}.`,
        "Pour continuer à utiliser toutes les fonctionnalités, souscrivez votre abonnement. Sans souscription, vos données restent consultables et exportables, mais ne peuvent plus être modifiées.",
      ],
      action: { label: "Choisir mon abonnement", url: appUrl("/app/abonnement") },
    });
  },
  supportReply(to: string, name: string, reference: string, subject: string, message: string, inApp: boolean) {
    return render({
      to,
      subject: `Réponse à votre demande ${reference} — ${siteConfig.name}`,
      greeting: `Bonjour ${name},`,
      paragraphs: [`Notre équipe a répondu à votre demande « ${subject} » :`, message],
      ...(inApp ? { action: { label: "Voir la conversation", url: appUrl("/app/support") } } : {}),
      footnote: inApp ? undefined : "Pour nous répondre, répondez simplement à cet e-mail.",
    });
  },
  adminAccessGranted(to: string, firstName: string, companyName: string, reason: string, expiresAt: Date) {
    return render({
      to,
      subject: `Accès du support aux données de ${companyName} — ${siteConfig.name}`,
      greeting: `Bonjour ${firstName},`,
      paragraphs: [
        `Un administrateur de ${siteConfig.name} a ouvert un accès en lecture aux données de « ${companyName} » jusqu'au ${longDate(expiresAt)} (${expiresAt.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" })}).`,
        `Motif indiqué : ${reason}`,
        "Chaque consultation est journalisée. Vous pouvez révoquer cet accès à tout moment depuis la page Équipe et accès de l'entreprise.",
      ],
      action: { label: "Voir les accès", url: appUrl("/app/entreprise/equipe") },
    });
  },
  verifyEmail(to: string, firstName: string, token: string) {
    return render({
      to,
      subject: `Confirmez votre adresse e-mail — ${siteConfig.name}`,
      greeting: `Bonjour ${firstName},`,
      paragraphs: [
        `Bienvenue sur ${siteConfig.name}. Pour activer votre compte, confirmez votre adresse e-mail.`,
        "Ce lien est valable 24 heures.",
      ],
      action: { label: "Confirmer mon adresse e-mail", url: appUrl(`/verification-email?token=${encodeURIComponent(token)}`) },
      footnote: "Si vous n'êtes pas à l'origine de cette inscription, ignorez simplement ce message.",
    });
  },

  accountAlreadyExists(to: string, firstName: string) {
    return render({
      to,
      subject: `Vous avez déjà un compte — ${siteConfig.name}`,
      greeting: `Bonjour ${firstName},`,
      paragraphs: [
        "Une inscription vient d'être tentée avec votre adresse e-mail, mais un compte existe déjà.",
        "Vous pouvez vous connecter directement ou réinitialiser votre mot de passe si vous l'avez oublié.",
      ],
      action: { label: "Se connecter", url: appUrl("/connexion") },
      footnote: "Si vous n'êtes pas à l'origine de cette tentative, aucune action n'est nécessaire.",
    });
  },

  passwordReset(to: string, firstName: string, token: string) {
    return render({
      to,
      subject: `Réinitialisation de votre mot de passe — ${siteConfig.name}`,
      greeting: `Bonjour ${firstName},`,
      paragraphs: [
        "Vous avez demandé la réinitialisation de votre mot de passe.",
        "Ce lien est valable 60 minutes et ne peut être utilisé qu'une seule fois.",
      ],
      action: { label: "Choisir un nouveau mot de passe", url: appUrl(`/reinitialiser-mot-de-passe?token=${encodeURIComponent(token)}`) },
      footnote: "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.",
    });
  },

  passwordChanged(to: string, firstName: string) {
    return render({
      to,
      subject: `Votre mot de passe a été modifié — ${siteConfig.name}`,
      greeting: `Bonjour ${firstName},`,
      paragraphs: [
        "Le mot de passe de votre compte vient d'être modifié. Vos autres sessions ont été déconnectées.",
        "Si vous n'êtes pas à l'origine de ce changement, réinitialisez immédiatement votre mot de passe et contactez le support.",
      ],
      action: { label: "Réinitialiser mon mot de passe", url: appUrl("/mot-de-passe-oublie") },
    });
  },

  invitation(to: string, inviterName: string, companyName: string, roleName: string, token: string) {
    return render({
      to,
      subject: `${inviterName} vous invite à rejoindre ${companyName} — ${siteConfig.name}`,
      greeting: "Bonjour,",
      paragraphs: [
        `${inviterName} vous invite à rejoindre l'entreprise « ${companyName} » sur ${siteConfig.name}, avec le rôle « ${roleName} ».`,
        "Cette invitation est valable 7 jours.",
      ],
      action: { label: "Voir l'invitation", url: appUrl(`/invitation/${encodeURIComponent(token)}`) },
      footnote: "Si vous ne connaissez pas l'expéditeur, ignorez ce message.",
    });
  },

  /** Envoi d'un devis ou d'une facture : le message est rédigé par l'utilisateur, le PDF est joint. */
  documentEmail(input: { to: string; subject: string; message: string; senderName: string; replyTo?: string | null; cc?: string }) {
    const mail = render({
      to: input.to,
      subject: input.subject,
      greeting: input.message.split(/\n{2,}/)[0],
      paragraphs: input.message.split(/\n{2,}/).slice(1),
      footnote: `Message envoyé par ${input.senderName} via ${siteConfig.name}. Le document est joint à cet e-mail au format PDF.`,
      replyTo: input.replyTo ?? undefined,
      signature: null,
    });
    return { ...mail, cc: input.cc };
  },

  contactNotification(to: string, input: { name: string; email: string; subject: string; message: string; reference: string }) {
    return render({
      to,
      subject: `[Contact ${input.reference}] ${input.subject}`,
      greeting: `Nouveau message de ${input.name} <${input.email}>`,
      paragraphs: input.message.split(/\n{2,}/),
      footnote: `Référence : ${input.reference}`,
      replyTo: input.email,
    });
  },

  contactAcknowledgement(to: string, name: string, reference: string) {
    return render({
      to,
      subject: `Nous avons bien reçu votre message (${reference}) — ${siteConfig.name}`,
      greeting: `Bonjour ${name},`,
      paragraphs: [
        "Votre message nous est bien parvenu. Notre équipe vous répondra dans les meilleurs délais.",
        `Référence de votre demande : ${reference}.`,
      ],
    });
  },
};
