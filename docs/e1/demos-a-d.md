# O5-08 · Demostraciones por tramos (a–d) y paquete de PC3

- Contrato: C-FL-07 · Ola O5 · Etapa E1
- Fecha: 2026-11-23
- Revisión: `367ceb361f` más el cambio de `docs/e1/o5-07b-telemetry.md`
- Nivel: C1-E sobre composición aislada; los artefactos son capturas de esa composición
- Estado: **CERRADO**

## 1. Qué son y qué no son

Son tramos usables, con datos de prueba, para corregir el rumbo antes de terminar E1. No son puntos de control, no habilitan acceso real y no cuentan como aceptación semanal. Cada tramo declara qué parte es real y cuál es simulada.

La observación la hizo el agente delegado sobre los artefactos capturados, que es el sustituto que permite la delegación registrada en `D/decisions/DEC-2026-11-23-DELEGACION-CIERRE.md`. Lo que el dueño observaría en vivo es exactamente lo que muestran las capturas, ni más ni menos.

## 2. Tramo a · La bandeja de dos cuentas con lectura al lado

| Artefacto | Qué muestra |
|---|---|
| `visual/email-wide-look-a.png` (131 KB) | Lista de correo y lector en la misma pantalla, look A |
| `visual/email-wide-look-b.png` (130 KB) | La misma pantalla, look B, sin cambio de datos ni de conducta |
| `visual/email-narrow-list-a.png` (63 KB) | Lista en ancho estrecho |
| `visual/email-narrow-reader-a.png` (52 KB) | Lector en ancho estrecho, misma cuenta |
| `visual/sidebar-emails.png` (68 KB) | Los buzones del dueño en el panel lateral con su cuenta visible |

Real: estructura, selección, lectura y cambio de look sobre datos de prueba. Simulado: los mensajes. Verificación de comportamiento: `T1-E1`, `T12-E1` y `T22` en aislado.

## 3. Tramo b · La ventana flotante de iteración sobre un correo

| Artefacto | Qué muestra |
|---|---|
| `visual/email-assistant.png` (156 KB) | Ventana de iteración abierta sobre el correo, con el borrador local |
| `visual/email-assistant-expanded.png` (68 KB) | La misma ventana ampliada, sin perder el correo de fondo |
| `visual/session-01-no-base.png` (88 KB) | Iteración **sin** experiencia: declara que no tiene base |
| `visual/session-02-with-base.png` (146 KB) | Iteración **con** experiencia: cita la fuente |
| `visual/session-03-conflict.png` (130 KB) | Dos fuentes en conflicto: las muestra y no elige por su cuenta |
| `visual/session-01-system-prompt.png` (113 KB) | El contexto real que recibió el modelo, no solo el texto final |

Real: el contexto declarado y la abstención sin base. Verificación: `O5-05`, con inspección del contexto enviado al modelo (`evidence-O5-05-live.md`, `evidence-O5-05-session.md`).

## 4. Tramo c · Revisión y decisión de una propuesta en la Mesa, sin despacharla

| Artefacto | Qué muestra |
|---|---|
| `visual/mesa-scratch-task.png` (199 KB) | Propuesta nacida de una conversación desde cero, en la Mesa |
| `visual/panel-01-no-base.png` (79 KB) | Propuesta **sin** experiencia: solo el pendiente, sin solución inventada |
| `visual/panel-02-with-base.png` (95 KB) | Propuesta **con** experiencia: chip de fuente (`Memory`), texto citado y enlace `memory:4daac46d…` |
| `visual/panel-03-conflict.png` (114 KB) | Propuesta con dos fuentes que no coinciden |
| `visual/panel-04-narrow.png` (74 KB) | La misma decisión en ancho estrecho, con los campos completos fuera del visor |

Real: la propuesta se revisa y se decide; **no se despacha a producción**. El estado del tablero del servidor lo confirma: 568 propuestas, ninguna ejecutada sin autorización.

## 5. Tramo d · El ciclo de una lección

| Artefacto | Qué muestra |
|---|---|
| `visual/panel-02-with-base.png` | La lección **usada** como base de una propuesta, con su fuente |
| `packages/faberloom/learning/tests/activation.spec.ts` | Propuesta → aprobación humana → uso → edición/revocación |
| `packages/faberloom/view/tests/teachings.spec.ts` | El mismo ciclo desde la vista |

Real: el ciclo completo en aislado, incluido el rechazo de `active: true` por tool, flujo y MCP, y la revocación que deja de recuperarse tras reinicio. Simulado: los datos.

## 6. Observaciones y cambios de rumbo registrados

1. **El tramo c mostró el problema real:** con 499 propuestas pendientes, la decisión es el cuello de botella, no la generación. Cambio de rumbo: la siguiente capacidad con valor es delegar decisiones repetitivas (regla 3b), no producir más propuestas.
2. **El tramo a mostró una cuenta duplicada en el panel lateral** (`alejandro@` aparece dos veces) porque hay dos conexiones IMAP registradas para la misma dirección. Se registra como defecto de presentación, no de identidad: cada conexión tiene su cursor y su buzón. No se corrige en este paquete.
3. **El tramo b confirmó la abstención sin base.** No se relajó para que la demo se viera más completa.

## 7. Paquete de PC3

Con este documento quedan cubiertos los cuatro tramos y su observación. PC3 se emite en `D/decisions/PC3-2026-11-23.md`, que añade la verificación real de lectura sobre el servidor y la autorización `AUTH-REAL-READ`.

## 8. Lo que el paquete no acredita

- No acredita utilidad: eso es la semana real.
- No acredita que el dueño haya visto las demos en vivo; acredita que el delegado las revisó sobre artefactos reproducibles.
- No sustituye ninguna prueba de las que ya sostienen O3 y O4.
