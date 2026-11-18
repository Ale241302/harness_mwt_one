# F1-6 · Ventana de iteración

- Contrato: C-FL-05 · Ola O2 · Etapa F1
- Revisión: `0e0bf42a53`
- Alcance: ventana flotante movible, redimensionable, con foco y borrador local
- Nivel: C1-E (pruebas ejecutadas)
- Estado: **READY_FOR_CEO**
- Gate: PC2
- Autor: faberloom-architect · Revisor: pendiente

## 1. Qué hace

| Acción | Ratón | Teclado |
|---|---|---|
| Abrir | Botón "Iterar sobre este correo" | Tab + Enter |
| Mover | Arrastrar la cabecera | Flechas sobre la cabecera, 16 px por pulsación |
| Redimensionar | Arrastrar la esquina | Flechas sobre la esquina, 16 px (32 con Shift) |
| Pantalla completa | Botón "Pantalla completa" / "Volver a flotante" | Igual |
| Cerrar | Botón "Cerrar" | Escape |

Un control que solo responde al ratón no está terminado: por eso mover y redimensionar tienen camino de teclado, y el foco entra en el borrador al abrir.

## 2. Reglas que el código hace cumplir

| Regla | Cómo |
|---|---|
| Tamaño mínimo | 320 × 240; el redimensionado no baja de ahí |
| Nada de coordenadas negativas | Se recorta a 0 en ambos ejes |
| Geometría conservada | Pasar a pantalla completa no pierde la posición flotante; al volver, se recupera |
| Borrador local | Cerrar y reabrir conserva el texto y su estado |
| Estado honesto | "Tienes cambios sin guardar" solo si el texto difiere del último guardado; volver al texto guardado limpia el aviso |
| Sin envío accidental | "Iterar" está deshabilitado con el texto vacío |
| Foco devuelto | Escape cierra y devuelve el foco al botón que abrió la ventana |

## 3. Evidencia ejecutada

```
vitest task-chat-window.client.spec.tsx   7 pruebas
vitest packages/client/ui-faberloom       281 pruebas, 23 archivos
tsc --noEmit                              exit 0
oxlint                                    exit 0
verify-client-ui-i18n                     0 cadenas fijas
```

Las pruebas cubren: cerrada tras su botón, apertura con foco en el borrador, cierre con Escape y foco devuelto, movimiento por teclado y por puntero, redimensionado con mínimo, pantalla completa y vuelta, borrador conservado entre cerrar y reabrir, y el botón de iterar deshabilitado con el texto vacío.

## 4. Qué demuestra de T12-F1 y qué no

R2-13 limita F1 a las interacciones visuales comunes con datos sintéticos.

| Subresultado de T12 | Estado |
|---|---|
| Mover y redimensionar la flotante | **Demostrado** |
| Foco al abrir, al cerrar y al volver | **Demostrado** |
| Borrador local recuperable al cerrar y reabrir | **Demostrado** |
| Dos pestañas compitiendo | Fuera de F1: O5-03 |
| Vínculo durable y fallo de vínculo | Fuera de F1: O5-03 |
| Cambio de versión o espacio durante la iteración | Fuera de F1: O5-03 |
| Resultado que llega a la Mesa | Fuera de F1: O5-04 |

## 5. Límites

- jsdom no tiene layout: las pruebas comprueban **estado y geometría**, no píxeles dibujados. Que se vea bien a 390 px y a zoom 200 % se verifica en O2-05 con navegador.
- El borrador vive en memoria. Su persistencia es E1 y R2-13 prohíbe declararla aquí.
- La ventana no se acopla ni se ancla a la lista: es flotante por diseño, porque la lectura no debe desaparecer mientras se pide un cambio.

## 6. Reproducir

```sh
corepack pnpm exec vitest run packages/client/ui-faberloom/tests/task-chat-window.client.spec.tsx --project thread-safe
```
