---
name: sicop-extraccion
description: Extraer, verificar y analizar la contratación pública de Costa Rica (SICOP) desde los datos abiertos del Observatorio de Compra Pública — carteles, ofertas con precio unitario por línea, oferentes, adjudicatarios, contratos, órdenes de pedido, recepciones, garantías, recursos con su desenlace, sanciones y plazos por etapa — con un ciclo idempotente que valida, deduplica y declara lo que no cuadra. Úsala cuando se pida extraer, descargar, consolidar, verificar o analizar datos de SICOP; construir base histórica de contratación pública costarricense; comparar precios ofertados; medir el negocio real de un proveedor; buscar adjudicatarios recurrentes o concentración por institución; extraer marca y modelo de lo entregado; cruzar qué pide el pliego contra qué ofertan y qué se adjudica; detectar señales de direccionamiento; o cuando se mencione SICOP, contratación administrativa CR, licitaciones de Costa Rica, Ley 9986 u Observatorio de Compra Pública.
---

# sicop-extraccion — la contratación pública completa, mes a mes

> **Si la pregunta se responde con el MCP de SICOP (`mcp__sicop__*`), carga y sigue
> `sicop-contratacion-publica`.** Esta skill es la referencia de **extracción y parseo** de los
> 25 CSV del Observatorio (esquema, joins, defectos de la fuente, automatización).

**Archivos de referencia** (cargar solo cuando el tema aparezca):
`reference_JOINS.md` · `reference_CAMPOS.md` · `reference_ANALISIS.md` ·
`reference_CIFRAS_CONTROL.md` · `reference_CONVENCIONES.md`

**§12 resume lo aprendido en el harness A0–A5 de septiembre 2026: identidad de producto,
normalización de marca/modelo, niveles de medición y defectos D1–D10. Leerlo antes de
diseñar cualquier extracción por referencia.**

---

## 0. La regla que gobierna todo lo demás

**Toda afirmación sobre el dato va acompañada del comando que la produjo.**

Esta skill existe en su forma actual porque **once** afirmaciones plausibles, específicas y
seguras resultaron falsas. Cada una sobrevivió hasta que alguien fue a mirar el dato:

| Afirmación | Realidad | Cómo se cayó |
|---|---|---|
| «El zip trae 17 archivos» | Trae **25**. `RecursosObjecion.csv` estaba ahí todo el tiempo | Un `head -20` truncó el listado |
| «El parser rompe con el formato CR (`1.234,56`)» | La fuente usa **punto decimal sin separador de miles**. Un parser CR infla ×1000 | 39.327 precios: 0 con coma |
| «El delimitador de salida es `;`» | Los CSV reales usan **coma** | Verificación byte a byte |
| «El harness está `COHERENTE`» | Sobrevivía un informe **sin la auditoría de la que salió** | Mirar la corrida de otra implementación |
| «La marca no existe en los datos» | Está en las tablas de **ejecución**, patrón `Marca X Modelo Y`, **99,6%** | Barrer *todos* los campos de texto |
| «Este producto subió +44% en USD» | **+13,4%.** El filtro exigente dejaba 24 productos; con 305 se derrumbó | Correr con dos umbrales |
| «Mismo `CODIGO_PRODUCTO_CL` = mismo producto» | **4× de diferencia**: CATERPILLAR USD 131 vs PAT PARATROOPERS USD 31 | Mirar la marca antes de comparar |
| «2026 fue el peor año de este proveedor» | Captación ₡15,5M, **ejecución ₡918,5M — 59×**. Se midió el nivel equivocado | Medir `OrdenPedido` (§4) |
| «`lineas_cartel` no tiene código de producto» | **Sí lo tiene**: `CODIGO_IDENTIFICACION`, 16 dígitos, 99,7% | Listar las columnas en vez de asumir |
| «Deduplicar órdenes por `NRO_ORDEN + SECUENCIA`» | `SECUENCIA` es un enum (98% en `'00'`). La clave es **`LINEA_ORD_PEDIDO`** | Contar valores distintos del campo |
| «El total ejecutado 2026 fue ₡458.106 M» | **₡456.263 M.** Se sumaron USD, EUR y JPY como si fueran colones | Desglosar por `MONEDA_ORDEN` |

Las once eran razonables. Ninguna era cierta. **Sin comando, es una hipótesis bien escrita.**

### Las cuatro reglas derivadas

**1 · Sesgo de muestra por filtro.** Un filtro más exigente no da un resultado más
confiable: da **otro universo**. Toda cifra agregada se calcula con **al menos dos
umbrales** y se reporta el n de cada uno. Si el resultado se mueve materialmente, la cifra
laxa es la válida y la estricta no se cita.

**2 · Antes de declarar que un dato no existe:** listar *todos* los campos de texto del
conjunto completo, tabla por tabla; barrer los términos en todos, no en los tres que
parecen relevantes; recién entonces declarar la ausencia, nombrando qué campos se
revisaron. El error de la marca no fue técnico sino **de alcance**: se buscó en las tablas
del *proceso de compra* y no en las de *ejecución*. Estuvo a punto de justificar un
scraper para un dato que ya estaba en disco.

**3 · Un hallazgo cuantitativo sin CSV de respaldo no es un hallazgo.** Si una cifra vive
solo en la prosa de un informe y no existe el archivo que permite recalcularla, es una
afirmación, no un resultado. Caso real: un gradiente de precio contra número de oferentes
—el hallazgo titular de una corrida— existía únicamente en el resumen; ninguna de las
cuatro salidas tenía `N` como dimensión. **Toda cifra citada nombra el archivo y las
columnas que la reproducen.**

**4 · Un chequeo que no corre debe ser distinguible de uno que pasa.** De ahí el campo
`no_evaluados`.

---

## 1. Origen y marco legal

### De dónde salen los datos

```
https://dlsaobservatorioprod.blob.core.windows.net/fs-synapse-observatorio-produccion/Zip/{AAAAMM}.zip
```

Un zip por mes, actualización diaria a las 08:00, historial desde 2010. Documentado en
`observatoriocomprapublica.go.cr/descargas-sicop/`. Solo `python3` de la biblioteca
estándar: sin dependencias, sin claves, sin terceros.

### Dos canales distintos con regímenes distintos — no confundirlos

| | Plataforma SICOP | Observatorio de Compra Pública |
|---|---|---|
| Opera | RACSA (convenio con Gobierno) | **Ministerio de Hacienda**, Ley 8131 |
| Acceso | autenticado, firma digital | abierto, sin registro |
| Restricción | **Términos de uso, Sección 5** | Decreto 40199-MP de apertura de datos |
| Emisor del texto | **no se identifica** — solo «Copyright 2015 SICOP» | Hacienda, con mandato |

**Los ZIP vienen del Observatorio, no de la plataforma.** El Observatorio declara sus
datos *«abiertos, consumibles y reutilizables»*, accesibles *«sin costo ni requisito de
registro»*, y dice que los usuarios pueden *«generar sus propios estudios»*.

### La cláusula 5.d, textual

> **5.d)** «Los Proveedores Registrados de SICOP no podrán reproducir ni comercializar con
> fines lucrativos ante terceros la información y demás funcionalidades disponibles en SICOP.»
>
> **5.c)** — no atentar, dañar, inutilizar ni **sobrecargar** la plataforma.

Tres elementos acumulativos: reproducir/comercializar **+** con fines de lucro **+** ante
terceros. La Sección 5 se titula *«Normas de uso particulares para Proveedores
Registrados»* — **obliga por la condición de proveedor registrado, no por la naturaleza
del dato**.

| Uso | Estado |
|---|---|
| Análisis interno para decidir precios y a qué licitar | **Permitido** |
| Vender reportes o dashboards a terceros | **Bloqueado** |
| Ranking público de proveedores | **Bloqueado** |
| Scraping de la plataforma | 5.c — restricción contractual |

**Sin resolver, y hay que decirlo:** no hay licencia expresa en los datos del Observatorio;
Hacienda se reserva la propiedad intelectual; y no existe precedente legal en CR sobre 5.d.
Si el uso deja de ser interno, **es consulta de abogado, no interpretación propia.**

### Advertencias de origen

- **No existe diccionario de datos oficial conocido.** Todo el esquema es interpretación
  leyendo los CSV. Es la debilidad estructural más grande de esta skill.
- Los datos **2010–2018 se cargaron retroactivamente**; la publicación en vivo arrancó en
  julio 2019. Su calidad no es necesariamente comparable. Nadie lo ha verificado.
- `sicop.go.cr` devuelve **403 a acceso anónimo automatizado**. El blob de Azure responde.

---

## 2. Los 25 conjuntos

**Cada zip trae 25 CSV.** El extractor toma 23 y deja fuera dos por tamaño; entran con
`--pesados`.

> **Los dos «pesados» son los dos flancos que faltan. `OrdenPedido` va primero.**
>
> **`OrdenPedido`** — el nivel de **ejecución**: la venta recurrente contra contratos de
> años anteriores. Sin él, el negocio de un proveedor se subestima hasta **59×** (§4).
>
> **`InvitacionProcedimiento`** — el lado que falta del análisis de competencia. En
> contratación directa la institución **elige a quién invitar**. El cruce
> *invitados → ofertantes → adjudicado* responde el direccionamiento mejor que cualquier
> señal indirecta. Y es **ex-ante**: se sabe antes de la apertura.

| Conjunto | Archivo | Qué aporta |
|---|---|---|
| `carteles` | DetalleCarteles.csv | Procedimiento, institución, tipo, modalidad, monto estimado, apertura |
| `lineas_cartel` | DetalleLineaCartel.csv | Cantidad, **`PRECIO_UNITARIO_ESTIMADO`**, monto reservado, **`CODIGO_IDENTIFICACION`** (16 díg.) |
| `ofertas` | Ofertas.csv | **Quién ofertó**: cédula, fecha, individual o consorcio |
| `lineas_ofertadas` | LineasOfertadas.csv | **Precio unitario ofertado por línea**, cantidad, moneda, tipo de cambio |
| `adjudicaciones` | ProcedimientoAdjudicacion.csv | Adjudicatario + monto + línea, ya desnormalizado |
| `adjudicaciones_firme` | AdjudicacionesFirme.csv | Acto, fecha en firme, si admite recursos, si quedó desierto |
| `lineas_adjudicadas` | LineasAdjudicadas.csv | Cantidad y precio unitario adjudicado |
| `contratos` | Contratos.csv | Contrato, proveedor, institución, vigencia, modificaciones |
| `lineas_contratadas` | LineasContratadas.csv | Precio contratado · **`DESC_PRODUCTO` trae `Marca X Modelo Y`** (§6) |
| `lineas_recibidas` | LineasRecibidas.csv | **Recepción real** · **`desc_producto` trae `Marca X Modelo Y`** (§6) |
| `garantias` | Garantias.csv | Tipo, monto, estado y vigencia por proveedor |
| `etapas` | FechaPorEtapas.csv | 22 fechas por línea, de publicación a pago |
| `inhibiciones` | FuncionariosInhibicion.csv | **El conjunto más sensible: son personas nombradas** |
| `instituciones` | InstitucionesRegistradas.csv | Catálogo con zona geográfica |
| `procedimientos_adm` | ProcedimientoADM.csv | Procedimientos administrativos sancionatorios |
| `recursos` | RecursosObjecion.csv | Quién objetó, tipo, línea, resultado y causa |
| `proveedores` | Proveedores.csv | Nombre, tipo, **`TAMAÑO_PROVEEDOR` (con Ñ)**, zona |
| `evaluacion_ofertas` | SistemaEvaluacionOfertas.csv | **Factores de evaluación con su porcentaje** |
| `sanciones_registro` | SancionProveedores.csv | Sanciones — **separado por comas, no por `;`** |
| `remates` | Remates.csv | Pujas: ofrecido vs estimado vs adjudicado |
| `recepciones` | Recepciones.csv | Recepciones definitivas por contrato |
| `reajustes` | ReajustePrecios.csv | Reajustes sobre contratos vigentes |
| `lineas_sistema` | Sistemas.csv | Líneas con publicación y tipo de procedimiento |
| **`ordenes_pedido`** | OrdenPedido.csv | **La ejecución.** `--pesados` |
| **`invitaciones`** | InvitacionProcedimiento.csv | **Quién fue invitado.** `--pesados` |

**Antes de confiar en esta tabla: listar el zip.** `sorted(z.namelist())` completo, sin
truncar. Cuesta nada, y es exactamente lo que no se hizo la primera vez.

Las tablas derivadas y el llenado medido de cada campo → **`reference_CAMPOS.md`**.

---

## 3. Convenciones de datos — obligatorias

| Punto | Convención |
|---|---|
| Sufijo de año | **Conjuntos SÍ** (`adjudicaciones_2026.csv`) · **derivadas NO** |
| Binarios | `S` / `N` / `""` — **nunca `0`/`1`** |
| Encoding de salida | UTF-8 con BOM (`utf-8-sig`) |
| Lectura de la fuente | utf-8 → utf-16 → latin-1. **Nunca `errors="replace"`** en producción — produce mojibake silencioso |
| Delimitador | **Mirarlo en el archivo, no en la documentación** |
| stdout en Windows | `sys.stdout.reconfigure(encoding="utf-8", errors="replace")` al inicio de todo script |

### Parsing de números

La fuente usa **punto decimal sin separador de miles**:

```
1.000                  → uno (NO mil)
507.66000000000003     → 507,66
2.9999999999999999E-2  → 0,03   (hay notación científica)
```

Verificado sobre 39.327 precios: **0 con coma, 0 con dos o más puntos.** Un parser de
miles estilo CR **infla las cantidades por 1000**.

Y la otra mitad: **un valor no numérico nunca devuelve `0.0`.** Un número de contrato
(`CE202603000268`) metido en una columna de monto entra como ₡0 y desaparece de las sumas
sin dejar rastro. Se encontraron **180 montos contaminados** así. Registrarlos y reportarlos.

### Identidad de corrida y guardavía

Un harness encadenado por archivos **no falla: ejecuta, y ejecuta algo plausible.** Un JSON
bien formado de ayer pasa cualquier validación de esquema. Ocurrió: un agente ejecutó siete
acciones sobre veredictos de la corrida anterior porque los ids son deterministas y
**coincidían**.

Toda la cadena propaga un identificador de corrida. Un artefacto sin corrida no se ejecuta:
se reporta y se detiene.

> **Un artefacto derivado no puede sobrevivir a su insumo.**

Tres mecanismos, y hacen falta los tres: **precedencia por fecha** (un derivado más viejo
que su insumo), **insumo ausente** (un derivado cuyo respaldo ya no existe), **coherencia
de corrida** (dos corridas conviviendo). La precedencia por fecha es la más valiosa porque
**no le pide cooperación a nadie**: funciona aunque el agente que escribió el archivo no
haya sellado nada.

Lo vencido **se retira, no se borra** — a `.VENCIDO-<ts>` o `.HUERFANO-<ts>`.

**Ids de deduplicación** deterministas: `{regla}:{clave1}|{clave2}`, o **sha256** si la
clave es texto libre. **Nunca `hash()` de Python**: `PYTHONHASHSEED` es aleatorio por
proceso, así que la misma novedad se re-notifica todos los días.

---

## 4. Los cuatro niveles de medición — captación no es venta

**El error más caro de esta skill.** Medir a un proveedor por `adjudicaciones` subestima su
negocio por uno o dos órdenes de magnitud: la adjudicación da **el derecho a vender**, no
la venta.

```
Cartel → Oferta → ADJUDICACIÓN → Contrato → ORDEN DE PEDIDO → Recepción → Pago
                  ↑ captación                ↑ ejecución recurrente
```

| Nivel | Tabla | Qué mide |
|---|---|---|
| Captación | `adjudicaciones` | ganar el derecho a vender |
| Formalización | `contratos` | el contrato y sus prórrogas |
| **Ejecución** | **`ordenes_pedido`** | **la venta recurrente** — `--pesados` |
| Entrega | `lineas_recibidas` | lo efectivamente recibido conforme |

### La magnitud, verificada

| Caso | Captación | Ejecución | Razón |
|---|---:|---:|---:|
| Un proveedor real, 2026 | ₡15,5 M | **₡918,5 M** | **59×** |
| Mercado nacional 2026 (CRC) | ₡89.131 M | ₡456.263 M | 5,1× |
| Calzado seguridad 461816 | 17.595 pares | 34.749 pares | 2,0× |

**96,9% de la ejecución de 2026 viene de procedimientos de años anteriores.** Hay órdenes
de 2026 contra un procedimiento de **2020 — seis años**. En modalidad `Según demanda` un
procedimiento ganado una vez factura por años sin volver a aparecer en `adjudicaciones`.

### Consecuencias obligatorias

1. **Ninguna afirmación sobre el negocio de un proveedor se hace solo con
   `adjudicaciones`.** Se declara qué nivel se está midiendo.
2. **La tasa de conversión mide reposición de cartera, no salud.** Una conversión que cae
   señala riesgo a 2–3 años vista, no un mal año en curso.
3. **Toda estimación de volumen de mercado sin `ordenes_pedido` está subestimada.**
4. **La ventana comercial no es cuándo sale la licitación: es cuándo vence el contrato marco.**

### Las tres trampas de `ordenes_pedido`

**a) `TOTAL_ORDEN` está replicado en cada línea.** Es el total de la orden completa, no de
la línea. Verificado: una orden aparece **54 veces** con el mismo total. Sumar en crudo
infla ~3×.

**b) La clave de línea es `LINEA_ORD_PEDIDO`, no `SECUENCIA`.**

```
SECUENCIA: 8 valores distintos, 98% en '00'  →  es un enum, NO identifica línea
NRO_ORDEN distintos                : 545.272
(NRO_ORDEN, LINEA_ORD_PEDIDO) dist : 545.896   ← la clave correcta
```

Deduplicar solo por `NRO_ORDEN` borra una línea en 624 órdenes (0,1%).

**c) Hay cinco monedas y sumarlas juntas destruye a los importadores.**

| Moneda 2026 | Monto | Órdenes |
|---|---:|---:|
| CRC | 456.263 M | 61.941 |
| **USD** | **1.715 M** | **42.131** |
| JPY · EUR · GBP | 129 M | 874 |

Hay casi tantas órdenes en USD como en colones. Sumar sin convertir **divide por ~510 a
quien factura en dólares** — el perfil exacto de un importador. Convertir por
`FECHA_ELABORACION_ORDEN` antes de cualquier ranking.

**d) `ordenes_pedido` no tiene producto.** No trae `CODIGO_PRODUCTO` ni `CANTIDAD`
(verificado sobre las 24 columnas). La ejecución llega a **proveedor × institución ×
monto** y no baja a producto. Para bajar hay que ir por `NRO_CONTRATO` →
`lineas_contratadas`, y ahí se pierde la recurrencia. **Cualquier cifra de ejecución por
producto obtenida desde órdenes es una cota superior, y hay que rotularla así.**

---

## 5. Los joins y sus trampas

**Esta sección es la que más veces ha roto un análisis. Leerla completa antes de cruzar
dos tablas.** El detalle con ejemplos → `reference_JOINS.md`.

### La regla de oro

> **Todo join declara su tasa de match y la cardinalidad resultante.
> Un join sin sanity check es un resultado inventado con formato de tabla.**

| Síntoma | Diagnóstico |
|---|---|
| Match **100,0%** | La clave está colapsando filas. Casi nunca es match perfecto real |
| Match **0%** entre tablas que deberían cruzar | Longitud de código distinta (ver abajo) o nombre de campo distinto |
| Cardinalidad absurda (N=120.922 «oferentes») | La clave no es única del lado que se creía; un `dict[k] = v` sobrescribió |
| Descartes masivos por rango | El join está uniendo cosas que no corresponden |

**Caso real, cometido dentro de este proyecto:** se cruzó `lineas_cartel` con
`lineas_ofertadas` usando `(NRO_SICOP, NUMERO_LINEA)`. `lineas_cartel` tiene además
**`NUMERO_PARTIDA`**, así que la clave no era única: 243.038 filas colapsaron a 1.974 y el
«número de oferentes» llegó a 120.922. El resultado era plausible en forma y basura en
contenido.

### El código de producto: el cartel habla en 16, la oferta en 24

```
CODIGO_PRODUCTO     = 24 dígitos = UNSPSC(8) + ID_CATALOGO(8) + correlativo(8)
CODIGO_PRODUCTO_CL  = 16 dígitos = los primeros 16
```

**Anidamiento verificado sobre el universo completo: 96,9%** (529.089 de 545.902 códigos de
24 tienen su prefijo `[:16]` en el universo real de 16).

| Longitud | Distintos | Dónde vive |
|---|---:|---|
| 24 | 545.902 | `lineas_ofertadas`, `lineas_adjudicadas`, `lineas_contratadas`, `lineas_recibidas`, `reajustes` |
| 16 | 167.791 | `CODIGO_PRODUCTO_CL` · **`lineas_cartel.CODIGO_IDENTIFICACION`** (99,7%) |
| 8 | 327 | solo `sanciones_registro` — muestra chica, **no** es el catálogo UNSPSC |

> **El join cartel ↔ oferta a nivel producto es por prefijo `[:16]`, nunca por igualdad.**
> Un join que devuelve cero entre esas dos tablas casi siempre es esto, no ausencia de datos.

Colapso: `545.902 → 127.463 grupos` (4,3×), 67.694 grupos con más de un código.

**El nivel de 8 no está verificado.** El anidamiento 24→8 da 22,2%, pero el universo de 8
que tenemos son 327 códigos de una sola tabla. Eso no refuta el UNSPSC: falta traer el
catálogo oficial.

### Las otras cuatro trampas

**1 · `NUMERO_LINEA` (cartel) vs `NRO_LINEA` (ofertadas/adjudicadas).** Nombre distinto,
mismo concepto, y llegan con ceros a la izquierda o como `'1.0'` según el año. Normalizar
ambos lados a entero-string. Sin esto se pierden líneas en silencio: en un caso real
recuperó 16 de 76.

**2 · `LineasOfertadas` no trae la cédula del oferente** — trae `NRO_OFERTA`. Unir con
`Ofertas.csv` por `NRO_SICOP + NRO_OFERTA`.

**3 · `lineas_recibidas` no tiene `CEDULA_PROVEEDOR`.** Cruzar por `NRO_CONTRATO`.

**4 · Convertir a CRC los tres lados.** Aplicar `TIPO_CAMBIO_CRC` de la propia fila al
ofertado **y** al adjudicado **y** al estimado. Convertir solo uno produce deltas absurdos
— se observó `+81.076%` y un «ganador» a CRC 83.

### El cruce no funciona mes a mes

El archivo mensual corta por fecha de publicación, no por procedimiento:

| Meses acumulados | Cobertura |
|---|---|
| 1 mes | **8%** |
| 8 meses | **62,6%** |

Por eso **los cruces van al final, sobre el acumulado**. Una estadística de competencia
calculada sobre cobertura baja no es representativa, y hay que decirlo cada vez.

---

## 6. Identidad de producto — qué hace comparable a dos precios

### El código no basta, y falla en ambas direcciones

**Un código contiene productos distintos.** Verificado en `4618160590006864`, 48
adjudicaciones bajo un mismo CL:

```
CATERPILLAR / NITROGEN   USD 131      RHINO / 64084          USD 44
REDWING / 3561           USD 135      MARLUVAS / PP-70B22    USD 53
SAFETY JOGGER / 6115     USD  51      PAT PARATROOPERS / TEK USD 31
```

**Un producto se dispersa en varios códigos.** MARLUVAS PP-70B22 aparece bajo **5** códigos,
uno en una familia UNSPSC distinta (`53111601` en vez de `461816`).

Y el correlativo (últimos 8 dígitos) **no identifica producto**: 140 de 316 sufijos
observados aparecen bajo CL distintos. **Nunca agrupar precios por el código de 24.**

**Una talla = un código.** `90017969` = bota #40, `90017971` = #41… Un modelo ocupa tantos
códigos como tallas registradas.

### Marca y modelo — SÍ están en los CSV

Viajan embebidos en la descripción de las tablas de **ejecución**:

| Tabla | Campo | Cobertura |
|---|---|---|
| `lineas_contratadas` | `DESC_PRODUCTO` | 99,6% |
| `lineas_recibidas` | `desc_producto` | 99,6% |

```python
RX_MARCA = re.compile(r"\bMarca\s+(.+?)\s+Modelo\s+(.+)$")   # CASE-SENSITIVE, obligatorio
```

**`re.I` produce falsos positivos.** `"BOTA SIN MARCA NI MODELO DECLARADO"` → Marca=`NI`,
Modelo=`DECLARADO`. Verificado: case-sensitive da cobertura idéntica sobre datos reales
(2.050 líneas / 99,6% / 176 marcas) sin el falso positivo.

Las tablas del *proceso de compra* casi nunca traen marca: 8 menciones en 1.177 líneas de
pliego. Ahí la marca solo aparece si la institución la escribió en el requerimiento, y
**esos casos son en sí mismos el hallazgo** (→ `reference_ANALISIS.md`).

Ojo con falsos positivos de conteo: `ACERO` sale 8.383 veces («puntera de acero»);
`CATERPILLAR` y `JOHN DEERE` en el catálogo global son repuestos de maquinaria. **Filtrar
por familia UNSPSC antes de contar.**

### La firma de SKU

```
FIRMA = CODIGO_PRODUCTO_CL + MARCA + MODELO + ATRIBUTOS_CLAVE
        ej. 4618160590006864 | RHINO | 64084 | dimension=406mm|clase=4
```

**Misma firma → comparable en precio. Firma distinta → no.** Toda derivada de precio debe
agrupar por firma.

Distribución de atributos variantes sobre 84.899 descripciones únicas: dimensión **41,5%** ·
color 10,1% · peso 9,8% · clase/grado 9,4% · pulgadas 7,7% · metros 7,5% · volumen 7,3% ·
… · **talla numérica 0,5%**.

**La talla numérica es el 0,5% del universo.** Quien diseñe la extracción pensando en
tallas construye para el 0,5% e ignora el 41,5%.

Cuatro reglas de extracción, todas aprendidas de un falso positivo real:

1. **Validar rango por tipo.** El barrido crudo devuelve `TALLA 9` de guantes y `GRADO # 3`
   de anteojos. Talla de calzado: 33–48.
2. **Normalizar unidades** — cm→mm, pulg→mm, L→ml, kg→g, kW→W, TB→GB.
3. **Marcar los rangos** (`TALLA 38 A 45`) con `ES_RANGO`.
4. **Cobertura por familia, nunca global.**

---

## 7. Chequeos de control obligatorios

Deterministas. Ninguno necesita modelo.

| Chequeo | Umbral | Reacción |
|---|---|---|
| Columnas esperadas por conjunto | cualquier ausencia | **BLOQUEADO** — no adaptar el parser a ciegas |
| **Regresión de inventario del zip** | aparece o desaparece un archivo | **BLOQUEADO** |
| **Tasa de match de cada join** | 100% o <50% inesperado | **BLOQUEADO** — ver §5 |
| **Cardinalidad de cada join** | fuera del rango plausible | **BLOQUEADO** |
| **Longitud del código antes de cruzar** | mezcla 16/24 sin prefijo | **BLOQUEADO** |
| **Salto de magnitud en precios** | ≥100× la mediana del mismo CL | REVISAR |
| **Monedas mezcladas en una suma** | más de una `MONEDA` en el agregado | **BLOQUEADO** |
| Cédula institucional (`4000…`) como proveedor | cualquiera | REVISAR, prioridad baja |
| Montos no numéricos o negativos | cualquiera | REVISAR |
| Hash de un mes ya registrado | cambió | REVISAR — la fuente reescribió historia |
| Cobertura del cruce | cae >5 puntos | REVISAR |

**Regresión de inventario.** Guardar `sorted(z.namelist())` completo y compararlo contra el
conocido. Es el antídoto directo del error de los 17 archivos.

**Salto de magnitud.** Comparar cada precio contra la mediana de **su propio código** —
un tornillo y una grúa difieren legítimamente por órdenes de magnitud. Umbral 100×, no
1000×, porque el error puede ser de dos ceros. **CICAP-UCR documentó en 2019 errores de
digitación en SICOP «en el orden de los miles de millones»**: ₡49,5 millones digitados como
₡49,5 **mil** millones.

**Outliers de la fuente.** Existen 4 órdenes con `TOTAL_ORDEN` > 1e12; la mayor es
₡52.558.672.235.326 — 1,5× el presupuesto nacional. Reportar en `N_SOSPECHOSAS`, **no sumar.**

Y el campo `no_evaluados`: los chequeos que **no pudieron correr**.

---

## 8. Trampas conocidas

| Situación | Significa | Qué hacer |
|---|---|---|
| **Enero sin adjudicaciones** | El zip es válido pero las tablas vienen vacías | **No concluir que enero no tuvo actividad.** Contrastar contra `adjudicaciones_firme` |
| **`TAMANO_PROVEEDOR` no existe** | La columna es **`TAMAÑO_PROVEEDOR` con Ñ** | Buscar por `"TAMA" in k.upper()` |
| **Filas con más campos que columnas** | Descripciones con `;` sin escapar. **No es suciedad: es el parser corriendo las columnas** | **Cuarentena, no marca.** Conservar en `filas_en_cuarentena.csv`. Medido: 47 + 115 filas |
| `DESIERTO` | La fuente usa **`Y`/`N`**, no `S`/`N` | Filtrar por `Y`. Y no sirve para medir desiertos: 242.918 `N` contra **4** `Y` |
| **Faltan ofertas respecto al expediente** | Las **ofertas retiradas no llegan a `Ofertas.csv`** | No concluir «solo hubo N oferentes». Un oferente que se retira es señal, e invisible |
| **`carteles` con una fila y el expediente muestra versiones** | El versionado del pliego se pierde | Las modificaciones son donde se introduce o retira el direccionamiento |
| Precios de 1 CRC | Simbólicos o por definir | Filtrar antes de calcular dispersión |
| `NOMBRE_PROVEEDOR` vacío | 6 casos en 2026 | Identificar por cédula. **No inventar el nombre** |
| Procedimientos de años anteriores | El corte es por publicación | Filtrar por la fecha del hecho |
| **Marca buscada y no encontrada** | Casi seguro se barrió solo el lado de compra | Barrer las tablas de ejecución — §6 |
| Ranking de marcas con basura | `LIBRO` 5.083, `NACIONAL` 1.724, `INTECO` 786 (norma), `SEGÚN OFERTA` 510 | Lista de descarte versionada. **22.254 marcas sobre 108.460 productos es implausible** |
| Un `PARSE_OK` alto se lee como calidad | Mide que el **patrón matcheó**, no que sea una marca | Renombrar a `PATRON_MATCH`, reportar por familia |
| Sancionados que siguen ganando | 350 proveedores, 66.163 líneas **sin filtrar vigencia** | Cruzar contra `INICIO_SANCION`–`FINAL_SANCION`. Antes de eso el número no significa nada |
| `PROSPERO` en recursos | Los 334 sin desenlace están contados como `N` — **sin resolver = fracasado** | Filtrar por `RESULTADO != ""` antes de calcular tasas |

### Rotular el período — «2026» no significa lo mismo en todas las tablas

| Tabla | Qué significa «2026» | Verificado |
|---|---|---|
| `carteles` | Procedimientos **publicados** en 2026 | **100%** |
| `adjudicaciones_firme` | Actos en firme en 2026 | **100%** |
| `adjudicaciones` | **Actividad observada**, no procedimientos de 2026 | solo **57,3%** |
| `contratos` | ídem | 46,7% |
| `lineas_recibidas` | ídem | 25,5% |

La advertencia aplica a adjudicaciones, contratos y recepciones. **No a carteles ni a actos
en firme**, que están acotados por su propia fecha. Generalizarla condena tablas que están
bien; omitirla infla las que no.

**El mes de corte es parcial**, y una corrida de 23 conjuntos **no es «extracción
completa»**: el rótulo correcto es «extracción núcleo de 23 conjuntos», nombrando los dos
que faltan.

---

## 9. Ejecución

```bash
python3 scripts/sicop_loop.py --year 2026 --out ./salida
python3 scripts/sicop_loop.py --year 2026 --months 01,02,03 --out ./salida
python3 scripts/sicop_loop.py --year 2026 --out ./salida --solo adjudicaciones,ofertas
python3 scripts/sicop_loop.py --year 2026 --out ./salida --pesados
python3 scripts/sicop_loop.py --year 2026 --out ./salida --force
```

Un año tarda 5–15 minutos. Si la herramienta que lo invoca corta las llamadas largas,
lanzarlo en segundo plano y leer `REPORTE.md` al terminar. `--force` **reconstruye desde
cero**, no reutiliza filas viejas con esquema distinto.

| Script | Para qué |
|---|---|
| `consulta_empresa.py` | Participación, adjudicaciones y competidores de una empresa |
| `competencia_producto.py` | Qué piden vs qué ofertan vs qué adjudican, por línea |
| `historia_producto.py` | Evolución de precio por artículo, con vendedor y USD implícito |
| `marcas_por_familia.py` | Marca y modelo desde las tablas de ejecución |
| `d2_longitud_codigo.py` | Distribución de longitudes de código y prueba de anidamiento |

```bash
python3 scripts/consulta_empresa.py --datos ./salida --empresa "CAPRIS"
python3 scripts/competencia_producto.py --codigo 461816 --perdidas-baratas
python3 scripts/marcas_por_familia.py --codigo 461816 --marca MARLUVAS
```

`SICOP_SALIDA` en el entorno sobreescribe la ruta base.

**Tres reglas que `consulta_empresa.py` trae implementadas y no son opcionales:**

- **Buscar por nombre parcial no agrega.** Si «CONSTRUCTORA» coincide con 40 empresas,
  lista las cédulas y obliga a elegir. Sumarlas sería inventar un grupo económico.
- **La tasa de éxito se declara como piso.** El denominador verificable es menor que el
  real, y el número lo dice.
- **Los procedimientos sin cartel se muestran como `?`**, no se reparten ni se esconden.

`marcas_por_familia.py` reporta el porcentaje parseado. **Si baja del 95%, el patrón cambió
en la fuente**: mirar las descripciones crudas antes de usar el resultado.

---

## 10. Verificación — no confiar en una sola ejecución

Los errores graves de este proyecto los encontró siempre **una segunda ejecución
independiente**, nunca quien los cometió.

1. **Listar el zip sin recibir la lista esperada.** Si se le da la respuesta a quien
   verifica, la confirma en vez de verificarla.
2. **Cerrar la ecuación** `origen = destino + duplicados + rechazos`, con residuo cero.
3. **Replicar con código escrito sin ver el extractor.** Una diferencia de una fila se
   investiga igual que una de mil.
4. **Corroborar contra una fuente distinta**, con URL y fecha. Sin URL el veredicto es
   `NO VERIFICABLE` — que es un resultado válido y se publica.
5. **Refutar lo ya publicado**: ¿sobre qué universo se calculó? ¿la cobertura permite ese
   porcentaje? ¿se presenta una ausencia de dato como si fuera dato?

**Si una verificación corre y todo sale bien, sospechar.** Está confirmando, no verificando.

**Y cuando la verificación misma falla, se declara.** Un verificador que produce números
imposibles no refuta nada: retira su propio resultado y reporta el defecto. Ocurrió en este
proyecto — un intento de replicar un gradiente produjo N=120.922 por una clave mal
construida. El resultado correcto de esa corrida fue «mi script está mal», no un veredicto
sobre el trabajo ajeno.

### Por qué la verificación tiene que ser plural

Tres auditores independientes revisaron este corpus. **Cada uno encontró un defecto
distinto, y ninguno encontró los tres:**

| Quién | Qué encontró |
|---|---|
| Auditor externo | La corrupción de columnas del parser — 162 filas |
| Implementación paralela | El desfase de corrida: siete acciones sobre veredictos viejos |
| Autor del harness | `PROSPERO` contando como fracaso los 334 sin resolver |

Y el guardavía, escrito para cerrar el segundo hallazgo, tenía **su propio hueco**.

**El patrón se repitió cuatro veces: el error no lo encuentra quien lo cometió.** Una
verificación con un solo revisor, por bueno que sea, es una opinión bien fundada.

### Ley 9986 — usar el vocabulario vigente

| SICOP rotula | La Ley 9986 dice |
|---|---|
| cartel | **pliego de condiciones** |
| recurso de revocación | **recurso de revocatoria** |
| licitación pública / abreviada | **licitación mayor / menor / reducida** |

Conservar el nombre del campo en el dato, usar el término vigente en el texto, y declarar
la diferencia una vez. En Costa Rica se dice **bufete**, no «despacho».

---

## 11. Límites y privacidad

Esta extracción produce **datos y preguntas, no conclusiones.** Una concentración alta puede
tener explicaciones legítimas: mercados con un solo oferente, especialización técnica,
convenios marco. Las causales de excepción están previstas en la ley. **La lectura jurídica
la hace una persona.**

Cuidado con el lenguaje: «oferta única» es una calificación con carga jurídica presentada
como descripción. Lo correcto es **«un solo oferente identificado por el cruce»**.

Todo resultado indica: período cubierto, fecha de extracción, archivo de origen y —cuando
aplique— **la cobertura del cruce**.

**Nada de screens de colusión.** Todos los FPR publicados vienen de muestras con ~50% de
prevalencia. A 5% de prevalencia real, un screen con 15% de falsos positivos produce ~63
falsos positivos por cada 100 flags. Las señales de §`reference_ANALISIS.md` son **cola de
revisión, nunca conclusión.**

### Privacidad

Los datos son públicos, pero **contienen datos personales**: cédulas de proveedores que
pueden ser personas físicas, nombres de representantes legales y **nombres de funcionarios
públicos con inhibición**. El principio de finalidad de la **Ley 8968** aplica igual al
tratamiento masivo.

No publicar los consolidados crudos ni cruzarlos con fuentes personales sin decisión
expresa. **`inhibiciones` es el conjunto más sensible: son personas nombradas.**

Y una regla para todo cruce externo: **una fuente pública no es automáticamente una fuente
usable de forma masiva.** Consultar el estado tributario de un adjudicatario puntual es
defendible; barrer el padrón completo contra Hacienda o la CCSS excede la finalidad para la
que esos servicios existen. **Uso dirigido y documentado sí; barrido universal no.**

---

## 12. Lo que enseñó el harness A0–A5 (septiembre 2026)

Tres semanas de captura (32.229 expedientes de 2025 por el servidor MCP), 81 ZIP del
Observatorio (2020-01 a 2026-09), emparejamiento (A3), identidades (A2) y un primer
análisis de calzado (A5). Cada línea de abajo se cayó o se confirmó con un expediente.

### 12.1 Identidad de producto: el techo es estructural

| Hecho verificado | Evidencia | Regla |
|---|---|---|
| **El código de 24 es de quien oferta, no del fabricante.** Cada oferente registra el suyo; el mismo 24 puede reaparecer bajo otra cédula (`20250802058`, dos cédulas, un código) | 63.975 códigos en ofertas 2025 | Oferente solo por `NRO_OFERTA` → `Ofertas.csv`. Nunca por código |
| **Un código solo recibe marca/modelo si gana.** La descripción vive en contratadas, recibidas, reajustes y sanciones; `LineasOfertadas` (captura y ZIP) no la trae | 81 ZIP, 722.345 observaciones | La identidad de una **oferta perdedora no es recuperable** de ninguna fuente. Se declara, no se busca |
| Cobertura del diccionario histórico código→descripción | 44 % de los códigos ofertados en 2025 (27.966 / 63.975); calzado 23 % (76 / 325). Seis años de historia sumaron **dos** códigos a los 74 que ya tenían contrato en 2025 | Toda tabla de identidad publica cobertura por conjunto; una oferta sin identidad se conserva con `IDENTIDAD = SOLO_OFERENTE` |
| El catálogo del servidor MCP (`sicop_producto`, `producto_firma`) solo responde por CL16 y **presta la marca de un contrato cualquiera** de ese CL; descripción cortada a 160 caracteres | 335 llamadas con código 24 → `total = 0`; por CL16, 10 de 10 controles con marca distinta a la del contrato | Ningún campo `MARCA`/`MODELO` del servidor entra a un análisis |
| **Una referencia de calzado la vende un solo proveedor** | 0 de 62 comparaciones proveedor-vs-resto con n ≥ 5 por lado | Comparar precios por **grupo equivalente** (mismo tipo, misma banda), no por referencia |

### 12.2 Normalización de marca y modelo — lo que hay dentro del texto

| Patrón real | Ejemplo | Regla |
|---|---|---|
| Prefijo del **registrador**, no del fabricante | `PP-IDQNW` y `IDQNW` son el mismo Duramil; 290 de 389 `PP-` son de un solo distribuidor | Lista `prefijos_registrador` en configuración (`PP-`, `PT-`); se quita y se conserva `PREFIJO_QUITADO` |
| Talla al final del modelo | `PP-75BPR29-MSMC-CPAP-TALLA`, `PP-60B22-CPAP-39`, `TALLA 36-43` | Quitar solo sufijos explícitos de talla; `66018` no se toca |
| Color al final | `ARGON HI WP CT- CAFE`, `MUNISING WP CT-TAN` | Lista `colores_final`; Caterpillar pasó de 41 a 13 referencias |
| Dos modelos en una línea | `MUNISING WP CT PARA HOMBRE Y ALLY 6 WP CT PARA MUJER` | `PATRON = MULTIMODELO`, lista de modelos, sin referencia única |
| Marca «X BY Y» con sentido ambiguo | `DALUPO BY VITAL SAFETY` (marca Dalupo, casa distribuidora) vs `ALBATROS BY PUMA SAFETY` (línea de Puma) | `MARCA` = antes de `BY`, `CASA` = después; excepciones en `casa_es_marca` decididas por una persona |
| Marca que no es marca | `BOTA ALTA NEGRA SUELA AMARILLA 44`, `ZAPATO PUNTA ACERO CAFE 41 66020 ACTIVE RHINO` | `MARCA_DUDOSA`: más de 3 tokens, o palabra completa `BOTA`/`ZAPATO`/`TALLA`/`SUELA`, o número de 2 dígitos. **Palabra completa**: `OZAPATO` es una marca |
| Familia y variante | `75BPR29-MSMC-CPAP` | Referencia = familia (`MARLUVAS|75BPR29`); variante como columna. Partir solo por `-` en códigos alfanuméricos; **no** partir nombres de palabras (`BLACK EAGLE TACTICAL` no es `BLACK` + variantes) |
| Escrituras distintas | `RED WING`/`REDWING`, cuatro formas de `PARATROOPERS`, `PORWEST` | `marcas_alias.yaml` versionado; el canónico es la forma con más observaciones |
| Valores nulos disfrazados | `Marca N/A Modelo N/A`, `Modelo SEGÚN TALLA`, `A ELEGIR` | Lista de nulos; `MODELO_NULO = S` conserva la marca |

El patrón de §6 (`Marca … Modelo …`, case-sensitive) se mantiene; a esto se le suma tomar la
**última** aparición de `Marca` (`ZAPATO MARCA DE AGUA … Marca RHINO`), y que una forma no
prevista cae en `SIN_PATRON`, nunca en una extracción parcial.

### 12.3 Contratación da precio; volumen, no

Los contratos según demanda traen **`CANTIDAD_CONTRATADA = 1`** (13 de 13 líneas Marluvas;
igual en ESOSA). Un ranking de marcas por "pares contratados" ordena cantidades nominales.
Precio unitario: contratación. Volumen: recepciones y órdenes de pedido (unidas por
`NRO_CONTRATO` + línea, §4.d). `LineasRecibidas` no trae moneda ni tipo de cambio: su
`precio` se publica sin convertir y rotulado.

`MES_ZIP` es el mes de **publicación del cartel**, no la fecha del contrato ni de la
entrega. Sirve como aproximación declarada (`FECHA_APROXIMADA = S`) hasta unir con
`fecha_recepcion_Definitiva` o con las fechas de `ProcedimientoAdjudicacion`.

Lo observable de calzado contratado en el Observatorio 2020–2026 son **1.343 líneas de
contrato y 1.052 de recepción**. Es una muestra con identidad, no el mercado.

### 12.4 Defectos del servidor MCP y de la fuente (registrados, con expediente)

| Id | Defecto | Origen | Evidencia |
|---|---|---|---|
| D1 | `fact_adjudicacion.PU_ADJUDICADO` es el precio estimado del cartel | servidor | `20250802058` L1 |
| D2 | `competencia_procedimiento` vacía con líneas cargadas | servidor | |
| D3 | Marca «prestada» a nivel CL16 | servidor | §12.1 |
| D4 | `campo_buscar` no busca en modelo | servidor | `2P9401`, `BX43` |
| D5 | `integridad` ignora el mes | servidor | |
| D6 | `fact_adjudicacion` repite un solo `NRO_ACTO` por expediente | servidor | `20250301337`: 4 actos reales |
| D7 | ZIP `202501` trae exactamente 1.000 carteles y cuatro tablas de líneas vacías | **fuente** | número redondo = truncado |
| D8 | `LineasOfertadas` solo existe para expedientes con `LineasAdjudicadas` | **fuente** | precio de perdedores visible solo cuando hay ganador (≈15 % de expedientes) |
| D9 | `fact_adjudicacion` devuelve filas sin `NRO_LINEA` | servidor | 1.239 expedientes de 2025 |
| D10 | `sicop_lineas_procedimiento` **trunca cada lista en 1.000 filas** sin aviso | servidor | `20250200306`, `20250100144` |

Regla general que salió de D7 y D10: **un conteo redondo (1.000, 500, 200) es un techo
hasta demostrar lo contrario.**

Otros hechos del emparejamiento 2025: 138 líneas con más de una cédula ganadora
(`20250100161` L13); 691 grupos línea/proveedor con varias filas de contrato (legítimas,
no duplicados); 11 claves oferta/línea repetidas por doble observación (`20250100714`,
`MES_PUBLICACION` 202512 y 202606); una sola `DESIERTO = Y` en 2025 y convive con una
adjudicación (`20250301584`, acto `1144672`); no existe campo de cancelación en ninguna
tabla; `IVA` es monto de línea, no unitario (`20250301584` L13: 11.050 = 68 × 1.250 × 0,13);
`TIPO_CAMBIO_CRC` puede traer 508,82 en una fila CRC (factor 1 siempre); una adjudicación en
USD sin tasa (`20250300763` L1) queda `NO_COMPARABLE`, nunca se rellena.

### 12.5 Cómo se ordena el trabajo entre agentes

| Práctica | Por qué |
|---|---|
| Toda orden fija **valores esperados con expediente** (`20250301337` L5: 4 ofertas, ganador 35.000, delta 652) | Cada defecto nuevo se encontró porque un número no cuadró: 935 vs 65 destapó D9; 30 líneas de febrero destaparon D10 |
| Cada lote sella sha256 del código **y** de la configuración; el merge rechaza mezclas | Detectó que un agente editó `restricciones.yaml` mientras otro corría producción |
| Nadie escribe en la instalación mientras hay una corrida; ninguna producción arranca sin revisar el cierre de pruebas | La primera producción se lanzó antes de la revisión y hubo que repetirla |
| `control.csv` clasifica **cada fila física exactamente una vez** (`VINCULADA`, `SIN_DEMANDA`, `SIN_CABECERA`, `DUPLICADA_OBSERVACION`, `SIN_LINEA`, `NO_NORMALIZABLE`), con precedencia declarada | «Residuo cero» significa clasificar todo, no que todo cruce |
| Una falla de prueba se reporta con el observado; **nunca se ajusta la expectativa para que pase** salvo con la evidencia del crudo | 11 vs 15 duplicadas era la expectativa mal escrita, y se demostró antes de cambiarla |
| El obrero de extracción masiva **lee y reporta**; no propone ejecutar, no infiere | Propuso tres veces correr una producción que ya corría; atribuyó al catálogo una descripción que era de otro código |
| El constructor recibe **formato de salida obligatorio** (enteros, sin JSON en celdas, sin filas `N_INSUFICIENTE` en rankings, una línea de lectura por tabla) | Sin eso entrega tablas correctas e ilegibles |
| Toda decisión de negocio (prefijos, granularidad, alias) vive en YAML versionado, no en código | Se revierte sin tocar `a2.py` |
