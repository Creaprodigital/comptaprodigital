import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { errors } from "@/server/http/errors";

/**
 * Paramètres globaux de la plateforme, modifiables depuis l'administration.
 * Chaque paramètre est déclaré ici avec son schéma : aucune clé arbitraire ne peut
 * être enregistrée, et une valeur invalide en base retombe sur la valeur par défaut.
 */

export const SETTINGS = {
  "platform.registration_open": {
    group: "Plateforme",
    label: "Inscriptions ouvertes",
    description: "Lorsque les inscriptions sont fermées, aucun nouveau compte ne peut être créé.",
    schema: z.boolean(),
    default: true,
  },
  "billing.enforcement": {
    group: "Abonnements",
    label: "Restriction des comptes sans abonnement actif",
    description: "« auto » : les comptes dont l'essai est terminé ou l'abonnement impayé passent en lecture seule dès que Stripe est configuré. « on » : toujours. « off » : jamais.",
    schema: z.enum(["auto", "on", "off"]),
    default: "auto" as "auto" | "on" | "off",
  },
  "billing.trial_reminder_days": {
    group: "Abonnements",
    label: "Rappel avant la fin de l'essai (jours)",
    description: "Nombre de jours avant la fin de l'essai où le titulaire est prévenu par e-mail.",
    schema: z.number().int().min(1).max(14),
    default: 3,
  },
  "support.email": {
    group: "Support",
    label: "Adresse du support affichée aux clients",
    description: "Laissez vide pour ne pas l'afficher.",
    schema: z.union([z.email(), z.literal("")]),
    default: "",
  },
  "mail.sender_name": {
    group: "E-mails",
    label: "Nom de l'expéditeur",
    description: "Nom affiché devant l'adresse d'envoi (MAIL_FROM). L'adresse elle-même se configure côté serveur, pour rester alignée avec SPF et DKIM.",
    schema: z.string().trim().max(60),
    default: "",
  },
  "mail.reply_to": {
    group: "E-mails",
    label: "Adresse de réponse",
    description: "Adresse utilisée lorsqu'un destinataire répond à un e-mail de la plateforme (hors envois de documents, qui répondent à l'entreprise).",
    schema: z.union([z.email(), z.literal("")]),
    default: "",
  },
  "mail.footer": {
    group: "E-mails",
    label: "Mention en pied des e-mails",
    description: "Texte ajouté à la fin de chaque e-mail (coordonnées de l'éditeur, par exemple).",
    schema: z.string().trim().max(500),
    default: "",
  },
  "admin.access_grant_max_hours": {
    group: "Sécurité",
    label: "Durée maximale d'un accès justifié (heures)",
    description: "Durée maximale pendant laquelle un administrateur peut consulter les données financières d'une entreprise, après justification.",
    schema: z.number().int().min(1).max(72),
    default: 8,
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]["schema"]>;

const CACHE_MS = 30_000;
let cache: { at: number; values: Map<string, unknown> } | null = null;

async function loadAll(): Promise<Map<string, unknown>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.values;
  const rows = await prisma.applicationSetting.findMany({ where: { key: { in: Object.keys(SETTINGS) } } });
  const values = new Map(rows.map((r) => [r.key, r.value as unknown]));
  cache = { at: Date.now(), values };
  return values;
}

export function invalidateSettingsCache() {
  cache = null;
}

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const definition = SETTINGS[key];
  const raw = (await loadAll()).get(key);
  if (raw === undefined) return definition.default as SettingValue<K>;
  const parsed = (definition.schema as z.ZodType).safeParse(raw);
  return (parsed.success ? parsed.data : definition.default) as SettingValue<K>;
}

export async function listSettings() {
  const values = await loadAll();
  return (Object.keys(SETTINGS) as SettingKey[]).map((key) => {
    const definition = SETTINGS[key];
    const raw = values.get(key);
    const parsed = raw === undefined ? null : (definition.schema as z.ZodType).safeParse(raw);
    return { key, group: definition.group, label: definition.label, description: definition.description, value: parsed?.success ? parsed.data : definition.default, isDefault: raw === undefined, kind: typeof definition.default === "boolean" ? "boolean" : typeof definition.default === "number" ? "number" : key === "billing.enforcement" ? "enum" : "text" };
  });
}

export async function updateSetting(key: string, value: unknown, adminId: string): Promise<void> {
  if (!(key in SETTINGS)) throw errors.notFound("Paramètre inconnu.");
  const definition = SETTINGS[key as SettingKey];
  const parsed = (definition.schema as z.ZodType).safeParse(value);
  if (!parsed.success) throw errors.validation([{ path: "value", message: parsed.error.issues[0]?.message ?? "Valeur invalide" }]);
  await prisma.applicationSetting.upsert({
    where: { key },
    create: { key, value: parsed.data as Prisma.InputJsonValue, description: definition.label, updatedById: adminId },
    update: { value: parsed.data as Prisma.InputJsonValue, updatedById: adminId },
  });
  invalidateSettingsCache();
}
