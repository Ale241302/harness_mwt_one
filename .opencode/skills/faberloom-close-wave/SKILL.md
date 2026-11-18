---
name: faberloom-close-wave
description: Verifica el cierre total de una ola de FaberLoom antes de declararla CLOSED, incluyendo pruebas ausentes, pendientes ocultos y dependencias abiertas. Usar al pedir o dar una revisión de cierre.
---

# Cierre de una ola

Empieza en `NEEDS_WORK`. Cambiar el veredicto exige evidencia, no confianza.

## Lista de comprobación

1. Cada check de la ola está `CLOSED` con su expediente enlazado, o `NOT_APPLICABLE_APPROVED`
   con decisión explícita. "Casi" no cuenta.
2. Cada caso `T` cerrado tiene sus partes cerradas. Una parte no cierra el caso.
3. Cada requisito tocado tiene dueño, nivel y gate en `evidence-assignments.md`.
4. Las dependencias de la ola están `CLOSED`. Una dependencia abierta bloquea la ola aunque el
   trabajo propio esté terminado.
5. Los gates humanos citados tienen su autorización registrada. Un `allow` de OpenCode no es una
   autorización.
6. Las pruebas citadas se ejecutaron sobre la revisión actual. Una salida vieja no sirve.
7. Los controles negativos existen y fallan por el motivo correcto.
8. No hay `.only`, `.skip`, supresiones de tipos o lint, ni umbrales bajados para llegar a verde.
9. No hay `TODO`, `FIXME`, mock sin rótulo, botón sin acción ni error silenciado dentro del alcance.
10. Las limitaciones están escritas y aceptadas por quien decide.

## Frases que no son evidencia

- "Ya funcionaba antes".
- "El test pasa" sin decir qué prueba ni qué control negativo tiene.
- "Queda un detalle menor" sin contrato que lo cubra.
- "No se tocó producción" como sustituto de una prueba de aislamiento.

## Salida

Un veredicto, la lista de bloqueos con su gate, y el siguiente contrato. Si un cierre solo se
puede sostener con una frase, no se sostiene.

## Estado del plan hoy

O0, O1 y O2 están cerradas con revisión independiente (`f0-status.md` y `reviews/O2-review-round-3.md`), y PC1 y PC2 están firmadas. O3 está entregada y en revisión independiente; O4 también está entregada. PC3 y PC4 siguen abiertas: exigen `AUTH-REAL-READ` y `AUTH-REAL-WRITE`, que no están otorgadas. N9 sigue documentado y sin habilitar.
