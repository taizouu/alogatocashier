#!/usr/bin/env bash
# Publica la última versión de main (después de cada merge):  /opt/alogato/deploy/actualizar.sh
set -euo pipefail
cd /opt/alogato
git pull --ff-only
docker compose up -d --build     # las migraciones se aplican solas al iniciar
docker image prune -f >/dev/null
echo "Caja actualizada."
