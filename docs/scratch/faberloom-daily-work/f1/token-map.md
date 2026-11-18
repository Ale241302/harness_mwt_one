# F1-2 · Inventario de tokens

- Contrato: C-FL-05 · Ola O2 · Etapa F1
- Revisión: `71191a400a`
- Alcance: `ui-theme/src` y `ui-faberloom/src` medidos con un contador propio
- Nivel: C1-E
- Estado: **READY_FOR_CEO**
- Gate: PC2
- Autor: faberloom-architect · Revisor: pendiente

## 1. Cómo se midió

Un contador recorre los `.css` y `.tsx` de los dos paquetes, recoge cada declaración `--token:` y cada uso `var(--token)`, y compara los dos conjuntos. No estima: cuenta. El guion es de un solo uso y su resultado es el de esta tabla.

| Dato | Valor |
|---|---:|
| Tokens declarados | **443** |
| Tokens usados | **119** |
| Usados y **no** declarados | **7** |
| Declarados y no usados | **332** |

## 2. Los siete tokens que se usan y no existen

No todos fallan igual, y la diferencia importa:

- **Con valor de reserva**: la regla se pinta igual, pero con un color fijo escrito a mano que no sigue el tema. Es deriva de tema, no invisibilidad.
- **Sin valor de reserva**: la propiedad se descarta al calcular el valor. La regla se aplica, el valor no, y no hay error en consola.

| Token | Dónde se usa | Qué pasa hoy |
|---|---|---|
| `--dsw-alias-bg-secondary` | `ui/panel-boundary.tsx` | Reserva `#1b1b1b`: el fondo no sigue el tema claro |
| `--dsw-alias-border-danger` | `ui/panel-boundary.tsx` | Reserva `#b42318`: el borde de error no sigue la paleta |
| `--dsw-alias-state-error-text` | `faberloom.module.css` | Reserva `#c0392b`: el texto de error no sigue la paleta |
| `--dsw-font-family-mono` | `ui/panel-boundary.tsx` | Reserva `ui-monospace`: la familia mono no es la del producto |
| `--dsh-content-font-size` | `ui-theme/src/styles/gradient-shadow-text.css` | Reserva `14px`: el degradado ignora el tamaño que eligió el usuario |
| `--dsw-alias-border-subtle` | `faberloom.module.css` | **Sin reserva**: el separador fino pierde el color |
| `--dsw-alias-border-accent` | `faberloom.module.css` | **Sin reserva**: el borde de foco no se distingue del neutro |

El octavo candidato que aparecía en el conteo (`--dsw-elevation-`) era el texto de un comentario, no un uso real. Queda descartado.

**Decisión de F1:** no se inventan valores ahora. Cada uno se resuelve en `looks/` cuando se defina la paleta de cada look, y el test `appearance-tokens.client.spec.ts` impide que aparezca un octavo sin documentar. Inventar el valor sin saber qué superficie lo consume es cómo se rompe el contraste.

## 3. Los 332 declarados sin uso

No son un defecto: `design-platform.css` define el catálogo completo de alias de la plataforma y cada producto consume una parte. Lo que sí es una regla de F1: **los looks solo pueden consumir tokens existentes**; si un look necesita uno nuevo, se agrega al catálogo con su razón, no se escribe un color literal.

## 4. Medidas fijas: 699 valores en píxeles

En los seis `.css` de `ui-faberloom` hay 699 valores en píxeles. Clasificados por rol:

| Rol | Valores | Ejemplos |
|---|---:|---|
| Espaciado | 261 | 4, 8, 12, 16, 24 |
| Borde y trazo | 110 | 0.5, 1, 2 |
| Radio | 79 | 4, 6, 8 |
| Texto | 64 | 11, 12, 13, 14, 16 |
| Alto de fila y objetivo | 30 | 32, 36, 44 |
| Ancho de panel | 15 | 220, 380 |

Quedan **140 fuera de la escala declarada**. Los más repetidos:

| Valor | Veces | Qué es probablemente | Qué hacer |
|---|---:|---|---|
| 10px | 53 | Espaciado intermedio | Decidir entre 8 y 12; no agregar un paso |
| 7px | 13 | Corrección óptica | Mantener solo con comentario que explique por qué |
| 9px | 8 | Corrección de texto | Igual que 7px |
| 5px | 4 | Radio menor | Unificar con 4 |
| 3px | 4 | Trazo | Unificar con 2 o 4 |
| 26px, 56px, 64px | 10 | Alturas y espacios | Revisar caso por caso |
| 200px, 240px, 300px | 7 | Anchos de control | Convertir a token de ancho |

No se tokeniza todo: se tokeniza lo que un look necesita cambiar. Un valor que nunca cambia entre looks puede quedarse en el componente, pero entonces no puede estar en un archivo de look.

## 5. Qué entrega F1 sobre este inventario

1. Los dos looks consumen solo tokens existentes más los siete que se resuelvan en su momento.
2. El test de tokens falla si aparece un `var(--x)` nuevo sin declaración.
3. El diff entre looks queda limitado a `looks/*.module.css` y `appearance.ts`.

## 6. Reproducir

El contador no está en el repositorio: es de un solo uso, igual que el del inventario del servidor. Si se necesita otra vez, se vuelve a escribir y se compara con esta tabla; si el número cambia, cambia este documento antes que el CSS.
