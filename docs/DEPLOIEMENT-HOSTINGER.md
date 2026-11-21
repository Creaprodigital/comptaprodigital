# Déploiement sur un VPS Hostinger (Ubuntu)

Ce guide décrit une mise en production avec Docker Compose : application, MySQL et reverse proxy Caddy (HTTPS
automatique), puis l'automatisation par GitHub Actions.

> **Statut.** Les fichiers Docker ont été écrits et relus, le build de production autonome et les scripts de
> sauvegarde/restauration ont été exécutés et vérifiés, mais **l'image Docker et le workflow de déploiement n'ont
> pas pu être exécutés dans l'environnement de développement** (pas de démon Docker). Faites un premier déploiement
> sur un VPS de test avant la mise en production.

## 0. Avant de commencer

- VPS **KVM 2** ou supérieur (2 vCPU, 8 Go de RAM conseillés), Ubuntu 24.04 LTS.
- Un nom de domaine dont un enregistrement **A** (ex. `app.votre-domaine.fr`) pointe vers l'adresse IP du VPS.
- Un service SMTP transactionnel (obligatoire en production : vérification d'e-mail, réinitialisation).
- Les mécanismes comptables et fiscaux et les pages légales validés par des professionnels.

## 1. Sécuriser le serveur

Connectez-vous en SSH (`ssh root@IP_DU_VPS`), puis créez un utilisateur de déploiement :

```bash
adduser deploy && usermod -aG sudo deploy
```

```bash
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
```

Désactivez la connexion par mot de passe et celle de root dans `/etc/ssh/sshd_config`
(`PasswordAuthentication no`, `PermitRootLogin no`), puis :

```bash
systemctl restart ssh
```

Pare-feu : seuls SSH, HTTP et HTTPS sont ouverts. MySQL n'est **jamais** exposé.

```bash
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable
```

```bash
apt update && apt upgrade -y && apt install -y unattended-upgrades fail2ban mysql-client
```

## 2. Installer Docker

```bash
curl -fsSL https://get.docker.com | sh
```

```bash
usermod -aG docker deploy
```

Reconnectez-vous ensuite avec l'utilisateur `deploy`.

## 3. Installer l'application

```bash
sudo mkdir -p /opt/comptapro && sudo chown deploy:deploy /opt/comptapro
```

```bash
git clone https://github.com/Creaprodigital/comptaprodigital.git /opt/comptapro && cd /opt/comptapro
```

Créez le fichier `.env` (droits restreints) à partir du modèle :

```bash
cp .env.example .env && chmod 600 .env
```

Valeurs à renseigner **impérativement** :

| Variable | Valeur |
|---|---|
| `APP_URL`, `NEXT_PUBLIC_SITE_URL` | `https://app.votre-domaine.fr` |
| `APP_DOMAIN` | `app.votre-domaine.fr` |
| `APP_ENCRYPTION_KEY` | `openssl rand -base64 32` — **à conserver hors du serveur** : sans elle, les secrets MFA et IBAN sont illisibles |
| `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD` | `openssl rand -base64 24` (deux valeurs différentes) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | paramètres de votre fournisseur SMTP |
| `CONTACT_EMAIL` | boîte qui reçoit les messages du formulaire de contact |
| `NEXT_PUBLIC_LEGAL_*`, `NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_DPO_EMAIL` | informations légales de l'éditeur |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | compte super administrateur (à retirer du fichier après le premier `migrate`) |
| `SEED_DEMO` | `false` |

`DATABASE_URL` est construit automatiquement par `docker-compose.yml` à partir des variables `MYSQL_*`.

## 4. Premier démarrage

```bash
docker compose build
```

```bash
docker compose up -d db
```

```bash
docker compose run --rm migrate
```

```bash
docker compose up -d
```

`migrate` applique les migrations Prisma puis charge les données de référence (rôles, permissions, formules, taux
de TVA). Caddy obtient le certificat Let's Encrypt au premier accès.

Vérifications :

```bash
docker compose ps
```

```bash
curl -s https://app.votre-domaine.fr/api/v1/health
```

La réponse attendue est `{"status":"ok"}`. Créez ensuite un compte de test et vérifiez la réception de l'e-mail de
confirmation.

## 5. Sauvegardes chiffrées

Créez la phrase secrète (à conserver aussi **hors du serveur**) et le fichier de paramètres :

```bash
sudo mkdir -p /etc/comptapro && openssl rand -base64 48 | sudo tee /etc/comptapro/backup.key > /dev/null && sudo chown deploy /etc/comptapro/backup.key && chmod 600 /etc/comptapro/backup.key
```

```bash
cat > /opt/comptapro/backup.env <<'ENV'
DATABASE_URL="mysql://comptapro:MOT_DE_PASSE_MYSQL@127.0.0.1:3306/comptapro"
BACKUP_PASSPHRASE_FILE="/etc/comptapro/backup.key"
BACKUP_DIR="/var/backups/comptapro"
BACKUP_RETENTION_DAYS=30
ENV
chmod 600 /opt/comptapro/backup.env
```

Sauvegarde quotidienne à 2 h 30 (`crontab -e`) :

```cron
30 2 * * * cd /opt/comptapro && set -a && . ./backup.env && set +a && ./scripts/backup-db.sh >> /var/log/comptapro-backup.log 2>&1
```

**Documents.** Avec le stockage local (par défaut), les justificatifs sont dans le volume Docker
`documents_data`, chiffrés. Sauvegardez-le chaque nuit, par exemple à 2 h 45 :

```cron
45 2 * * * docker run --rm -v comptapro_documents_data:/data:ro -v /var/backups/comptapro:/backup alpine tar czf /backup/documents-$(date +\%F).tar.gz -C /data . >> /var/log/comptapro-backup.log 2>&1
```

Le nom exact du volume s'obtient avec `docker volume ls`. Ces fichiers ne sont lisibles qu'avec
`APP_ENCRYPTION_KEY` : conservez cette clé hors du serveur, avec la phrase secrète des sauvegardes. Pour un
stockage objet, renseignez `STORAGE_DRIVER="s3"` et les variables `S3_*` dans `.env`.

Copiez ensuite chaque sauvegarde vers un stockage externe (stockage objet, autre serveur) : une sauvegarde restée
sur le VPS ne protège pas d'une perte du VPS. La procédure de restauration, à tester régulièrement, est décrite dans
[SECURITE.md](SECURITE.md#sauvegardes-et-restauration).

## 6. Tâches quotidiennes

Elles émettent les factures récurrentes, envoient les relances, vérifient que les écritures comptables
automatiques sont à jour (sans jamais modifier une écriture validée) et purgent les données expirées.

Les factures récurrentes et les relances automatiques sont produites par une tâche à lancer une fois par jour
(`crontab -e`, ici à 6 h 15) :

```cron
15 6 * * * cd /opt/comptapro && docker compose run --rm jobs >> /var/log/comptapro-jobs.log 2>&1
```

Sans cette planification, les récurrences ne génèrent aucune facture et aucune relance automatique ne part ; les
relances manuelles restent disponibles depuis chaque facture.

### Abonnements Stripe

1. Dans le tableau de bord Stripe (mode test d'abord), copiez la clé secrète dans `STRIPE_SECRET_KEY`.
2. Créez un point de terminaison webhook vers `https://<APP_DOMAIN>/api/v1/stripe/webhook` avec les événements
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`,
   `invoice.payment_failed`, `invoice.finalized`, `invoice.voided`, `invoice.marked_uncollectible`, puis copiez
   son secret de signature dans `STRIPE_WEBHOOK_SECRET`.
3. Activez le portail client Stripe (changement de moyen de paiement, factures).
4. Redémarrez l'application, puis dans `/admin/formules`, cliquez « Synchroniser avec Stripe » pour chaque formule.
   `/admin/integrations` doit indiquer Stripe opérationnel ; le dernier événement reçu y apparaît.
5. Passez en clés `sk_live_…` et créez le webhook de production une fois les essais concluants.

Sans clé Stripe, les comptes restent en période d'essai : rien n'est facturé ni restreint (`billing.enforcement`
« auto »).

### Synchronisation bancaire (Bridge)

1. Ouvrez un compte sur le tableau de bord Bridge et créez une application (environnement de test d'abord) ;
   copiez ses identifiants dans `BRIDGE_CLIENT_ID` et `BRIDGE_CLIENT_SECRET`.
2. Dans la configuration de l'application Bridge, autorisez le domaine de redirection `https://<APP_DOMAIN>` (le
   retour du parcours se fait sur `/api/v1/bank/bridge/callback`).
3. Créez un webhook vers `https://<APP_DOMAIN>/api/v1/bank/bridge/webhook` avec les événements `item.created`,
   `item.refreshed`, `item.deleted`, `item.account.created`, `item.account.updated`, `item.account.deleted` et
   `user.deleted` ; copiez son secret (affiché une seule fois) dans `BRIDGE_WEBHOOK_SECRET`. Le bouton « Send a
   test » doit recevoir une réponse 200.
4. Redémarrez l'application. Dans une entreprise de test (formule Pro ou Business), Banque > Comptes propose
   « Connecter une banque » : connectez la banque de démonstration de Bridge et vérifiez comptes, soldes et
   opérations.
5. Passez aux identifiants de production une fois les essais concluants, et ajoutez Bridge à la liste des
   sous-traitants (politique de confidentialité).

Sans identifiants Bridge, seul l'import de relevés est proposé.

### Assistant IA (Anthropic)

1. Créez une clé d'API dans la console Anthropic (espace de travail dédié à la production, avec une limite de
   dépenses) et renseignez `ANTHROPIC_API_KEY` dans `.env`. Laissez `ANTHROPIC_BASE_URL` vide.
2. Redémarrez l'application. `/admin/integrations` n'a pas besoin d'appeler l'API : la disponibilité se vérifie en
   activant l'assistant sur une entreprise de test (Paramètres de l'entreprise), puis en lisant un justificatif.
3. Ajustez au besoin le quota mensuel de requêtes par formule dans `/admin/formules`.
4. Mettez à jour la liste des sous-traitants (politique de confidentialité, accord de sous-traitance).

Sans clé, l'assistant est masqué et les contrôles automatiques restent disponibles.

## 7. Mises à jour

Manuellement :

```bash
cd /opt/comptapro && git pull && docker compose build && set -a && . ./backup.env && set +a && ./scripts/backup-db.sh && docker compose run --rm migrate && docker compose up -d
```

Automatiquement avec GitHub Actions (`.github/workflows/deploy.yml`) :

1. Dans GitHub → *Settings → Secrets and variables → Actions*, créez les secrets `VPS_HOST`, `VPS_USER` (`deploy`),
   `VPS_SSH_KEY` (clé privée dédiée au déploiement) et la variable `APP_URL`.
2. Créez l'environnement `production` (*Settings → Environments*) et, si souhaité, imposez une approbation.
3. Sur le VPS, autorisez la lecture des images : `docker login ghcr.io` avec un jeton en lecture seule.
4. Publiez une étiquette (`git tag v0.1.0 && git push origin v0.1.0`) ou lancez le workflow manuellement.

Le workflow construit les images, sauvegarde la base, applique les migrations, redémarre l'application, vérifie
`/api/v1/health`, puis lance le contrôle complet de l'installation (`docker compose run --rm check`).

## 8. Exploitation

| Besoin | Commande |
|---|---|
| Journaux de l'application | `docker compose logs -f --tail 100 app` |
| État des services | `docker compose ps` |
| Redémarrer l'application | `docker compose restart app` |
| Console MySQL | `docker compose exec db mysql -u comptapro -p comptapro` |
| Tâches quotidiennes à la demande | `docker compose run --rm jobs` |
| Contrôle de l'installation | `docker compose run --rm check` |
| Test de restauration | `./scripts/verify-restore.sh` (voir SECURITE.md) |
| Rotation de la clé de chiffrement | voir SECURITE.md, « Rotation de la clé de chiffrement » |

Points d'attention :

- **Reverse proxy obligatoire.** L'application lit l'adresse du client dans `X-Forwarded-For` (limitation de débit,
  audit). Caddy l'écrase avec l'adresse réelle ; n'exposez jamais le port 3000 directement sur Internet.
- **Une seule instance** suffit au démarrage. Les sessions et les compteurs de débit étant en base, plusieurs
  instances peuvent être placées derrière le proxy sans autre changement.
- **Supervision** : surveillez `/api/v1/health`, l'espace disque (`/var/lib/docker`, `/var/backups`) et l'expiration
  du domaine. Les erreurs applicatives, les violations de CSP, les paiements en échec, les demandes de support en
  souffrance et les services en défaut sont envoyés chaque jour par e-mail aux super administrateurs et à l'adresse
  du support (tâche quotidienne), et consultables dans `/admin`.
- **Antivirus** : `docker compose --profile antivirus up -d` et `CLAMAV_HOST="clamav"` dans `.env` ; le premier
  démarrage télécharge les signatures (plusieurs minutes, ≈ 1,5 Go de mémoire).

## 9. Check-list de mise en production

1. Domaine pointé vers le VPS, pare-feu (22, 80, 443), utilisateur `deploy`, connexion SSH par clé uniquement.
2. `.env` complet : `APP_URL` en `https://`, `APP_ENCRYPTION_KEY` générée (`openssl rand -base64 32`) et copiée hors
   du serveur, mots de passe MySQL forts, SMTP (SPF et DKIM du domaine configurés), `SEED_ADMIN_EMAIL`.
3. `docker compose up -d`, `docker compose run --rm migrate`, connexion du super administrateur et activation de sa
   double authentification.
4. Stripe en clés de production, webhook créé, formules synchronisées (`/admin/formules`) ; essai d'un paiement
   réel remboursé.
5. Clé Anthropic (facultatif) ; ClamAV (recommandé si la mémoire le permet).
6. Paramètres globaux (`/admin/parametres`) : adresse du support, nom d'expéditeur, mention de pied de page.
7. Pages légales complétées (`NEXT_PUBLIC_LEGAL_*`) et relues par un juriste ; accord de sous-traitance.
8. Cron : sauvegarde de la base (2 h 30), des documents (2 h 45), tâches quotidiennes (6 h 15) ; copie des
   sauvegardes hors du serveur ; premier `verify-restore.sh` réussi.
9. `docker compose run --rm check` : **aucun point bloquant**.
10. Validation des mécanismes comptables et fiscaux par un professionnel compétent avant commercialisation.
