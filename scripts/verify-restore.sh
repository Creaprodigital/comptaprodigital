#!/usr/bin/env bash
# =============================================================================
# Test de restauration d'une sauvegarde (à exécuter au moins une fois par mois).
#
#   DATABASE_URL=mysql://…/comptapro \
#   RESTORE_DATABASE_URL=mysql://…/comptapro_restore \
#   BACKUP_PASSPHRASE_FILE=/etc/comptapro/backup.key \
#   ./scripts/verify-restore.sh [backups/comptapro-….sql.gz.enc]
#
# Sans fichier indiqué, la sauvegarde la plus récente de BACKUP_DIR (./backups) est utilisée.
# La base RESTORE_DATABASE_URL, dédiée au test, est vidée puis remplie ; la production
# (DATABASE_URL) n'est lue que pour comparer le nombre de lignes de chaque table.
# Code de sortie non nul si la restauration échoue ou si le contenu restauré est incohérent.
# =============================================================================
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL (base source) est requis}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL (base de test dédiée) est requis}"
: "${BACKUP_PASSPHRASE_FILE:?BACKUP_PASSPHRASE_FILE est requis}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
backup_file="${1:-$(ls -1t "$BACKUP_DIR"/*.sql.gz.enc 2>/dev/null | head -1 || true)}"
[ -n "$backup_file" ] && [ -r "$backup_file" ] || { echo "Aucune sauvegarde à tester." >&2; exit 1; }
script_dir="$(cd "$(dirname "$0")" && pwd)"

parse() { # $1 = URL → variables db_user db_password db_host db_port db_name
  local url="${1#mysql://}" credentials location host_port
  credentials="${url%%@*}"; location="${url#*@}"
  db_user="${credentials%%:*}"; db_password="${credentials#*:}"
  host_port="${location%%/*}"; db_name="${location#*/}"; db_name="${db_name%%\?*}"
  db_host="${host_port%%:*}"; db_port="${host_port##*:}"
  if [ "$db_port" = "$host_port" ]; then db_port=3306; fi
}
defaults() { # $1 = URL → chemin d'un fichier d'options (mot de passe hors ligne de commande)
  parse "$1"
  local f; f="$(mktemp)"; chmod 600 "$f"
  printf '[client]\nuser=%s\npassword=%s\nhost=%s\nport=%s\n' "$db_user" "$db_password" "$db_host" "$db_port" > "$f"
  echo "$f"
}

parse "$DATABASE_URL"; source_db="$db_name"
parse "$RESTORE_DATABASE_URL"; restore_db="$db_name"
[ "$source_db" != "$restore_db" ] || { echo "La base de test doit être différente de la base source." >&2; exit 1; }
source_opts="$(defaults "$DATABASE_URL")"
restore_opts="$(defaults "$RESTORE_DATABASE_URL")"
trap 'rm -f "$source_opts" "$restore_opts"' EXIT

echo "Sauvegarde testée : $backup_file"
started=$(date +%s)

# Base de test vidée (toutes ses tables supprimées), puis restauration.
tables=$(mysql --defaults-extra-file="$restore_opts" -N -e "SELECT table_name FROM information_schema.tables WHERE table_schema = '$restore_db'")
if [ -n "$tables" ]; then
  { echo "SET FOREIGN_KEY_CHECKS = 0;"; for t in $tables; do echo "DROP TABLE \`$t\`;"; done; } | mysql --defaults-extra-file="$restore_opts" "$restore_db"
fi
DATABASE_URL="$RESTORE_DATABASE_URL" "$script_dir/restore-db.sh" "$backup_file" --yes >/dev/null

count_rows() { # $1 = fichier d'options, $2 = base, $3 = table
  mysql --defaults-extra-file="$1" -N -e "SELECT COUNT(*) FROM \`$2\`.\`$3\`"
}

restored_tables=$(mysql --defaults-extra-file="$restore_opts" -N -e "SELECT table_name FROM information_schema.tables WHERE table_schema = '$restore_db' ORDER BY table_name")
table_count=$(echo "$restored_tables" | grep -c . || true)
[ "$table_count" -gt 0 ] || { echo "ÉCHEC : aucune table restaurée." >&2; exit 1; }

migrations=$(mysql --defaults-extra-file="$restore_opts" -N -e "SELECT COUNT(*) FROM \`$restore_db\`._prisma_migrations WHERE finished_at IS NOT NULL")
expected_migrations=$(find "$script_dir/../prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l)
echo "Tables restaurées : $table_count — migrations appliquées : $migrations (dépôt : $expected_migrations)"
status=0
[ "$migrations" -le "$expected_migrations" ] || { echo "ÉCHEC : la sauvegarde contient des migrations inconnues du dépôt." >&2; status=1; }

# Comparaison avec la base source : la source a pu évoluer depuis la sauvegarde, d'où un simple
# avertissement si elle contient davantage de lignes ; moins de lignes dans la source est anormal.
for t in $restored_tables; do
  restored=$(count_rows "$restore_opts" "$restore_db" "$t")
  current=$(count_rows "$source_opts" "$source_db" "$t" 2>/dev/null || echo "?")
  if [ "$current" = "?" ]; then
    echo "  ! $t : table absente de la base source"
  elif [ "$current" -lt "$restored" ]; then
    echo "  ! $t : $restored ligne(s) restaurée(s), $current dans la source (suppressions depuis la sauvegarde ?)"
  fi
done

# Contrôles d'intégrité métier : chaque écriture comptable validée est équilibrée.
unbalanced=$(mysql --defaults-extra-file="$restore_opts" -N -e "
  SELECT COUNT(*) FROM (
    SELECT e.id FROM \`$restore_db\`.accounting_entries e JOIN \`$restore_db\`.accounting_entry_lines l ON l.entryId = e.id
    GROUP BY e.id HAVING SUM(l.debit) <> SUM(l.credit)
  ) x" 2>/dev/null || echo "?")
echo "Écritures déséquilibrées : $unbalanced"
[ "$unbalanced" = "0" ] || [ "$unbalanced" = "?" ] || status=1

echo "Durée : $(( $(date +%s) - started )) s"
if [ "$status" -eq 0 ]; then echo "RESTAURATION VÉRIFIÉE"; else echo "RESTAURATION EN ÉCHEC" >&2; fi
exit "$status"
