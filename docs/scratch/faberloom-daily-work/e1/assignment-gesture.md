# O5-02C · Gesto de asignación y rótulo

- Contrato: C-FL-04 · Ola O5 · Etapa E1
- Revisión: `0b01ca39365ba04fe89858bcac56e3523896ee4d` + checkpoints `6b71b07`, `6813c91`, `636448f`, `2596e1f`
- Alcance: gesto con regla visible, desmarcar sin regla, rótulo y origen, revocación
- Nivel: C1-E (componente y servicio) · C1-I (build)
- Estado: **READY_FOR_CEO**
- Gate: PC1, PC2, O5-02B

## 1. Qué captura la regla

El gesto vive en el detalle de la Mesa, junto al selector de agente. La casilla **«Recordar como regla para esta cuenta»** decide si la asignación se queda en ese ítem o se convierte en regla:

| Estado de la casilla | Qué pasa |
|---|---|
| Marcada | Se asigna el ítem **y** se registra una regla `account equals <cuenta>` → agente elegido, con `spaceId` del ítem |
| Desmarcada | Solo se asigna el ítem; **no** se crea ninguna regla activa |

Antes de asignar, la pantalla escribe la regla exacta: «Los correos de `eguisa` se asignarán a *Agente*». La regla captura la **cuenta** del ítem, no el remitente, porque el ítem de la Mesa no lleva un campo de remitente de primera clase; la cuenta es el alcance que la pantalla puede mostrar con exactitud.

## 2. Rótulo y origen

El detalle incluye qué reglas deciden el ítem (`assignment`), con la versión y el origen de cada una. Cuando la decisión es `assigned` y hay origen, aparece **«Asignado por regla»**; el `title` muestra quién la escribió y cuándo. Un conflicto no produce rótulo de asignación: la decisión queda en `conflict` y sin destino, coherente con el servicio.

## 3. Revocación y cero efectos

- Revocar una regla la saca de la clasificación; el rótulo desaparece en la siguiente lectura y la regla sigue listada.
- El gesto no mueve correo, no lee buzones y no concede acceso a ningún espacio: llama a la asignación del tablero y, si se pidió, al servicio de reglas.
- Desmarcar no crea regla activa, y una asignación a `null` no deja regla.

## 4. Evidencia ejecutada

```
vitest view/assignment-gesture   5 pruebas
vitest client/ui-faberloom       135 pruebas (2 nuevas; 2 ajustadas a la casilla nueva)
tsc -b view / client             exit 0
```

| Prueba | Qué demuestra |
|---|---|
| Recordar | Crea la regla con cuenta, espacio, agente y origen humano |
| Desmarcar | Asigna sin crear regla |
| Repetir | Reutiliza la regla activa de la misma cuenta, espacio y agente |
| Explicar | `assignmentFor` devuelve la versión y el origen que el rótulo muestra |
| Revocar | Llama a la revocación del servicio |
| Panel | La casilla escribe la regla visible y el rótulo aparece con el origen en el `title` |

## 5. Lo que no se hizo

- **E2E visual a dos looks y tamaños**: la casilla y el rótulo están probados en componente; la pasada visual pertenece a PC3, como en O4-03.
- **Pantalla dedicada de reglas**: listar y revocar existe como remotos (`assignmentRules`, `revokeAssignmentRule`); una pantalla propia no estaba en el alcance de este ítem.
- **Regla por remitente**: requiere que el ítem de la Mesa exponga el remitente como campo; hoy la cuenta es el alcance exacto disponible.
- Las reglas compuestas siguen fuera del vocabulario.
