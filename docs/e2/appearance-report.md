# A1-A9 · informe de apariencia de la revisión de O7

Ejecutado el 2026-11-20 sobre la revisión candidata. Cada fila nombra la prueba que la demuestra; ninguna se aprueba por captura sola.

| ID | Qué se verifica | Prueba ejecutada | Resultado |
|---|---|---|---|
| A1 | Diferencia de aspecto real | `apps/web/tests/appearance-compare.e2e.ts` · dos looks de la misma pantalla | PASS |
| A2 | Solo cambia presentación | `apps/web/tests/appearance-compare.e2e.ts` · «keeps both looks inside presentation» | PASS |
| A3 | Misma aprobación | `apps/web/tests/email-panel.e2e.ts` · borrador con De/Para/CC/CCO/adjuntos y versión revisada | PASS |
| A4 | Misma conducta | `apps/web/tests/email-panel.e2e.ts` · responder, responder a todos, reenviar, mover, restaurar | PASS |
| A5 | Legibilidad y acceso | `apps/web/tests/appearance-compare.e2e.ts` · contraste 4,5:1 y 3:1, foco y teclado | PASS |
| A6 | Tamaño y densidad | `apps/web/tests/appearance-compare.e2e.ts` · 1440×900, 1024×768, 390×844 y zoom 200 % | PASS |
| A7 | Modos y carga | `apps/web/tests/appearance-compare.e2e.ts` · claro/oscuro, recarga y look persistido | PASS |
| A8 | Correo hostil | `apps/web/tests/email-panel.e2e.ts` · HTML con script, formulario, iframe y píxel remoto, aislado | PASS |
| A9 | Actualización | `docs/t14/update-report.md` · tokens, modos, estados y aprobación antes/después sobre el SHA fijado | PASS con matiz: núcleo bloqueado por `AUTH-CORE` |

## Recuento

- Apariencia en navegador: 8/8.
- Correo en el producto ensamblado: 9/9.
- Componente de correo y tokens: 145/145.
- Conjunto afectado de O7: 572/572.

## Límites

- A9 comprueba la superficie pública del objetivo; no demuestra una fusión de núcleo ya aplicada (ver `docs/t14/update-report.md`).
- El contraste se mide en el navegador real; una captura no demuestra teclado.
