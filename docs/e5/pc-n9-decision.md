# Decisión de cierre · O11 / E5

Estado: **PLAN_N9_COMPLETO**. La ola O11 cierra como plan documental. El estado externo sigue siendo `NO LISTO PARA TERCEROS`.

| Campo | Valor |
|---|---|
| Contratos | C-FL-01, C-FL-02, C-FL-04, C-FL-08, C-FL-09, C-FL-10 |
| Ola / etapa | O11 / E5 |
| Paquete | N9 |
| Fecha | 2026-11-23 |
| Autoridad | Delegación del dueño del 2026-11-23 registrada en esta sesión |
| Entregable | [n9-plan.md](n9-plan.md) |
| Estado del cierre | PLAN_N9_COMPLETO |
| Estado externo | NO LISTO PARA TERCEROS |

La autoridad de cierre es la delegación del 2026-11-23 registrada en esta sesión. El registro previsto en `FaberLoom_tarea_2026-11-16/D/decisions/DEC-2026-11-23-DELEGACION-CIERRE.md` no existía al escribir esta decisión; cuando exista, prevalece como registro canónico de la delegación y esta decisión solo documenta el cierre que esa delegación autoriza.

## Qué se decide

1. O11 / E5 cierra como plan documental con estado `PLAN_N9_COMPLETO`.
2. El modo soportado declarado es instalación por dueño, sin multiempresa compartida y sin sincronización entre instalaciones.
3. La matriz de N9 cubre las reglas 8b, 11b, 11c, 12c y C-R6 y los ocho mínimos del paquete.
4. La ejecución de la matriz no ocurre en el piloto: ocurre en otro proyecto, con su propia aprobación.
5. El estado externo no cambia por esta decisión: sigue `NO LISTO PARA TERCEROS`.

## Lista de verificación

Cada fila de la matriz de §2 del plan tiene entrega, responsable, prueba, nivel y gate. Esta tabla lo confirma fila por fila; la redacción completa está en [n9-plan.md](n9-plan.md#2-matriz-requisito--entrega--responsable--prueba--nivel--gate).

| Fila | Entrega | Responsable | Prueba | Nivel | Gate |
|---|---|---|---|---|---|
| N9-01 · 8b | Inventario de credenciales con custodia, caducidad, rotación, revocación e incidente | C-FL-04 prepara; CEO aprueba | P-N9-01 · sustitución con rechazo de la anterior | C1-I | GATE-N9-CRED |
| N9-02 · 11b | Suite de aislamiento entre instalaciones y entre usuarios | C-FL-04 con C-FL-02 | P-N9-02 · casos de §5 con rechazo y control positivo | C1-I | GATE-N9-ISOLATION |
| N9-03 · 11c | Declaración de no oferta y rechazo de configuración de sincronización | C-FL-01 | P-N9-03 · la composición rechaza el emparejamiento | C1-E | GATE-N9-SCOPE |
| N9-04 · 12c | Inventario por tipo de dato, plazos, eliminación y revisión previa a publicar | C-FL-08 con C-FL-10 | P-N9-04 · eliminación sin residuo en almacén, copias y respaldos | C1-E | GATE-N9-DATA |
| N9-05 · C-R6 | Procedimiento de reevaluación y qué invalida un pase anterior | C-FL-01 con C-FL-09 | P-N9-05 · sin evidencia nueva el veredicto vuelve a NO LISTO | C1-I | GATE-N9-REEVAL |
| N9-06 · alcance | Declaración de instalación por dueño publicada junto al producto | C-FL-10 | P-N9-06 · dos instalaciones no comparten rutas ni credenciales | C1-I | GATE-N9-SCOPE |
| N9-07 · datos | Inventario de §4 aplicado a una instalación real | C-FL-02 con C-FL-04 | P-N9-07 · inventario contra el sistema de archivos y la base | C1-E | GATE-N9-DATA |
| N9-08 · responsables | Dueño y suplente por dato, credencial, artefacto y gate | C-FL-01 | P-N9-08 · ninguna fila sin dueño | C1-L | GATE-N9-OWNER |
| N9-09 · artefactos | Lista cerrada de artefactos publicables | C-FL-08 con C-FL-09 | P-N9-09 · §3 ejecutado sobre el candidato | C1-E | GATE-N9-RELEASE |
| N9-10 · casos | Casos de aislamiento con entrada, acción, resultado y evidencia | C-FL-04 con C-FL-07 | P-N9-10 · suite completa en composición representativa | C1-I | GATE-N9-ISOLATION |
| N9-11 · rotación | Calendario por credencial con ventana y caducidad forzada | C-FL-04 con C-FL-08 | P-N9-11 · rotación sin corte y caducidad explícita | C1-I | GATE-N9-CRED |
| N9-12 · eliminación | Procedimiento por tipo de dato, incluidos copias y respaldos | C-FL-08 | P-N9-12 · restaurar y documentar qué reaparece | C1-E | GATE-N9-DATA |
| N9-13 · publicación | Checklist de §3 firmado por revisión independiente y CEO | C-FL-09 con CEO | P-N9-13 · revisión independiente del candidato | C1-E | GATE-N9-RELEASE |

Trece filas, cinco campos cada una. Ningún gate está concedido y ninguna prueba está ejecutada.

## Estado externo y reactivación

Estado externo: `NO LISTO PARA TERCEROS`. Esta decisión no autoriza publicar, distribuir ni permitir uso por terceros, y no cuenta como certificación parcial de 8b, 11b, 11c, 12c ni C-R6.

Disparador de reactivación: el primer evento entre publicar un artefacto y permitir el uso por terceros. Cualquiera de los dos abre el gate, exige la matriz ejecutada en el proyecto correspondiente y exige la autorización del CEO antes de continuar.

Condiciones de reactivación, todas obligatorias:

- Las trece filas con evidencia del nivel declarado en §2 del plan.
- La revisión de artefactos de §3 cerrada, con la salida de cada paso conservada.
- La revisión independiente C-FL-09 sin hallazgos abiertos.
- Autorización del CEO registrada por escrito para el alcance concreto.

Si alguna condición falta, el estado sigue siendo `NO LISTO PARA TERCEROS`. Un artefacto publicado no hereda el pase de otro artefacto y una instalación nueva no hereda la evidencia de la anterior.

## Límites de esta decisión

- No ejecuta la matriz ni adelanta su resultado.
- No concede `GATE-N9-CRED`, `GATE-N9-ISOLATION`, `GATE-N9-SCOPE`, `GATE-N9-DATA`, `GATE-N9-OWNER`, `GATE-N9-REEVAL` ni `GATE-N9-RELEASE`.
- No modifica el alcance del piloto ni habilita multiempresa, sincronización o retención formal de terceros.
- No sustituye el registro de la delegación cuando ese registro exista.

## Criterio de parada

Cualquier uso de este documento como permiso de publicación, cualquier afirmación de aislamiento entre empresas y cualquier pase dado sin evidencia nueva devuelven `NEEDS_WORK` y obligan a reabrir O11.
