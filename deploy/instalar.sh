#!/usr/bin/env bash
# Instala AloGato Cashier en un servidor Ubuntu nuevo (ejecutar como root, una sola vez):
#   curl -fsSL https://raw.githubusercontent.com/taizouu/alogatocashier/main/deploy/instalar.sh | bash
set -euo pipefail
DIR=/opt/alogato
REPO=https://github.com/taizouu/alogatocashier.git

echo "==> 1/5 Actualizando el sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -y -q
apt-get install -y -q git curl ufw unattended-upgrades openssl
dpkg-reconfigure -f noninteractive unattended-upgrades   # parches de seguridad automáticos
timedatectl set-timezone America/Santiago || true

echo "==> 2/5 Instalando Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

echo "==> 3/5 Firewall: solo SSH (22), http (80) y https (443)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> 4/5 Descargando la caja en $DIR"
if [ ! -d "$DIR/.git" ]; then
  git clone "$REPO" "$DIR"
else
  git -C "$DIR" pull --ff-only
fi
cd "$DIR"
if [ ! -f .env ]; then
  cp deploy/env.ejemplo .env
  sed -i "s|^DJANGO_SECRET_KEY=.*|DJANGO_SECRET_KEY=$(openssl rand -base64 48 | tr -d '\n/+=')|" .env
  sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=$(openssl rand -hex 24)|" .env
  chmod 600 .env
  echo "    Se creó $DIR/.env (completa los datos de Shopify, TUU y OpenFactura)."
fi

echo "==> 5/5 Respaldo diario de la base de datos (03:30, se guardan 14 días)"
chmod +x deploy/*.sh
echo "30 3 * * * root $DIR/deploy/respaldo.sh >> /var/log/alogato-respaldo.log 2>&1" > /etc/cron.d/alogato-respaldo

echo
echo "Listo. Siguientes pasos:"
echo "  1) nano $DIR/.env        (pega tus claves y guarda con Ctrl+O, Enter, Ctrl+X)"
echo "  2) cd $DIR && docker compose up -d --build"
