# O3-04 · Identidad canónica

- Contrato: C-FL-04 · Ola O3 · Etapa E1
- Revisión: `c7a20b03a1`
- Alcance: identidad de ocurrencia en el correo y determinismo de la identidad en las pruebas
- Nivel: C1-E (pruebas ejecutadas) + C1-L (diagnóstico)
- Estado: **READY_FOR_CEO**
- Gate: PC1, PC2
- Autor: faberloom-implementer · Revisor: pendiente

## 1. El hallazgo que cambia la historia

Los **212 fallos** que el baseline atribuía al producto **no eran del producto**. Eran del entorno de pruebas.

Esta máquina corre el gateway desplegado, que define `FABERLOOM_BOARD_REMOTE=on` con URL, tenant y token. La suite unitaria heredaba esa variable, el board se creía en modo remoto y cada operación consultaba una API central que no estaba levantada. El resultado: `NOT_FOUND` y `NO_ACCESS` en 212 pruebas, con toda la apariencia de un modelo de propiedad roto.

Verificado, no supuesto:

| Corrida | Resultado |
|---|---|
| Con el entorno heredado | 1.485 pasan, 212 fallan |
| Con `FABERLOOM_BOARD_REMOTE` vacía | 330 de 330 en el paquete board |
| Con la variable puesta a propósito, después del arreglo | **1.712–1.713 pasan, 0–1 falla según la red, 1 omitida** |

El aislamiento vive en `scripts/test-invariants.ts`: la lane unitaria borra las cinco variables de activación del despliegue. Un test ya no puede reportar el despliegue en lugar del código.

## 2. El único fallo real del producto en esa lista

`checks-mwt` aprobaba con un actor de identidad simple (`{ id }`), que el board trata como `agent`. PROP-09 exige que una aprobación venga de una persona, y el guard responde `HUMAN_ACTION_REQUIRED`. La prueba estaba desactualizada, no el código: ahora usa `{ id, kind: 'human' }` y las 56 pasan.

No se tocó el guard: se corrigió la prueba para que respete la regla.

## 3. Identidad de correo: lo que faltaba de verdad

El lector IMAP identificaba cada mensaje así:

```
imap:<Message-ID>            (o imap:<conexión>:<uid> sin Message-ID)
cursor: { lastUid }
```

Tres defectos de identidad:

| Defecto | Consecuencia |
|---|---|
| La clave no incluía la cuenta | Dos buzones con el mismo `Message-ID` colapsaban en una ocurrencia |
| El cursor no guardaba `UIDVALIDITY` | Un reindexado del buzón reasigna los UID y el cursor salta correo |
| Sin `Message-ID` se usaba solo el UID | Un UID de otra cuenta o de otra época parecía el mismo mensaje |

Corregido:

| Antes | Ahora |
|---|---|
| `imap:<Message-ID>` | `imap:<cuenta>:<Message-ID>` |
| `imap:<cuenta>:<uid>` | `imap:<cuenta>:<UIDVALIDITY>:<uid>` |
| Cursor `{ lastUid }` | Cursor `{ lastUid, uidValidity }` |
| UIDVALIDITY ignorado | Si cambia, el cursor se descarta y el buzón se relee |

El relectura no duplica efectos: la clave de ocurrencia sigue siendo la misma y el motor de rutinas deduplica por clave. Lo que cambia es que un mensaje ya visto no se pierde por un número que ahora significa otra cosa.

## 4. Evidencia ejecutada

```
vitest packages/faberloom        1.712-1.713 pasan, 0-1 falla de red, 1 omitida (140 archivos)
tsc --noEmit (inbound)           exit 0
```

| Prueba nueva | Qué demuestra |
|---|---|
| `UIDVALIDITY` cambió | El cursor se ignora y el buzón se relee (uid 5 y 25) |
| Mismo `UIDVALIDITY` | El cursor se respeta: solo lo nuevo (uid 25) |
| `uidValidityOf` | Parsea el valor real e ignora un servidor que no lo da |
| Clave de ocurrencia | Específica por cuenta: `imap:<cuenta>:<Message-ID>` |
| `checks-mwt` con humano | PROP-09 sigue en pie y la aprobación procede |

## 4-bis. El único fallo que puede quedar

`mcp-server/tests/oauth.spec.ts` publica revisiones reales y toca un almacén por red. En esta máquina falla de forma intermitente con `ECONNRESET`. No es del producto ni del aislamiento: es una prueba que depende de un servicio externo y así queda registrada en el baseline.

## 5. Lo que O3-04 **no** cierra

- **Dos buzones en lectura simultánea.** El receptor lee una conexión IMAP por dueño. La identidad ya está lista para dos cuentas, pero el ciclo que las recorre es O4-01.
- **Identidad de hilo, propuesta e intento** más allá de lo que ya tiene el board (`threadId`, propuestas e intentos existen y sus pruebas pasan). Enlazarlos al mensaje entrante es O4-03.
- **Carpetas distintas del mismo buzón.** El cursor es por conexión, no por carpeta; hoy se lee una carpeta configurada. Multi-carpeta es O4-02.
- **Migración de cursores antiguos.** El campo nuevo tiene `default(null)`: un cursor viejo se trata como "identidad desconocida" y se relee una vez. No se corrompe nada; se paga una relectura.

## 6. Corrección del registro

`board-failures-diagnosis.md` describía un modelo de propiedad roto. Era falso. Se corrige en el mismo cambio: el documento conserva el hallazgo como diagnóstico equivocado y la evidencia que lo derribó, porque un diagnóstico erróneo también es historia del proyecto.

## 7. Reproducir

```sh
# Aislamiento: con la variable puesta a propósito, la suite sigue verde
FABERLOOM_BOARD_REMOTE=on pnpm exec vitest run packages/faberloom/board --project thread-safe
corepack pnpm exec vitest run packages/faberloom/inbound --project thread-safe
```
