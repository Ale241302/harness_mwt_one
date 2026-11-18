# O3-03 · Autoenvío, avisos e invitaciones retirados

- Contrato: C-FL-04 · Ola O3 · Etapa E1
- Revisión: `afe9da6cf8`
- Alcance: todo lo que salía por SMTP sin que una persona lo pidiera
- Nivel: C1-E (pruebas ejecutadas)
- Estado: **READY_FOR_CEO**
- Gate: PC1, PC2
- Autor: faberloom-implementer · Revisor: pendiente

## 1. Los tres correos que ya no salen

| Lo que salía | Dónde estaba | Qué lo disparaba | Qué pasa ahora |
|---|---|---|---|
| Borrador de IA enviado solo | `view/src/index.ts` | Política activa y `cleanSends >= threshold` | El borrador **siempre** espera a una persona |
| Aviso de rutina en revisión | `execution/src/index.ts` | Una ejecución agotaba intentos | Aviso interno persistente |
| Invitación al compartir | `shares/src/index.ts` | Crear un grant de Space o flujo | Aviso al dueño con el enlace para reenviar |

La política de racha dejó de leerse. Su registro sigue en el almacén (no se migra ni se borra), pero nada la consulta, y el control que la activaba desapareció de la pantalla: no quedó un interruptor sin efecto.

## 2. El aviso interno

Paquete nuevo `packages/faberloom/notices` (`ctx.faberloomNotices`):

| Operación | Qué hace |
|---|---|
| `publish` | Guarda un aviso del dueño; con `dedupeKey`, reutiliza el no leído en vez de duplicar |
| `list` | Devuelve los avisos del dueño, más nuevos primero |
| `unreadCount` | Cuenta los no leídos |
| `markRead` / `markAllRead` | Marca leído, sin tocar avisos de otro dueño |

Un aviso no se envía: se guarda. Es la diferencia entre enterarse y recibir un correo.

## 3. Evidencia ejecutada

```
vitest notices + execution + shares + effects-mail + access + ui-faberloom   377 pruebas
tsc --noEmit (notices, execution, shares, view, ui-faberloom)                exit 0
verify-client-ui-i18n                                                        0 cadenas fijas
verify-package-dependencies                                                  64 paquetes conformes
```

| Prueba | Qué demuestra |
|---|---|
| `notices` (6) | Persistencia, aislamiento por dueño, marcar leído, deduplicación y dueño obligatorio |
| `execution` (36) | Un aviso por rutina y causa por ventana, cuenta los retenidos, y un fallo del aviso no pierde el caso |
| `shares` (27) | El enlace queda en un aviso al dueño y no se envía correo |
| `effect-census` (3) | El censo queda en **tres archivos** que pueden enviar y `effect-census.spec.ts` los fija |

## 4. Lo que el censo dejó abierto, y cómo se cerró

De las diez rutas del censo original:

- **Retiradas:** autoenvío por racha, aviso de rutina e invitación automática.
- **Cerradas en O3-02C:** pasos de flujo (`email.send`, `smtp.send`), prueba de flujo y herramienta del agente. Rechazan con `WRITE_NOT_APPROVED`; ver `write-denied.md` y `t10-surfaces.md`.
- **Aceptable en diseño:** el adaptador de la Mesa envía solo el cuerpo aprobado, y en E1 no se registra sin autoridad y mediador (`authority-mounted.md`).

## 5. Lo que no se toca

- **La política de racha en el almacén.** Borrarla exigiría migración y no aporta seguridad; lo que importa es que ya no se lee.
- **`connections.emailPolicy`.** Sigue disponible para leer el registro histórico; ninguna ruta de envío lo consulta.
- **El envío manual desde la vista.** Sigue existiendo, porque es una persona la que lo pide. Que mande exactamente la versión revisada es el efecto 8, en O3-02C.

## 6. Deuda declarada

`oxlint` reporta dos infracciones **previas** en archivos que este cambio toca en otras líneas: indentación en `panels.tsx:4958` y una aserción innecesaria en `execution/src/index.ts:502`. El diff de este trabajo no incluye esas líneas. Se dejan como están para no mezclar una limpieza ajena con la entrega; quedan nombradas para que no se descubran después.

## 7. Reproducir

```sh
corepack pnpm exec vitest run packages/faberloom/notices packages/faberloom/execution packages/faberloom/shares --project thread-safe
corepack pnpm exec vitest run packages/faberloom/access --project thread-safe   # incluye el censo
```
