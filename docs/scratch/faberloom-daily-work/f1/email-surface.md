# F1-3 · Superficie de correo: estructura común

- Contrato: C-FL-05 · Ola O2 · Etapa F1
- Revisión: `71191a400a`
- Alcance: lista, lectura al lado, propuesta, aprobación completa y entrada desde cero
- Nivel: C1-E (pruebas ejecutadas)
- Estado: **CLOSED** (revision independiente PASS, `reviews/O2-review-round-3.md`)
- Gate: PC2
- Autor: faberloom-architect · Revisor: PASS 2026-11-17 - O2-review-round-3

## 1. Qué se construyó

| Archivo | Qué hace |
|---|---|
| `src/client/email-store.ts` | Estado puro: selección, borrador por mensaje, disposición, panel y composición |
| `src/client/email-layout.tsx` | Superficie: lista, lectura, propuesta, aprobación y entrada desde cero |
| `src/client/email-layout.module.css` | Solo tokens; dos disposiciones sobre el mismo DOM |
| `src/client/locales/email.ts` | Copy en español, con conjugación neutra ("Tienes") |
| `tests/email-layout.client.spec.tsx` | Trece pruebas de comportamiento |

## 2. Las cuatro promesas que una captura no muestra

1. **La lista es un solo tab stop.** `role="listbox"`, flechas para moverse, Enter para abrir, y el elemento activo se anuncia con `aria-activedescendant`.
2. **Escape devuelve el foco.** Al cerrar la lectura vuelve a la fila seleccionada; al cerrar el panel de aprobación vuelve al botón que lo abrió.
3. **El borrador es por mensaje.** Editar uno y cambiar a otro no pierde nada; al volver, el texto sigue ahí y el estado dice "Tienes cambios sin guardar".
4. **El panel de aprobación muestra el sobre completo.** Para, copia, copia oculta, asunto, adjuntos, cuerpo y versión como `vN`. Sin hash, sin nombres internos.

## 3. Decisiones que se ven en el código

| Decisión | Razón |
|---|---|
| Dos disposiciones (`split` y `focus`) sobre el mismo DOM | Un look no puede cambiar estructura; cambiar la disposición es un control del usuario |
| El colapso a una columna ocurre a 900 px | Es reflow probado, no promesa de app móvil |
| Ningún color literal en el CSS | El look pinta; la estructura no tiene paleta |
| El aviso de "falta un destinatario" va en texto y peso, no en color | AS-R25 y A5: nada depende solo del color |
| La propuesta del agente se muestra como bloque, no como tarjeta flotante | Es contenido que se decide, no decoración |
| La entrada desde cero crea un mensaje sintético en la lista | Se puede probar el flujo completo sin tocar el motor |

## 4. Pruebas

```
vitest run packages/client/ui-faberloom/tests/email-layout.client.spec.tsx
Test Files  1 passed (1)
Tests       13 passed (13)
```

Cubren: lista con una opción por mensaje, selección por flechas, apertura con Enter que **mueve el foco al mensaje**, retorno de foco con Escape, **Escape desde la propia lista** cierra la lectura, borrador que sobrevive al cambio de mensaje, panel con el sobre completo y cierre con foco de vuelta, entrada desde cero, y estado vacío.

## 5. Lo que faltaba para PC2

- ~~**O2-04**: los dos looks (`look-a.module.css`, `look-b.module.css`) y `appearance.ts` con persistencia y recuperación del look válido.~~ Hecho: ver `f1/looks.md`.
- ~~**O2-06**: la ventana de iteración movible y redimensionable.~~ Hecho: ver `f1/iteration-window.md`; la superficie la recibe por `iterationSlot`.
- ~~**O2-05**: recorrido en navegador a 1440×900, 1024×768, 390×844 y zoom 200 %, contraste medido, capturas de la misma pantalla en ambos looks y el informe `f1/pc2-look.md`.~~ Hecho: 16 celdas en `f1/captures/matrix.json` y el informe `f1/pc2-look.md`.

## 6. Bloqueo heredado: resuelto

`verify-client-ui-i18n` fallaba por una cadena fija en `src/client/ui/panel-boundary.tsx:63` (`El panel "..." falló`). Se corrigió en el lugar que marca la regla, no con una excepción:

| Cambio | Archivo |
|---|---|
| Clave `panel.failed` en los tres diccionarios (`es`, `en`, `zh`) | `src/client/locales.ts` |
| El límite recibe `failureTitle` ya localizado y deja de escribir copy | `src/client/ui/panel-boundary.tsx` |
| El asiento de locale la resuelve con `{name}` | `src/client/index.ts:596` |

El tipo `Record<FaberloomKey, string>` obliga a que las tres lenguas tengan la clave: si falta una, no compila. Verificado:

```
verify-client-ui-i18n   686 archivos usan copy del locale, 0 cadenas fijas
tsc --noEmit            exit 0
vitest packages/client/ui-faberloom   281 pruebas en 23 archivos
oxlint                  exit 0
```

Queda pendiente otra cosa distinta que F1 tampoco introduce: los tokens de color con valor de reserva en ese mismo archivo, documentados en `f1/token-map.md` §2 y que se resuelven al definir cada look.

## 6-bis. Qué demuestra T12-F1 y qué no

R2-13 lo fija: F1 verifica **selección, borrador local, foco, movimiento y redimensionado, y dos variantes con datos sintéticos** sobre estructura común, y registra qué subresultados demuestra en C1-E. No declara C1-I de persistencia, envío ni actualización.

| Subresultado | Estado en F1 |
|---|---|
| Selección y apertura por teclado | Demostrado: `moves the selection with the arrow keys and opens with Enter` comprueba además que el foco llega al mensaje |
| Borrador local por mensaje, recuperable al cambiar de correo | Demostrado: `keeps a draft per message and reports it as unsaved` |
| Foco devuelto al cerrar lectura y panel | Demostrado: `returns to the list and to the selected row on Escape` y el cierre del panel aprobado |
| Lectura cerrada desde la lista | Demostrado: `closes the reading from the list with Escape` |
| Aprobación con el sobre completo | Demostrado en prototipo: `shows the whole snapshot in the approval panel and closes on Escape` |
| Entrada desde cero | Demostrado: `starts a message from zero and opens it in the reading pane` |
| Mover y redimensionar la ventana flotante | Demostrado en su expediente: `f1/iteration-window.md` |
| Dos variantes sobre estructura común | Demostrado en su expediente: `f1/looks.md` |
| Persistencia, vínculo durable, envío, actualización | **Fuera de F1**: E1, E2 y T14 |

## 7. Cómo se reproduce

```sh
corepack pnpm exec vitest run packages/client/ui-faberloom/tests/email-layout.client.spec.tsx --project thread-safe
corepack pnpm exec tsc --noEmit -p packages/client/ui-faberloom/tsconfig.json
corepack pnpm exec tsx scripts/run-oxlint.ts packages/client/ui-faberloom/src/client/email-layout.tsx
```
