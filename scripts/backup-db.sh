#!/usr/bin/env bash
# =============================================================================
# Sauvegarde chiffrée de la base MySQL.
#
#   BACKUP_PASSPHRASE_FILE=/etc/comptapro/backup.key ./scripts/backup-db.sh
#
# Variables :
#   DATABASE_URL            mysql://utilisateur:motdepasse@hote:port/base   (requis)
#   BACKUP_PASSPHRASE_FILE  fichier contenant la phrase secrète (chmod 600) (requis)
#   BACKUP_DIR              dossier de destination (défaut : ./backups)
#   BACKUP_RETENTION_DAYS   durée de conservation locale en jours (défaut : 30)
#
# Le fichier produit (.sql.gz.enc) est chiffré en AES-256 (PBKDF2). Copiez-le
# ensuite hors du serveur (stockage objet, autre site) : une sauvegarde qui
# reste sur la même machine ne protège pas d'une perte du serveur.
# =============================================================================
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL est requis}"
: "${BACKUP_PASSPHRASE_FILE:?BACKUP_PASSPHRASE_FILE est requis}"
[ -r "$BACKUP_PASSPHRASE_FILE" ] || { echo "Phrase secrète illisible : $BACKUP_PASSPHRASE_FILE" >&2; exit 1; }

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

# Décomposition de l'URL sans jamais afficher le mot de passe.
url="${DATABASE_URL#mysql://}"
credentials="${url%%@*}"
location="${url#*@}"
db_user="${credentials%%:*}"
db_password="${credentials#*:}"
host_port="${location%%/*}"
db_name="${location#*/}"
db_name="${db_name%%\?*}"
db_host="${host_port%%:*}"
db_port="${host_port##*:}"
[ "$db_port" = "$host_port" ] && db_port=3306

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/${db_name}-${timestamp}.sql.gz.enc"

# Le mot de passe passe par un fichier d'options temporaire, pas par la ligne de commande.
defaults_file="$(mktemp)"
trap 'rm -f "$defaults_file"' EXIT
chmod 600 "$defaults_file"
printf '[client]\nuser=%s\npassword=%s\nhost=%s\nport=%s\n' "$db_user" "$db_password" "$db_host" "$db_port" > "$defaults_file"

mysqldump --defaults-extra-file="$defaults_file" \
  --single-transaction --quick --routines --triggers --no-tablespaces \
  --set-gtid-purged=OFF --default-character-set=utf8mb4 "$db_name" \
  | gzip -9 \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$BACKUP_PASSPHRASE_FILE" -out "$target"

chmod 600 "$target"
sha256sum "$target" > "$target.sha256"
find "$BACKUP_DIR" -name '*.sql.gz.enc*' -type f -mtime "+$RETENTION_DAYS" -delete

echo "Sauvegarde chiffrée : $target ($(du -h "$target" | cut -f1))"
