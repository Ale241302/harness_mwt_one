# E4 · curación de memoria antes del mes

Estado: **disponible con datos de prueba**; el informe real es de O10.

## Qué queda cerrado

| Pieza | Evidencia |
|---|---|
| Conservar, editar, unir, revocar y descartar con historial y versiones | `packages/faberloom/learning/tests/curation.spec.ts` |
| Unir deja un texto vigente y marca los demás `superseded`, sin duplicados | mismo spec |
| Descartar saca la enseñanza de la recuperación y conserva su historia | mismo spec |
| Una versión antigua no vuelve tras reiniciar sobre el mismo almacén | mismo spec |
| Informe con denominadores separados: propuestas, aprobadas, descartadas, revocadas, usadas, correcciones | `curationReport` y spec |
| Repetidos: el registro no dice si hubo sugerencia, así que se declara desconocido en vez de cero | `CurationReport.repeated` |
| Panel: estado, alcance, unir y descartar | `packages/client/ui-faberloom/src/client/panels.tsx` |

## Qué falta

| Requisito | Estado |
|---|---|
| PC3 `CLOSED` | **PENDIENTE**. El gate de O8C lo exige. |
| Informe con datos reales del mes | **O10**, sobre la semana y el mes reales. |
| Motivo de repetición con/sin sugerencia | **DESCONOCIDO** hasta que el registro guarde si se mostró una sugerencia. |

## Criterio de parada

Un cero solo se escribe cuando se observó cero. Un dato que la fila no guarda se publica como desconocido con su motivo.
