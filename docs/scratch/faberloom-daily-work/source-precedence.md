# Precedencia de fuentes y contradicciones registradas

Contrato: C-FL-02 / O0-01 / FM-O0-01 Nivel: C1-L sobre las fuentes locales. No acredita comportamiento del producto. Fecha: 2026-11-16

## 1. Universo inventariado

21 archivos, 21 huellas SHA-256 recalculadas en esta sesión. El detalle byte a byte está en `source-hashes.json`, generado desde los archivos, no transcrito a mano.

| Grupo | Archivos | Función |
|---|---|---|
| Canónicos | `1_TAREA_BASE_FaberLoom_v1.2.md`, `2_TAREA_DETALLADA_FaberLoom_v1.0.md`, `3_ACTA_DECISIONES_CEO_v1.1.md` | Vigentes y vinculantes |
| Índice | `LEEME.txt` | Orden de lectura y advertencia de evidencia |
| Historia | `discusion/01` a `discusion/17` | Origen de las reglas. No es una segunda lista de trabajo |

Las huellas de los tres canónicos y de `LEEME.txt` coinciden con las registradas en `tasks/fuentes-y-precedencia.md` §7 (`AC812F3E…`, `4B19FDDD…`, `E4FA0A79…`, `9B79732E…`). Ninguna fuente canónica fue modificada.

## 2. Orden de precedencia aplicado

1. `3_ACTA_DECISIONES_CEO_v1.1.md`: decisiones cerradas del CEO. No se reabren por este trabajo.
2. `1_TAREA_BASE_FaberLoom_v1.2.md`: principios, certeza, seguridad, apariencia y pendientes.
3. `2_TAREA_DETALLADA_FaberLoom_v1.0.md`: etapas, N0-N9, T1-T25 y puntos de control. Si sus secciones 1-8 contradicen a las 12-14, mandan las 12-14.
4. Fuentes locales con huella verificable por encima de referencias remotas sin contenido aportado.
5. `discusion/*`: explica el origen, no fija alcance vigente.
6. Precisiones Claude/Astra: base de trabajo, ratificación expresa separada (§4).
7. `PLAN_CORREO_WORKBENCH.md` y su elección de Metis: otro alcance multiusuario. No decide el motor de este plan.
8. `DESIGN_MESA.md`: dirección visual histórica. Cualquier conflicto con aprobación exacta y las nueve pruebas de apariencia se resuelve antes de las pantallas finales.

Identificadores que no se mezclan: `F0`-`E5` (etapas), `N0`-`N9` (paquetes), `T1`-`T25` (casos), `T*-F1/E1/E2/E4` (partes), `R2-1`-`R2-18` (precisiones), 35 reglas de §14, `APA-01`-`APA-12` (histórico ya incorporado), `AS-R01`-`AS-R38` (antislop de este plan).

## 3. Contradicciones registradas y su tratamiento

Ninguna se resuelve por preferencia. Cada una tiene dueño y puerta.

| # | Tema | Conflicto real | Estado | Se resuelve en |
|---:|---|---|---|---|
| K-01 | Versión y hash en aprobación | `DESIGN_MESA.md` histórico los oculta; la regla 7 y la apariencia vigente exigen mostrarlos | ABIERTA | F1 ficha visual; PC2 no aprueba pantalla que oculte datos exigidos |
| K-02 | Dials visuales | La dirección histórica usa otra escala; antislop manda 1-3 | ABIERTA | O2-01, dos fichas propias |
| K-03 | Metis | `PLAN_CORREO_WORKBENCH.md` eligió Metis y descartó DaMail; este plan compara tres alternativas | RESUELTA POR PRECEDENCIA (§2.7) | Sin reapertura. F0-4/PC1 decide |
| K-04 | DaMail desplegado | La tarea lo trata como alternativa disponible; el inventario del VPS no lo encuentra | ABIERTA | Instalarlo exige `AUTH-LAB-SERVICE` y decisión posterior |
| K-05 | Motor por extensión | Es una alternativa, no una decisión | ABIERTA | PC1 |
| K-06 | Respaldo | Hay respaldo remoto informado `OK`; no hay restauración demostrada | ABIERTA | N6 y O5-07A. No se afirma recuperación |
| K-07 | Rutina activa | Configuración declara `INBOUND_ENABLED=1`; no hay efecto observado | ABIERTA | O0-03, O3-05 y `AUTH-ROUTINE-TRANSITION` |
| K-08 | Precisión técnica | Claude y Astra la acordaron; el acta no la ratifica | RESUELTA el 2026-11-16 | `decisions/RAT-2026-11-16-PREC.md`: otorgada por instrucción expresa, firma sin manuscrito |
| K-09 | `faberloomConfigured` | `/healthz` devuelve `false` mientras `DSH_PROFILE=faberloom` | ABIERTA | O0-03: hay que leer `gateway/server.mjs` para saber qué mide el campo |
| K-10 | Estado de autorización del inventario | El paquete anterior marcaba `AUTORIZACIÓN_NO_DEMOSTRADA` | RESUELTA el 2026-11-16 | `decisions/AUTH-2026-11-16-F0-2.md`: otorgada por instrucción expresa |
| K-11 | Credenciales en claro en el workspace | `deepseek-harness/.git/config` y `.git/lfs/logs/` contienen un PAT de GitHub con push; `desktop-home-env.json` contiene una clave de API DeepSeek | ABIERTA, **bloqueante para E1** | Rotación por el CEO. Registrada en `baseline.md`; no se corrigió en silencio |

## 4. Decisiones firmadas por instrucción del CEO

Solicitante: Alejandro (CEO). Sesión de trabajo del 2026-11-16. Las respuestas fueron explícitas, no inferidas de "usar las decisiones".

| ID | Decisión | Texto registrado | Efecto |
|---|---|---|---|
| RAT-2026-11-16-PREC | Ratificación de las seis precisiones | "Ratifico las seis" + "Firmar en decisions/" | `PREC-01` a `PREC-06` **OTORGADAS** por instrucción expresa, con registro en `decisions/RAT-2026-11-16-PREC.md`. Firma de tipo instrucción en sesión, sin manuscrito |
| AUTH-2026-11-16-F0-2 | Autoriza el inventario del VPS | "Inventario del VPS" | `AUTH-F0-2-SERVER` **OTORGADA**. Inventario ejecutado y ampliado con conteos y roles |
| AUTH-2026-11-16-F0-7 | Autoriza la medición de buzones | "Medición de buzones reales" | `AUTH-F0-7` **OTORGADA** y **ejecutada**: 6.301 mensajes, 1,51 GiB, sin leer contenido |
| AUTH-2026-11-16-PROBE | Autoriza sonda real de Hostinger | "Sonda Hostinger real" | `AUTH-REAL-PROBE` **OTORGADA**. Sigue sin token de API: las contraseñas de buzón no son un token de hPanel |
| AUTH-2026-11-16-LAB | Autoriza el laboratorio de servicios | "Autorizar el laboratorio de servicios" | `AUTH-LAB-SERVICE` **OTORGADA**. GreenMail 2.1.0 corriendo; 5/5 verificaciones en verde |
| PC1-2026-11-16 | Motor, alcance y topes | "Firmar PC1 con motor, topes y la enmienda a 4b si el motor es DaMail" | **PC1 FIRMADA**: DaMail, PILOTO, tope 155 jornadas, enmienda a 4b aplicada |

Una preferencia de motor no sustituye una prueba de motor. `PREF-2026-11-16-PC1` se cita en `f0/motor-recommendation.md` como condición del CEO, no como recomendación técnica alcanzada.

## 5. Alcance exacto de `AUTH-F0-2-SERVER`

| Campo | Valor |
|---|---|
| Autoriza | Conexión SSH de solo lectura al VPS en uso y consulta de metadatos operativos |
| Destino | servidor del CEO por SSH con clave, puerto no estándar. Valor exacto redactado por custodia |
| Permite | `ls`, `find` de nombres, `git log/status/rev-parse`, `docker ps/inspect` de metadatos, `printenv` de variables no secretas seleccionadas, `stat`, `df`, `ss`, `systemctl list-units` |
| Prohíbe | Leer `.env`, claves, tokens, contraseñas, cookies, contenido de correo, adjuntos, memorias o logs de aplicación |
| Prohíbe | Escribir, instalar, reiniciar, desplegar, cambiar permisos o mover archivos |
| Custodia | Evidencia `INTERNAL` en `docs/scratch/faberloom-daily-work/` y en `tasks/evidence/`. Sin copia a destinos públicos |
| Vigencia | Un solo inventario. Una nueva sesión o una nueva máquina exige renovarlo |

## 6. Límites de este documento

- No demuestra que el producto implemente nada. Solo fija qué fuente manda y qué quedó sin resolver.
- Las huellas identifican contenido; no prueban que ese contenido sea correcto.
- `K-11` no se repara aquí: una credencial rotada por un agente sin autorización sigue siendo una credencial expuesta en el historial.
