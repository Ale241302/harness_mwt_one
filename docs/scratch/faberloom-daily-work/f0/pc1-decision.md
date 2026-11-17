# Decisión PC1

Estado: **FIRMADA** por instrucción expresa del CEO del 2026-11-16. Registro completo y condiciones: `decisions/PC1-2026-11-16.md`.

## 1. Lo firmado

| Campo | Valor |
|---|---|
| Motor | **DaMail** |
| Alternativas | Hostinger descartada como motor; extensión propia descartada para este piloto |
| Nivel | PILOTO |
| Tope | 155 jornadas efectivas; si se excede, se saca alcance, no pruebas |
| Enmienda a 4b | **Sí**: Hostinger es proveedor de buzones; DaMail es el motor |
| Semana real | Se fija al cerrar PC4 |
| Umbral del mes | Se fija en PC6 con datos reales |

## 2. Insumo que sostiene la firma

| Evidencia | Estado |
|---|---|
| Comparación de tres alternativas con fuentes y límites | `f0/motor-comparison.md` |
| Recomendación condicional con ocho condiciones | `f0/motor-recommendation.md` |
| Rangos con supuestos escritos | `f0/effort-ranges.md` |
| Volumen real medido: 6.301 mensajes, 1,51 GiB, 928 en 90 días | `volume-report.md` |
| Buzones en Hostinger, no en mailcow | `volume-report.md` §3 |
| Baseline del producto: 212-213 fallos | `baseline.md` |
| `PREC-05` (dos niveles) | `decisions/RAT-2026-11-16-PREC.md` |

## 3. Lo que la firma no habilita

- Instalar DaMail en producción.
- Conectar los buzones reales en escritura (`AUTH-REAL-WRITE`, PC4).
- Desplegar en el servidor (`AUTH-DEPLOY`).
- Modificar núcleo (`AUTH-CORE`).
- Escribir en expedientes (`AUTH-MWT-WRITE`).
- Declarar la integración `C1-I`.

## 4. Condiciones abiertas que bloquean la integración

Las ocho de `f0/motor-recommendation.md` §3. La primera y la tercera son las que más riesgo tienen: aprobar en DaMail no es aprobar en FaberLoom, y el aislamiento de borradores por creador está por probar.

## 5. Revocación

Por escrito del CEO. Si cambia el motor, se reescribe esta página y se reevalúan las condiciones; no se heredan de DaMail.
