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
| DC-1 | Transición y continuidad útil de la rutina de correo en vivo | ABIERTA | Antes de aplicar §5.5 en producción. Exige `AUTH-ROUTINE-TRANSITION` |
| DC-2 | Autorizar el inventario del servidor en uso (F0-2) | **OTORGADA 2026-11-16** (`AUTH-2026-11-16-F0-2`) | Inventario ejecutado en `server-inventory.md` |
| DC-3 | Consecuencia para los avisos automáticos | ABIERTA, tratamiento ya fijado por la regla 4: avisos internos persistentes, cero correo automático | Se registra al cerrar O3 |
| DC-4 | Uso y alcance de la entrega gradual E1 | ABIERTA | Al presentar demos a-d (O5-08) |

Ninguna DC levanta la prohibición de autoenvío ni de S4 sin aprobación (R2-7).

## 3. Puntos de control y gates

| Gate | Qué se firma | Estado | Falta |
|---|---|---|---|
| PC1 | Motor, alcance y topes | **FIRMADA 2026-11-16** | DaMail, PILOTO, 155 jornadas, enmienda a 4b |
| PC2 | Look y disposición | ABIERTO | O2 completo; `PREC-06` ya ratificada |
| PC3 | Lectura real de ambos buzones | ABIERTO | O3-O5 y `AUTH-REAL-READ` |
| PC4 | Escritura y envío | ABIERTO | O6-O7 y `AUTH-REAL-WRITE` |
| SEMANA | Aceptación o rechazo tras una semana real | ABIERTO | O9 |
| PC5-M | Expedientes | ABIERTO | O8A |
| PC5-A | Reglas S3 | ABIERTO | O8B |
| E4-listo | Curación disponible antes del mes | ABIERTO | O8C |
| PC6 | Umbral del mes y continuidad | ABIERTO | O10, con umbral fijado por el CEO sobre datos reales |
| N3 | Lista de espacios ya creados | ABIERTA | Insumo del CEO. No se inventan espacios |
| N9 | Modo para terceros | ABIERTO | O11. Nunca emite `TERCEROS_LISTOS` en este plan |

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
