#!/usr/bin/env bash
# Copia de la base de datos en /opt/alogato-respaldos (se borran las de más de 14 días).
set -euo pipefail
cd /opt/alogato
set -a; . ./.env; set +a
DESTINO=/opt/alogato-respaldos
mkdir -p "$DESTINO"
ARCHIVO="$DESTINO/caja-$(date +%F-%H%M).dump"
docker compose exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$ARCHIVO"
find "$DESTINO" -name 'caja-*.dump' -mtime +14 -delete
echo "$(date '+%F %T') respaldo: $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"
