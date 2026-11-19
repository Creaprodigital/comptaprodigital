#!/usr/bin/env bash
# =============================================================================
# Restauration d'une sauvegarde chiffrée produite par backup-db.sh.
#
#   DATABASE_URL=mysql://… BACKUP_PASSPHRASE_FILE=… ./scripts/restore-db.sh backups/base-….sql.gz.enc
#
# ⚠️ Le contenu de la base ciblée par DATABASE_URL est REMPLACÉ. Pour un test
# de restauration, ciblez une base vide dédiée (ex. comptapro_restore).
# Ajoutez --yes pour ne pas avoir à confirmer (tâches automatisées).
# =============================================================================
set -euo pipefail

backup_file="${1:-}"
confirm="${2:-}"
[ -n "$backup_file" ] && [ -r "$backup_file" ] || { echo "Usage : $0 <fichier.sql.gz.enc> [--yes]" >&2; exit 1; }
: "${DATABASE_URL:?DATABASE_URL est requis}"
: "${BACKUP_PASSPHRASE_FILE:?BACKUP_PASSPHRASE_FILE est requis}"

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

if [ -r "$backup_file.sha256" ]; then
  (cd "$(dirname "$backup_file")" && sha256sum --check --quiet "$(basename "$backup_file").sha256") \
    || { echo "Somme de contrôle invalide : sauvegarde corrompue." >&2; exit 1; }
fi

if [ "$confirm" != "--yes" ]; then
  read -r -p "Remplacer le contenu de la base « $db_name » sur $db_host ? (oui/non) " answer
  [ "$answer" = "oui" ] || { echo "Restauration annulée."; exit 1; }
fi

defaults_file="$(mktemp)"
trap 'rm -f "$defaults_file"' EXIT
chmod 600 "$defaults_file"
printf '[client]\nuser=%s\npassword=%s\nhost=%s\nport=%s\n' "$db_user" "$db_password" "$db_host" "$db_port" > "$defaults_file"

# Première passe sans rien importer : déchiffrement et contrôle d'intégrité gzip (CRC) du flux
# complet. Une sauvegarde altérée est ainsi refusée avant toute écriture dans la base.
if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$BACKUP_PASSPHRASE_FILE" -in "$backup_file" 2>/dev/null | gzip -t 2>/dev/null; then
  echo "Sauvegarde illisible ou altérée (phrase secrète incorrecte ou fichier corrompu) : rien n'a été importé." >&2
  exit 1
fi

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$BACKUP_PASSPHRASE_FILE" -in "$backup_file" \
  | gunzip \
  | mysql --defaults-extra-file="$defaults_file" --default-character-set=utf8mb4 "$db_name"

echo "Restauration terminée dans « $db_name »."
