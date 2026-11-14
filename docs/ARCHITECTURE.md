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
│   ├── schema.prisma            Schéma relationnel complet (52 tables)
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
│   │   └── modules/             companies, dashboard, insee, plans, contact, notifications,
│   │                            customers, products, invoicing (devis, factures, PDF, envoi, récurrence)
│   └── proxy.ts                 Premier filtre de l'espace client (redirection sans session)
├── tests/
│   ├── unit/                    Fonctions pures
│   ├── integration/             Services contre MySQL (base _test)
│   └── e2e/                     Playwright sur build de production (base _e2e, SMTP local)
├── docker/, Dockerfile, docker-compose.yml, docker-compose.dev.yml
├── scripts/                     Sauvegarde et restauration chiffrées, tâches quotidiennes (run-jobs.ts)
└── .github/workflows/           CI et déploiement
```

## Modèle de données

Le schéma (`prisma/schema.prisma`) couvre dès maintenant l'ensemble du périmètre fonctionnel afin d'éviter des
refontes lors des phases suivantes. Tables principales :

| Domaine | Tables |
|---|---|
| Identité et accès | `users`, `sessions`, `verification_tokens`, `mfa_recovery_codes`, `roles`, `permissions`, `role_permissions` |
| Entreprises | `companies`, `company_users`, `company_invitations`, `company_logos`, `fiscal_years` |
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

Facturation (toutes sous `/companies/:id`) :

| Ressource | Routes |
|---|---|
| Clients | `GET/POST /customers`, `GET/PATCH /customers/:cid`, `POST /customers/:cid/archive`, `GET /customers/export` |
| Catalogue | `GET/POST /products`, `PATCH /products/:pid`, `POST /products/:pid/archive`, `GET /products/export`, `GET/POST /vat-rates`, `DELETE /vat-rates/:rid` |
| Devis | `GET/POST /quotes`, `GET/PATCH/DELETE /quotes/:qid`, `POST /quotes/:qid/{status,send,convert}`, `GET /quotes/:qid/pdf`, `GET /quotes/export` |
| Factures | `GET/POST /invoices`, `GET/PATCH/DELETE /invoices/:iid`, `POST /invoices/:iid/{issue,send,remind,credit-note}`, `GET /invoices/:iid/pdf`, `POST /invoices/:iid/payments`, `DELETE /invoices/:iid/payments/:pid`, `GET /invoices/export` |
| Récurrence | `GET/POST /recurring-invoices`, `PATCH/DELETE /recurring-invoices/:rid` |
| Paramètres | `GET/PATCH /billing-settings`, `GET/PUT/DELETE /logo` |

## Facturation

Le module `src/server/modules/invoicing` regroupe les devis, les factures, le PDF, l'envoi et la récurrence. Le
calcul des totaux (`src/lib/invoicing.ts`) est un module pur, partagé avec le formulaire pour l'aperçu en direct ;
**le serveur recalcule toujours** et n'utilise jamais un total reçu du navigateur.

| Règle | Mise en œuvre |
|---|---|
| Numérotation chronologique continue | Le numéro est pris à l'émission, dans une transaction qui verrouille le compteur `number_sequences` (une séquence par entreprise, par type et par année). Si l'émission échoue, la transaction rend le numéro : ni trou, ni doublon, y compris en émissions simultanées (testé). |
| Chronologie | Une facture ne peut pas être émise à une date antérieure à celle du dernier document émis de la même séquence, ni à une date future. |
| Intangibilité | Un brouillon se modifie et se supprime librement (il n'a pas de numéro). Une facture émise est verrouillée : l'API répond 409 à toute modification ou suppression. |
| Correction | Par **avoir** uniquement, numéroté dans sa propre séquence et lié à la facture d'origine ; le total des avoirs ne peut pas dépasser celui de la facture. Les avoirs viennent en déduction du reste à encaisser et du chiffre d'affaires. |
| Parties figées | À l'émission, l'identité de l'émetteur et du client est copiée dans la facture (`partiesSnapshot`) : une modification ultérieure des fiches ne change pas les factures émises. |
| Totaux | Total HT d'une ligne arrondi au centime ; remise globale répartie entre les taux de TVA au prorata ; TVA calculée par taux sur la base nette. |
| Acomptes | La facture d'acompte porte une ligne par taux de TVA du devis. La facture finale reprend les lignes du devis et déduit chaque acompte émis par une ligne négative au même taux ; la remise globale ne s'applique qu'aux lignes positives. Acompte + facture finale = montant du devis (testé). |
| Franchise en base | Aucune ligne ne peut porter de TVA ; la mention « TVA non applicable, art. 293 B du CGI » figure sur les documents. |
| Règlements | La facture est verrouillée en base pendant l'enregistrement : deux règlements simultanés ne peuvent pas dépasser le reste dû (testé). |
| Relances | Manuelles depuis la facture, ou automatiques (délais configurables après l'échéance, une relance au plus par jour et par facture). |
| Récurrence | La tâche quotidienne génère les factures échues, datées du jour de génération pour respecter la chronologie ; brouillon, émission ou émission + envoi selon le réglage. |
| Formules | Les factures d'acompte et récurrentes relèvent du module `invoicing-advanced` (Pro et Business) ; les avoirs sont disponibles dans toutes les formules, car ils sont le seul moyen légal de corriger une facture. |

### PDF et facturation électronique

Le rendu passe par une représentation structurée indépendante du format (`document-model.ts` :
émetteur, client, lignes, ventilation de TVA, mentions, conditions de règlement), aujourd'hui convertie en PDF par
PDFKit (`pdf.ts`). Les formats structurés de la réforme (Factur-X, UBL, CII) se brancheront sur ce même modèle, et le
schéma porte déjà les données requises (SIREN du client, nature de l'opération, exigibilité de la TVA, statut de
dépôt). **Le PDF produit aujourd'hui n'est pas une facture électronique au sens de la réforme** : celle-ci exige un
format structuré transmis par une plateforme agréée, à intégrer dans une phase ultérieure.

Le PDF d'une facture émise est régénéré à la demande à partir des données figées (il indique alors les règlements
reçus). L'original, tel qu'émis, est archivé au moment de l'émission dans les documents de l'entreprise
(`invoices.pdfDocumentId`) : il ne peut être ni modifié ni supprimé.

### Tâches quotidiennes

`npm run jobs:daily` (ou `docker compose run --rm jobs`) exécute les factures récurrentes, les relances
automatiques et les purges (sessions, compteurs de débit, fichiers des documents supprimés depuis plus de 30 jours).
À planifier une fois par jour.

## Banque

`src/server/modules/bank/*`. Aucune donnée d'accès bancaire n'est demandée ni conservée.

- **Comptes** (`accounts.ts`) — IBAN chiffré (AES-256-GCM), seuls ses quatre derniers caractères sont affichés.
  Solde = solde d'ouverture + opérations à partir de la date de ce solde.
- **Import de relevés** (`parsers/*`, `imports.ts`) — le format est reconnu au contenu : CSV (séparateur, en-tête
  et colonnes détectés, correspondance confirmée par l'utilisateur), OFX 1.x/2.x, camt.053. Les montants sont lus
  en chaînes décimales, jamais en flottants. L'import se fait en deux temps (aperçu sans écriture, puis import) ;
  le fichier est ré-analysé à l'import et n'est pas conservé.
- **Doublons** (`labels.ts`) — une opération est ignorée si sa référence bancaire (OFX, camt) ou son empreinte
  (date, montant, libellé normalisé, rang d'apparition) existe déjà sur le compte : réimporter un relevé, ou un
  relevé qui recouvre la même période, n'ajoute rien. Une opération de même date et de même montant sous un autre
  libellé est importée et signalée « doublon possible » : l'utilisateur la confirme ou la supprime.
- **Catégories et règles** (`categories.ts`) — catégories communes (plateforme) et propres à l'entreprise ; règles
  « contient / commence par / est exactement », par sens et tranche de montant, évaluées par priorité. Les
  expressions régulières ne sont volontairement pas proposées (risque de déni de service). Une règle ne modifie
  jamais une opération déjà catégorisée ; chaque application est inscrite dans l'historique de l'opération.
- **Statuts** (`status.ts`) — à traiter ; catégorisée ; rapprochée (encaissement entièrement affecté à des factures,
  ou opération catégorisée et appuyée par un justificatif). « Sans justificatif » : décaissement sans pièce, non
  catégorisé ou classé en charges ou en frais de personnel.
- **Rapprochement** (`reconciliation.ts`) — un encaissement est affecté à une ou plusieurs factures (suggestions
  par numéro de facture, montant, nom du client). Chaque affectation crée un règlement lié à l'opération, ou
  reprend un règlement déjà saisi à la main pour ne pas le compter deux fois. L'annulation retire les règlements
  créés par le rapprochement. Le rapprochement des décaissements avec des factures fournisseurs viendra avec le
  module d'achats.
- **Historique** — toute modification d'une opération est tracée dans le journal d'audit (`BankTransaction`). La
  date et le montant d'une opération importée ne sont pas modifiables.
- **Prestataire bancaire** (`provider.ts`) — interface `BankDataProvider` pour un agrégateur agréé (parcours de
  consentement hébergé par le prestataire, référence opaque de connexion). Aucune implémentation n'est raccordée.

## Documents

`src/server/modules/documents/service.ts`, `src/server/storage/`.

- Types acceptés : PDF, JPEG, PNG, vérifiés par la signature du contenu ; 10 Mo par fichier.
- Stockage : pilote `local` (dossier du serveur) ou `s3` (tout stockage compatible), choisi par `STORAGE_DRIVER`.
  Le contenu est chiffré par l'application avant écriture (AES-256-GCM, clé dérivée de `APP_ENCRYPTION_KEY`, clé
  de l'objet authentifiée) : le stockage ne voit jamais les pièces en clair.
- Les fichiers ne sont jamais exposés directement : ils sont servis par l'API après contrôle des droits et de la
  formule, avec le type réel du contenu, `nosniff` et une politique de sécurité dédiée.
- Un même fichier (même empreinte SHA-256) n'est stocké qu'une fois par entreprise.
- Suppression : le document disparaît immédiatement de l'espace de l'entreprise ; son fichier est effacé du
  stockage par la tâche quotidienne après 30 jours.
- OCR : les colonnes sont prévues (`ocrStatus`, `ocrData`, `ocrVerifiedAt`, `suggestedCategory`) mais aucune
  extraction n'est faite à ce stade.

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
- facturation : mentions portées sur les factures et les avoirs, règle de numérotation et de chronologie,
  exigibilité de la TVA retenue par défaut (acomptes : à l'encaissement ; biens : à la facturation ; services : selon
  l'option de l'entreprise), traitement des acomptes sur la facture finale, répartition de la remise globale,
  textes des relances ;
- banque : comptes comptables suggérés par catégorie, calcul de la TVA comprise dans une opération à partir d'un
  taux unique, liste des catégories dispensées de justificatif, durée de conservation des pièces ;
- en phase 5 : plan comptable, FEC et clôture.

## Feuille de route

Chaque phase suit le même déroulé : architecture, fichiers, implémentation réelle, migrations, tests, corrections,
documentation des variables d'environnement, commit.

- **Phase 5** — plan comptable, journaux, écritures, grand livre, balance, immobilisations, clôture, TVA, FEC.
- **Phase 6** — abonnements Stripe (webhooks vérifiés, idempotence) et super administration.
- **Phase 7** — automatisations, assistant IA (suggestions soumises à validation), intégrations.
- **Phase 8** — durcissement (CSP par nonce, tests de charge, supervision), optimisation, mise en production.
