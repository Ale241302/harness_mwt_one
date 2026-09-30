---
name: sicop-contratacion-publica
description: "Consulta y analiza la contratación pública de Costa Rica (SICOP) por el MCP `sicop_*`. Úsala cuando se pregunte por licitaciones, carteles, ofertas, adjudicaciones, contratos, órdenes de pedido, proveedores, precios o mercado de SICOP; cuando se use cualquier tool `mcp__sicop__*`; o cuando se mencione SICOP, contratación administrativa CR, Ley 9986 u Observatorio de Compra Pública. Toda cifra viaja con su sobre (nivel_medicion, cobertura, moneda, caveats)."
---

# SICOP · contratación pública de Costa Rica

Los datos abiertos de SICOP (2020-2026) están expuestos por el MCP `sicop`, montado para todos los usuarios. Sus tools se llaman `mcp__sicop__<tool>`. Esta skill es la puerta de entrada: cárgala **siempre** antes de consultar el MCP.

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
- **Cobertura**: el cruce oferta × oferente cubre el 62,6%; el archivo del primer mes de un año cubre apenas el 8%. Toda comparación de competencia es parcial y hay que decirlo.
- **Moneda**: las órdenes traen CRC/USD/EUR/JPY/GBP y **solo los colones son sumables**. No mezcles monedas ni sumes precios sin declarar la moneda.

Una cifra sin su sobre es una respuesta incorrecta.

## Los cuatro niveles de medición — captación no es venta

```
Cartel → Oferta → ADJUDICACIÓN → Contrato → ORDEN DE PEDIDO → Recepción → Pago
                  ↑ captación                ↑ ejecución recurrente
```

| Nivel | Etiqueta del sobre | Qué mide |
|---|---|---|
| Captación | `captacion` | ganar el derecho a vender (`adjudicaciones`) |
| Formalización | — | el contrato y sus prórrogas (`contratos`) |
| **Ejecución** | **`ejecucion`** | **la venta recurrente** (`ordenes_pedido`) |
| Entrega | `entrega` | lo efectivamente recibido (`recepciones`) |

Magnitud verificada: un proveedor real de 2026 mostraba ₡15,5 M de captación contra **₡918,5 M de ejecución (59x)**; el mercado nacional 2026 fue ₡89.131 M captado contra ₡456.263 M ejecutado (5,1x). **96,9% de la ejecución de un año viene de procedimientos de años anteriores.** Nunca midas el negocio de un proveedor solo con adjudicaciones.

## Trampas de `ordenes_pedido`

- **`TOTAL_ORDEN` está replicado en cada línea**: es el total de la orden completa, no de la línea. Sumarlo en crudo infla ~3x. Deduplica por `NRO_ORDEN` o marca la repetición.
- **La moneda manda**: hay casi tantas órdenes en USD como en colones. Sumar sin convertir divide por ~510 a quien factura en dólares. Convertir por `FECHA_ELABORACION_ORDEN` antes de cualquier ranking, y solo sumar lo que esté en la misma moneda.
- **`ordenes_pedido` no baja a producto**: llega a proveedor × institución × monto. Cualquier cifra de ejecución por producto obtenida desde órdenes es una cota superior y se rotula así.
- Hay outliers de la fuente (órdenes > ₡1e12). Repórtalos, **no los sumes**.

## Herramientas principales

- Proveedor: `sicop_ficha_proveedor` (ejecución vs captación), `sicop_precios_institucion`, `sicop_perdidas_baratas`, `sicop_cara_a_cara` (dos proveedores).
- Mercado y producto: `sicop_mercado_familia`, `sicop_producto`, `sicop_producto_historia`.
- Procedimiento: `sicop_expediente`, `sicop_competencia_procedimiento`, `sicop_regimen_evaluacion`.
- Riesgo: `sicop_carteles_objetados`, `sicop_excepciones`, `sicop_sanciones`, `sicop_representantes`, `sicop_representante_competencia`.
- Búsqueda y diagnóstico: `sicop_campo_buscar`, `sicop_resumen`, `sicop_gold_status`.
- Capa canónica (hechos): `sicop_fact_requerimiento/oferta/adjudicacion/contrato/orden/recepcion`, `sicop_catalogo_campo`, `sicop_ctl_deriva`, `sicop_regimen`, `sicop_competencia_por_regimen`.
- Extras dirigidos: `sicop_cgr_buscar` (resoluciones CGR, **uso dirigido, no barrido**), `sicop_bccr_tc` (tipo de cambio oficial; sin token devuelve el TC implícito marcado como tal).

## Flujo típico (ficha de proveedor)

1. `sicop_ficha_proveedor` con la cédula.
2. Separa captación (adjudicado) de ejecución (órdenes) y declara ambas.
3. Baja a instituciones y líneas relevantes con `sicop_precios_institucion` / `sicop_mercado_familia`.
4. Cierra con el sobre completo y los caveats.

## Claves crudas (`_claves`) vs etiquetas, y nulos

El MCP presenta cada fila con **etiquetas legibles** de primer nivel y mueve los **códigos crudos** a `_claves`:

- Usa las etiquetas de primer nivel: `NRO_PROCEDIMIENTO`, `PROCEDIMIENTO_LABEL`, `INSTITUCION`, `NOMBRE_PROVEEDOR`, `TIPO_MONEDA`, etc. Es lo que debe aparecer en tu respuesta.
- Los códigos crudos (`NRO_SICOP`, `CEDULA_PROVEEDOR`, `CEDULA_INSTITUCION`, …) pueden venir en `_claves`, **no** en el primer nivel. Si necesitas el código para programar, léelo de ahí:
  `nro = r.get('NRO_SICOP') or (r.get('_claves') or {}).get('NRO_SICOP')`.
- **No asumas dónde está un campo.** Antes de usarlo imprime `list(rows[0].keys())` y `rows[0].get('_claves')`.

Además, algunos campos sí pueden ser `null` (`NRO_OFERTA`, `NRO_ACTO`, `DESCUENTO`, `IVA`, `OTROS_IMPUESTOS`, `ACARREOS`, `TIPO_CAMBIO_*`, y `_claves` puede faltar). `sorted()`/`','.join()` con un `None` dentro revienta con `TypeError`; normaliza con `str(v)` y filtra `None`.

Patrón seguro para agrupar e imprimir:

```python
def s(v):  # nunca metas None a sorted()/join()
    return '' if v is None else str(v)

for k, v in sorted(d.items()):
    sicos = ','.join(sorted({s(x) for x in v['sicos']}))
    monedas = ','.join(sorted({s(x) for x in v['moneda']}))
    print(k, '| lineas:', v['n'], '| sicop:', sicos, '|', monedas, round(v['monto'], 2))
```

## Defectos conocidos del servidor MCP (`sicop_*`)

Registrados con expediente. No confíes en estos campos sin control:

| Id | Defecto | Consecuencia |
|---|---|---|
| D1 | `fact_adjudicacion.PU_ADJUDICADO` es el precio **estimado del cartel**, no el adjudicado | No uses ese campo como precio ganador |
| D2 | `competencia_procedimiento` puede venir vacía aunque haya líneas cargadas | Contrasta con la capa de hechos |
| D3 | El catálogo presta la **marca de un contrato cualquiera** a nivel CL16 | No uses `MARCA`/`MODELO` del servidor en un análisis |
| D4 | `campo_buscar` no busca en modelo | Busca por descripción/familia, no por modelo |
| D5 | `integridad` ignora el mes | No la uses para acotar por período |
| D6 | `fact_adjudicacion` repite un solo `NRO_ACTO` por expediente | No cuentes actos desde ahí |
| D7 | El ZIP `202501` trae exactamente 1.000 carteles y tablas de líneas vacías (**fuente**) | Un conteo redondo es un techo, no un total |
| D8 | `LineasOfertadas` solo existe para expedientes con `LineasAdjudicadas` (**fuente**) | El precio de perdedores es visible solo cuando hay ganador (≈15%) |
| D9 | `fact_adjudicacion` devuelve filas sin `NRO_LINEA` | No agrupes por línea sin filtrar nulos |
| D10 | `sicop_lineas_procedimiento` **trunca cada lista en 1.000 filas** | Un conteo de 1.000 es un techo hasta probar lo contrario |

**Regla general:** un conteo redondo (1.000, 500, 200) es un techo hasta demostrar lo contrario.

## Identidad de producto

- `CODIGO_PRODUCTO` = 24 dígitos; `CODIGO_PRODUCTO_CL` = sus primeros 16. En `lineas_cartel` el código de 16 vive en `CODIGO_IDENTIFICACION`. Anidamiento verificado: 96,9%. **El join cartel ↔ oferta es por prefijo `[:16]`, nunca por igualdad.**
- **Un código no es un producto**: el mismo CL contiene productos distintos (CATERPILLAR USD 131 vs PAT PARATROOPERS USD 31) y un producto se dispersa en varios códigos. Nunca agrupes precios solo por código.
- **Marca y modelo solo existen donde se ejecuta**: viajan embebidos como `Marca X Modelo Y` en las tablas de ejecución/contrato/recepción (cobertura 99,6%). La identidad de una **oferta perdedora no es recuperable**. Se declara, no se busca.
- Antes de comparar precios, verifica **unidad y presentación** (una talla = un código; una referencia puede venderla un solo proveedor).

## Rotular el período — «2026» no significa lo mismo en todas las tablas

| Tabla | Qué significa «2026» |
|---|---|
| `carteles` | Procedimientos **publicados** en 2026 (100%) |
| `adjudicaciones_firme` | Actos en firme en 2026 (100%) |
| `adjudicaciones` | **Actividad observada**, no procedimientos de 2026 (solo 57,3%) |
| `contratos` | Ídem, 46,7% |
| `lineas_recibidas` | Ídem, 25,5% |

Di siempre si una cifra es «procedimientos publicados en el año» o «actividad ocurrida en el año». **No es lo mismo.** Y el mes de corte suele ser parcial: dilo.

## Vocabulario — Ley 9986

| SICOP rotula | La Ley 9986 dice |
|---|---|
| cartel | **pliego de condiciones** |
| recurso de revocación | **recurso de revocatoria** |
| licitación pública / abreviada | **licitación mayor / menor / reducida** |

Conserva el nombre del campo en el dato, usa el término vigente en el texto, y declara la diferencia una vez.

## Anti-patrones

- No inventes montos, códigos, cédulas ni adjudicaciones: si no lo devolvió una tool, no existe para la respuesta.
- No sumes montos de distintas monedas ni de distintos niveles de medición.
- No presentes competencia como completa por encima del 62,6% de cobertura.
- No hagas barridos con `sicop_lab_sql` ni con el buscador CGR: son de uso dirigido.
- No conviertas una ausencia de dato en un dato: «no aparece en el cruce» no es «no participó».
- No califiques jurídicamente: «oferta única» es una conclusión con carga legal; di **«un solo oferente identificado por el cruce»**.
- Nada de pantallas de colusión: las señales son cola de revisión, nunca conclusión.

## Privacidad

Los datos son públicos pero contienen datos personales. `inhibiciones` son **personas nombradas**; no publiques consolidados sin decisión expresa (Ley 8968, principio de finalidad). Una fuente pública no es automáticamente usable de forma masiva: uso dirigido y documentado sí, barrido universal no.

## Entrega

Resume: la entidad consultada (proveedor por cédula, producto por `codigo_cl`, procedimiento por `NRO_SICOP`), la cifra con su nivel de medición y moneda, la cobertura aplicable, y las tools usadas. Si algo quedó fuera de la cobertura o no es consultable, dilo.

## Referencia profunda

Para **extraer, descargar y parsear** los ZIP del Observatorio (esquema de los 25 CSV, joins, defectos de la fuente, automatización), usa la skill `sicop-extraccion`. Esta skill es para **consultar y responder** por el MCP.
