# O3-02C · Toda escritura denegada en el ejecutor

- Contrato: C-FL-04 · Ola O3 · Etapa E1
- Revisión: `9b35cdb12b`
- Alcance: las seis vías que podían escribir, más el cierre del fallo abierto
- Nivel: C1-E (pruebas ejecutadas)
- Estado: **READY_FOR_CEO**
- Gate: PC1, PC2
- Autor: faberloom-implementer · Revisor: pendiente

## 1. Lo que se cerró

| Vía | Antes | Ahora |
|---|---|---|
| Paso `email.send` | Enviaba desde un flujo | **`WRITE_NOT_APPROVED`** antes de tocar un servicio |
| Paso `smtp.send` | Enviaba desde un flujo o rutina | **`WRITE_NOT_APPROVED`** |
| `notify` con `kind: email` | Mandaba un correo al dueño | **Aviso interno persistente** |
| `email.followup` sin respuesta | **Reenviaba** el mensaje | **Aviso interno**; no se reenvía |
| Herramienta del agente `mail.send` | Enviaba con un grant de autonomía | **`WRITE_NOT_APPROVED`**: el agente prepara, la persona envía |
| `mcp.call` sin autoridad | **Fallaba abierto** y ejecutaba | **Falla cerrado**: sin autoridad montada no se ejecuta |
| Envío de un borrador | Mandaba lo guardado sin comparar | Rechaza `DRAFT_CHANGED` si cambió desde que se revisó |

La razón de fondo: en E1 **no existe** todavía el objeto que aprueba un mensaje exacto. Inventar una aprobación falsa habría sido peor que negar. E2 (O6) sustituye cada rechazo por la comprobación real.

**Corrección al cierre original**: la guarda del borrador comparaba la versión solo si el llamador la enviaba, y el panel no la enviaba, así que en la vía real no corría. El gate O3 la conectó de punta a punta y añadió el caso de versión ausente; ver `t10-surfaces.md` §4 y `gate-security-review.md` S-1.

## 2. El censo, otra vez

De nueve vías a **tres archivos** que pueden poner un mensaje en el cable:

| Archivo | Qué es | Control |
|---|---|---|
| `connections/src/index.ts` | El transporte SMTP | No decide; solo envía |
| `effects-mail/src/index.ts` | Adaptador de la Mesa | Solo envía el cuerpo **aprobado** del ítem |
| `view/src/index.ts` | Envío manual desde la pantalla | Lo pide una persona; guarda de versión |

La prueba `effect-census` fija esa lista: si alguien vuelve a introducir un emisor, falla.

## 3. Evidencia ejecutada

```
vitest (access, connections, effects-mail, execution, shares, notices,
        handlers, workflows, tool-faberloom, ui-faberloom)      607 pruebas
tsc --noEmit (connections, handlers, access)                     exit 0
verify-client-ui-i18n                                            0 cadenas fijas
```

| Prueba | Qué demuestra |
|---|---|
| `email.send` rechaza | El paso no envía y nombra `WRITE_NOT_APPROVED` |
| `smtp.send` rechaza | Ningún socket; el envío no ocurre |
| `notify` por correo | Publica un aviso `routine-notice`, no un correo |
| `email.followup` | Aviso al dueño; `resent: false` siempre |
| `mcp.call` sin autoridad | Falla cerrado con el motivo |
| `DRAFT_CHANGED` | Un borrador editado después de revisarlo no se envía |
| Flujo anti-spam e2e | La marca ocurre; el flujo **se detiene** en el envío denegado; cero correos |

## 4. Lo que E1 gana con esto

El resultado de la ola ya es literal: **lectura y preparación funcionan, toda escritura se deniega en el ejecutor.** No es una nota de diseño: es lo que devuelve cada vía al intentarlo.

## 5. Lo que este contrato dejó abierto, y quién lo cerró

| Pendiente al entregar | Cerrado por |
|---|---|
| T10-E1 en las superficies que no son código de producto | `t10-surfaces.md`: shell, HTTP y navegador no están montados; el subagente usa el mismo ejecutor |
| Canarios de secretos en prompts, logs y errores | `custody.md` §2 y `access/tests/canary.spec.ts`; el prompt de un modelo real es de E2 |
| Revisión de seguridad sin hallazgos abiertos | `gate-security-review.md`, con los hallazgos de E2 y del CEO declarados |
| Identidad canónica | `identity.md` (O3-04) |

Lo que sigue fuera de O3: la aprobación del mensaje exacto (O6) y el adaptador `mail.send`, que en E1 no está montado.

## 6. Deuda declarada

`oxlint` mantiene una infracción **previa** en `tool-faberloom/src/index.ts:2877` (aserción innecesaria). El diff de este trabajo no toca esa línea: toca la 208 y la 3411. Se deja para no mezclar limpiezas ajenas.

## 7. Reproducir

```sh
corepack pnpm exec vitest run packages/faberloom/handlers packages/faberloom/workflows packages/faberloom/connections --project thread-safe
corepack pnpm exec vitest run packages/faberloom/access --project thread-safe   # incluye el censo
```
