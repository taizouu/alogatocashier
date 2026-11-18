#!/usr/bin/env bash
# Carga en el servidor una copia de la base de datos (p. ej. la de tu PC):
#   /opt/alogato/deploy/restaurar.sh /opt/alogato/respaldo.dump
# ¡Reemplaza los datos que haya en el servidor!
set -euo pipefail
ARCHIVO="${1:?Indica el archivo .dump}"
cd /opt/alogato
set -a; . ./.env; set +a
read -r -p "Esto REEMPLAZA los datos del servidor con $ARCHIVO. ¿Continuar? (si/no) " r
[ "$r" = "si" ] || { echo "Cancelado."; exit 1; }
docker compose stop web
docker compose up -d db
until docker compose exec -T db pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; do sleep 1; done
docker compose exec -T db pg_restore -U "$DB_USER" -d "$DB_NAME" --clean --if-exists --no-owner --no-privileges < "$ARCHIVO" || \
  echo "(Algunos avisos de pg_restore son normales; revisa que no diga 'FATAL')"
docker compose up -d web          # aplica las migraciones que falten
echo "Datos cargados."
