# PC2 · Entrega de apariencia de F1

- Contrato: C-FL-05 · Ola O2 · Etapa F1
- Revisión: `71191a400a` (código, capturas y expedientes medidos); las notas de cierre se añaden después sin cambiar lo medido
- Alcance: dos looks sobre la estructura común, verificados en navegador
- Nivel: **C1-E**
- Estado: **CLOSED** (decisión delegada el 2026-11-17)
- Gate: **PC2**
- Autor: faberloom-qa · Revisor: pendiente

PC2 no cierra T13 global, T12 global ni seguridad integrada. Cierra la elección estética de F1 sobre un prototipo ejecutado.

## 1. Qué se ejecutó

Prototipo construido desde el código real, no una maqueta: `apps/web/prototype/f1/` monta `EmailLayout` y `TaskChatWindow` con datos sintéticos rotulados, sobre las paletas de producto.

```sh
# construir
cd apps/web && pnpm exec vite build --config prototype/f1/vite.config.ts
# verificar
pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/appearance-compare.e2e.ts
```

Resultado: **8 de 8 en verde**, contra Chromium real, sirviendo el build por HTTP.

## 2. Tamaños y temas

La matriz completa son 16 celdas: cuatro combinaciones de look y tema por cuatro vistas. Cada celda tiene su captura `f1/captures/<look>-<tema>-<vista>.png` y su fila en `f1/captures/matrix.json`, escrita por la misma corrida que la captura.

| Combinación | 1440×900 | 1024×768 | 390×844 | Zoom 200 % |
|---|---|---|---|---|
| A · Papel, claro | captura | captura | captura | captura |
| A · Papel, oscuro | captura | captura | captura | captura |
| B · Pizarra, claro | captura | captura | captura | captura |
| B · Pizarra, oscuro | captura | captura | captura | captura |

En las 16 celdas la corrida comprueba, no supone: contenido idéntico (`Proforma 2026-014`), cero desbordamiento horizontal, botones de al menos 44 px en la vista de 390 y consola sin errores desde el primer byte. El zoom se mide en un viewport de 720×450 con `zoom: 2`, que es el caso que rompe una barra de herramientas que no envuelve. Sin desbordamiento horizontal en 390 px ni con zoom al 200 %. La ventana estrecha es prueba de reflow, no promesa de aplicación móvil.

Capturas en `f1/captures/`, incluida `window-open.png` con la ventana de iteración abierta.

## 3. Contraste medido

24 pares medidos: seis elementos por cada combinación de look y tema. Todos por encima de 4,5:1.

| Elemento | Mínimo | Máximo |
|---|---:|---:|
| Título | 13,65 | 15,46 |
| Remitente | 6,20 | 7,48 |
| Fecha | 6,20 | 7,48 |
| Botón primario | 4,70 | 4,80 |
| Aviso de datos sintéticos | 6,13 | 8,11 |
| Estado del borrador | 6,13 | 8,11 |

Datos crudos en `f1/captures/measurements.json`, generados por la corrida.

**Dos defectos que la compuerta encontró y se corrigieron:**

1. El aviso de datos sintéticos usaba el token de leyenda a 11 px: **3,10:1** en tema claro. Pasó a texto secundario.
2. La barra de herramientas no envolvía a 390 px: **529 px** de ancho sobre 390. Se permitió el reflujo del filtro y el envoltorio de las acciones.

Ninguno se habría visto en una captura a 1440.

Otros tres salieron de la revisión de controles y estados, no del contraste: dos botones de la propuesta no hacían nada, faltaban los estados de carga y error, y "sin leer" se comunicaba solo con un punto de color. Los tres están corregidos y probados. El detalle completo está en `f1/antislop.md`.

## 4. Teclado y consola

- Recorrido completo del orden real (seis paradas) registrado en `f1/captures/keyboard.json`: la lista es **un solo tab stop**, el foco avanza por controles reales y no se queda atrapado.
- **Foco visible en todas las paradas**, medido: `outline-style` distinto de `none` y `outline-width` mayor que cero, no solo "el elemento tiene el foco".
- **Enter abre el mensaje y lleva el foco a su título**; Escape cierra la lectura y devuelve el foco a la fila, tanto desde el lector como desde la lista.
- Escape cierra la ventana de iteración y devuelve el foco a su botón.
- El look elegido **sobrevive una recarga** y el panel de aprobación muestra el mismo contenido en ambos looks; lo único que cambia es su presentación.
- **Consola sin errores** en las cuatro combinaciones de look y tema, escuchando desde el primer byte.

## 5. Qué cambia entre looks y qué no

- Cambia: densidad de fila (36 contra 44 px), radio (8 contra 6), superficie elevada contra plana, trazo mínimo contra visible, etiquetas en versalitas contra caja normal.
- No cambia: textos, datos, estados, orden de zonas, teclado ni comportamiento.
- Prueba estática: los dos CSS de look contienen **solo** propiedades `--fl-look-*` y ningún color literal. Si un look intentara pintar, el test falla.

## 6. Lo que decides

1. **Un look**: A · Papel o B · Pizarra, o ajustes sobre uno.
2. **La huella en el panel de aprobación**: hoy no se muestra; queda en la evidencia del ítem.

**Decidido el 2026-11-17 por delegación expresa del CEO** ("decide tú"): **A · Papel**, sin ajustes, y la huella fuera de pantalla. El registro completo, con el motivo y lo que no cierra, está en `decisions/PC2-2026-11-17.md`.

## 7. Lo que esta entrega no demuestra

- Persistencia del borrador al recargar: es E1, no F1.
- Integración con el motor de correo: es E1.
- Actualización (`PRE_DEPLOY_E1_UPDATE`): es T14.
- Las nueve comprobaciones completas de T13: aquí se demuestran las que aplican a un prototipo.

## 8. Cierre de la ola

| Contrato | Expediente | Qué lo demuestra |
|---|---|---|
| O2-01 | `f1/references.md`, `f1/conflict-resolution.md` | Ficha de referencias y resolución de los dos conflictos: diales normalizados a 1-3 y qué se hace con versión y huella |
| O2-02 | `f1/token-map.md`, `f1/design-direction.md`, `f1/adaptation-estimate.md` | Inventario de 443 tokens con **siete** usados sin declarar (el plan decía tres; se declaran los siete), medidas fijas y adaptación estimada |
| O2-03 | `f1/email-surface.md` | Estructura común con lista, lectura, propuesta, aprobación y entrada desde cero |
| O2-04 | `f1/looks.md` | Dos looks, persistencia y recuperación; el diff permitido y su prueba están en `conflict-resolution.md` §4 |
| O2-05 | `f1/antislop.md`, este informe, `f1/captures/matrix.json` | 16 celdas de tamaño y tema, contraste, teclado, consola y aprobación idéntica |
| O2-06 | `f1/iteration-window.md` | Ventana flotante movible y redimensionable, con foco y borrador local |

`tasks/todo.md` es la instantánea del plan, fijada por `plan-manifest.json` con su huella; la ejecución no la reescribe. El cierre de la ola se registra aquí y en `reviews/`, igual que F0 lo hace en `f0-status.md` sin tocar el checklist del plan. Lo que sigue fuera de O2, por diseño: T12 y T13 globales (E1/E2 y T14), la integración con el motor y la seguridad integrada.
