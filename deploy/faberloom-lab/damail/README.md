# DaMail en el laboratorio

> **Variante superada.** Este compose es el del primer intento local. La instalación que se midió y
> que sigue corriendo es `../vps/docker-compose.yml`, con la imagen fijada por digest y la app
> compartiendo el namespace de GreenMail. Este archivo se conserva como historia del fallo de
> `service_started`, no como el camino a reproducir.

Instalación de DaMail **solo para el laboratorio**, autorizada por `AUTH-2026-11-16-LAB`. No se
conecta a ningún buzón real: habla con GreenMail por la red `faberloom-lab`.

## Qué levanta

| Servicio | Imagen | Puerto |
|---|---|---|
| `db` | `pgvector/pgvector:pg17` | interno |
| `app` | `ghcr.io/gopkg-dev/damail:latest` | `127.0.0.1:8787` |

El `MASTER_KEY` vive en `deploy/faberloom-lab/damail/.env`, que está ignorado por Git. No se
commitea, no se versiona y se regenera con `openssl rand -hex 32`.

## Arrancar

```sh
docker compose -f deploy/faberloom-lab/docker-compose.yml up -d          # GreenMail primero
docker compose -f deploy/faberloom-lab/damail/docker-compose.yml --env-file deploy/faberloom-lab/damail/.env up -d
```

DaMail necesita a GreenMail en marcha porque la cuenta de prueba apunta a `greenmail:3143` (IMAP) y
`greenmail:3025` (SMTP).

## Qué se configura dentro de DaMail

- Una cuenta `piloto-a@faberloom.test` con IMAP `greenmail:3143` sin TLS y SMTP `greenmail:3025`.
- `POLL_INTERVAL_SEC=30` para no esperar cinco minutos en cada prueba.
- `UPDATE_CHECK=false`: el laboratorio no consulta GitHub.
- `ALLOW_PRIVATE_WEBHOOKS=true`: los webhooks van a la red interna, no a internet.

## Prohibiciones

- **No** se conecta a `imap.hostinger.com` ni a los buzones del CEO.
- **No** se usa la interfaz web de DaMail como aprobación de FaberLoom. Aprobar allí es una
  referencia de control, no el diseño.
- **No** se copia código ni recursos de DaMail al producto.
- **No** se reutiliza ninguna sesión web ni cookie como identidad aprobadora.

## Limpiar

```sh
docker compose -f deploy/faberloom-lab/damail/docker-compose.yml down -v
```

`-v` borra PostgreSQL y `app-data`. Sin `-v` quedan cuentas y estados entre corridas, que arruina
las pruebas de identidad.
