# F1-1 · Ficha de referencias y decisiones propias

- Contrato: C-FL-05 · Ola O2 · Etapa F1
- Revisión: `71191a400a`
- Alcance: fuentes visuales, qué se toma de cada una y qué no
- Nivel: C1-L
- Estado: **CLOSED** (revision independiente PASS, `reviews/O2-review-round-3.md`)
- Gate: PC2
- Autor: faberloom-architect · Revisor: PASS 2026-11-17 - O2-review-round-3

## 1. Fuente normativa

| Documento | Huella | Uso |
|---|---|---|
| `DESIGN_MESA.md` (27 oct 2026, dueño `ui-designer`) | `1C6D538E84DFBB18A498F01628ABCE3AF3B45427593F6B9BBDA506ADB39E4ADA`, 12.038 bytes | Dirección visual y de interacción de la Mesa |

La huella se verificó con `Get-FileHash -Algorithm SHA256` el 2026-11-16 y coincide con la que fija `tasks/file-map.md`. Si el documento cambia, esta ficha se revisa antes de tocar una pantalla.

**Regla del documento:** ningún valor se inventa en el código. Si falta un token, se agrega primero en la ficha de tokens (`f1/token-map.md`), no en el CSS.

## 2. Referencias públicas: qué se toma y qué no

Se usan como criterio de oficio, nunca como plantilla. De cada una se toma una **idea**, no un recurso, ni un color, ni un componente copiado.

| Referencia | Qué se toma | Qué no se toma |
|---|---|---|
| GOV.UK Design System | Jerarquía por tamaño y peso, densidad administrativa, estados escritos en una línea | Su paleta, su tipografía, su barra superior |
| Linear | Teclado primero, atajos por letra, densidad sin ruido | Su estética oscura, sus gradientes, su vocabulario |
| Stripe Dashboard | Tabla densa con montos alineados y números tabulares | Sus tarjetas, sus ilustraciones, sus anuncios |
| Documentación de contabilidad (facturas, proformas) | Cómo se lee un documento comercial: emisor, receptor, líneas, totales | Cualquier maquetación de plantilla |

`DESIGN_MESA.md` fija la dirección; estas cuatro solo justifican decisiones concretas cuando haya que explicar por qué una fila mide 34 px y no 48.

## 3. Prohibiciones explícitas

- No se copian recursos, capturas, iconos ni CSS de Spark, DaMail, Gmail ni Roundcube. Ni un archivo.
- No se usan ilustraciones de stock, personajes 3D ni avatares generados.
- No se inventan personas, cargos, testimonios ni cifras.
- No se inventa el logo. El wordmark actual se conserva y, si la pantalla no lo necesita, no aparece.

## 4. Inventario de activos que sí existen

| Activo | Dónde vive | Estado |
|---|---|---|
| Iconos de producto | `packages/client/ui-faberloom/src/client/ui/faberloom-icons.tsx` | Existentes; cada uso nuevo se registra en `f1/design-direction.md` §9 |
| Glifos | `.../ui/glyphs.tsx` | Existentes; solo si el icono pertinente no está en el set anterior |
| Paletas de producto | `packages/client/ui-theme/src/theme-palettes.ts` | Cinco paletas ya definidas por la marca |
| Tipografía | `packages/client/ui-theme/src/styles/fonts.css` | Una familia; escala en `app-type-scale.css` |

## 5. Datos de las pantallas

Todo dato que aparezca en el prototipo es **fixture rotulado**: lleva nombre de archivo o etiqueta que dice que es sintético. No se usan proformas reales, ni nombres de clientes reales, ni montos reales.

Esto no es una precaución de estilo: es AS-R38. Un prototipo que se ve real y no lo es, se discute como si fuera real.

## 6. Qué queda fuera de esta ficha

- Los valores de token: van en `f1/token-map.md`.
- Las dos definiciones de look: van en código, `looks/look-a.module.css` y `looks/look-b.module.css`.
- La elección final del CEO: es PC2, no esta ficha.
