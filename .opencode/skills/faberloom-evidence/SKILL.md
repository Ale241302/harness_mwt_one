---
name: faberloom-evidence
description: Crea el expediente de evidencia de un contrato de FaberLoom Web con revisión, fixture, comandos, esperado, observado, controles y límites. Usar al cerrar cualquier check, al reportar un fallo o cuando alguien pide "demuéstralo".
---

# Expediente de evidencia

Un expediente no es un resumen: es lo que permite a otra persona repetir la observación y
llegar al mismo resultado.

## Ubicación y forma

`docs/scratch/faberloom-daily-work/evidence/<ola>/<contrato>.md`

```markdown
# <contrato> · <título>

- Revisión: <SHA de 40 caracteres>
- Alcance: <qué entra y qué no>
- Nivel: C1-L | C1-E | C1-I | OBSERVADO_REAL
- Estado: PLANNED | IN_PROGRESS | BLOCKED | READY_ISOLATED | READY_FOR_CEO | CLOSED | NOT_APPLICABLE_APPROVED
- Gate y aprobación: <PCn / AUTH-... / NINGUNA>
- Autor / Revisor / Veredicto: <agente> / <otro agente> / PASS | NEEDS_WORK
- Fixture: <archivo y hash>

## Comandos

## Esperado

## Observado

## Control positivo

## Control negativo

## Limitaciones fuera del alcance
```

## Reglas duras

- Sin observación no hay cierre. "Debería funcionar" no es una observación.
- Sin control negativo no se distingue un backend que siempre niega de uno que aplica la regla.
- Sin control positivo no se distingue un rechazo correcto de una ruta muerta.
- Las limitaciones se escriben aunque sean incómodas. Una limitación vacía es un cierre falso.
- La revisión es de otra persona. El autor no se aprueba a sí mismo.
- `CLOSED` con un gate pendiente no existe. Si el contrato depende de `PC3`, cita `AUTH-REAL-READ`.
- Un dato real de correo no entra aquí. Se usan fixtures sintéticos y agregados sin contenido.

## Comprobación automática

`scripts/faberloom-daily/check-closure.ts` valida la estructura del registro. Rechaza `CLOSED` sin
observación, sin negativo, sin limitaciones, sin veredicto o con el autor como revisor. Úsalo
antes de pedir revisión; no sustituye la revisión.

## Cuando no puedes cerrar

Escribe `BLOCKED` con la razón exacta: autorización que falta, acceso que no existe, dependencia
abierta. Un `BLOCKED` honesto vale más que un `CLOSED` inventado.
