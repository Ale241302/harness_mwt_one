# O4-05 · Adjuntos y conversión con límites

- Contrato: C-FL-04 · Ola O4 · Etapa E1
- Revisión: `0b01ca39365ba04fe89858bcac56e3523896ee4d`
- Alcance: conversión de adjuntos con límites de tamaño, tiempo, rutas y red; originales íntegros; omisiones visibles
- Nivel: C1-E (pruebas ejecutadas) + C1-I (proceso real del conversor en pruebas)
- Estado: **READY_FOR_CEO**
- Gate: PC1, PC2, O4-02, O4-04

## 1. Qué se limita

| Límite | Valor | Qué pasa al superarlo |
|---|---|---|
| Tamaño de entrada | 25 MB por adjunto | Se omite como `oversized`, sin escribir ni lanzar el conversor |
| Tiempo por documento | 20 s | Se termina el proceso y se informa `timeout` |
| Salida a Markdown | 200 KB | La salida se corta; el documento se entrega truncado |
| Diagnóstico del conversor | 8 KB | No se muestra; nunca llega al modelo |
| Directorio de trabajo | Temp por lote | Se borra en toda salida, con éxito o fallo |

El original no se toca: los bytes se copian a un archivo temporal; el adjunto del correo sigue siendo el mismo. Rutas: el lanzador se resuelve por el grafo de módulos del propio paquete y el temporal vive en el directorio temporal del sistema, no en el workspace.

## 2. Omisiones visibles

Antes, un adjunto que no convertía desaparecía de la lista y el modelo veía «sin texto extraíble» sin saber por qué. Ahora cada adjunto declara su resultado:

| Resultado | Cuándo |
|---|---|
| `unsupported` | Extensión que el conversor no lee (png, zip, sin extensión) |
| `oversized` | Supera el límite de entrada |
| `timeout` | El proceso no terminó en 20 s |
| `failed` | Salida distinta de cero, fallo de spawn o de escritura |
| `empty` | Terminó bien pero no extrajo texto (por ejemplo, PDF escaneado sin OCR) |
| `converter-missing` | La ingesta no está configurada o falta el lanzador |

La herramienta `faberloom_mail_read` añade `note` a cada adjunto sin texto y el render lo repite: «sin texto extraíble (la conversión no está configurada)». `markdownFromAttachments` sigue existiendo como atajo de los que sí convirtieron; el detalle vive en `convertAttachments`.

## 3. Red y macros

- El OCR alojado solo se usa si el despliegue lo configuró (`anydocOcr: hosted`) y con su clave; por defecto es `reject` y un PDF escaneado se informa como `empty`.
- Los enlaces del cuerpo se **listan**, no se descargan. No hay descarga automática a ningún destino.
- Un `.docm` o `.xlsx` con macros se convierte a texto; el conversor no ejecuta macros.
- La política de destinos de O3-06 cubre los transportes de correo; el conversor es un proceso local que solo habla con el servicio de OCR si se habilitó.

## 4. Evidencia ejecutada

```
vitest inbound/documents       13 pruebas (6 nuevas de resultados)
vitest tool-faberloom           6 pruebas de adjuntos (1 nueva del aviso)
suite completa                 1.752: 1.751 pasan, 1 omitida
tsc -b (inbound, tool)         exit 0
```

| Prueba | Qué demuestra |
|---|---|
| Formato y vacío | Extensión no soportada y nombre sin extensión se nombran como `unsupported` |
| Sobredimensionado | Un adjunto mayor que el límite se omite sin lanzar el conversor |
| Timeout | Se distingue del fallo: `timeout` tras el límite, no `failed` |
| Fallo y vacío | Salida distinta de cero es `failed`; salida en blanco es `empty` |
| Sin conversor | `converter-missing`, no «vacío» |
| Herramienta | El render dice el motivo en vez de un genérico |

## 5. Lo que no cubre

- La calidad de la conversión de un PDF escaneado depende del OCR alojado; sin él se informa `empty`, no se inventa texto.
- El límite de salida trunca el Markdown; el aviso de truncamiento no se muestra todavía al modelo (el texto llega cortado, sin marca). Queda para O6 cuando el lector de adjuntos tenga su tarjeta propia.
- Los adjuntos se procesan en serie; un lote grande tarda, y el límite es por documento, no por lote.
