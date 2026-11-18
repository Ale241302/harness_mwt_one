# AS-R01 a AS-R38 · Informe de apariencia de F1

- Contrato: C-FL-05 · Ola O2 · Etapa F1
- Revisión: `0b01ca39365ba04fe89858bcac56e3523896ee4d`
- Alcance: prototipo de correo, dos looks, dos temas
- Nivel: **C1-E**
- Estado: **READY_FOR_CEO**
- Gate: **PC2**
- Autor: faberloom-qa · Revisor: pendiente

Ejecutado sobre el build real (`apps/web/prototype/f1/dist`) en Chromium, no sobre una descripción. Corrida: `vitest --config vitest.web.config.ts apps/web/tests/appearance-compare.e2e.ts` → 9 de 9.

## Reglas

| Regla | Veredicto | Evidencia |
|---|---|---|
| AS-R01 color y gradientes | PASS | Sin un solo gradiente. Dos neutros y un acento por tema, tomados de las paletas de producto; ninguna decisión de color inventada en el prototipo |
| AS-R02 copy sin guion largo | PASS | `rg "\x{2014}"` sobre la copia de F1: 0 coincidencias |
| AS-R03 responsive real | PASS | Las 16 celdas sin desbordamiento (`scrollWidth === clientWidth + 1`); en 390 los botones miden al menos 44 px de alto, medido |
| AS-R04 iconos pertinentes | PASS (no aplica) | F1 no introduce iconos: ni sparkle, ni robot, ni set nuevo |
| AS-R05 estructura por contenido | PASS | Lista y lectura responden a cómo se decide: la lectura no tapa la lista en pantalla ancha |
| AS-R06 tipografía con razón | PASS | Una familia, escala 11/12/13/16/18/20 y cifras tabulares en fechas |
| AS-R07 fondo con propósito | PASS | Fondo plano del tema; sin rejilla, ruido ni textura |
| AS-R08 flechas solo con función | PASS | Ninguna flecha decorativa en botones |
| AS-R09 badges de estado real | PASS | Sin cápsulas ni brillo. El punto de "sin leer" va acompañado de texto para lectores de pantalla |
| AS-R10 glass limitado | PASS | Sin `backdrop-filter` |
| AS-R11 radios coherentes | PASS | 8 px tarjetas, 6 px controles, 4 px chips; el look B baja a 6 px sin volverse píldora |
| AS-R12 sombra por elevación | PASS | Una sola sombra, en el panel de aprobación y la ventana flotante |
| AS-R13 glow solo foco | PASS | Sin glow; el foco usa contorno de 2 px con el acento |
| AS-R14 jerarquía, no cards iguales | PASS | Lista densa, detalle en dos columnas y propuesta como bloque: tres composiciones distintas |
| AS-R15 acciones específicas | PASS | "Aprobar y enviar", "Guardar", "Iterar", "Nueva", "Cambiar look" |
| AS-R16 copy concreta | PASS | Cada control dice qué hace; sin "explorar" ni "descubrir" |
| AS-R17 números reales | PASS | Sin métricas. Los precios y fechas viven dentro de fixtures rotulados como sintéticos |
| AS-R18 sin testimonios falsos | PASS (no aplica) | No hay testimonios ni personas |
| AS-R19 motion con propósito | PASS | MOTION 1: solo transiciones de estado; nada entra animado |
| AS-R20 identidad propia | PASS | Densidad y jerarquía propias; no reproduce la piel de otro producto |
| AS-R21 temas justificados | PASS | Claro y oscuro medidos por separado, no solo el claro |
| AS-R22 imágenes conectadas | PASS (no aplica) | Ninguna ilustración ni captura de stock |
| AS-R23 activos confirmados | PASS | No se creó logo, avatar ni icono |
| AS-R24 navegación real | PASS | No hay enlaces de navegación; cada control existente actúa |
| AS-R25 contraste medido | PASS | 24 pares medidos; mínimo 4,70:1 (botón primario), máximo 15,46:1 |
| AS-R26 controles funcionales | PASS | Todos los botones cambian estado. Los de la propuesta se conectaron tras detectarse sin efecto |
| AS-R27 estados de datos | PASS | Vacío, carga y error con Reintentar en Chromium (`f1/captures/phase-loading.png`, `phase-error.png`, con `aria-busy`); guardando, guardado y cambios sin guardar en el componente (jsdom) |
| AS-R28 FAQ real o ausente | PASS (no aplica) | Sin FAQ |
| AS-R29 paleta acotada | PASS | Dos neutros más un acento; el look no añade colores |
| AS-R30 sin clonación | PASS | Referencias citadas como oficio, sin recursos copiados |
| AS-R31 razón por decisión | PASS | `f1/design-direction.md` §3 a §9, una línea por decisión |
| AS-R32 teclado completo | PASS | Recorrido registrado en `f1/captures/keyboard.json`: la lista es un solo tab stop, **todas** las paradas tienen contorno propio, Enter lleva el foco al mensaje y Escape lo devuelve a la fila |
| AS-R33 sin parches de CSS por script | PASS | Cambios en fuente y tokens; ningún script reescribe CSS |
| AS-R34 todos los temas funcionan | PASS | 16 combinaciones de look, tema y tamaño capturadas; contraste medido en las cuatro de look y tema |
| AS-R35 verificar antes de entregar | PASS | Build, consola limpia, click-through, temas y tamaños en la misma corrida |
| AS-R36 sin claims inventados | PASS | Ni seguridad, ni rendimiento, ni cumplimiento |
| AS-R37 dirección requerida | PASS | `DESIGN_MESA.md` con huella verificada y diales declarados |
| AS-R38 contenido real u honesto | PASS | Todo fixture dice "sintético" y la pantalla lo advierte |

## A1 a A9 · Compuerta de apariencia

| ID | Veredicto | Evidencia |
|---|---|---|
| A1 diferencia real | PASS | Fila de 36 contra 44 px, radio 8 contra 6, superficie elevada contra plana |
| A2 solo presentación | PASS | Los dos CSS de look contienen únicamente `--fl-look-*` y ningún color literal; un test lo impone |
| A3 misma aprobación | PASS | El panel muestra el mismo `textContent` en ambos looks; la diferencia de mayúsculas es `text-transform` |
| A4 misma conducta | PASS | Un solo componente, un solo reducer: los dos looks comparten comportamiento |
| A5 legibilidad y acceso | PASS | Contraste medido; cada parada del recorrido de teclado tiene contorno propio; "sin leer" ya no depende solo del color |
| A6 tamaño y densidad | PASS | 16 celdas: 1440×900, 1024×768, 390×844 y zoom 200 % en los dos looks y los dos temas, sin desbordamiento |
| A7 modos y carga | PASS | Ambos temas; el look elegido sobrevive una recarga y un valor inválido se repara al look por defecto |
| A8 correo hostil | No aplica en F1 | El visor aislado es O4-04 |
| A9 actualización | No aplica en F1 | `PRE_DEPLOY_E1_UPDATE` es T14 |

## Qué se corrigió porque esta compuerta lo encontró

1. Aviso de datos sintéticos con **3,10:1** en tema claro. Pasó a texto secundario: 6,13:1.
2. Barra de herramientas con **529 px** sobre una pantalla de 390. Se permitió el reflujo.
3. Botones de "Usar la versión nueva" y "Quedarme con la actual" **sin efecto**. Ahora deciden y la propuesta desaparece.
4. Estados de carga y error **ausentes**. Ahora existen, con Reintentar, y se capturan en Chromium (`phase-loading.png`, `phase-error.png`), no solo en jsdom.
5. "Sin leer" comunicado **solo por un punto de color**. Ahora lleva texto para lectores de pantalla.

Ninguno de los cinco se habría visto en una captura a 1440 px.
