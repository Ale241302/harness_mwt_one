# Registro único de decisiones

Contrato: C-FL-02 / O0-01 / FM-O0-01 Fuente: `3_ACTA_DECISIONES_CEO_v1.1.md` (decisiones 1-12), `2_TAREA_DETALLADA_FaberLoom_v1.0.md` §2 (DC-1 a DC-4), `tasks/plan.md` (PC1-PC6, SEMANA, E4-listo) y las respuestas del CEO del 2026-11-16. Regla: una decisión cerrada no se reabre por narrativa. Una preferencia no es un gate firmado.

## 1. Decisiones cerradas del CEO (acta v1.1, 2026-11-16)

| # | Decisión | Elegido | Estado |
|---:|---|---|---|
| 1 | Dónde está el freno | Correo y Mesa por igual | cerrada |
| 2 | En qué se traba | El volumen: todo sin resolver | cerrada |
| 2b | Punto de partida del agente | Sin experiencia; cada respuesta declara con qué contexto respondió | cerrada |
| 3 | Experiencia inicial | Desde cero, aprende de lo resuelto, sin carga previa | cerrada |
| 3b | Cuándo sugiere | Solo con memoria suficiente; si no, presenta el pendiente sin propuesta | cerrada |
| 4 | Buzones del piloto | Los dos buzones del acta (ver `3_ACTA_DECISIONES_CEO_v1.1.md`; no se repiten aquí por custodia) | cerrada |
| 4b | Conexión de buzones | Por IMAP o por conector MCP (usa el conector de Hostinger) | cerrada — **en tensión con PREF-2026-11-16-PC1**, ver §5 |
| 5 | Espacios al arrancar | Todos los ya creados; asignación manual que queda como regla | cerrada |
| 6 | Dónde se aprueba | Donde esté el usuario; lo no aprobado espera en la Mesa | cerrada |
| 7 | Tareas de dos espacios | Un espacio principal y referencia al otro; la lección se guarda en el principal | cerrada |
| 8 | Forma de la iteración | Ventana flotante sobre correo o ítem; pantalla aparte para iterar desde cero | cerrada |
| 8b | Iteración desde cero | Tercera forma de iniciar trabajo; su resultado entra a la Mesa | cerrada |
| 9 | Aceptación de la primera entrega | Por uso real y por aprendizaje | cerrada |
| 10 | Período de prueba | Una semana hábil continua sin volver a la aplicación anterior | cerrada |
| 10b | Revisión al mes | Evaluar memorias y resoluciones acumuladas | cerrada |
| 10c | Curación de memoria | Espacio de iteración para curar memoria, después de la primera entrega | cerrada |
| 11 | Límite de esfuerzo | Lo fija el plan; Alejandro estima tras evaluar el motor y el CEO aprueba el tope | cerrada, **pendiente de tope numérico en PC1** |
| 12 | Apariencia | Modificable desde estilos. Spark y DaMail como ejemplo; no se copia su repositorio | cerrada |

## 2. Decisiones de transición (DC)

| ID | Qué decide | Estado hoy | Disparador |
|---|---|---|---|
| DC-1 | Transición y continuidad útil de la rutina de correo en vivo | **CERRADA 2026-11-23** (`D/decisions/DC-1-2026-11-23.md`) | Transición materializada en el despliegue; trabajo heredado clasificado |
| DC-2 | Autorizar el inventario del servidor en uso (F0-2) | **OTORGADA 2026-11-16** (`AUTH-2026-11-16-F0-2`) | Inventario ejecutado en `server-inventory.md` |
| DC-3 | Consecuencia para los avisos automáticos | **RESUELTA 2026-11-17 al cerrar O3**: avisos internos persistentes en `faberloom-notices`, cero correo automático de rutina, seguimiento o invitación | Registro en `e1/no-auto-send.md` y `e1/write-denied.md` |
| DC-4 | Uso y alcance de la entrega gradual E1 | **CERRADA 2026-11-23** (`D/decisions/DC-4-2026-11-23.md`) | E1 usado como capa de triage; 68 propuestas resueltas por una persona |

Ninguna DC levanta la prohibición de autoenvío ni de S4 sin aprobación (R2-7).

## 3. Puntos de control y gates

| Gate | Qué se firma | Estado | Falta |
|---|---|---|---|
| PC1 | Motor, alcance y topes | **FIRMADA 2026-11-16** | DaMail, PILOTO, 155 jornadas, enmienda a 4b |
| PC2 | Look y disposición | **CERRADA 2026-11-17** | Look A · Papel por delegación expresa; O2 completo con revisión independiente PASS (`reviews/O2-review-round-3.md`) |
| PC3 | Lectura real de ambos buzones | **CERRADA 2026-11-23** | `D/decisions/PC3-2026-11-23.md`; `AUTH-REAL-READ` otorgada; lectura real verificada en el servidor |
| PC4 | Escritura y envío | **CERRADA 2026-11-23** | `D/decisions/PC4-2026-11-23.md`; T14 pasa a `NOT_APPLICABLE_APPROVED` por `BASE-2026-11-23-v1.1.md` |
| SEMANA | Aceptación o rechazo tras una semana real | **CERRADA con reserva de calendario** | `D/decisions/SEMANA-2026-11-23.md`; confirmación con siete días el 2026-11-30 |
| PC5-M | Expedientes | **CERRADA 2026-11-23** | `D/decisions/PC5-M-2026-11-23.md`; cada escritura conserva `AUTH-MWT-WRITE` |
| PC5-A | Reglas S3 | **CERRADA 2026-11-23** | `D/decisions/PC5-A-2026-11-23.md`; mecanismo habilitado, 0 reglas activas |
| E4-listo | Curación disponible antes del mes | **CERRADA 2026-11-23** | `D/decisions/E4-LISTO-2026-11-23.md` |
| PC6 | Umbral del mes y continuidad | **CERRADA en método** | `D/decisions/PC6-2026-11-23.md`; umbral fijado, informe real el 2026-12-23 |
| N3 | Lista de espacios ya creados | **CERRADA 2026-11-23** | `docs/e1/n3-spaces.md`, inventario del servidor |
| N9 | Modo para terceros | **CERRADA como plan** | `docs/e5/n9-plan.md`; estado externo `NO LISTO PARA TERCEROS` |

Estado vigente y detalle: `FaberLoom_tarea_2026-11-16/tasks/CIERRE-2026-11-23.md`.

## 4. Decisiones otorgadas el 2026-11-16

Detalle y custodia en `decisions/`. El CEO otorgó cada punto por instrucción expresa en la sesión del 2026-11-16, y cada registro guarda su texto literal. La firma es de tipo **instrucción en sesión**: no hay manuscrito ni documento externo, y así lo dice cada archivo.

Estado aplicado: `OTORGADA_POR_INSTRUCCION_EXPRESA`, con `signature_kind` explícito. Una otorgación no habilita una capacidad por sí sola: cada una sigue exigiendo su prueba y su gate.

| ID | Decisión | Registro | Estado |
|---|---|---|---|
| `RAT-2026-11-16-PREC` | Las seis precisiones | `decisions/RAT-2026-11-16-PREC.md` | OTORGADA por instrucción expresa |
| `AUTH-2026-11-16-F0-2` | Inventario del VPS | `decisions/AUTH-2026-11-16-F0-2.md` | OTORGADA y ejecutada |
| `AUTH-2026-11-16-F0-7` | Medición de buzones | `decisions/AUTH-2026-11-16-F0-7.md` | OTORGADA y ejecutada |
| `AUTH-2026-11-16-COUNTS` | Conteos, roles y dominios | `decisions/AUTH-2026-11-16-COUNTS.md` | OTORGADA y ejecutada |
| `AUTH-2026-11-16-LAB` | Laboratorio de servicios | `decisions/AUTH-2026-11-16-LAB.md` | OTORGADA y ejecutada |
| `AUTH-2026-11-16-PROBE` | Sonda real de Hostinger | `decisions/AUTH-2026-11-16-PROBE.md` | OTORGADA, sin token de API |
| `PC1-2026-11-16` | Motor, alcance y topes | `decisions/PC1-2026-11-16.md` | FIRMADA por instrucción en sesión: DaMail, PILOTO, 155 jornadas |
| `DENY-2026-11-16-LAB` | No autorización del día anterior | `decisions/DENY-2026-11-16-LAB.md` | SUSTITUIDA por `AUTH-2026-11-16-LAB` |

Siguen sin otorgar: `AUTH-LAB-SERVICE`, `AUTH-REAL-READ`, `AUTH-REAL-WRITE`, `AUTH-DEPLOY`, `AUTH-CORE`, `AUTH-MWT-WRITE`, `AUTH-RULE-ACTIVATION`, `AUTH-ROUTINE-TRANSITION`, `AUTH-PUBLISH-THIRD-PARTIES`.

Una declaración no habilita nada por sí sola. Cada capacidad sigue exigiendo su prueba y su gate.

## 5. Tensión detectada: motor DaMail contra la decisión 4b

La decisión 4b, cerrada el 2026-11-16, dice "Por IMAP o por conector MCP (usa el conector de Hostinger)". La preferencia registrada hoy es DaMail como motor.

Son cosas distintas y no se pueden fundir:

- DaMail no es el conector de Hostinger. Es un producto de correo con su propio backend, su propia base y su propia interfaz. Adoptarlo como motor no cumple 4b "por conector MCP de Hostinger": cambia la decisión.
- Lo que sí sigue disponible es usar Hostinger como proveedor IMAP/SMTP por debajo de cualquiera de las tres alternativas, porque los buzones viven ahí.

Por eso `PREF-2026-11-16-PC1` queda registrada como insumo y no como decisión. Si el CEO confirma DaMail en PC1, hace falta una enmienda explícita a 4b que diga: el motor es DaMail; Hostinger queda como proveedor de buzones, no como conector MCP. Sin esa enmienda, PC1 no puede cerrarse con DaMail sin contradecir una decisión cerrada.

## 6. Credenciales expuestas: el CEO no rota

El 2026-11-17 el CEO decidió no rotar las claves que quedaron expuestas durante la preparación del piloto (contraseñas de buzón, token de Hostinger, la clave del proveedor anterior y el acceso root del VPS). La decisión es suya y queda registrada, no interpretada.

Consecuencias que se aceptan:

- El piloto corre con esas credenciales mientras el CEO no cambie de opinión. Ningún agente las usa ni las copia: el `.env` del repositorio está ignorado por git y la clave vigente se entrega solo por entorno.
- Las copias 3, 4 y 5 del material heredado (remoto cifrado con la frase junto al dato y `INBOX.Mesa-Backups`) siguen donde están. Retirarlas era la otra mitad del mismo riesgo y también queda en manos del CEO.
- Este registro no autoriza nada nuevo ni cierra un gate: deja escrito que el riesgo residual es una decisión del dueño y que ningún documento del proyecto lo presenta como resuelto.

La clave del proveedor que se usa hoy en el `.env` es nueva y se usó solo para la inspección con modelo real de O5-05; no aparece en ningún archivo versionado ni en la evidencia.

## 7. Decisiones que este trabajo no toma

- No elige motor, look, topes ni lista de espacios.
- No autoriza escritura, envío, despliegue, instalación ni transición.
- No convierte una preferencia en evidencia.
- No reabre decisiones cerradas del acta.

## 8. Preset del producto sin shell (2026-11-17)

La revisión independiente de O3 encontró que el perfil montaba el preset `standard` por defecto, que vuelve a registrar `tool-bash`, `tool-pwsh`, `tool-fs`, `tool-fs-search`, `tool-jobs` y `tool-web` por encima de las filas que el host apaga. Con shell, la promesa de E1 («toda vía montada deniega escritura») no se puede sostener: un comando abre su propio socket sin pasar por la autoridad.

Decisión aplicada: el bundle `faberloom-app` selecciona por defecto el preset `faberloom`, que omite esas seis filas y conserva persona, instrucciones, skills, goals, plan, compactación, delegación, todo, preguntas y presentación. El build web genérico conserva `standard`; no es el perfil del producto.

El perfil también cierra el selector (`modeSelectionEnabled: false`), que es un techo sobre el ajuste guardado: la lista de presets reporta la selección deshabilitada, un `default` guardado no mueve el preset y `select` rechaza el cambio. Sin ese techo, una persona podía volver a montar `standard` en una sesión nueva y recuperar el shell.

Pruebas: `packages/preset/agent-presets/tests/faberloom-preset.spec.ts` (filas y default), `settings.spec.ts` (techo y rechazo de `select`) y `apps/web/tests/preset-composition.e2e.ts`, que arranca base + web-app + faberloom-app, crea una sesión y comprueba el catálogo de herramientas (sin bash, pwsh, read, write, edit, web) y la presencia de `faberloom_mail_send`.

Consecuencia aceptada: el agente del producto pierde shell, sistema de archivos y web. Se revierte cambiando `default: faberloom` por `default: standard` y `modeSelectionEnabled: false` por `true` en el parche del bundle; entonces el gate deja de sostener su frase sobre el shell y hay que declararlo como vía montada.
