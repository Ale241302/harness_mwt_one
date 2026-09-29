---
name: sicop-contratacion-publica
description: "Consulta los datos abiertos de contratación pública de Costa Rica (SICOP) con las tools MCP `sicop_*`. Úsala para investigar un proveedor (captación vs ejecución), comparar oferentes, ver la historia de precios de un producto por año, revisar un procedimiento (NRO_SICOP), detectar carteles objetados o sanciones, buscar oportunidades (ofertó más barato y perdió) o medir un mercado por familia UNSPSC. Toda cifra de negocio viaja con su sobre (nivel_medicion, cobertura_cruce, moneda, caveats); no la separes de él."
---

# SICOP · contratación pública de Costa Rica

Los datos abiertos de SICOP (2020-2026) están expuestos por el MCP `sicop`, montado para todos los usuarios. Sus tools se llaman `mcp__sicop__<tool>`.

## Cuándo usarla

- Investigar un proveedor por cédula (`CEDULA_PROVEEDOR`): qué adjudicó, qué ejecutó, en qué instituciones, con qué desempeño.
- Ver el mercado de una familia UNSPSC (quiénes compiten, a qué precios).
- Reconstruir la historia de precios de un producto por año (`codigo_cl`).
- Revisar un procedimiento por `NRO_SICOP`: expediente, competencia por línea, régimen de evaluación, invitados.
- Detectar riesgo: carteles objetados, excepciones, sanciones, representantes que compiten entre sí.
- Buscar oportunidades: líneas donde el proveedor ofertó más barato y perdió.

## Antes de empezar

- `sicop_resumen` o `sicop_gold_status` para confirmar que la capa gold está cargada y vigente.
- `sicop_campo_buscar` cuando no sepas el nombre exacto de una columna o familia.

## Regla del sobre (obligatoria)

Toda respuesta de negocio trae un sobre con `nivel_medicion`, `cobertura_cruce` (0.626), `moneda` y `caveats`. Repórtalo junto a la cifra:

- **Nivel de medición**: `captacion` = adjudicaciones · `ejecucion` = órdenes de pedido · `entrega` = recepciones. Medir por adjudicaciones subestima hasta 59x frente a la ejecución.
- **Cobertura**: el cruce oferta × oferente cubre el 62,6%; toda comparación de competencia es parcial hasta que cargue el recuperado.
- **Moneda**: las órdenes traen CRC/USD/EUR/JPY/GBP y **solo los colones son sumables**. No mezcles monedas ni sumes precios sin declarar la moneda.

Una cifra sin su sobre es una respuesta incorrecta.

## Herramientas principales

- Proveedor: `sicop_ficha_proveedor` (ejecución vs captación), `sicop_precios_institucion`, `sicop_perdidas_baratas`, `sicop_cara_a_cara` (dos proveedores).
- Mercado y producto: `sicop_mercado_familia`, `sicop_producto`, `sicop_producto_historia`.
- Procedimiento: `sicop_expediente`, `sicop_competencia_procedimiento`, `sicop_regimen_evaluacion`.
- Riesgo: `sicop_carteles_objetados`, `sicop_excepciones`, `sicop_sanciones`, `sicop_representantes`, `sicop_representante_competencia`.
- Búsqueda y diagnostico: `sicop_campo_buscar`, `sicop_resumen`, `sicop_gold_status`.
- Capa canónica (hechos): `sicop_fact_requerimiento/oferta/adjudicacion/contrato/orden/recepcion`, `sicop_catalogo_campo`, `sicop_ctl_deriva`, `sicop_regimen`, `sicop_competencia_por_regimen`.
- Extras dirigidos: `sicop_cgr_buscar` (resoluciones CGR, **uso dirigido, no barrido**), `sicop_bccr_tc` (tipo de cambio oficial; sin token devuelve el TC implícito marcado como tal).

## Flujo típico (ficha de proveedor)

1. `sicop_ficha_proveedor` con la cédula.
2. Separa captación (adjudicado) de ejecución (órdenes) y declara ambas.
3. Baja a instituciones y líneas relevantes con `sicop_precios_institucion` / `sicop_mercado_familia`.
4. Cierra con el sobre completo y los caveats.

## Datos crudos: nulos y tipos (importante)

El MCP devuelve datos crudos, no limpios. Antes de ordenar, unir o sumar:

- Muchos campos vienen `null` o vacíos (`NRO_SICOP` puede ser `null` en cientos de filas, igual que `NRO_OFERTA`, `NRO_ACTO`, `DESCUENTO`, `IVA`, `OTROS_IMPUESTOS`, `ACARREOS`, `TIPO_CAMBIO_*`). `sorted()`/`','.join()` sobre un conjunto que contenga `None` revienta con `TypeError`; normaliza siempre: `[str(v) for v in xs if v is not None]`.
- **No asumas el esquema.** Imprime `list(rows[0].keys())` de una fila antes de usar campos, y usa `.get()` con valor por defecto. `sicop_adjudicaciones(cedula=...)` trae `NRO_SICOP` (nullable) pero **no** institución, año ni label de procedimiento; para ubicar el cartel/institución usa `sicop_expediente`, `sicop_preguntar` o `sicop_competencia_procedimiento`.
- Coacciona antes de operar: `r.get('CANTIDAD_ADJUDICADA') or 0`, `float(...)` con guarda, y filtra `None`.

Patrón seguro para agrupar e imprimir:

```python
def s(v):  # nunca metas None a sorted()/join()
    return '' if v is None else str(v)

for k, v in sorted(d.items()):
    sicos = ','.join(sorted({s(x) for x in v['sicos']}))
    monedas = ','.join(sorted({s(x) for x in v['moneda']}))
    print(k, '| lineas:', v['n'], '| sicop:', sicos, '|', monedas, round(v['monto'], 2))
```

## Anti-patrones

- No inventes montos, códigos, cédulas ni adjudicaciones: si no lo devolvió una tool, no existe para la respuesta.
- No sumes montos de distintas monedas ni de distintos niveles de medición.
- No presentes competencia como completa por encima del 62,6% de cobertura.
- No hagas barridos con `sicop_lab_sql` ni con el buscador CGR: son de uso dirigido.
- `inhibiciones` contiene datos de funcionarios; no publiques consolidados sin decisión expresa (Ley 8968).

## Entrega

Resume: la entidad consultada (proveedor por cédula, producto por `codigo_cl`, procedimiento por `NRO_SICOP`), la cifra con su nivel de medición y moneda, la cobertura aplicable, y las tools usadas. Si algo quedó fuera de la cobertura o no es consultable, dilo.
