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
| 3 | Clients, produits, devis, factures | ⏳ À venir (schéma en place) |
| 4 | Banque, transactions, justificatifs | ⏳ À venir (schéma en place) |
| 5 | Moteur comptable, journaux, TVA, exports | ⏳ À venir (schéma en place) |
| 6 | Stripe et super administration | ⏳ À venir (schéma en place) |
| 7 | Automatisations, IA, intégrations | ⏳ À venir |
| 8 | Durcissement sécurité, optimisation, déploiement | 🔶 Socle en place (Docker, CI, sauvegardes) |

Ce qui fonctionne réellement aujourd'hui : le site vitrine complet (16 pages), l'inscription avec vérification
d'e-mail, la connexion, la double authentification (TOTP + codes de secours), la réinitialisation de mot de passe,
la gestion multi-entreprises avec recherche Sirene, les invitations et rôles, le tableau de bord calculé à partir
de la base, la gestion du compte (sessions, export RGPD) et le formulaire de contact.

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
