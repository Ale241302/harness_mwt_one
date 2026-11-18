# F1-4 · Dos looks sobre la estructura común

- Contrato: C-FL-05 · Ola O2 · Etapa F1
- Revisión: `71191a400a`
- Alcance: `look-a`, `look-b`, elección persistida y rechazo de un look no revisado
- Nivel: C1-E (pruebas ejecutadas)
- Estado: **CLOSED** (revision independiente PASS, `reviews/O2-review-round-3.md`)
- Gate: PC2
- Autor: faberloom-architect · Revisor: PASS 2026-11-17 - O2-review-round-3

## 1. El contrato de un look

Un look **no pinta**: asigna variables `--fl-look-*` sobre la superficie. Nunca escribe un color literal, nunca redefine un `--dsw-alias-*` y nunca toca un componente.

Esa decisión es la que mantiene tres cosas a la vez:

| Regla | Por qué se cumple |
|---|---|
| A2 (solo cambia presentación) | El diff de un look son dos archivos CSS y una variable por vez |
| R34 / A7 (claro y oscuro funcionan) | El color sigue viniendo del tema; el look elige densidad, radio y tratamiento |
| R29 (paleta acotada) | Un look no introduce colores nuevos, solo elige entre los que ya existen |

## 2. Las dos definiciones

| Variable | A · Papel | B · Pizarra | Qué cambia en pantalla |
|---|---|---|---|
| `--fl-look-radius` | 8px | 6px | Esquinas de lista, lectura y propuesta |
| `--fl-look-gap` | 16px | 12px | Separación entre lista y lectura |
| `--fl-look-row-height` | 36px | 44px | Densidad de la lista |
| `--fl-look-row-padding` | 8px 12px | 10px 14px | Aire dentro de la fila |
| `--fl-look-card` | `bg-layer-1` | `bg-base` | Superficie elevada contra superficie plana |
| `--fl-look-border-color` | `border-l1` | `border-l2` | Trazo mínimo contra trazo visible |
| `--fl-look-selected-bg` | `bg-layer-2` | `interactive-hover` | Cómo se lee la fila activa |
| `--fl-look-label-transform` | mayúsculas | caja normal | Etiquetas de zona |
| `--fl-look-label-spacing` | 0.04em | 0.01em | Aire de las versalitas |

Ninguno de los dos es "el bueno": A se lee como papel de trabajo denso; B como pizarra más aireada. **PC2 eligió A · Papel** el 2026-11-17 por delegación expresa del CEO (`decisions/PC2-2026-11-17.md`). B sigue disponible en el selector: PC2 fija el look por defecto, no retira el otro.

## 3. Persistencia y recuperación

`appearance.ts` resuelve cuatro cosas:

| Función | Qué garantiza |
|---|---|
| `resolveLookPreference` | Un valor desconocido no se aplica a medias: cae al look por defecto |
| `readStoredLook` | Lee la preferencia; si el valor guardado no es un look revisado, lo corrige en el almacén |
| `writeStoredLook` | Guarda la elección; si el almacén está bloqueado, no rompe la pantalla |
| `applyLook` | Pone la clase del look elegido y quita la del otro, sin tocar el resto de clases |

La clave es `faberloom.email.look`. Un look no revisado (por ejemplo `neon`) no se habilita: se rechaza y se recupera el revisado, que es lo que exige T13-F1.

## 4. Evidencia ejecutada

```
vitest appearance.client.spec.tsx     7 pruebas
vitest email-layout.client.spec.tsx   13 pruebas (incluye el cambio de look)
tsc --noEmit                          exit 0
verify-client-ui-i18n                 0 cadenas fijas
oxlint                                exit 0
```

Cubren: aceptar solo `a` y `b`, guardar y recuperar tras una recarga, rechazar y reparar un valor inválido, sobrevivir a un almacén que lanza, alternar, clases distintas y estables por look, intercambio en el elemento sin estilos en línea y normalización de un elemento que lleva las dos clases.

## 5. Lo que este paso no demuestra

- **Contraste medido en ambos temas y ambos looks.** Es O2-05 y ya está en `f1/pc2-look.md` §3, con el medidor.
- **Diferencias a 1440, 1024, 390 y zoom 200 %.** También O2-05: 16 celdas en `f1/captures/matrix.json`.
- **Recarga con el mismo borrador.** El borrador vive en memoria en F1: la persistencia de borrador es E1 (O5-03) y R2-13 prohíbe declararla aquí. Lo que sí persiste es el look.
- **Elección estética.** Es PC2 y es tuya.

## 6. Reproducir

```sh
corepack pnpm exec vitest run packages/client/ui-faberloom/tests/appearance.client.spec.tsx --project thread-safe
corepack pnpm exec vitest run packages/client/ui-faberloom/tests/email-layout.client.spec.tsx --project thread-safe
```
