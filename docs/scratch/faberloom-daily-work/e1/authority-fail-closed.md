# O3-02A · Autoridad con denegación por defecto y mediador de credenciales

- Contrato: C-FL-04 · Ola O3 · Etapa E1
- Revisión: `0b01ca39365ba04fe89858bcac56e3523896ee4d`
- Alcance: decisión de autoridad y custodia de credenciales para E1
- Nivel: C1-L (código) + C1-E (pruebas ejecutadas)
- Estado: **READY_FOR_CEO**
- Gate: PC1, PC2
- Autor: faberloom-architect · Revisor: pendiente

## 1. Qué se construyó

| Pieza | Archivo | Qué garantiza |
|---|---|---|
| Mediador de credenciales | `packages/faberloom/access/src/credentials.ts` | El secreto se usa dentro de una llamada y no se devuelve nunca |
| Refusos de credencial | `src/refusal.ts` | Cinco códigos estables; los errores no arrastran texto con el secreto |
| Registro del servicio | `src/index.ts` | `ctx.faberloomCredentials`, con su tipo declarado |
| Pruebas | `tests/credentials.spec.ts` | 10 casos, incluidos rotación, revocación y redacción |

La autoridad de decisiones ya era cerrada por defecto: `check()` devuelve `allowed: false` con `NO_GRANT` cuando no hay concesión, y eso lo cubren las 25 pruebas que ya existían. Lo que faltaba era la custodia del secreto, y eso es lo que añade O3-02A.

## 2. Contrato del mediador

| Operación | Qué devuelve | Qué no devuelve |
|---|---|---|
| `put(owner, connection, secret)` | descripción | el secreto |
| `describe(owner, connection)` | `{ connectionId, present, updatedAt, revoked }` | el secreto |
| `list(owner)` | descripciones | secretos |
| `verify(owner, connection, candidate)` | booleano | nada más |
| `withSecret(owner, connection, purpose, run)` | lo que devuelva `run` | el secreto |
| `revoke(owner, connection)` | descripción revocada | el secreto |

Cinco refusos, todos con código estable: `CREDENTIAL_NOT_FOUND`, `CREDENTIAL_REVOKED`, `CREDENTIAL_EMPTY`, `CREDENTIAL_SCOPE_REQUIRED`, `CREDENTIAL_USE_FAILED`.

## 3. Denegación por defecto, en hechos

| Caso | Resultado |
|---|---|
| Conexión inexistente | `CREDENTIAL_NOT_FOUND` antes de abrir socket |
| Conexión de otro dueño | `CREDENTIAL_NOT_FOUND`: no revela que exista |
| Conexión revocada | `CREDENTIAL_REVOKED` |
| Secreto en blanco | `CREDENTIAL_EMPTY` al guardar |
| Dueño o conexión vacíos | `CREDENTIAL_SCOPE_REQUIRED` |
| Error del transporte que cita la clave | `CREDENTIAL_USE_FAILED` con `[redacted]` |

## 4. Rotación y revocación

- Guardar de nuevo **rota**: la clave anterior deja de verificar y la nueva funciona en el mismo alcance. Lo prueba el caso de rotación.
- Revocar **inutiliza**: la siguiente llamada se rechaza con `CREDENTIAL_REVOKED`, sin borrar el registro (queda la fecha y el estado).
- El dueño no cambia: rotar no mueve la credencial a otro alcance.

## 5. Evidencia ejecutada

```
vitest packages/faberloom/access      38 pruebas (25 de autoridad, 3 de censo, 10 de credenciales)
tsc --noEmit                          exit 0
oxlint                                exit 0
```

Las 10 pruebas cubren: denegación por defecto, alcance vacío, secreto vacío, uso con secreto y retorno solo del resultado, descripción sin secreto, aislamiento entre dueños, rotación, revocación, revocar lo inexistente y redacción de un error del transporte, más una comprobación de que no se registra la clave en el log.

## 6. Lo que esta pieza no hace, y hay que decirlo

- **No está montada en las nueve vías.** Eso es O3-02B (composición) y O3-02C (probar cada vía). Hoy el mediador existe y nadie lo llama desde un envío.
- **No cifra en reposo.** Guarda lo que el dominio de almacenamiento proteja; el cifrado es una decisión de despliegue y aquí no se declara.
- **`verify` compara por igualdad, no en tiempo constante.** Es una comprobación de custodia, no un hash de contraseña, y así queda escrito.
- **No aprueba mensajes.** Autoriza el uso de una credencial; la aprobación del contenido exacto es el efecto 8 y depende de O3-03 y O3-04.

## 7. Reproducir

```sh
corepack pnpm exec vitest run packages/faberloom/access --project thread-safe
corepack pnpm exec tsc --noEmit -p packages/faberloom/access/tsconfig.json
```
