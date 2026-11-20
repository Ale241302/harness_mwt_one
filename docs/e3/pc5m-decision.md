# PC5-M · expedientes

Estado: **mecanismo cerrado, escritura real pendiente de firma**. PC4 no está `CLOSED`, así que el gate no se declara abierto.

## Qué queda cerrado

| Pieza | Evidencia |
|---|---|
| Propuesta con expediente exacto, campos con unidad, documentos con bytes y SHA-256, versión previa y ambigüedades | `packages/faberloom/effects-mwt/tests/expediente.spec.ts` |
| Autorización de un solo uso por revisión (`AUTH-MWT-WRITE` en el producto) | mismo spec: sin autorización no escribe; consumida no repite |
| Revalidación de destino y escritura única con clave de idempotencia | mismo spec: versión cambiada = `VERSION_CONFLICT`, sin escritura |
| Resultado perdido como desconocido y conciliación humana | mismo spec: `RESULT_UNKNOWN` y `reconcile` |
| Adaptador `mwt.write` del S4: consume una autorización existente, nunca la crea | `effects-mwt/src/index.ts` |

## Qué falta y quién lo firma

| Requisito | Estado |
|---|---|
| `AUTH-MWT-WRITE` por operación real | **PENDIENTE — CEO**. La autorización se registra en el producto antes de cada escritura y vale una sola vez. |
| Transporte real de MWT.ONE (MCP, credenciales, límites) | **PENDIENTE — despliegue**. El paquete no incluye endpoint ni credencial. |
| PC4 `CLOSED` | **PENDIENTE**. Sin él, PC5-M no se abre. |
| T23 con escritura real observada | **PENDIENTE**. El mecanismo está probado con destino falso; la lectura posterior real no se ejecutó. |

## Criterio de parada

Sin autorización no hay escritura; con autorización se escribe una vez; una respuesta perdida no se reintenta sola; el administrador no sustituye la aprobación.
