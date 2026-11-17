# O5-02A · Reglas de asignación

- Contrato: C-FL-04 · Ola O5 · Etapa E1
- Revisión: `0b01ca39365ba04fe89858bcac56e3523896ee4d` + checkpoint `6b71b07`
- Alcance: servicio backend con criterio exacto, origen, versión, conflicto y revocación persistente
- Nivel: C1-E (pruebas ejecutadas)
- Estado: **READY_FOR_CEO**
- Gate: PC1, PC2, O5-01

## 1. Qué decide una regla

Una regla lee **un** campo del ítem y lo compara con **un** operador exacto:

| Campo | Operador | Ejemplo |
|---|---|---|
| `from` | `equals`, `contains`, `startsWith` | remitente contiene `eguisa` |
| `subject` | los mismos | asunto empieza por `OC` |
| `account` | los mismos | cuenta que recibió |
| `company` | los mismos | empresa del ítem |

No hay comodines, expresiones regulares ni cuerpo del mensaje: una regla no inspecciona adjuntos ni texto. El valor se recorta y la comparación ignora mayúsculas; un campo ausente nunca coincide.

## 2. Decisión, no efecto

`evaluate(owner, subject)` devuelve:

| Estado | Cuándo | Resultado |
|---|---|---|
| `none` | Ninguna regla activa coincide | sin destino |
| `assigned` | Todas las que coinciden nombran el mismo destino | el destino, con las reglas y versiones que decidieron |
| `conflict` | Dos reglas activas nombran destinos distintos | `target: null` y los destinos en `conflicts` |

En conflicto **no se elige un lado**: el consumidor ve los candidatos y decide. Nada se mueve, no se lee ningún buzón y no se concede acceso a ningún espacio; el servicio solo decide, y el consumidor actúa bajo su propia autoridad. `evaluate` no escribe: dos evaluaciones seguidas dejan versiones y revocación intactas (probado).

## 3. Origen, versión y revocación

- **Origen**: quién creó la regla, cuándo y desde qué ítem (`human` o `learned`). El panel podrá rotular `asignado por regla` con ese dato.
- **Versión**: empieza en 1 y sube en cada edición; la decisión nombra la versión exacta que la tomó.
- **Revocación**: `revokedAt` es permanente; la regla deja de coincidir pero sigue listada. Una regla revocada no se puede editar, así que la historia no se revive por accidente. Revocar dos veces es idempotente.
- **Dueño**: solo el dueño edita y revoca; otro dueño recibe un rechazo.

## 4. Evidencia ejecutada

```
vitest assignment              8 pruebas
suite completa                 1.765: 1.763 pasan, 1 omitida, 1 falla de red conocida
tsc -b host                    exit 0
catálogo Cordis / persistencia al día
```

| Prueba | Qué demuestra |
|---|---|
| Coincidencia exacta | Asigna y devuelve la regla y su versión; mayúsculas no importan |
| No coincidencia | Otro remitente o campo ausente no asignan; `equals` no confunde con prefijo |
| Dos reglas, mismo destino | Sigue `assigned`, con las dos reglas como evidencia |
| Dos reglas, destinos distintos | `conflict`, sin destino, con ambos candidatos |
| Revocación | Deja de coincidir, sigue listada, versión sube, segunda revocación no cambia nada |
| Edición | Versión sube, origen se conserva, la decisión usa el criterio nuevo |
| Validación y dueño | Valor vacío, destino vacío y otro dueño se rechazan |
| Sin escritura | Evaluar dos veces no altera versiones ni revocación |

## 5. Lo que queda para O5-02B/C

- **O5-02B**: montar el servicio en la composición y probar la persistencia entre reinicios.
- **O5-02C**: el gesto de asignación con la regla visible, la opción de desmarcar y el rótulo `asignado por regla`; desmarcar no crea una regla activa, y no hay movimiento en servidor ni permiso nuevo.
- Las reglas compuestas y el cuerpo del mensaje quedan fuera del vocabulario actual.
