# N3 · Lista formal de espacios del piloto

Estado: **CERRADO**. Inventario cerrado y lista formal firmada (firma delegada en §7). Ningún espacio se borra, se mueve ni se renombra en el servidor: este documento solo clasifica lo que ya existe.

Observación del **servidor real del piloto** (no de un fixture ni de una maqueta), ejecutada el **2026-11-23 entre 23:29 y 23:58 UTC** (hora del contenedor: `Mon Nov 23 23:29:55 UTC 2026`).

Servidor observado: host del CEO, contenedor `mwt-one-harness-gateway` (`mwt-one-harness/gateway:latest`, `Up 54 minutes (healthy)`), perfil `faberloom`, `PUBLIC_HOST=faberloom.ai`, `DATA_DIR=/data/users`, `INBOUND_ENABLED=1`. Dueño `alejandro@muitowork.com` = `/data/users/5072fce2-e66e-4bf7-8fd2-623cfd3afaf6`.

## 1. Qué se miró y qué no

Se miraron nombres de carpeta, conteo de archivos, tamaños, fechas de modificación y metadatos de los registros del producto (`faberloom_spaces.json`, `workspace.json`, `faberloom_session_shares.json`) y de cada `.faberloom/harness.json`.

No se leyó contenido de correo ni credenciales. Los textos de memoria que aparecen citados son títulos y conteos, no cuerpos de correo.

Los comandos reales fueron `docker exec mwt-one-harness-gateway sh -c 'ls -la ...'`, `find <dir> -type f | wc -l`, `du -sh <dir>`, `date -r <dir>`, `cat <dir>/.faberloom/harness.json` y `cat .../storages/{faberloom_spaces,workspace,faberloom_session_shares}.json`. Ninguno escribe.

## 2. Los 16 directorios que existen en disco

`ls -la /data/users/5072fce2-e66e-4bf7-8fd2-623cfd3afaf6/spaces/` devuelve 16 directorios (`drwxr-xr-x 18 root root`) con fecha de carpeta entre el 2026-09-25 y el 2026-10-27.

Un dato que atraviesa toda la tabla: **ningún espacio contiene documentos propios**. Los únicos archivos reales de todo `spaces/` son dos, y están en un directorio sin registro de espacio: `fw_389219c69fe82404/correo-adjuntos/PO 505433.pdf` (367.361 B) e `image.png` (84.447 B), ambos del 2026-09-25 22:15.

El resto de lo que hay en cada carpeta es andamiaje generado (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.gemini/`, `.kimi/`, `.agents/`, `.claude/settings.json`) y el `.faberloom/harness.json`. Esos archivos llevan marca **2026-11-23 22:35** en todas las carpetas menos una (la que se señala en la tabla), que es el arranque del contenedor actual (`Up 54 minutes` a las 23:29): el harness los regenera al bootear, no son trabajo del dueño. Por eso la columna de fecha usa la carpeta y el `generatedAt` del `harness.json`, no el `mtime` del andamiaje.

| Espacio en disco (nombre exacto) | Clasificación | Evidencia observada | Decisión |
|---|---|---|---|
| `fw_e4aab0813fcd8579` | PRODUCCIÓN | 0 archivos propios; carpeta 2026-10-19 21:31; espacio `36dce89f` «Factura Electrónica 00900001010000183212 — COMPAÑÍA TÉCNICA Y COMERCIAL SATEC, S.A.»; **42 sesiones registradas** | Se conserva y aparece en el selector |
| `fw_cc592aae4be3187e` | PRODUCCIÓN | 0 archivos propios; carpeta 2026-10-19 20:44; espacio `9de8ba7b` «email_docker»; **12 sesiones**; `harness.json` de 25.225 B con **22 entradas** de memoria de negocio (Sondel OC 20845, FE 137, PCS, DHL, ADN) | Se conserva y aparece en el selector |
| `fw_b9556b323bf52def` | PRODUCCIÓN | 0 archivos propios; carpeta 2026-10-19 20:44; espacio `3cdbb682` «2417-2026 · PO 504802»; **6 sesiones**; sin memoria propia | Se conserva y aparece en el selector |
| `Prueba OC 20845 - Muito Work` | PRUEBA | 0 archivos propios; carpeta 2026-10-22 19:10; subcarpetas `OC 20845 - Sondel CR` y dentro `PF y documentos OC 20845`; espacio `5d95dbf0`; **4 sesiones**; memoria de corridas de prueba del flujo | Se conserva oculto |
| `Prueba-2` | PRUEBA | 0 archivos propios; carpeta 2026-10-27 01:34; subcarpetas `Subspace UI 7ed13`, `pryeba2`; espacio `41018ac5` «Prueba»; **7 sesiones**; **6 entradas** de memoria sobre cambios de modelo (gpt-5.4-nano, kimi, haiku, gemini) | Se conserva oculto |
| `Prueba` | PRUEBA | 0 archivos propios; carpeta 2026-10-23 09:46; subcarpeta `Subspace UI 7ed13`; espacio `1a1b0daf` «Prueba»; 0 sesiones | Se conserva oculto |
| `Test User OC 20845` | PRUEBA | 0 archivos propios; carpeta 2026-10-23 09:46; espacio `73bfbed6`; 0 sesiones en el registro de sesiones; memoria del usuario de test `test.muitowork@muitowork.com` | Se conserva oculto |
| `Probe carpeta raiz-2` | PRUEBA | 0 archivos propios; carpeta 2026-10-23 09:46; tres niveles de subcarpetas «Probe carpeta hija» / «... hija de la hija»; espacio `1153535c`, **`archived: true`**; **7 sesiones** | Se conserva oculto (ya archivado en el registro) |
| `Probe carpeta raiz` | PRUEBA | 0 archivos propios; carpeta 2026-10-21 17:47; subcarpeta «Probe carpeta hija»; espacio `190ecbcb`, `archived: false`; 0 sesiones | Se conserva oculto |
| `Facturas ADN Logistica` | HUÉRFANO | 0 archivos propios; carpeta 2026-10-22 13:57; el `harness.json` apunta al espacio `e9ac30e1`, creado en el **lote de duplicados del 2026-10-22 19:28:01**, con 0 sesiones; el espacio original del mismo nombre (`9cccaf0e`, 13:09, 10 sesiones) **no tiene carpeta** | Propuesto para archivar (la carpeta conserva el nombre del original) |
| `Facturas ADN Logística-2` | HUÉRFANO | 0 archivos propios; carpeta 2026-10-22 19:10; espacio `6ac6069f` del lote de duplicados; 0 sesiones | Propuesto para archivar |
| `Facturas ADN Logística-3` | HUÉRFANO | 0 archivos propios; carpeta 2026-10-23 09:46; espacio `d5b8aa8a`; única subcarpeta `sub spaces` (espacio `a1ae9a80`, 2 sesiones); 0 sesiones propias | Propuesto para archivar (con su sub espacio) |
| `Facturas ADN Logística` | HUÉRFANO | 0 archivos; carpeta 2026-10-22 13:57; su `harness.json` declara el espacio `939f699a-4314-45a9-b8a9-7df076d097db`, **que no existe en `faberloom_spaces.json`**; es la única carpeta con andamiaje previo que el arranque del 23-nov no reescribió (sus archivos siguen en 2026-10-22 13:57) | Propuesto para archivar |
| `Facturas ADN Log?stica` | HUÉRFANO | 0 archivos, 0 subcarpetas, 4,0 K; carpeta 2026-10-22 14:03; **el nombre en disco no es UTF-8** (`ls` muestra `?` en lugar del byte inválido); sin `harness.json` ni registro | Propuesto para archivar |
| `fw_182756accd387a13` | HUÉRFANO | 0 archivos, 0 subcarpetas, 4,0 K; carpeta 2026-09-25 22:16; sin `harness.json`, sin espacio en el registro, sin sesiones | Propuesto para archivar |
| `fw_389219c69fe82404` | HUÉRFANO | 2 archivos reales en `correo-adjuntos/` (`PO 505433.pdf` 367.361 B e `image.png` 84.447 B, 2026-09-25 22:15); sin `harness.json`, sin espacio en el registro, sin sesiones | Propuesto para archivar **después** de rescatar el PDF a un espacio con dueño |

Cuenta resultante: **3 PRODUCCIÓN, 6 PRUEBA, 7 HUÉRFANO**.

## 3. Por qué hay duplicados: un lote del 2026-10-22 19:28:01

`faberloom_spaces.json` tiene **34 registros** de espacio, pero solo 16 carpetas y 25 workspaces. La diferencia no es azar: hay un grupo de registros creados con milisegundos de diferencia el **2026-10-22 19:28:01**, con los mismos títulos que espacios anteriores.

Los registros del lote son doce: `4f684962` y `39c9c759` (PF y documentos OC 20845, OC 20845 - Sondel CR), `c2b8e09d` (Prueba OC 20845), `6ac6069f` (Facturas ADN Logística), `e9ac30e1` (Facturas ADN Logistica), `8938c681` (Probe carpeta hija), `190ecbcb` (Probe carpeta raiz), `0f03790d` (SATEC), `1a1b0daf` (Prueba), `cec6c587` (SICOP), `294e4c4e` (2417-2026) y `0fa353a8` (email_docker). Doce copias de una vez, con `createdAt` que van de `19:28:01.061` a `19:28:01.586`.

Consecuencia medida: hay carpetas `-2` y `-3` al lado de las originales, y hay un caso en que la carpeta con el nombre original pertenece al duplicado. El caso concreto es `Facturas ADN Logistica`: el espacio con las 10 sesiones (`9cccaf0e`, creado 13:09) quedó sin carpeta y la carpeta la ocupa el duplicado sin uso (`e9ac30e1`, creado en el lote). El mecanismo que produjo ese reparto no se leyó en el código; lo observado es el resultado. Eso no se repara aquí: entra como defecto de identidad de espacios, no como decisión editorial.

El único registro con `archived: true` es `1153535c` («Probe carpeta raiz», cuya carpeta en disco es `Probe carpeta raiz-2`). El producto ya tiene los campos que hacen falta para ocultar y para anidar (`archived`, `parentId`): este documento no pide mecanismo nuevo.

## 4. Lista formal del selector (en orden)

Criterio: solo espacios con asunto de negocio real y sesiones propias; orden por sesiones registradas, de más a menos. Tres entradas.

1. `36dce89f-b0db-414a-adfc-dda660348541` · «Factura Electrónica 00900001010000183212 — COMPAÑÍA TÉCNICA Y COMERCIAL SATEC, S.A.» · carpeta `spaces/fw_e4aab0813fcd8579` · 42 sesiones.
2. `9de8ba7b-babe-49da-a153-0bda21cfb93d` · «email_docker» · carpeta `spaces/fw_cc592aae4be3187e` · 12 sesiones.
3. `3cdbb682-1cc6-4436-84cc-818994952744` · «2417-2026 · PO 504802» · carpeta `spaces/fw_b9556b323bf52def` · 6 sesiones.

Los otros 31 registros no entran en el selector: siete son los huérfanos de la tabla, el resto son espacios de prueba con nombre explícito (`Prueba`, `Probe`, `Test User`), sub espacios que se muestran dentro de su padre y no como entrada de primer nivel, y los duplicados sin carpeta del lote del 19:28:01.

Dos observaciones que el CEO debe conocer antes de firmar: el título `email_docker` es un nombre interno, no un nombre de negocio, y el mismo título de SATEC está repetido en el registro (`0f03790d` sin carpeta). Cambiar un título o fusionar dos registros es una decisión de producto, no de inventario, y por eso no se ejecutó.

## 5. Qué queda cubierto con esto

Cubierto: el inventario observable del servidor real, la clasificación de los 16 directorios con evidencia de conteo y fecha, la lista formal del selector con identificadores y orden, y la decisión por espacio sin borrar nada.

Cubierto además: la prueba de que el contenido de los espacios hoy es andamiaje generado más memoria, no documentos; y la prueba de que el único archivo real fuera de un espacio con dueño es el `PO 505433.pdf` del directorio huérfano `fw_389219c69fe82404`.

N3 queda **CERRADA** con la firma delegada de §7: lo que faltaba era el insumo del CEO, y ese insumo es esta lista. El inventario ya no es el bloqueo. Las dos decisiones de producto del §4 —cambiar el título interno `email_docker` y fusionar el título repetido de SATEC— siguen siendo del dueño y no se ejecutan aquí.

No cubierto, y no se finge: la asignación manual de espacios a usuarios y las reglas 3a ya están implementadas y no se reabren aquí; el defecto de dos espacios que comparten o pierden carpeta queda registrado pero sin arreglo; el rescate del PDF huérfano y el archivado efectivo de los siete huérfanos necesitan una ejecución aparte, con autorización; y la memoria de cada espacio no se clasificó entrada por entrada (solo se contaron y se leyeron títulos), lo que corresponde a la curación de O5-05.

## 6. Reproducir

```sh
docker exec mwt-one-harness-gateway sh -c 'ls -la /data/users/5072fce2-e66e-4bf7-8fd2-623cfd3afaf6/spaces/'
docker exec mwt-one-harness-gateway sh -c 'cd /data/users/5072fce2-e66e-4bf7-8fd2-623cfd3afaf6/spaces && for d in */; do echo "$d $(find "$d" -type f | wc -l)"; done'
docker exec mwt-one-harness-gateway cat /data/users/5072fce2-e66e-4bf7-8fd2-623cfd3afaf6/storages/faberloom_spaces.json
docker exec mwt-one-harness-gateway cat /data/users/5072fce2-e66e-4bf7-8fd2-623cfd3afaf6/storages/workspace.json
docker exec mwt-one-harness-gateway cat /data/users/5072fce2-e66e-4bf7-8fd2-623cfd3afaf6/storages/faberloom_session_shares.json
```

Salida resumida de la primera: 16 líneas `drwxr-xr-x`, de `Facturas ADN Log?stica` (2026-10-22 14:03) a `fw_e4aab0813fcd8579` (2026-10-19 21:31). De la última: 11 espacios con sesiones, encabezados por `36dce89f` (42) y `9de8ba7b` (12).

## 7. Firma del gate N3

```
gate: N3
estado: CERRADO
fecha: 2026-11-23
firma: AGENTE-DELEGADO por D/decisions/DEC-2026-11-23-DELEGACION-CIERRE.md
alcance: la lista formal del selector (§4) y la clasificación de los 16 directorios (§3)
```

Se firma lo que el gate pedía: la lista de espacios ya creados, obtenida del servidor y del registro del producto, sin inventar espacios y sin borrar ninguno. No se firma el arreglo de los duplicados ni el archivado de los huérfanos: son trabajo de producto con su propia autorización, y quedan declarados en §5.
