# ComptaPro Digital

Plateforme SaaS de comptabilité et de gestion pour les indépendants, micro-entrepreneurs, TPE et PME françaises :
site vitrine, espace client sécurisé, tableau de bord financier, et — au fil des phases — facturation, banque,
comptabilité, TVA, documents, abonnements et administration.

> **Avertissement.** ComptaPro Digital est un logiciel de gestion et de tenue comptable. Il ne fournit pas de
> prestation d'expertise comptable. Les mécanismes comptables et fiscaux doivent être validés par un professionnel
> compétent avant toute commercialisation (voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#points-à-faire-valider)).

## État d'avancement

| Phase | Périmètre | État |
|---|---|---|
| 1 | Architecture, base MySQL, authentification, entreprises, rôles | ✅ Livrée |
| 2 | Site vitrine, inscription, tableau de bord | ✅ Livrée |
| 3 | Clients, produits, devis, factures | ✅ Livrée |
| 4 | Banque, transactions, justificatifs | ✅ Livrée |
| 5 | Moteur comptable, journaux, TVA, exports | ✅ Livrée |
| 6 | Stripe et super administration | ✅ Livrée |
| 7 | Automatisations, IA, intégrations | ✅ Livrée (IA et contrôles ; voir les limites ci-dessous) |
| 8 | Durcissement sécurité, optimisation, déploiement | 🔶 Socle en place (Docker, CI, sauvegardes) |

Ce qui fonctionne réellement aujourd'hui :

- **Socle** — site vitrine complet (16 pages), inscription avec vérification d'e-mail, connexion, double
  authentification (TOTP + codes de secours), réinitialisation de mot de passe, gestion multi-entreprises avec
  recherche Sirene, invitations et rôles, compte (sessions, export RGPD), formulaire de contact.
- **Tableau de bord** — indicateurs calculés à partir de la base, filtres de période, alertes.
- **Facturation** — clients, catalogue, taux de TVA, devis (cycle de vie, envoi), factures (brouillon, émission
  numérotée et verrouillée), factures d'acompte, avoirs, factures récurrentes, règlements, PDF avec mentions
  obligatoires, envoi par e-mail, relances manuelles et automatiques, logo et personnalisation, exports CSV.
- **Banque** (formules Pro et Business) — comptes bancaires, import de relevés CSV, OFX et camt.053 avec aperçu,
  détection des doublons, saisie manuelle, recherche et filtres, catégorisation (unitaire ou par sélection),
  règles automatiques, rapprochement des encaissements avec les factures (annulable), suivi des dépenses sans
  justificatif, historique des modifications, export CSV. La synchronisation automatique par un prestataire agréé
  n'est **pas** disponible : seule son interface d'intégration est préparée.
- **Documents** (formules Pro et Business) — ajout de PDF, JPEG et PNG, chiffrés avant stockage (disque local ou
  S3), classement, recherche, association aux opérations, factures et devis, aperçu, téléchargement, historique,
  export ZIP, archivage de l'original de chaque facture émise. La lecture automatique (OCR) n'est pas livrée.
- **Achats** — fournisseurs, factures d'achat (biens ou services, option du fournisseur pour les débits),
  justificatifs, règlement par rapprochement d'un décaissement bancaire, export CSV.
- **Comptabilité** (formules Pro et Business, entreprises au réel) — plan comptable de référence configurable,
  journaux (ventes, achats, banques, caisse, opérations diverses, à-nouveaux), écritures générées automatiquement
  à partir des factures, règlements, achats et opérations bancaires, proposées au brouillard puis validées avec une
  numérotation continue ; saisie manuelle contrôlée ; aucune modification d'une écriture validée (contre-passation
  tracée) ; grand livre, balance, journaux, comptes clients et fournisseurs avec lettrage, rapprochement bancaire,
  immobilisations (plans linéaire et dégressif, dotations, cession), verrouillage des périodes, clôture avec
  à-nouveaux, export FEC et exports CSV.
- **Micro-entreprises** — livre des recettes et registre des achats, exportables.
- **TVA** (formules Pro et Business) — TVA collectée et déductible calculée selon l'exigibilité de chaque opération,
  périodes selon le régime (CA3 mensuelle ou trimestrielle, CA12), préparation de la déclaration avec les repères de
  la CA3, validation, indication du dépôt, crédit reporté, écriture de liquidation, contrôle de concordance avec la
  comptabilité, simulation et acomptes, export. **Aucune télétransmission** : la déclaration se dépose sur l'espace
  professionnel. Les opérations intracommunautaires, l'autoliquidation et le prorata de déduction ne sont pas gérés.
- **Abonnements** — formules Starter, Pro, Business configurables (prix, essai, limites, modules), paiement
  mensuel ou annuel par Stripe Checkout, portail client Stripe, changement de formule au prorata, résiliation en
  fin de période, historique et factures d'abonnement, webhooks signés et idempotents, délai de grâce en cas
  d'impayé puis passage en lecture seule (données toujours consultables et exportables), rappels de fin d'essai.
- **Support** — demandes depuis l'espace client, réponses par e-mail et dans l'application.
- **Super administration** (`/admin`, double authentification obligatoire) — MRR, ARR et encaissements, comptes,
  entreprises, abonnements, formules synchronisées avec Stripe, support, annonces, e-mails, supervision des
  intégrations, erreurs applicatives, journal d'audit exportable, paramètres globaux. Aucun accès implicite aux
  données financières des clients : accès justifié, limité dans le temps, notifié au titulaire, révocable et
  journalisé à chaque consultation.
- **Assistant IA** (formules Pro et Business, API Anthropic, modèle Claude) — activation par l'entreprise avec
  consentement explicite et révocable, quota mensuel par formule, journal d'usage. Lecture des justificatifs
  (fournisseur, numéro, dates, montants, catégorie) contrôlée par le serveur puis **vérifiée par l'utilisateur** avant la
  création éventuelle de la facture d'achat ; suggestions de catégories pour les opérations bancaires, appliquées
  seulement après acceptation ; assistant conversationnel qui explique les indicateurs et retrouve des opérations à
  l'aide d'outils en lecture seule. Sans clé d'API, ces fonctions sont masquées.
- **Contrôles automatiques** (sans IA) — doublons possibles (banque et achats), dépenses sans justificatif, opérations
  non catégorisées, TVA et montants inhabituels, factures clients échues. Ils signalent, ne corrigent rien.

Non livré en phase 7 : la synchronisation bancaire par un prestataire agréé et la transmission des factures
électroniques via une plateforme agréée nécessitent un contrat avec ces prestataires ; seules leurs interfaces
d'intégration sont préparées.

## Pile technique

- **Next.js 16** (App Router, React 19, TypeScript strict) — interface et API REST `/api/v1`
- **Tailwind CSS 4**, composants de style **shadcn/ui** (Radix UI), **Lucide**, **Recharts**
- **Prisma 6** + **MySQL 8** — montants en `DECIMAL`, jamais de flottants
- **Zod** pour la validation, **Argon2id** pour les mots de passe, **TOTP** pour la double authentification
- **Vitest** (unitaires + intégration MySQL) et **Playwright** (bout en bout)
- **Docker**, **GitHub Actions**, reverse proxy **Caddy** (HTTPS automatique)

## Démarrage rapide

Prérequis : Node.js 22, MySQL 8 (ou Docker). Guide pas à pas pour Windows :
[docs/INSTALLATION-WINDOWS.md](docs/INSTALLATION-WINDOWS.md).

```bash
docker compose -f docker-compose.dev.yml up -d     # MySQL + boîte e-mail de test (Mailpit)
```

```bash
cp .env.example .env                               # puis renseigner APP_ENCRYPTION_KEY
```

```bash
npm install
```

```bash
npm run db:deploy                                  # applique les migrations
```

```bash
npm run db:seed:demo                               # référentiel + entreprise de démonstration
```

```bash
npm run dev                                        # http://localhost:3000
```

Compte de démonstration : `demo@comptaprodigital.fr` / `Demo-ComptaPro-2026!` (créé uniquement par `db:seed:demo`).

## Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` / `build` / `start` | Développement, build de production, démarrage |
| `npm run lint` / `typecheck` | ESLint, vérification TypeScript |
| `npm test` | Tests unitaires et d'intégration (base `<nom>_test`) |
| `npm run test:e2e` | Tests de bout en bout sur un build de production (base `<nom>_e2e`) |
| `npm run db:migrate` | Crée et applique une migration (développement) |
| `npm run db:deploy` | Applique les migrations (production, CI) |
| `npm run db:seed` | Données de référence : rôles, permissions, formules, TVA, catégories |
| `npm run db:seed:demo` | Idem + compte et entreprise de démonstration |
| `npm run db:studio` | Explorateur de base Prisma Studio |
| `npm run jobs:daily` | Tâches quotidiennes : factures récurrentes, relances automatiques, purges |

## Documentation

- [Architecture, arborescence et modèle de données](docs/ARCHITECTURE.md)
- [Installation locale sous Windows](docs/INSTALLATION-WINDOWS.md)
- [Déploiement sur un VPS Hostinger](docs/DEPLOIEMENT-HOSTINGER.md)
- [Sécurité, RGPD, sauvegardes et restauration](docs/SECURITE.md)
- Variables d'environnement : [.env.example](.env.example)

## Tests

```bash
npm test
```

```bash
npm run test:e2e
```

Les tests d'intégration et de bout en bout utilisent des bases dédiées dérivées de `DATABASE_URL`
(`comptapro_test`, `comptapro_e2e`) : la base de développement n'est jamais touchée. Les e-mails sont capturés
(mémoire ou serveur SMTP local), aucun envoi réel.
