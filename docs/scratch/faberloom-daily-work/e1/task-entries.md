# O5-04 · Tres entradas y Mesa (servicio)

- Contrato: C-FL-04 · Ola O5 · Etapa E1
- Revisión: `0b01ca39365ba04fe89858bcac56e3523896ee4d` + checkpoint `72ebbfb`
- Alcance de esta entrega: el servicio de entrada única; la capa de gestos queda pendiente
- Nivel: C1-E (servicio y pruebas)
- Estado: **PARCIAL · READY_FOR_REVIEW**
- Gate: PC1, PC2, O5-03

## 1. Una entrada, tres orígenes

`openTaskEntry(input)` crea la tarea en la Mesa desde cualquiera de las tres entradas y resuelve **una sola vez**:

| Entrada | Referencia | Evidencia | Clave |
|---|---|---|---|
| Correo | `accountRef:uid` | `mail:<cuenta>:<uid>` | `entry:email:<ref>` |
| Ítem de la Mesa | id del ítem | `board:<id>` | `entry:item:<ref>` |
| Aviso | id del aviso | `notice:<id>` | `entry:notice:<ref>` |
| Desde cero | id de pestaña, o ninguno | la propia entrada | `entry:scratch:<ref o uuid>` |

La clave viaja como `idempotencyKey` al tablero, que ya devuelve el ítem existente para la misma clave: un doble clic, una recarga o el mismo correo abierto dos veces resuelven a **un ítem con un historial**, no a dos. Sin `ref` en un correo, ítem o aviso la entrada se rechaza: una tarea sin origen real no es una tarea.

La prioridad se mapea a la severidad del tablero (`high` → `HIGH`), y el espacio y la cuenta viajan como referencias del ítem. La entrada no lee el buzón ni mueve nada: registra el ítem y su evidencia.

## 2. Evidencia ejecutada

```
vitest view/task-entry       5 pruebas
tsc -b host                  exit 0
catálogo Cordis              al día
```

| Prueba | Qué demuestra |
|---|---|
| Correo | Evidencia `mail:cuenta:uid`, severidad y referencias mapeadas |
| Mismo correo, dos veces | Misma clave y mismo ítem |
| Ítem y aviso | Cada uno con su referencia y su evidencia |
| Desde cero | Con id de pestaña es idempotente; sin id, cada gesto es una tarea nueva |
| Rechazos | Sin referencia, sin título o identidad de solo lectura |

## 3. Lo que falta para cerrar O5-04

- **Los tres gestos en la interfaz**: botón en el lector de correo, botón en el detalle del ítem/aviso y compositor «desde cero», cada uno abriendo el ítem que devuelve el servicio.
- **La pasada visual** de esas entradas a dos looks y tamaños (PC3), como el resto de la ola.
- **El historial visible** ya existe en el detalle del tablero; la entrada nueva aparece con el evento de envío y su evidencia.

No se declara cerrado: el servicio está probado y la clave de idempotencia es la que impide duplicados, pero sin los tres botones la aceptación de T12-E1 no se cumple.
