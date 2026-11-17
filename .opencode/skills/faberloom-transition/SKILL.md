---
name: faberloom-transition
description: Prepara y valida la transición de la rutina de correo en vivo hacia el comportamiento objetivo, en aislado y con runbook humano. Usar antes de cualquier cambio en el productor de correo o en el servicio actual.
---

# Transición

Esta skill prepara y valida. **No despliega.** El despliegue lo ejecuta una persona autorizada
con `AUTH-DEPLOY`.

## Qué decide DC-1

Qué trabajo en curso se conserva y cuándo se aplica el cambio. No decide que la rutina pueda
seguir enviando ni escribiendo: eso lo prohíben las reglas 4 y 5 en cualquier etapa.

## Inventario previo

- Productores activos: rutinas, flujos, handlers, colas, boot, tareas programadas.
- Estado heredado: pendientes, borradores, propuestas abiertas, intentos a medias.
- Efectos posibles ya iniciados: envíos, movimientos, escrituras en MWT.ONE.
- Cómo se reactiva cada productor y qué lo despierta (arranque, guardado, reinicio, error).

## Comportamiento objetivo

La rutina lee y presenta. Asigna espacio por gesto o por regla 3a vigente. Sin experiencia no
propone. No envía, no borra y no escribe en expedientes. El arranque automático deja de
reactivarla.

## Runbook

1. Parar la reactivación automática y verificar que no vuelve.
2. Clasificar el estado heredado y conservarlo sin reinterpretarlo.
3. Conciliar lo iniciado antes del corte; marcar los desconocidos como desconocidos.
4. Aplicar el comportamiento objetivo en aislado y repetir los recorridos.
5. Verificar que ninguna vía alternativa sigue enviando o escribiendo.
6. Dejar escrito el rollback: qué se restaura, qué se pierde y quién decide detenerse.

## Rechazos

- Cambiar producción sin `AUTH-ROUTINE-TRANSITION`.
- "Pausar y ver" sin conservar el trabajo en curso.
- Declarar cero efectos porque no se encontraron, en vez de por observación.
- Usar una copia restaurada para revivir rutinas, permisos o memoria.
