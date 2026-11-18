import { prisma } from "@/server/db";
import { liveAnnouncements } from "@/server/modules/admin/announcements";
import type { AppBanner } from "@/components/app/banners";
import { enforcementActive, isCompanyReadOnly, standingOf } from "./standing";

const day = 24 * 3600 * 1000;
const date = (d: Date) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" }).format(d);

/** Bandeaux à afficher à un utilisateur : annonces, situation de son abonnement, entreprise en lecture seule. */
export async function bannersFor(userId: string, activeCompanyId: string | null): Promise<AppBanner[]> {
  const [announcements, subscription, enforced, readOnly] = await Promise.all([
    liveAnnouncements(),
    prisma.subscription.findUnique({ where: { userId }, select: { status: true, trialEndsAt: true, stripeSubscriptionId: true, cancelAtPeriodEnd: true, currentPeriodEnd: true } }),
    enforcementActive(),
    activeCompanyId ? isCompanyReadOnly(activeCompanyId) : Promise.resolve(false),
  ]);
  const banners: AppBanner[] = announcements.map((a) => ({ kind: "announcement", id: a.id, level: a.level, title: a.title, body: a.body }));
  const action = { label: "Gérer mon abonnement", href: "/app/abonnement" };
  if (subscription) {
    const standing = standingOf(subscription);
    if (standing === "grace") {
      banners.push({ kind: "billing", id: "billing-grace", level: "WARNING", title: "Le dernier paiement de votre abonnement a échoué", body: "Mettez à jour votre moyen de paiement pour éviter que votre compte ne passe en lecture seule.", action });
    } else if (standing === "inactive" && enforced) {
      banners.push({ kind: "billing", id: "billing-inactive", level: "CRITICAL", title: "Votre abonnement n'est pas actif", body: "Vos données restent consultables et exportables. Souscrivez une formule pour pouvoir à nouveau les modifier.", action: { label: "Choisir une formule", href: "/app/abonnement" } });
    } else if (standing === "trial" && subscription.trialEndsAt && !subscription.stripeSubscriptionId && subscription.trialEndsAt.getTime() - Date.now() < 7 * day) {
      banners.push({ kind: "billing", id: "billing-trial", level: "INFO", title: `Votre essai se termine le ${date(subscription.trialEndsAt)}`, body: "Souscrivez dès maintenant : l'essai restant est conservé.", action: { label: "Choisir une formule", href: "/app/abonnement" } });
    } else if (subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd) {
      banners.push({ kind: "billing", id: "billing-canceling", level: "INFO", title: `Votre abonnement prend fin le ${date(subscription.currentPeriodEnd)}`, body: "Vous pouvez le reprendre à tout moment d'ici là.", action });
    }
  }
  // Membre d'une entreprise dont le titulaire n'a plus d'abonnement actif.
  if (readOnly && !banners.some((b) => b.id === "billing-inactive")) {
    banners.push({ kind: "billing", id: "company-read-only", level: "CRITICAL", title: "Cette entreprise est en lecture seule", body: "L'abonnement de son titulaire n'est plus actif : les données restent consultables et exportables, mais ne peuvent plus être modifiées." });
  }
  return banners;
}
