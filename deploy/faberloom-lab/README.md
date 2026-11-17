# Laboratorio de correo FaberLoom

Aislamiento para probar recepción, identidad, borradores, aprobación y conciliación **sin tocar un
buzón real**. Autorizado por instrucción expresa del CEO del 2026-11-16 (`AUTH-2026-11-16-LAB`).

## Qué levanta

| Servicio | Imagen | Puertos (solo loopback) |
|---|---|---|
| `greenmail` | `greenmail/standalone:2.1.0` | 3025 SMTP, 3143 IMAP, 3465 SMTPS, 3993 IMAPS |

Dos cuentas de prueba: `piloto-a@faberloom.test` y `piloto-b@faberloom.test`. Dominio `.test`, que
no resuelve a nadie.

## Por qué es seguro, y qué no promete

- Red propia `faberloom-lab`, separada de producción. Todos los puertos se publican en
  `127.0.0.1`, nunca en `0.0.0.0`.
- **La red no está aislada de internet.** Docker no publica puertos en redes `internal: true`, así
  que se usa un bridge normal. La lista de destinos prohibidos (`egress-policy.json`) es una
  **política declarada, no un control implementado**: hoy ningún código la lee y el contenedor
  tiene egreso normal. Se dice así para no vender un aislamiento que no existe.
- La barrera real de hoy son tres cosas verificables: dominio `.test` que no resuelve, cuentas
  sintéticas y puertos en loopback.
- No usa el Compose de producción, ni su volumen, ni su red, ni sus credenciales.
- No contiene secretos: las cuentas son sintéticas y la contraseña es de laboratorio.

## Dónde corre

Dos instalaciones con el mismo propósito y distinta suerte:

| Dónde | Qué pasa |
|---|---|
| Equipo local | Funciona, pero Docker Desktop se apaga con el proceso que lo lanza y el laboratorio no sobrevive entre llamadas |
| **VPS del CEO** | Es donde corre hoy: `/opt/faberloom-lab`, demonio como servicio, puertos solo en `127.0.0.1` |

El compose del VPS está en `vps/docker-compose.yml` y añade DaMail y PostgreSQL. La diferencia
importante: DaMail exige TLS salvo contra loopback, así que su contenedor comparte el namespace de
red de GreenMail. El motivo y el coste están escritos en `evidence/O1/damail-lab-vps.md`.

## Arrancar y verificar

```sh
docker compose -f deploy/faberloom-lab/docker-compose.yml up -d
docker compose -f deploy/faberloom-lab/docker-compose.yml ps
```

Verificación mínima (sin contenido real):

```sh
# IMAP responde y las dos cuentas existen
python deploy/faberloom-lab/verify.py
```

## Detalle que cuesta descubrir

GreenMail crea la cuenta como `piloto-a@faberloom.test` pero **autentica con la parte local**:
`piloto-a` / `lab-only-a`. Un login con la dirección completa falla. Está así en el servidor de
prueba, no en el producto, y la prueba de identidad debe usar la forma que el servidor acepta.

## Limpiar

```sh
docker compose -f deploy/faberloom-lab/docker-compose.yml down -v
```

`-v` borra los volúmenes. Sin `-v` quedan mensajes de prueba entre corridas, que es justo lo que
arruina una prueba de identidad.

## Prohibiciones

- No se conecta a los buzones del CEO. Ni con credenciales reales ni por reenvío.
- No se copian recursos ni interfaces de DaMail, Spark, Gmail o Roundcube.
- No se escribe en MWT.ONE desde el laboratorio.
- Un mensaje sintético se rotula como tal en el informe; nunca se presenta como tráfico real.
