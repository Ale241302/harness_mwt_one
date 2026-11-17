---
name: faberloom-appearance-gate
description: Verifica las nueve comprobaciones de apariencia de FaberLoom (A1-A9) antes de aprobar un look o una pantalla integrada. Usar al revisar contraste, teclado, temas, tamaños, correo hostil o actualización.
---

# Compuerta de apariencia

La apariencia no es decoración: si cambia el comportamiento, la lista de destinatarios o el
rastro de aprobación, es un defecto funcional.

## Las nueve comprobaciones

| ID | Qué se verifica | Cómo se demuestra |
|---|---|---|
| A1 | Diferencia de aspecto real | Fichas de tokens y la misma pantalla en ambos looks |
| A2 | Solo cambia presentación | Diff limitado a tema/CSS; ninguna lógica ni servicio tocado |
| A3 | Misma aprobación | El snapshot completo se ve igual en ambos looks, con To/Cc/Bcc/adjuntos/versión |
| A4 | Misma conducta | Seleccionar, abrir, iterar, guardar, revisar, aprobar, cancelar |
| A5 | Legibilidad y acceso | Contraste 4,5:1 en texto y 3:1 en componentes; foco visible; nada solo por color |
| A6 | Tamaño y densidad | 1440×900, 1024×768, 390×844 y zoom 200 % sin pérdida de controles |
| A7 | Modos y carga | Claro/oscuro, recarga, persistencia de la elección y recuperación a un look válido |
| A8 | Correo hostil | HTML con scripts, iframes, formularios y URLs: aislado, sin red, sin eventos en la app |
| A9 | Actualización | Tokens, modos, estados y aprobación antes y después; solo con `PRE_DEPLOY_E1_UPDATE` |

## Reglas

- Una captura no demuestra teclado ni foco. Hay que navegar con teclado y registrar el orden.
- La consola limpia se comprueba, no se supone.
- "Modificable desde estilos" rige después de una preparación común. Estructura, teclado,
  arrastre y lectura junto a lista son funciones, no CSS.
- No se copian recursos ni repositorios de Spark, DaMail, Gmail o Roundcube. Se toma la idea.
- Ninguna pantalla final oculta versión, hash ni destinatarios aunque el diseño histórico lo
  sugiriera: esa contradicción la resuelve PC2.

## Antes de PC2

Entrega: dos looks propios, diff A/B permitido, fichas de tokens, capturas de la misma pantalla,
recorrido de teclado con foco, consola limpia, tres tamaños y zoom 200 %. PC2 no cierra T13
global ni la seguridad integrada.
