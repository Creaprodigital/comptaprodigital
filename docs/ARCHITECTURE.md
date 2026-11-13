# Architecture

## Vue d'ensemble

ComptaPro Digital est un **monolithe modulaire** : une seule application Next.js sert le site vitrine, l'espace
client et l'API REST. Ce choix limite les coûts d'exploitation sur un VPS unique, garde un seul pipeline de
déploiement et n'empêche pas d'extraire plus tard un module (le code métier ne dépend pas de l'interface).

```
Navigateur ──HTTPS──► Caddy (reverse proxy, TLS) ──► Next.js (Node.js)
                                                       ├─ Pages serveur (site vitrine, espace client)
                                                       ├─ API REST  /api/v1/*
                                                       └─ Couche métier  src/server/*
                                                             ├─ Prisma ──► MySQL 8
                                                             ├─ SMTP (e-mails transactionnels)
                                                             ├─ API Sirene (INSEE ou annuaire public)
                                                             └─ à venir : S3, Stripe, agrégateur bancaire
```

### Principes

1. **La logique métier vit dans `src/server/modules/*`**, sans dépendance à HTTP ni à React. Les routes API et les
   pages ne font qu'authentifier, autoriser, valider puis appeler un service. C'est ce qui rend les services
   testables directement contre MySQL.
2. **Toute donnée d'entreprise est cloisonnée.** Chaque table métier porte un `companyId`. Les services passent par
   `authorizeCompany()` (appartenance + permission), qui retourne un client Prisma déjà restreint à l'entreprise
   (`tenantDb`). Un filtre ou une écriture visant une autre entreprise lève une erreur.
3. **Aucun calcul financier en flottant.** Colonnes `DECIMAL`, calculs avec `decimal.js` (`src/lib/money.ts`),
   montants échangés sous forme de chaînes (`"1234.56"`).
4. **Le serveur ne fait jamais confiance au client.** Validation Zod sur chaque entrée, permissions revérifiées à
   chaque appel, l'interface ne fait que masquer ce qui n'est pas autorisé.
5. **Pas de donnée fictive.** Le tableau de bord n'affiche que ce qui est en base ; une entreprise neuve voit des
   zéros. Les données d'exemple n'existent que dans l'entreprise de démonstration créée par `db:seed:demo`.

## Arborescence

```
├── prisma/
│   ├── schema.prisma            Schéma relationnel complet (51 tables)
│   ├── migrations/              Migrations SQL versionnées
│   ├── reference-data.ts        Rôles, permissions, formules, TVA, catégories (idempotent)
│   ├── demo-data.ts             Entreprise de démonstration (optionnelle)
│   └── seed.ts                  Point d'entrée « npm run db:seed »
├── src/
│   ├── app/
│   │   ├── (marketing)/         Site vitrine : accueil, produit, tarifs, solutions, FAQ, blog, contact, légal
│   │   ├── (auth)/              Connexion, inscription, vérification, mot de passe, invitation
│   │   ├── app/                 Espace client protégé (tableau de bord, entreprises, équipe, compte)
│   │   ├── api/v1/              API REST
│   │   ├── layout.tsx, globals.css, sitemap.ts, robots.ts, not-found.tsx
│   ├── components/
│   │   ├── ui/                  Composants de base (style shadcn/ui)
│   │   ├── marketing/           Sections du site vitrine
│   │   ├── auth/                Formulaires d'authentification
│   │   └── app/                 Coque applicative, tableau de bord, formulaires métier
│   ├── config/                  Identité du site, contenus, référentiel juridique et fiscal
│   ├── lib/                     Utilitaires partagés client/serveur (montants, dates, schémas Zod, client API)
│   ├── server/
│   │   ├── auth/                Mots de passe, sessions, MFA, parcours d'authentification, garde-fous de pages
│   │   ├── rbac/                Permissions, rôles, autorisation par entreprise
│   │   ├── tenancy/             Client Prisma cloisonné par entreprise
│   │   ├── http/                Enveloppe des routes API (CSRF, débit, validation, erreurs)
│   │   ├── security/            Chiffrement, jetons, limitation de débit
│   │   ├── audit/, mail/        Journal d'audit, e-mails transactionnels
│   │   └── modules/             companies, dashboard, insee, plans, contact, notifications
│   └── proxy.ts                 Premier filtre de l'espace client (redirection sans session)
├── tests/
│   ├── unit/                    Fonctions pures
│   ├── integration/             Services contre MySQL (base _test)
│   └── e2e/                     Playwright sur build de production (base _e2e, SMTP local)
├── docker/, Dockerfile, docker-compose.yml, docker-compose.dev.yml
├── scripts/                     Sauvegarde et restauration chiffrées
└── .github/workflows/           CI et déploiement
```

## Modèle de données

Le schéma (`prisma/schema.prisma`) couvre dès maintenant l'ensemble du périmètre fonctionnel afin d'éviter des
refontes lors des phases suivantes. Tables principales :

| Domaine | Tables |
|---|---|
| Identité et accès | `users`, `sessions`, `verification_tokens`, `mfa_recovery_codes`, `roles`, `permissions`, `role_permissions` |
| Entreprises | `companies`, `company_users`, `company_invitations`, `fiscal_years` |
| Abonnements | `subscription_plans`, `subscriptions`, `subscription_payments`, `stripe_events` |
| Facturation | `customers`, `suppliers`, `products`, `vat_rates`, `quotes`, `quote_items`, `invoices`, `invoice_items`, `number_sequences`, `recurring_invoices`, `payments`, `purchases` |
| Banque | `bank_accounts`, `bank_transactions`, `bank_imports`, `transaction_categories`, `categorization_rules` |
| Comptabilité | `accounting_accounts`, `accounting_journals`, `accounting_entries`, `accounting_entry_lines`, `fixed_assets`, `fixed_asset_depreciations` |
| TVA | `vat_periods` |
| Documents | `documents`, `document_links` |
| Plateforme | `notifications`, `audit_logs`, `support_tickets`, `support_ticket_messages`, `application_settings`, `system_announcements`, `application_errors`, `admin_data_access_grants`, `ai_suggestions`, `rate_limit_counters` |

Choix structurants déjà inscrits dans le schéma :

- **Factures** : numéro attribué à l'émission via `number_sequences` (compteur sous verrou transactionnel, suite
  continue), statut `DRAFT` → `ISSUED`, instantané des parties, avoir lié à la facture d'origine. Champs prévus pour
  la facturation électronique (catégorie d'opération, exigibilité, format structuré, statut de dépôt sur plateforme
  agréée) : un PDF seul ne répond pas à l'obligation.
- **Écritures comptables** : brouillard (`DRAFT`) puis validation (`VALIDATED`) avec numéro séquentiel par exercice ;
  correction par contre-passation (`reversalOfId`), jamais par modification. Champs alignés sur le FEC (pièce,
  compte auxiliaire, lettrage, validation).
- **Exercices** : verrouillage de période (`lockedThrough`) et clôture.
- **Banque** : empreinte de chaque opération pour la détection des doublons ; aucun identifiant bancaire stocké
  (seul un IBAN chiffré et ses quatre derniers caractères).
- **Super administration** : aucun accès implicite aux données financières ; un accès exceptionnel est porté par
  `admin_data_access_grants` (motif, durée limitée) et journalisé.

## Authentification et autorisation

- **Sessions serveur** : jeton opaque aléatoire (256 bits) dans un cookie `httpOnly`, `SameSite=Lax`, `Secure` et
  préfixe `__Host-` en HTTPS. Seule l'empreinte SHA-256 est stockée : une session est révocable immédiatement.
- **Mots de passe** : Argon2id ; politique à 12 caractères et quatre familles ; verrouillage temporaire après cinq
  échecs ; réponses identiques que le compte existe ou non.
- **Double authentification** : TOTP (RFC 6238), secret chiffré AES-256-GCM, dix codes de secours à usage unique.
  Tant que le second facteur n'est pas validé, la session provisoire n'ouvre aucun droit.
- **RBAC** : rôles `OWNER`, `COMPANY_ADMIN`, `COLLABORATOR`, `READ_ONLY`, `EXTERNAL_ACCOUNTANT` (par entreprise) et
  `SUPER_ADMIN` (plateforme). La matrice par défaut est dans `src/server/rbac/permissions.ts`, synchronisée en base
  par `db:seed` et lue en base à l'exécution.

## API REST

Toutes les routes sont sous `/api/v1` et passent par `publicRoute` / `authRoute` (`src/server/http/api.ts`) :
contrôle d'origine (anti-CSRF), limitation de débit, session, validation Zod, réponses homogènes
`{ "data": … }` ou `{ "error": { "code", "message", "details" } }`.

| Ressource | Routes |
|---|---|
| Authentification | `POST /auth/register`, `/auth/login`, `/auth/mfa`, `/auth/logout`, `/auth/verify-email`, `/auth/resend-verification`, `/auth/forgot-password`, `/auth/reset-password` |
| Compte | `GET/PATCH /me`, `POST /me/password`, `POST /me/mfa/{setup,enable,disable}`, `GET /me/sessions`, `DELETE /me/sessions/:id`, `PUT /me/active-company`, `GET /me/export`, `GET /me/notifications`, `POST /me/notifications/read` |
| Entreprises | `GET/POST /companies`, `GET/PATCH /companies/:id`, `GET /companies/:id/dashboard` |
| Membres | `GET /companies/:id/members`, `PATCH/DELETE /companies/:id/members/:memberId`, `POST /companies/:id/invitations`, `DELETE /companies/:id/invitations/:invitationId`, `GET /invitations/:token`, `POST /invitations/:token/accept` |
| Divers | `GET /company-search?q=`, `GET /plans`, `POST /contact`, `GET /health` |

## Rendu et cache (Next.js 16)

Le projet utilise **Cache Components** : rien n'est mis en cache sans directive explicite. Le site vitrine est
prérendu ; tout ce qui dépend de la session ou de la base est rendu à la requête derrière une frontière
`<Suspense>` (un `loading.tsx` par page de l'espace client). Aucune donnée financière n'est mise en cache.

## Définitions des indicateurs du tableau de bord

Implémentées dans `src/server/modules/dashboard/service.ts` et vérifiées au centime par
`tests/integration/dashboard.test.ts`.

| Indicateur | Définition |
|---|---|
| Chiffre d'affaires | Total HT des factures émises (hors brouillons et annulées) à leur date d'émission, avoirs déduits |
| Dépenses | Achats saisis (HT) + décaissements bancaires non rattachés à un achat, hors virements internes et impôts, nets de TVA si renseignée |
| Résultat estimé | Chiffre d'affaires − dépenses de la période (avant impôts, amortissements et écritures d'inventaire) |
| TVA estimée | TVA collectée (à la facturation ou au prorata des encaissements selon l'exigibilité de chaque facture) − TVA déductible saisie |
| Solde bancaire | Soldes d'ouverture + mouvements des comptes actifs |
| Trésorerie disponible | Solde bancaire − TVA estimée de la période de déclaration en cours − factures fournisseurs à payer |
| Impayées / en retard | Reste à encaisser TTC des factures émises ; en retard si l'échéance est dépassée |

## Points à faire valider

À soumettre à un expert-comptable ou à un fiscaliste avant commercialisation :

- combinaisons forme juridique / régime fiscal proposées (`src/config/legal.ts`) ;
- définitions des indicateurs ci-dessus, en particulier l'estimation de TVA (avoirs, acomptes, opérations
  particulières) et la notion de dépenses ;
- rappels d'échéances de TVA (`vat-deadlines.ts`) : fenêtres légales indicatives, pas de date opposable ;
- contenus des pages légales et des articles de blog ;
- à partir de la phase 3 : mentions de facture, numérotation, et, en phase 5, plan comptable, FEC et clôture.

## Feuille de route

Chaque phase suit le même déroulé : architecture, fichiers, implémentation réelle, migrations, tests, corrections,
documentation des variables d'environnement, commit.

- **Phase 3** — clients, catalogue, devis, factures (acomptes, avoirs, récurrence), PDF, envoi, règlements, relances.
- **Phase 4** — comptes bancaires, imports CSV/OFX/CAMT, catégorisation et règles, rapprochement, justificatifs (S3).
- **Phase 5** — plan comptable, journaux, écritures, grand livre, balance, immobilisations, clôture, TVA, FEC.
- **Phase 6** — abonnements Stripe (webhooks vérifiés, idempotence) et super administration.
- **Phase 7** — automatisations, assistant IA (suggestions soumises à validation), intégrations.
- **Phase 8** — durcissement (CSP par nonce, tests de charge, supervision), optimisation, mise en production.
