# Laboratorio FaberLoom en el VPS

- Contrato: C-FL-08 · Ola O1 · Etapa F0 (instalación de `O1-02`)
- Revisión: `0b01ca39365ba04fe89858bcac56e3523896ee4d`
- Alcance: GreenMail y DaMail en el servidor del CEO, aislados por puerto y por red
- Nivel: C1-E sobre el laboratorio
- Estado: **CLOSED**
- Gate: `AUTH-2026-11-16-LAB`
- Veredicto: PASS (2026-11-16; revisión independiente, no firma del CEO)
- Autor: faberloom-release · Revisor: sesión independiente (reality-checker), PASS 2026-11-16; historial en `reviews/F0-review-log.md`

## 1. Por qué en el VPS y no en el equipo local

Docker Desktop del equipo del CEO se apaga al terminar el proceso que lo lanza, así que el laboratorio no sobrevive entre una llamada y la siguiente. En el VPS el demonio es un servicio y el laboratorio queda vivo. La decisión la tomó el CEO el 2026-11-16.

## 2. Qué se desplegó

`/opt/faberloom-lab/`, con su propio proyecto de Compose, separado de todo lo demás del servidor:

| Servicio | Imagen | Puerto |
|---|---|---|
| `greenmail` | `greenmail/standalone:2.1.0` | `127.0.0.1:3025/3143/3465/3993` |
| `db` | `pgvector/pgvector:pg17` | interno |
| `app` (DaMail) | `ghcr.io/gopkg-dev/damail@sha256:292f2b0a…` | `127.0.0.1:8787` |
| `faberloom-lab-hook` | `python:3.12-alpine` | interno, para P-11 |

Nada se publica fuera de `127.0.0.1`. El `MASTER_KEY` vive en `/opt/faberloom-lab/damail/.env` (permisos 600) y no está en el repositorio.

## 3. Tres obstáculos reales, con su solución

1. **DaMail exige TLS salvo contra `127.0.0.1`.** Su transporte fuerza `STARTTLS` si el destino no es loopback, y GreenMail no lo ofrece. Solución: la aplicación comparte el namespace de red de GreenMail (`network_mode: "service:greenmail"`), así el destino es loopback de verdad y la conexión sigue sin salir del contenedor. Coste: el puerto 8787 se publica en el servicio de GreenMail porque el namespace es el mismo. Está en el compose, con el motivo escrito.
2. **La base arrancaba antes de aceptar conexiones.** El primer intento murió con `ECONNREFUSED` porque `service_started` no espera a PostgreSQL. Se corrigió con `pg_isready` y `service_healthy`. El fallo queda registrado: el segundo arranque fue limpio.
3. **`latest` no identifica una versión.** P-14 falló primero por eso. La imagen quedó fijada por digest y la sonda volvió a pasar.

## 4. Qué se midió

Catorce sondas en este laboratorio, todas en verde, más P-15 contra la API real de Hostinger. Detalle por sonda en `evidence/O1/FM-O1-02.md` e informe crudo en `evidence/O1/probes-lab-report.json`.

## 5. Límites que no se ocultan

- Es un servidor de prueba en el VPS del CEO, no un entorno aislado de producción. Comparte kernel y disco con los otros contenedores del servidor (52 al inventariar, 56 al cerrar contando los cuatro del laboratorio). Lo separa la red propia, los puertos en loopback y el dominio `.test`.
- `egress-policy.json` sigue siendo política declarada, no control implementado: ningún código la lee. P-12 mide lo que importa en la práctica (cero conexiones TLS salientes) pero no sustituye un cortafuegos.
- El laboratorio no se apaga solo. Queda corriendo en `/opt/faberloom-lab` y se retira con `docker compose -f /opt/faberloom-lab/docker-compose.yml --env-file /opt/faberloom-lab/damail/.env down -v`.

## 6. Reproducir

```sh
cd /opt/faberloom-lab
docker compose --env-file damail/.env up -d
python3 verify.py          # 5/5 del servidor de prueba
python3 probes-core.py     # P-01, P-02, P-03, P-05, P-06, P-07, P-08, P-10
python3 probes-2.py        # P-11
python3 probes-3.py        # P-12
python3 probes-5.py        # P-04, P-09
python3 probes-6.py        # P-06 adjuntos, P-13, P-14
```

Los guiones están copiados en `deploy/faberloom-lab/vps/` para que no dependan del servidor.
