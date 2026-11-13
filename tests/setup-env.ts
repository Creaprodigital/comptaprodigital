import "dotenv/config";

/**
 * Environnement des tests : base dédiée (jamais la base de développement),
 * pas de SMTP (les e-mails vont dans la boîte d'envoi en mémoire).
 */
const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL?.replace(/\/([^/?]+)(\?.*)?$/, "/$1_test$2");
if (!baseUrl) throw new Error("DATABASE_URL (ou TEST_DATABASE_URL) est requis pour les tests");

process.env.DATABASE_URL = baseUrl;
process.env.APP_URL = "http://localhost:3000";
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
delete process.env.SMTP_HOST;
delete process.env.INSEE_API_KEY;
