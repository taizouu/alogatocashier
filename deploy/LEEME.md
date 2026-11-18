# Publicar AloGato Cashier en el servidor (Contabo)

Servidor: Ubuntu 24.04 · IP `195.26.253.138` · dirección pública `https://caja.alogato.cl`

En el servidor corren 3 piezas (con Docker):

| Pieza | Qué hace |
|---|---|
| `db` | Base de datos PostgreSQL (los datos quedan en un volumen; se respaldan cada noche) |
| `web` | Django + gunicorn (la API de la caja) |
| `caddy` | Entrega la pantalla de la caja, reenvía `/api` y `/admin` a Django y obtiene el **https** solo |

## 1. Apuntar el dominio (Shopify)
Shopify → **Configuración → Dominios → alogato.cl → Configuración de DNS → Administrar → Agregar registro personalizado**:

| Tipo | Nombre | Valor |
|---|---|---|
| **A** | `caja` | `195.26.253.138` |

Puede tardar de minutos a unas horas en funcionar.

## 2. Entrar al servidor
En PowerShell de tu PC:
```
ssh root@195.26.253.138
```
La primera vez pregunta si confías en el servidor: escribe `yes`. Luego la contraseña de root que creaste en Contabo (al escribirla no se ve nada; es normal).

## 3. Instalar (una sola vez)
Ya dentro del servidor:
```
curl -fsSL https://raw.githubusercontent.com/taizouu/alogatocashier/main/deploy/instalar.sh | bash
```
Actualiza Ubuntu, instala Docker, activa el firewall, descarga la caja en `/opt/alogato`, crea el `.env` con claves nuevas y programa el respaldo diario.

## 4. Completar el `.env`
```
nano /opt/alogato/.env
```
Copia desde tu `.env` del PC los valores de **Shopify**, **TUU** y **OpenFactura** (y los `TIENDA_*` si los tienes). **No cambies** `DJANGO_SECRET_KEY` ni `DB_PASSWORD` (ya vienen generados).
Guardar: `Ctrl+O`, `Enter`, `Ctrl+X`.

## 5. Encender la caja
```
cd /opt/alogato
docker compose up -d --build
```
La primera vez tarda unos minutos (compila la caja). Ver que todo esté arriba: `docker compose ps`.

## 6. Pasar tus datos del PC al servidor
En **tu PC** (PowerShell), crea la copia de tu base de datos (ajusta el número de versión de PostgreSQL de la ruta):
```
& "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" -U postgres -d alogato_cashier -Fc -f respaldo.dump
scp respaldo.dump root@195.26.253.138:/opt/alogato/respaldo.dump
```
En el **servidor**:
```
/opt/alogato/deploy/restaurar.sh /opt/alogato/respaldo.dump
```
Escribe `si` para confirmar. Tus usuarios, ventas, promociones y compras quedan en el servidor.

> Si prefieres empezar sin datos: `docker compose exec web python manage.py createsuperuser`

## 7. Probar
Abre `https://caja.alogato.cl` en el PC y en el teléfono e inicia sesión.

---

## Uso diario

| Para… | Comando (en el servidor) |
|---|---|
| Publicar cambios después de un merge | `/opt/alogato/deploy/actualizar.sh` |
| Ver errores del servidor | `cd /opt/alogato && docker compose logs --tail 100 web` |
| Reiniciar todo | `cd /opt/alogato && docker compose restart` |
| Respaldo manual | `/opt/alogato/deploy/respaldo.sh` |
| Ver respaldos | `ls -lh /opt/alogato-respaldos` |

Los respaldos quedan en `/opt/alogato-respaldos` (14 días). Para guardar uno en tu PC:
`scp root@195.26.253.138:/opt/alogato-respaldos/NOMBRE.dump .`
