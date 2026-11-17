# F1-2 · Dirección propia y diales

- Contrato: C-FL-05 · Ola O2 · Etapa F1
- Revisión: `0b01ca39365ba04fe89858bcac56e3523896ee4d`
- Alcance: dirección de diseño de la Mesa en F1, con una razón por decisión
- Nivel: C1-L
- Estado: **READY_FOR_CEO**
- Gate: PC2
- Autor: faberloom-architect · Revisor: pendiente

## 1. Lectura de dirección

> Lectura: **mesa de decisiones para una operación comercial real**, para **una persona con criterio y muchas proformas**, en lenguaje **administrativo sobrio**, con diales **ENERGY 2 / RHYTHM 3 / MOTION 1**.

Viene de `DESIGN_MESA.md` §1, que fija personalidad sobria, densidad alta en Lista y la idea rectora "la IA prepara, vos aportás tu criterio". No se inventa una dirección nueva: se normaliza la que ya está escrita.

## 2. Diales

`DESIGN_MESA.md` declara `ENERGY 3 · RHYTHM 5 · MOTION 2` en una escala que no dice cuál es. El plan exige la escala 1-3. La conversión y su motivo están en `conflict-resolution.md` §1.

| Dial | Valor | Qué significa en esta pantalla |
|---|---|---|
| **ENERGY** | 2 | Presencia media: una fila domina, el resto se ordena. Ni gris institucional ni campaña |
| **RHYTHM** | 3 | Las zonas cambian de composición a propósito: lista densa, detalle en dos columnas, panel de aprobación angosto |
| **MOTION** | 1 | Solo estados: hover, foco, "Guardado". Cero animaciones de entrada |

Confirmados el 2026-11-17. No quedan como propuesta: la construcción de O2-03 y los dos looks se hacen sobre estos tres valores.

Consecuencia verificable: si una pantalla entra animada o todas sus zonas miden lo mismo, la dirección no se cumplió.

## 3. Color

| Rol | Decisión | Razón en una línea |
|---|---|---|
| Fondo | Neutro de la paleta activa, sin textura | La Mesa no compite con la proforma que hay que leer |
| Superficie | Una sola elevación sobre el fondo | Dos elevaciones harían parecer que todo flota |
| Borde | 1 px, sin caja dibujada | Separa filas sin convertir cada fila en una tarjeta |
| Texto | Contraste AA mínimo | Es una herramienta de trabajo, se lee ocho horas |
| Acento | Uno solo, para acción primaria y foco | Un acento por pantalla jerarquiza; cinco no jerarquizan nada |
| Peligro | Solo descartar y error | Si el rojo aparece por estética, deja de avisar |
| Éxito | Solo verificación aprobada | "Todo está bien" no es un estado del producto |

Paleta activa: 2 neutros de base + 1 acento, sobre las cinco paletas que ya define la marca en `ui-theme`. Los looks A y B **no** introducen colores nuevos: cambian tratamiento, no identidad.

Prohibido en CSS: color literal. Todo pasa por token (`--fl-*` o el alias que corresponda).

## 4. Tipografía

| Rol | Tamaño | Razón |
|---|---|---|
| Título de pantalla | 20-22 px, peso 600 | Una sola vez por pantalla: dice dónde estás |
| Título de ítem | 16-18 px, peso 600 | Es la fila que domina; se trunca con tooltip |
| Cuerpo | 14 px, interlínea 1.45 | Lectura de párrafos cortos y campos |
| Dato denso | 13 px, tabular | Montos y fechas se comparan en vertical |
| Etiqueta | 12 px, mayúsculas pequeñas | Encabezados de columna y de zona |
| Micro | 11 px | Metadatos y contadores |

Una sola familia. Números tabulares obligatorios en montos y fechas. Sin fuentes decorativas, sin monoespaciado como estética.

## 5. Espaciado, radios y sombras

| Decisión | Valor | Razón |
|---|---|---|
| Escala | 4, 8, 12, 16, 24, 32, 48 | Cubre densidad de tabla y aire de detalle sin números sueltos |
| Radio de control | 6 px | Se reconoce como control sin parecer píldora |
| Radio de tarjeta | 8 px | Agrupa sin llamar la atención |
| Radio de chip | 4 px | El chip es una etiqueta, no un botón |
| Sombra | Una sola, para panel de aprobación y selector | Marca elevación real; las tarjetas se separan con borde |
| Ancho de lectura | 72-80 caracteres | Más ancho cansa; menos rompe el ritmo de la proforma |

## 6. Movimiento

MOTION 1 significa: transiciones de estado de 120-160 ms, sin rebote, sin desplazamiento de entrada. El único movimiento con función es el cambio de estado ("Guardando" → "Guardado"), que informa y desaparece. Nada se mueve para llamar la atención.

## 7. Estructura y composición

- Una pantalla, una fila dominante. En Lista, la fila seleccionada; en Foco, el borrador.
- Lista y lectura conviven: la lectura no tapa la lista, la reemplaza solo en pantallas angostas.
- El panel de aprobación es angosto a propósito: obliga a leer qué se aprueba.
- La barra de alcance (espacio, cuenta, filtros activos) siempre visible: un filtro activo que se esconde es una mentira sobre lo que estás viendo.

## 8. Copy

- Segunda persona, breve, sin humor en errores.
- Sin guion largo en texto de interfaz (R-02).
- El glosario de `DESIGN_MESA.md` §8 manda; no se inventan sinónimos.
- Un error dice qué pasó y qué hacer. No culpa al usuario.
- Cero claims: nada de "potenciado por IA", "sin fricción", "revolucionario".

## 9. Iconos

Se usan los existentes de `faberloom-icons.tsx`. Cada icono nuevo se registra con tres columnas:

| Icono | Significado | Razón |
|---|---|---|
| Aprobar | `check` | Acción primaria del panel; el mismo símbolo en Lista y Foco |
| Descartar | `x` | Cierra sin decidir; nunca se usa para "cerrar panel" |
| Iterar | `pencil` | Abre el trabajo sin terminar sobre el ítem |
| Sin espacio | `folder` | El ítem no tiene dónde vivir; es un dato, no un adorno |

Sin sparkle, robot, orbe ni rayo. Si un icono no tiene significado propio, no se usa.

## 10. Lo que se evita, con nombre

Gradientes decorativos, glassmorphism, tarjetas flotantes con sombra difusa, iconos de color por estado, métricas grandes que no se usan para decidir, animaciones de entrada, modales en cascada, badges tipo cápsula con punto y brillo, flechas decorativas en cada botón.

## 11. Cómo se comprueba que se cumplió

No con una captura. Con las nueve comprobaciones de `faberloom-appearance-gate` (A1-A9) y las 38 de `apariencia-antislop.md`, cada una con evidencia propia. La entrega de PC2 lleva: dos looks, mismo contenido, diff limitado a tema y CSS, capturas, recorrido de teclado, consola limpia y tres tamaños más zoom 200 %.
