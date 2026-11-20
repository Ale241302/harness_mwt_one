# PC4 · paquete de decisión del mínimo diario

Estado: **listo para firma**. La ingeniería está cerrada y verificada en laboratorio; la habilitación real depende de dos firmas del CEO y del smoke controlado. No se declara PC4 abierto sin ellas.

## Qué queda cerrado

| Check | Entregable | Evidencia |
|---|---|---|
| O7-01 | Ciclo de borradores: crear, editar, guardar, reabrir, descartar; un solo gesto final | `email-panel.e2e.ts` · borrador y envío con revisión |
| O7-02 | Responder, responder a todos, reenviar, adjuntos, emisor, enviados, carpetas, marcar, papelera y restaurar | `inbound/tests/mail-writes.spec.ts`, `registration.client.spec.tsx`, `email-panel.e2e.ts` |
| O7-03 | Error de emisor sin fallback, estados de envío y continuidad del borrador | `send-intents.spec.ts`, `registration.client.spec.tsx` |
| O7-04 | Actualización al SHA fijado con contratos comprobados y recorridos repetidos | `docs/t14/update-report.md` |
| O7-05 | A1-A9, revisión integrada y este paquete | `docs/e2/appearance-report.md` |

## Qué falta y quién lo firma

| Autorización | Alcance | Estado |
|---|---|---|
| `AUTH-REAL-WRITE` | Habilitar escritura y envío en los dos buzones del CEO: cuentas, destinatarios permitidos, límites, aprobación por mensaje y rollback | **PENDIENTE — CEO** |
| `AUTH-DEPLOY` | Desplegar el SHA candidato con backup, ventana y rollback | **PENDIENTE — CEO** |
| `AUTH-CORE` | Fusionar los 19 archivos de núcleo que separan al fork del SHA fijado | **PENDIENTE — CEO**, ventana propia |

`AUTH-CORE` no bloquea el correo diario: el producto corre sobre su núcleo actual con los contratos ya verificados. Bloquea únicamente la fusión del upstream (`T14` completo), que el gate deja medida.

## Rollback

1. Volver al SHA anterior desplegado (`b388b3c4aa` o el último manifiesto sano).
2. Restaurar la copia de base y almacén tomada antes de la ventana.
3. Comprobar que no quedan envíos en `sending`; los `unknown` se concilian a mano.
4. Repetir lectura en ambos buzones y confirmar que no se reenvió nada.

## Smoke y período

El recorrido mínimo está en `docs/e2/real-send-smoke.md`. Solo con el smoke en verde se abre el período de `T24`; hasta entonces la semana no empieza.

## Criterio de parada

Cualquier diferencia entre lo aprobado y lo enviado, cualquier destinatario no previsto o cualquier fallo de copia en enviados devuelve `NEEDS_WORK` y no se abre PC4.
